# Stock Opname App

Web app + API untuk siklus **stock opname** per toko: manager membuka session (snapshot stok), staff menghitung & submit, manager approve/reject. Setelah approve, stok di-update secara async lewat **delta** + ledger `stock_movements`.

## Tech stack

| Layer | Choice |
|---|---|
| API | Node 20+, Express, TypeScript, Zod |
| DB | PostgreSQL 16, Prisma (+ raw SQL untuk lock & apply) |
| Jobs | pg-boss (queue di Postgres) |
| Auth | JWT access (15m) + refresh cookie (rotating), argon2id |
| Web | Next.js App Router, Tailwind, TanStack Query |
| Tests | Vitest |

## Prerequisites

- Node 20+
- [pnpm](https://pnpm.io/) 9+
- PostgreSQL 16 (lokal)

Buat database:

```sql
CREATE DATABASE stock_opname;
CREATE DATABASE stock_opname_test;  -- opsional, untuk integration test
```

## Quick start (jalankan semuanya)

Pastikan PostgreSQL 16 sudah jalan, lalu dari **root repo**:

```bash
# 1) (sekali saja) buat database di psql
# CREATE DATABASE stock_opname;
# CREATE DATABASE stock_opname_test;

# 2) env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3) install + migrate + seed + jalankan API & web
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| App | URL |
|---|---|
| Web | http://localhost:3000 |
| API health | http://localhost:4000/health |

Default DB URL: `postgresql://postgres:postgres@localhost:5432/stock_opname`

Test: `pnpm test`

## Seed accounts

Password semua akun: `Password123!`

| Email | Role | Store |
|---|---|---|
| manager@storeA.test | MANAGER | Store A |
| staff1@storeA.test | STAFF | Store A |
| staff2@storeA.test | STAFF | Store A |
| manager@storeB.test | MANAGER | Store B |
| staff1@storeB.test | STAFF | Store B |
| staff2@storeB.test | STAFF | Store B |

Produk default: 200 SKU. Untuk load test: `SEED_PRODUCT_COUNT=20000 pnpm db:seed`.

Contoh CSV: `samples/` (`valid.csv`, `with-errors.csv`, `with-duplicates.csv`).

## Alur singkat

```
Manager: Start opname (snapshot)
    → Staff: isi counted qty (autosave / CSV) → Submit
    → Manager: Approve (202 APPLYING) atau Reject (+ alasan)
    → Worker: apply delta ke store_stock + stock_movements → APPLIED
```

- Submit **tidak** mengubah stok.
- Item belum diisi (`null`) **bukan** dianggap 0; diabaikan saat apply.
- Satu session aktif per toko.

## Scripts

| Command | Keterangan |
|---|---|
| `pnpm dev` | API + web (parallel) |
| `pnpm db:migrate` | Jalankan migrasi Prisma |
| `pnpm db:seed` | Seed store, user, produk, stok |
| `pnpm test` | Unit test API (Vitest) |
| `pnpm build` | Build api + web |

## Project structure

```
apps/api     Express API, Prisma, pg-boss worker
apps/web     Next.js (login, staff grid, manager review)
samples/     Fixture CSV
NOTES.md     Catatan keputusan implementasi
```

## API overview

Prefix: `/api/v1`

**Auth** — `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`

**Sessions** (ringkas)

| Method | Path | Role |
|---|---|---|
| POST | `/sessions` | Manager — buat session + snapshot |
| GET | `/sessions`, `/sessions/:id` | Kedua role (scoped toko) |
| GET | `/sessions/:id/items` | Pagination + filter/search |
| PUT | `/sessions/:id/items` | Staff — batch save ≤500 |
| POST | `/sessions/:id/items/import` | Staff — CSV (`dryRun`, `mergeDuplicates`) |
| POST | `/sessions/:id/submit` \| `/withdraw` | Staff |
| POST | `/sessions/:id/approve` \| `/reject` \| `/retry-apply` \| `/cancel` | Manager |
| GET | `/sessions/:id/report.csv`, `/history` | Manager / keduanya |

**Catalog** — `GET /products`, `GET /stores/:id/stock`

Error shape: `{ error: { code, message, details? } }`  
Contoh code: `VALIDATION_ERROR`, `INVALID_STATE`, `FORBIDDEN`, `ACTIVE_SESSION_EXISTS`, `DUPLICATE_SKU`, `UNKNOWN_SKU`.

## Implementation notes

Lihat **[NOTES.md](./NOTES.md)** untuk alasan desain, alur approve, item uncounted, edge case, dan tambahan penting.
