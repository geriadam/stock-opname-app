import 'dotenv/config';
import argon2 from 'argon2';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'Password123!';
const PRODUCT_COUNT = Number(process.env.SEED_PRODUCT_COUNT ?? 200);

async function upsertUser(opts: {
  email: string;
  name: string;
  role: Role;
  storeId: string;
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: { email: opts.email },
    update: {
      name: opts.name,
      role: opts.role,
      storeId: opts.storeId,
      passwordHash: opts.passwordHash,
    },
    create: opts,
  });
}

async function main() {
  const passwordHash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });

  const storeA = await prisma.store.upsert({
    where: { id: 'store-a' },
    update: { name: 'Store A' },
    create: { id: 'store-a', name: 'Store A' },
  });
  const storeB = await prisma.store.upsert({
    where: { id: 'store-b' },
    update: { name: 'Store B' },
    create: { id: 'store-b', name: 'Store B' },
  });

  const accounts = [
    { email: 'manager@storeA.test', name: 'Manager A', role: Role.MANAGER, storeId: storeA.id },
    { email: 'staff1@storeA.test', name: 'Staff 1 A', role: Role.STAFF, storeId: storeA.id },
    { email: 'staff2@storeA.test', name: 'Staff 2 A', role: Role.STAFF, storeId: storeA.id },
    { email: 'manager@storeB.test', name: 'Manager B', role: Role.MANAGER, storeId: storeB.id },
    { email: 'staff1@storeB.test', name: 'Staff 1 B', role: Role.STAFF, storeId: storeB.id },
    { email: 'staff2@storeB.test', name: 'Staff 2 B', role: Role.STAFF, storeId: storeB.id },
  ];

  for (const account of accounts) {
    await upsertUser({ ...account, passwordHash });
  }

  const products = Array.from({ length: PRODUCT_COUNT }, (_, i) => {
    const n = String(i + 1).padStart(5, '0');
    return {
      id: `prod-${n}`,
      sku: `SKU-${n}`,
      name: `Product ${n}`,
      unit: 'pcs',
    };
  });

  for (let i = 0; i < products.length; i += 100) {
    const chunk = products.slice(i, i + 100);
    await prisma.product.createMany({ data: chunk, skipDuplicates: true });
  }

  const stockRows = products.flatMap((p, idx) => [
    {
      storeId: storeA.id,
      productId: p.id,
      quantity: 10 + (idx % 50),
    },
    {
      storeId: storeB.id,
      productId: p.id,
      quantity: 5 + (idx % 40),
    },
  ]);

  for (let i = 0; i < stockRows.length; i += 200) {
    const chunk = stockRows.slice(i, i + 200);
    await prisma.storeStock.createMany({ data: chunk, skipDuplicates: true });
  }

  console.log('Seed complete.');
  console.log(`Products: ${PRODUCT_COUNT}`);
  console.log(`Password for all seed users: ${SEED_PASSWORD}`);
  console.log(accounts.map((a) => a.email).join('\n'));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
