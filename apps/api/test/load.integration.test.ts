import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const run = process.env.RUN_DB_TESTS === '1';
const LOAD_PRODUCTS = Number(process.env.LOAD_PRODUCT_COUNT ?? 2000);

describe.skipIf(!run)('load check', () => {
  let app: Express;
  let managerA: Auth;
  let staffA: Auth;

  beforeAll(async () => {
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase();
    await seedBase(LOAD_PRODUCTS);
    managerA = await login(app, 'manager@storeA.test');
    staffA = await login(app, 'staff1@storeA.test');
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    `handles snapshot, paged items, batch save, and apply for ${LOAD_PRODUCTS} SKUs`,
    async () => {
      const t0 = Date.now();
      const created = await createSession(app, managerA);
      expect(created.status).toBe(201);
      const sessionId = created.body.id as string;
      const createMs = Date.now() - t0;

      const t1 = Date.now();
      const page = await request(app)
        .get(`/api/v1/sessions/${sessionId}/items?limit=100`)
        .set(authHeader(staffA.token));
      expect(page.status).toBe(200);
      expect(page.body.items.length).toBe(100);
      expect(page.body.nextCursor).toBeTruthy();
      const pageMs = Date.now() - t1;

      const batch = Array.from({ length: 200 }, (_, i) => {
        const n = String(i + 1).padStart(5, '0');
        return { sku: `SKU-${n}`, countedQty: 1 };
      });
      const t2 = Date.now();
      const save = await request(app)
        .put(`/api/v1/sessions/${sessionId}/items`)
        .set(authHeader(staffA.token))
        .send({ items: batch });
      expect(save.status).toBe(200);
      const saveMs = Date.now() - t2;

      await request(app)
        .post(`/api/v1/sessions/${sessionId}/submit`)
        .set(authHeader(staffA.token));

      const t3 = Date.now();
      const approve = await request(app)
        .post(`/api/v1/sessions/${sessionId}/approve`)
        .set(authHeader(managerA.token))
        .set('Idempotency-Key', 'load-approve');
      expect(approve.status).toBe(202);
      const applyMs = Date.now() - t3;

      const session = await prisma.opnameSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.status).toBe('APPLIED');

      // Soft budgets — fail loudly only if pathologically slow
      expect(createMs).toBeLessThan(15_000);
      expect(pageMs).toBeLessThan(3_000);
      expect(saveMs).toBeLessThan(10_000);
      expect(applyMs).toBeLessThan(15_000);

      console.log(
        JSON.stringify({
          products: LOAD_PRODUCTS,
          createMs,
          pageMs,
          saveMs,
          applyMs,
        }),
      );
    },
    180_000,
  );
});
