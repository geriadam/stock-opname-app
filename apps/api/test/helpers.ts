import argon2 from 'argon2';
import request from 'supertest';
import type { Express } from 'express';
import { PrismaClient, Role } from '@prisma/client';

export const prisma = new PrismaClient();

export type Auth = { token: string; userId: string; storeId: string };

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      stock_movements,
      opname_submissions,
      opname_items,
      opname_sessions,
      audit_log,
      refresh_tokens,
      store_stock,
      products,
      users,
      stores
    RESTART IDENTITY CASCADE
  `);
}

export async function seedBase(productCount = 10) {
  const passwordHash = await argon2.hash('Password123!', { type: argon2.argon2id });

  const storeA = await prisma.store.create({ data: { id: 'store-a', name: 'Store A' } });
  const storeB = await prisma.store.create({ data: { id: 'store-b', name: 'Store B' } });

  const users = await Promise.all([
    prisma.user.create({
      data: {
        email: 'manager@storeA.test',
        name: 'Manager A',
        role: Role.MANAGER,
        storeId: storeA.id,
        passwordHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'staff1@storeA.test',
        name: 'Staff 1 A',
        role: Role.STAFF,
        storeId: storeA.id,
        passwordHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'manager@storeB.test',
        name: 'Manager B',
        role: Role.MANAGER,
        storeId: storeB.id,
        passwordHash,
      },
    }),
    prisma.user.create({
      data: {
        email: 'staff1@storeB.test',
        name: 'Staff 1 B',
        role: Role.STAFF,
        storeId: storeB.id,
        passwordHash,
      },
    }),
  ]);

  const products = Array.from({ length: productCount }, (_, i) => {
    const n = String(i + 1).padStart(5, '0');
    return { id: `prod-${n}`, sku: `SKU-${n}`, name: `Product ${n}`, unit: 'pcs' };
  });
  await prisma.product.createMany({ data: products });

  await prisma.storeStock.createMany({
    data: products.flatMap((p, idx) => [
      { storeId: storeA.id, productId: p.id, quantity: 10 + (idx % 20) },
      { storeId: storeB.id, productId: p.id, quantity: 5 + (idx % 15) },
    ]),
  });

  return { storeA, storeB, users, products };
}

export async function login(app: Express, email: string): Promise<Auth> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: 'Password123!' });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
    storeId: res.body.user.storeId as string,
  };
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function createSession(app: Express, manager: Auth, storeId = manager.storeId) {
  const res = await request(app)
    .post('/api/v1/sessions')
    .set(authHeader(manager.token))
    .send({ storeId });
  return res;
}

export async function waitForStatus(
  app: Express,
  token: string,
  sessionId: string,
  status: string,
  attempts = 30,
) {
  for (let i = 0; i < attempts; i++) {
    const res = await request(app)
      .get(`/api/v1/sessions/${sessionId}`)
      .set(authHeader(token));
    if (res.body.status === status) return res.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Session ${sessionId} did not reach ${status}`);
}
