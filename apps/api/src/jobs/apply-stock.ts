import { prisma } from '../db/prisma.js';
import { SessionStatus } from '@prisma/client';
import { writeAudit } from '../services/audit.service.js';

export const APPLY_STOCK_QUEUE = 'apply-stock';

export async function applyStockJob(sessionId: string) {
  try {
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: SessionStatus; store_id: string }>
      >`
        SELECT id, status, store_id FROM opname_sessions WHERE id = ${sessionId} FOR UPDATE
      `;
      const session = locked[0];
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      if (session.status === SessionStatus.APPLIED) {
        return; // idempotent no-op
      }
      if (session.status !== SessionStatus.APPLYING) {
        throw new Error(`Session ${sessionId} is ${session.status}, expected APPLYING`);
      }

      // Test hook: force failure after lock to verify stock rollback + APPLY_FAILED.
      if (process.env.FORCE_APPLY_FAIL === '1') {
        throw new Error('Injected apply failure');
      }

      const storeId = session.store_id;

      // Ensure unexpected items have a store_stock row
      await tx.$executeRaw`
        INSERT INTO store_stock (store_id, product_id, quantity, updated_at)
        SELECT ${storeId}, i.product_id, 0, NOW()
        FROM opname_items i
        WHERE i.session_id = ${sessionId}
          AND i.is_unexpected = true
          AND i.counted_qty IS NOT NULL
        ON CONFLICT (store_id, product_id) DO NOTHING
      `;

      // Set-based delta apply with ordered row locks + ledger idempotency.
      // Skip products already recorded in stock_movements so retries never double-apply.
      await tx.$executeRaw`
        WITH changes AS (
          SELECT
            i.product_id,
            ss.quantity AS current_qty,
            i.system_qty,
            i.counted_qty,
            GREATEST(0, ss.quantity + (i.counted_qty - i.system_qty)) AS new_qty,
            CASE
              WHEN ss.quantity + (i.counted_qty - i.system_qty) < 0 THEN true
              ELSE false
            END AS clamped
          FROM opname_items i
          JOIN store_stock ss
            ON ss.store_id = ${storeId} AND ss.product_id = i.product_id
          WHERE i.session_id = ${sessionId}
            AND i.counted_qty IS NOT NULL
            AND i.counted_qty <> i.system_qty
            AND NOT EXISTS (
              SELECT 1 FROM stock_movements sm
              WHERE sm.session_id = ${sessionId} AND sm.product_id = i.product_id
            )
          ORDER BY i.product_id
          FOR UPDATE OF ss
        ),
        upd AS (
          UPDATE store_stock ss
          SET quantity = c.new_qty, updated_at = NOW()
          FROM changes c
          WHERE ss.store_id = ${storeId} AND ss.product_id = c.product_id
          RETURNING ss.product_id
        )
        INSERT INTO stock_movements (
          id, store_id, product_id, session_id, before_qty, after_qty, delta, note, created_at
        )
        SELECT
          gen_random_uuid()::text,
          ${storeId},
          c.product_id,
          ${sessionId},
          c.current_qty,
          c.new_qty,
          c.new_qty - c.current_qty,
          CASE WHEN c.clamped THEN 'Clamped at 0 (sale after count)' ELSE 'Opname delta apply' END,
          NOW()
        FROM changes c
        ON CONFLICT (session_id, product_id) DO NOTHING
      `;

      await tx.opnameSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatus.APPLIED,
          appliedAt: new Date(),
          applyError: null,
          version: { increment: 1 },
        },
      });

      await writeAudit(null, 'opname_session', sessionId, 'APPLIED', {}, tx);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.opnameSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.APPLY_FAILED,
        applyError: message.slice(0, 2000),
        applyAttempts: { increment: 1 },
        version: { increment: 1 },
      },
    });
    await writeAudit(null, 'opname_session', sessionId, 'APPLY_FAILED', { error: message });
    throw err;
  }
}
