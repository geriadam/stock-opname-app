CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STAFF', 'MANAGER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'REJECTED', 'APPLYING', 'APPLY_FAILED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "store_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_stock" (
    "store_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_stock_pkey" PRIMARY KEY ("store_id","product_id"),
    CONSTRAINT "store_stock_quantity_nonneg" CHECK ("quantity" >= 0)
);

-- CreateTable
CREATE TABLE "opname_sessions" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "apply_started_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "apply_error" TEXT,
    "apply_attempts" INTEGER NOT NULL DEFAULT 0,
    "blind_count" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "approve_idempotency_key" TEXT,
    CONSTRAINT "opname_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opname_items" (
    "session_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "system_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER,
    "note" TEXT,
    "is_unexpected" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "opname_items_pkey" PRIMARY KEY ("session_id","product_id")
);

-- CreateTable
CREATE TABLE "opname_submissions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "SubmissionDecision" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "reason" TEXT,
    "items_snapshot" JSONB NOT NULL,
    "idempotency_key" TEXT,
    CONSTRAINT "opname_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "before_qty" INTEGER NOT NULL,
    "after_qty" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_store_id_idx" ON "users"("store_id");
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "store_stock_store_id_idx" ON "store_stock"("store_id");
CREATE INDEX "opname_sessions_store_id_status_idx" ON "opname_sessions"("store_id", "status");
CREATE INDEX "opname_items_session_id_counted_qty_idx" ON "opname_items"("session_id", "counted_qty");
CREATE INDEX "opname_submissions_session_id_revision_idx" ON "opname_submissions"("session_id", "revision");
CREATE UNIQUE INDEX "opname_submissions_idempotency_key_key" ON "opname_submissions"("idempotency_key");
CREATE UNIQUE INDEX "stock_movements_session_id_product_id_key" ON "stock_movements"("session_id", "product_id");
CREATE INDEX "stock_movements_store_id_idx" ON "stock_movements"("store_id");
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- One active session per store (partial unique index)
CREATE UNIQUE INDEX "uniq_active_session_per_store"
ON "opname_sessions"("store_id")
WHERE "status" IN ('OPEN', 'SUBMITTED', 'REJECTED', 'APPLYING', 'APPLY_FAILED');

-- Foreign keys
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_stock" ADD CONSTRAINT "store_stock_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_stock" ADD CONSTRAINT "store_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opname_sessions" ADD CONSTRAINT "opname_sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opname_sessions" ADD CONSTRAINT "opname_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opname_sessions" ADD CONSTRAINT "opname_sessions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "opname_sessions" ADD CONSTRAINT "opname_sessions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "opname_items" ADD CONSTRAINT "opname_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "opname_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opname_items" ADD CONSTRAINT "opname_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opname_submissions" ADD CONSTRAINT "opname_submissions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "opname_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opname_submissions" ADD CONSTRAINT "opname_submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opname_submissions" ADD CONSTRAINT "opname_submissions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "opname_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
