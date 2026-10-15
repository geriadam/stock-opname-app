import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  authHeader,
  createSession,
  login,
  prisma,
  resetDatabase,
  seedBase,
  type Auth,
} from './helpers.js';
import { applyStockJob } from '../src/jobs/apply-stock.js';

const run = process.env.RUN_DB_TESTS === '1';

describe.skipIf(!run)('opname integration', () => {
  let app: Express;
  let managerA: Auth;
  let staffA: Auth;
  let managerB: Auth;
  let staffB: Auth;

  beforeAll(async () => {
    const { createApp } = await import('../src/app.js');
    app = createApp();
  });

  beforeEach(async () => {
    delete process.env.FORCE_APPLY_FAIL;
    await resetDatabase();
    await seedBase(12);
    managerA = await login(app, 'manager@storeA.test');
    staffA = await login(app, 'staff1@storeA.test');
    managerB = await login(app, 'manager@storeB.test');
    staffB = await login(app, 'staff1@storeB.test');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects bad credentials with generic message', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/invalid/i);
  });

  it('enforces RBAC and store isolation', async () => {
    const created = await createSession(app, managerA);
    expect(created.status).toBe(201);
    const sessionId = created.body.id as string;

    const staffCreate = await createSession(app, staffA);
    expect(staffCreate.status).toBe(403);

    const crossStore = await request(app)
      .post('/api/v1/sessions')
      .set(authHeader(managerA.token))
      .send({ storeId: 'store-b' });
    expect(crossStore.status).toBe(403);

    const staffBView = await request(app)
      .get(`/api/v1/sessions/${sessionId}`)
      .set(authHeader(staffB.token));
    expect(staffBView.status).toBe(403);

    const managerBApprove = await request(app)
      .post(`/api/v1/sessions/${sessionId}/approve`)
      .set(authHeader(managerB.token));
    expect(managerBApprove.status).toBe(403);

    const staffApprove = await request(app)
      .post(`/api/v1/sessions/${sessionId}/approve`)
      .set(authHeader(staffA.token));
    expect(staffApprove.status).toBe(403);
  });

  it('blocks a second active session for the same store', async () => {
    const first = await createSession(app, managerA);
    expect(first.status).toBe(201);

    const second = await createSession(app, managerA);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ACTIVE_SESSION_EXISTS');

    const otherStore = await createSession(app, managerB);
    expect(otherStore.status).toBe(201);
  });

  it('submit does not change store stock', async () => {
    const created = await createSession(app, managerA);
    const sessionId = created.body.id as string;

    const before = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });

    const save = await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty: before.quantity + 5 }] });
    expect(save.status).toBe(200);

    const submit = await request(app)
      .post(`/api/v1/sessions/${sessionId}/submit`)
      .set(authHeader(staffA.token))
      .set('Idempotency-Key', 'submit-1');
    expect(submit.status).toBe(200);
    expect(submit.body.session.status).toBe('SUBMITTED');

    const after = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });
    expect(after.quantity).toBe(before.quantity);
  });

  it('rejects duplicate SKUs in a batch and accepts unexpected SKU', async () => {
    const created = await createSession(app, managerA);
    const sessionId = created.body.id as string;

    // Extra product not in store_stock snapshot → unexpected when counted
    await prisma.product.create({
      data: { id: 'prod-extra', sku: 'SKU-EXTRA', name: 'Extra', unit: 'pcs' },
    });

    const dup = await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({
        items: [
          { sku: 'SKU-00001', countedQty: 1 },
          { sku: 'SKU-00001', countedQty: 2 },
        ],
      });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('DUPLICATE_SKU');

    const unexpected = await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-EXTRA', countedQty: 3 }] });
    expect(unexpected.status).toBe(200);

    const item = await prisma.opnameItem.findFirst({
      where: { sessionId, productId: 'prod-extra' },
    });
    expect(item?.isUnexpected).toBe(true);
    expect(item?.systemQty).toBe(0);
    expect(item?.countedQty).toBe(3);
  });

  it('reject then resubmit increments revision', async () => {
    const created = await createSession(app, managerA);
    const sessionId = created.body.id as string;

    await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty: 11 }] });

    const submit1 = await request(app)
      .post(`/api/v1/sessions/${sessionId}/submit`)
      .set(authHeader(staffA.token));
    expect(submit1.body.session.revision).toBe(1);

    const reject = await request(app)
      .post(`/api/v1/sessions/${sessionId}/reject`)
      .set(authHeader(managerA.token))
      .send({ reason: 'Recount shelf A' });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('REJECTED');

    await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty: 12 }] });

    const submit2 = await request(app)
      .post(`/api/v1/sessions/${sessionId}/submit`)
      .set(authHeader(staffA.token));
    expect(submit2.status).toBe(200);
    expect(submit2.body.session.revision).toBe(2);
    expect(submit2.body.session.status).toBe('SUBMITTED');

    const submissions = await prisma.opnameSubmission.findMany({
      where: { sessionId },
      orderBy: { revision: 'asc' },
    });
    expect(submissions).toHaveLength(2);
    expect(submissions[0]!.decision).toBe('REJECTED');
    expect(submissions[1]!.decision).toBe('PENDING');
  });

  it('approve applies delta once; parallel approve collapses to one apply', async () => {
    const created = await createSession(app, managerA);
    const sessionId = created.body.id as string;

    const stockBefore = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });
    // Simulate a sale during count: live stock drops by 2 vs snapshot
    await prisma.storeStock.update({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
      data: { quantity: stockBefore.quantity - 2 },
    });

    const systemQty = stockBefore.quantity; // snapshot value
    const countedQty = systemQty + 3; // variance +3
    // expected new = (systemQty - 2) + 3 = systemQty + 1

    await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty }] });

    await request(app)
      .post(`/api/v1/sessions/${sessionId}/submit`)
      .set(authHeader(staffA.token));

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post(`/api/v1/sessions/${sessionId}/approve`)
          .set(authHeader(managerA.token))
          .set('Idempotency-Key', `approve-${i}`),
      ),
    );

    const accepted = results.filter((r) => r.status === 202);
    const conflicted = results.filter((r) => r.status === 409);
    expect(accepted.length).toBeGreaterThanOrEqual(1);
    expect(accepted.length + conflicted.length).toBe(10);

    const session = await prisma.opnameSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe('APPLIED');

    const stockAfter = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });
    expect(stockAfter.quantity).toBe(systemQty + 1);

    const movements = await prisma.stockMovement.findMany({ where: { sessionId } });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.delta).toBe(3);

    // Idempotent re-apply does not duplicate movements
    await prisma.opnameSession.update({
      where: { id: sessionId },
      data: { status: 'APPLYING' },
    });
    await applyStockJob(sessionId);
    const movements2 = await prisma.stockMovement.findMany({ where: { sessionId } });
    expect(movements2).toHaveLength(1);
    const stockFinal = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });
    expect(stockFinal.quantity).toBe(systemQty + 1);
  });

  it('apply failure rolls back stock and sets APPLY_FAILED', async () => {
    const created = await createSession(app, managerA);
    const sessionId = created.body.id as string;

    const before = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });

    await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty: before.quantity + 9 }] });
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/submit`)
      .set(authHeader(staffA.token));

    process.env.FORCE_APPLY_FAIL = '1';
    const approve = await request(app)
      .post(`/api/v1/sessions/${sessionId}/approve`)
      .set(authHeader(managerA.token))
      .set('Idempotency-Key', 'fail-once');
    expect([500, 202]).toContain(approve.status);

    const session = await prisma.opnameSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe('APPLY_FAILED');
    expect(session.applyError).toMatch(/Injected apply failure/i);

    const after = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });
    expect(after.quantity).toBe(before.quantity);
    expect(await prisma.stockMovement.count({ where: { sessionId } })).toBe(0);

    delete process.env.FORCE_APPLY_FAIL;
    const retry = await request(app)
      .post(`/api/v1/sessions/${sessionId}/retry-apply`)
      .set(authHeader(managerA.token));
    expect(retry.status).toBe(202);

    const applied = await prisma.opnameSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(applied.status).toBe('APPLIED');
    const stock = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00001' } },
    });
    expect(stock.quantity).toBe(before.quantity + 9);
  });

  it('clamps negative apply results at zero', async () => {
    const created = await createSession(app, managerA);
    const sessionId = created.body.id as string;

    const before = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00002' } },
    });
    // Live stock almost empty vs high snapshot system qty
    await prisma.storeStock.update({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00002' } },
      data: { quantity: 1 },
    });

    await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00002', countedQty: 0 }] });
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/submit`)
      .set(authHeader(staffA.token));
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/approve`)
      .set(authHeader(managerA.token))
      .set('Idempotency-Key', 'clamp');

    const after = await prisma.storeStock.findUniqueOrThrow({
      where: { storeId_productId: { storeId: 'store-a', productId: 'prod-00002' } },
    });
    expect(after.quantity).toBe(0);

    const movement = await prisma.stockMovement.findFirst({
      where: { sessionId, productId: 'prod-00002' },
    });
    expect(movement?.afterQty).toBe(0);
    expect(movement?.note).toMatch(/clamp/i);
    expect(before.quantity).toBeGreaterThan(0);
  });

  it('blocks staff edits after submit until withdraw', async () => {
    const created = await createSession(app, managerA);
    const sessionId = created.body.id as string;

    await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty: 10 }] });
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/submit`)
      .set(authHeader(staffA.token));

    const locked = await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty: 99 }] });
    expect(locked.status).toBe(409);

    const withdraw = await request(app)
      .post(`/api/v1/sessions/${sessionId}/withdraw`)
      .set(authHeader(staffA.token));
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.status).toBe('OPEN');

    const edit = await request(app)
      .put(`/api/v1/sessions/${sessionId}/items`)
      .set(authHeader(staffA.token))
      .send({ items: [{ sku: 'SKU-00001', countedQty: 99 }] });
    expect(edit.status).toBe(200);
  });
});
