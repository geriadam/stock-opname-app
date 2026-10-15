import { Prisma, Role, SessionStatus, SubmissionDecision } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/errors.js';
import { assertSameStore } from '../middleware/authenticate.js';
import { writeAudit } from './audit.service.js';
import { MAX_BATCH_ITEMS, MAX_COUNTED_QTY } from '../config.js';
import { csvSafe, parseCountCsv } from './csv.service.js';
import { enqueueApplyStock } from '../jobs/boss.js';

const ACTIVE_STATUSES: SessionStatus[] = [
  'OPEN',
  'SUBMITTED',
  'REJECTED',
  'APPLYING',
  'APPLY_FAILED',
];

const EDITABLE: SessionStatus[] = ['OPEN', 'REJECTED'];

type AuthUser = {
  id: string;
  role: Role;
  storeId: string;
};

async function getSessionOrThrow(id: string) {
  const session = await prisma.opnameSession.findUnique({ where: { id } });
  if (!session) {
    throw new AppError('NOT_FOUND', 'Session not found', 404);
  }
  return session;
}

function scopeSession(user: AuthUser, storeId: string) {
  assertSameStore(user.storeId, storeId);
}

export async function createSession(
  user: AuthUser,
  storeId: string,
  blindCount = false,
) {
  if (user.role !== Role.MANAGER) {
    throw new AppError('FORBIDDEN', 'Only managers can create sessions', 403);
  }
  scopeSession(user, storeId);

  try {
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.opnameSession.create({
        data: {
          storeId,
          createdById: user.id,
          blindCount,
          status: SessionStatus.OPEN,
          snapshotAt: new Date(),
        },
      });

      await tx.$executeRaw`
        INSERT INTO opname_items (session_id, product_id, system_qty, counted_qty, note, is_unexpected, updated_at)
        SELECT ${created.id}, product_id, quantity, NULL, NULL, false, NOW()
        FROM store_stock
        WHERE store_id = ${storeId}
      `;

      await writeAudit(user.id, 'opname_session', created.id, 'CREATE', { storeId, blindCount }, tx);
      return created;
    });

    return session;
  } catch (err) {
    const prismaCode = (err as { code?: string })?.code;
    if (prismaCode === 'P2002') {
      throw new AppError(
        'ACTIVE_SESSION_EXISTS',
        'An active opname session already exists for this store',
        409,
      );
    }
    throw err;
  }
}

export async function listSessions(
  user: AuthUser,
  opts: { status?: SessionStatus; storeId?: string },
) {
  const where: Prisma.OpnameSessionWhereInput = {
    storeId: user.storeId,
  };
  if (opts.storeId && opts.storeId !== user.storeId) {
    throw new AppError('FORBIDDEN', 'Cannot list other store sessions', 403);
  }
  if (opts.status) {
    where.status = opts.status;
  }

  return prisma.opnameSession.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      submittedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getSessionDetail(user: AuthUser, sessionId: string) {
  const session = await prisma.opnameSession.findUnique({
    where: { id: sessionId },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      submittedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
      store: { select: { id: true, name: true } },
    },
  });
  if (!session) {
    throw new AppError('NOT_FOUND', 'Session not found', 404);
  }
  scopeSession(user, session.storeId);

  const [total, counted, unexpected, varianceAgg] = await Promise.all([
    prisma.opnameItem.count({ where: { sessionId } }),
    prisma.opnameItem.count({ where: { sessionId, countedQty: { not: null } } }),
    prisma.opnameItem.count({ where: { sessionId, isUnexpected: true } }),
    prisma.$queryRaw<Array<{ positive: bigint; negative: bigint; abs_total: bigint }>>`
      SELECT
        COALESCE(SUM(CASE WHEN counted_qty - system_qty > 0 THEN counted_qty - system_qty ELSE 0 END), 0) AS positive,
        COALESCE(SUM(CASE WHEN counted_qty - system_qty < 0 THEN counted_qty - system_qty ELSE 0 END), 0) AS negative,
        COALESCE(SUM(ABS(counted_qty - system_qty)), 0) AS abs_total
      FROM opname_items
      WHERE session_id = ${sessionId} AND counted_qty IS NOT NULL
    `,
  ]);

  const v = varianceAgg[0];
  return {
    ...session,
    counters: {
      total,
      counted,
      uncounted: total - counted,
      unexpected,
      variancePositive: Number(v?.positive ?? 0),
      varianceNegative: Number(v?.negative ?? 0),
      varianceAbs: Number(v?.abs_total ?? 0),
    },
  };
}

export async function listItems(
  user: AuthUser,
  sessionId: string,
  opts: {
    cursor?: string;
    limit?: number;
    search?: string;
    filter?: 'all' | 'uncounted' | 'counted' | 'unexpected';
  },
) {
  const session = await getSessionOrThrow(sessionId);
  scopeSession(user, session.storeId);

  const limit = Math.min(opts.limit ?? 50, 200);
  const hideSystem = session.blindCount && user.role === Role.STAFF;

  const filter = opts.filter ?? 'all';
  const conditions: Prisma.Sql[] = [Prisma.sql`i.session_id = ${sessionId}`];

  if (filter === 'uncounted') {
    conditions.push(Prisma.sql`i.counted_qty IS NULL`);
  } else if (filter === 'counted') {
    conditions.push(Prisma.sql`i.counted_qty IS NOT NULL`);
  } else if (filter === 'unexpected') {
    conditions.push(Prisma.sql`i.is_unexpected = true`);
  }

  if (opts.search) {
    const q = `%${opts.search}%`;
    conditions.push(Prisma.sql`(p.sku ILIKE ${q} OR p.name ILIKE ${q})`);
  }

  if (opts.cursor) {
    const [cursorSku, cursorProductId] = opts.cursor.split('|');
    if (cursorSku && cursorProductId) {
      conditions.push(
        Prisma.sql`(p.sku, i.product_id) > (${cursorSku}, ${cursorProductId})`,
      );
    }
  }

  const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

  const rows = await prisma.$queryRaw<
    Array<{
      session_id: string;
      product_id: string;
      sku: string;
      name: string;
      unit: string;
      system_qty: number;
      counted_qty: number | null;
      note: string | null;
      is_unexpected: boolean;
      updated_at: Date;
    }>
  >`
    SELECT i.session_id, i.product_id, p.sku, p.name, p.unit,
           i.system_qty, i.counted_qty, i.note, i.is_unexpected, i.updated_at
    FROM opname_items i
    JOIN products p ON p.id = i.product_id
    ${whereSql}
    ORDER BY p.sku ASC, i.product_id ASC
    LIMIT ${limit + 1}
  `;

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && page.length
      ? `${page[page.length - 1]!.sku}|${page[page.length - 1]!.product_id}`
      : null;

  return {
    items: page.map((r) => ({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      systemQty: hideSystem ? undefined : r.system_qty,
      countedQty: r.counted_qty,
      note: r.note,
      isUnexpected: r.is_unexpected,
      updatedAt: r.updated_at,
      variance:
        hideSystem || r.counted_qty == null ? undefined : r.counted_qty - r.system_qty,
    })),
    nextCursor,
  };
}

export async function saveCounts(
  user: AuthUser,
  sessionId: string,
  items: Array<{ sku: string; countedQty: number; note?: string | null }>,
) {
  if (user.role !== Role.STAFF) {
    throw new AppError('FORBIDDEN', 'Only staff can edit counts', 403);
  }
  if (items.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No items provided', 400);
  }
  if (items.length > MAX_BATCH_ITEMS) {
    throw new AppError('VALIDATION_ERROR', `Batch exceeds ${MAX_BATCH_ITEMS} items`, 400);
  }

  const skus = items.map((i) => i.sku);
  const unique = new Set(skus);
  if (unique.size !== skus.length) {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const s of skus) {
      if (seen.has(s)) dups.push(s);
      seen.add(s);
    }
    throw new AppError('DUPLICATE_SKU', 'Duplicate SKUs in batch', 422, { skus: [...new Set(dups)] });
  }

  for (const item of items) {
    if (!Number.isInteger(item.countedQty) || item.countedQty < 0 || item.countedQty > MAX_COUNTED_QTY) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Invalid countedQty for ${item.sku}`,
        400,
      );
    }
  }

  const session = await getSessionOrThrow(sessionId);
  scopeSession(user, session.storeId);
  if (!EDITABLE.includes(session.status)) {
    throw new AppError('INVALID_STATE', `Session is ${session.status}; counts are locked`, 409);
  }

  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true },
  });
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const unknown = skus.filter((s) => !bySku.has(s));
  if (unknown.length) {
    throw new AppError('UNKNOWN_SKU', 'One or more SKUs are unknown', 422, { skus: unknown });
  }

  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const product = bySku.get(item.sku)!;
      const existing = await tx.opnameItem.findUnique({
        where: { sessionId_productId: { sessionId, productId: product.id } },
      });

      if (existing) {
        await tx.opnameItem.update({
          where: { sessionId_productId: { sessionId, productId: product.id } },
          data: {
            countedQty: item.countedQty,
            note: item.note ?? existing.note,
          },
        });
      } else {
        await tx.opnameItem.create({
          data: {
            sessionId,
            productId: product.id,
            systemQty: 0,
            countedQty: item.countedQty,
            note: item.note ?? null,
            isUnexpected: true,
          },
        });
      }
    }
  });

  return { saved: items.length };
}

export async function importCsv(
  user: AuthUser,
  sessionId: string,
  buffer: Buffer,
  opts: { dryRun: boolean; mergeDuplicates: boolean },
) {
  if (user.role !== Role.STAFF) {
    throw new AppError('FORBIDDEN', 'Only staff can import counts', 403);
  }

  const session = await getSessionOrThrow(sessionId);
  scopeSession(user, session.storeId);
  if (!EDITABLE.includes(session.status)) {
    throw new AppError('INVALID_STATE', `Session is ${session.status}; import locked`, 409);
  }

  const parsed = parseCountCsv(buffer, opts.mergeDuplicates);

  const skus = parsed.rows.map((r) => r.sku);
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true },
  });
  const known = new Set(products.map((p) => p.sku));
  for (const row of parsed.rows) {
    if (!known.has(row.sku)) {
      parsed.errors.push({ line: row.line, sku: row.sku, message: 'Unknown SKU' });
    }
  }

  const hasBlockingErrors = parsed.errors.length > 0;

  if (opts.dryRun || hasBlockingErrors) {
    return {
      dryRun: opts.dryRun,
      committed: false,
      rowCount: parsed.rows.length,
      errors: parsed.errors,
      duplicates: parsed.duplicates,
    };
  }

  await saveCounts(
    user,
    sessionId,
    parsed.rows.map((r) => ({ sku: r.sku, countedQty: r.countedQty, note: r.note })),
  );

  await writeAudit(user.id, 'opname_session', sessionId, 'CSV_IMPORT', {
    rows: parsed.rows.length,
  });

  return {
    dryRun: false,
    committed: true,
    rowCount: parsed.rows.length,
    errors: [],
    duplicates: parsed.duplicates,
  };
}

export async function submitSession(
  user: AuthUser,
  sessionId: string,
  idempotencyKey?: string,
) {
  if (user.role !== Role.STAFF) {
    throw new AppError('FORBIDDEN', 'Only staff can submit', 403);
  }

  if (idempotencyKey) {
    const existing = await prisma.opnameSubmission.findUnique({
      where: { idempotencyKey },
    });
    if (existing && existing.sessionId === sessionId) {
      const session = await getSessionOrThrow(sessionId);
      return { session, submission: existing, idempotent: true };
    }
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: SessionStatus; store_id: string; revision: number }>>`
      SELECT id, status, store_id, revision FROM opname_sessions WHERE id = ${sessionId} FOR UPDATE
    `;
    const session = locked[0];
    if (!session) {
      throw new AppError('NOT_FOUND', 'Session not found', 404);
    }
    scopeSession(user, session.store_id);
    if (!EDITABLE.includes(session.status)) {
      throw new AppError('INVALID_STATE', `Cannot submit from ${session.status}`, 409);
    }

    const newRevision = session.revision + 1;
    const items = await tx.opnameItem.findMany({
      where: { sessionId, countedQty: { not: null } },
      include: { product: { select: { sku: true } } },
    });

    const snapshot = items.map((i) => ({
      productId: i.productId,
      sku: i.product.sku,
      systemQty: i.systemQty,
      countedQty: i.countedQty,
      note: i.note,
      isUnexpected: i.isUnexpected,
    }));

    const updated = await tx.opnameSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.SUBMITTED,
        revision: newRevision,
        submittedAt: new Date(),
        submittedById: user.id,
        version: { increment: 1 },
        reviewNote: null,
      },
    });

    const submission = await tx.opnameSubmission.create({
      data: {
        sessionId,
        revision: newRevision,
        submittedById: user.id,
        decision: SubmissionDecision.PENDING,
        itemsSnapshot: snapshot,
        idempotencyKey: idempotencyKey ?? null,
      },
    });

    await writeAudit(user.id, 'opname_session', sessionId, 'SUBMIT', { revision: newRevision }, tx);
    return { session: updated, submission, idempotent: false };
  });
}

export async function withdrawSession(user: AuthUser, sessionId: string) {
  if (user.role !== Role.STAFF) {
    throw new AppError('FORBIDDEN', 'Only staff can withdraw', 403);
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: SessionStatus; store_id: string; revision: number }>>`
      SELECT id, status, store_id, revision FROM opname_sessions WHERE id = ${sessionId} FOR UPDATE
    `;
    const session = locked[0];
    if (!session) throw new AppError('NOT_FOUND', 'Session not found', 404);
    scopeSession(user, session.store_id);
    if (session.status !== SessionStatus.SUBMITTED) {
      throw new AppError('INVALID_STATE', 'Only SUBMITTED sessions can be withdrawn', 409);
    }

    const updated = await tx.opnameSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.OPEN,
        version: { increment: 1 },
      },
    });

    await tx.opnameSubmission.updateMany({
      where: { sessionId, revision: session.revision, decision: SubmissionDecision.PENDING },
      data: { decision: SubmissionDecision.WITHDRAWN, decidedAt: new Date(), decidedById: user.id },
    });

    await writeAudit(user.id, 'opname_session', sessionId, 'WITHDRAW', {}, tx);
    return updated;
  });
}

export async function rejectSession(user: AuthUser, sessionId: string, reason: string) {
  if (user.role !== Role.MANAGER) {
    throw new AppError('FORBIDDEN', 'Only managers can reject', 403);
  }
  if (!reason?.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Rejection reason is required', 400);
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: SessionStatus; store_id: string; revision: number }>>`
      SELECT id, status, store_id, revision FROM opname_sessions WHERE id = ${sessionId} FOR UPDATE
    `;
    const session = locked[0];
    if (!session) throw new AppError('NOT_FOUND', 'Session not found', 404);
    scopeSession(user, session.store_id);
    if (session.status !== SessionStatus.SUBMITTED) {
      throw new AppError('INVALID_STATE', 'Only SUBMITTED sessions can be rejected', 409);
    }

    const updated = await tx.opnameSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.REJECTED,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: reason.trim(),
        version: { increment: 1 },
      },
    });

    await tx.opnameSubmission.updateMany({
      where: { sessionId, revision: session.revision, decision: SubmissionDecision.PENDING },
      data: {
        decision: SubmissionDecision.REJECTED,
        decidedAt: new Date(),
        decidedById: user.id,
        reason: reason.trim(),
      },
    });

    await writeAudit(user.id, 'opname_session', sessionId, 'REJECT', { reason }, tx);
    return updated;
  });
}

export async function cancelSession(user: AuthUser, sessionId: string) {
  if (user.role !== Role.MANAGER) {
    throw new AppError('FORBIDDEN', 'Only managers can cancel', 403);
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: SessionStatus; store_id: string }>>`
      SELECT id, status, store_id FROM opname_sessions WHERE id = ${sessionId} FOR UPDATE
    `;
    const session = locked[0];
    if (!session) throw new AppError('NOT_FOUND', 'Session not found', 404);
    scopeSession(user, session.store_id);
    if (session.status !== SessionStatus.OPEN && session.status !== SessionStatus.REJECTED) {
      throw new AppError('INVALID_STATE', 'Only OPEN or REJECTED sessions can be cancelled', 409);
    }

    const updated = await tx.opnameSession.update({
      where: { id: sessionId },
      data: { status: SessionStatus.CANCELLED, version: { increment: 1 } },
    });
    await writeAudit(user.id, 'opname_session', sessionId, 'CANCEL', {}, tx);
    return updated;
  });
}

export async function approveSession(
  user: AuthUser,
  sessionId: string,
  idempotencyKey?: string,
) {
  if (user.role !== Role.MANAGER) {
    throw new AppError('FORBIDDEN', 'Only managers can approve', 403);
  }

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        status: SessionStatus;
        store_id: string;
        revision: number;
        approve_idempotency_key: string | null;
      }>
    >`
      SELECT id, status, store_id, revision, approve_idempotency_key
      FROM opname_sessions WHERE id = ${sessionId} FOR UPDATE
    `;
    const session = locked[0];
    if (!session) throw new AppError('NOT_FOUND', 'Session not found', 404);
    scopeSession(user, session.store_id);

    if (
      idempotencyKey &&
      session.approve_idempotency_key === idempotencyKey &&
      (session.status === SessionStatus.APPLYING || session.status === SessionStatus.APPLIED)
    ) {
      return { status: session.status, idempotent: true };
    }

    if (session.status === SessionStatus.APPLYING || session.status === SessionStatus.APPLIED) {
      throw new AppError('INVALID_STATE', `Session already ${session.status}`, 409);
    }
    if (session.status !== SessionStatus.SUBMITTED) {
      throw new AppError('INVALID_STATE', 'Only SUBMITTED sessions can be approved', 409);
    }

    await tx.opnameSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.APPLYING,
        reviewedById: user.id,
        reviewedAt: new Date(),
        applyStartedAt: new Date(),
        applyError: null,
        approveIdempotencyKey: idempotencyKey ?? null,
        version: { increment: 1 },
      },
    });

    await tx.opnameSubmission.updateMany({
      where: { sessionId, revision: session.revision, decision: SubmissionDecision.PENDING },
      data: {
        decision: SubmissionDecision.APPROVED,
        decidedAt: new Date(),
        decidedById: user.id,
      },
    });

    await writeAudit(user.id, 'opname_session', sessionId, 'APPROVE', {}, tx);

    // Enqueue via same DB (pg-boss uses its own tables; we call after commit via after-tx pattern)
    // Store pending job marker in audit; actual enqueue happens after transaction in controller.
    return { status: SessionStatus.APPLYING, idempotent: false, enqueue: true };
  }).then(async (result) => {
    if (result.enqueue) {
      try {
        await enqueueApplyStock(sessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.opnameSession.update({
          where: { id: sessionId },
          data: {
            status: SessionStatus.APPLY_FAILED,
            applyError: `Failed to enqueue apply job: ${message}`.slice(0, 2000),
            applyAttempts: { increment: 1 },
            version: { increment: 1 },
          },
        });
        throw new AppError('INTERNAL_ERROR', 'Approved but failed to enqueue apply job', 500);
      }
    }
    return { status: result.status, idempotent: result.idempotent };
  });
}

export async function retryApply(user: AuthUser, sessionId: string) {
  if (user.role !== Role.MANAGER) {
    throw new AppError('FORBIDDEN', 'Only managers can retry apply', 403);
  }

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: SessionStatus; store_id: string }>>`
      SELECT id, status, store_id FROM opname_sessions WHERE id = ${sessionId} FOR UPDATE
    `;
    const session = locked[0];
    if (!session) throw new AppError('NOT_FOUND', 'Session not found', 404);
    scopeSession(user, session.store_id);
    if (session.status !== SessionStatus.APPLY_FAILED) {
      throw new AppError('INVALID_STATE', 'Only APPLY_FAILED sessions can be retried', 409);
    }

    await tx.opnameSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.APPLYING,
        applyStartedAt: new Date(),
        applyError: null,
        version: { increment: 1 },
      },
    });
    await writeAudit(user.id, 'opname_session', sessionId, 'RETRY_APPLY', {}, tx);
    return { enqueue: true };
  });

  if (result.enqueue) {
    await enqueueApplyStock(sessionId);
  }
  return { status: SessionStatus.APPLYING };
}

export async function getHistory(user: AuthUser, sessionId: string) {
  const session = await getSessionOrThrow(sessionId);
  scopeSession(user, session.storeId);

  const [submissions, audits] = await Promise.all([
    prisma.opnameSubmission.findMany({
      where: { sessionId },
      orderBy: { revision: 'asc' },
      include: {
        submittedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { entity: 'opname_session', entityId: sessionId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, name: true } } },
    }),
  ]);

  return { submissions, audits };
}

export async function exportReportCsv(user: AuthUser, sessionId: string) {
  if (user.role !== Role.MANAGER) {
    throw new AppError('FORBIDDEN', 'Only managers can export reports', 403);
  }
  const session = await getSessionOrThrow(sessionId);
  scopeSession(user, session.storeId);

  const rows = await prisma.$queryRaw<
    Array<{
      sku: string;
      name: string;
      system_qty: number;
      counted_qty: number | null;
      variance: number | null;
      note: string | null;
      is_unexpected: boolean;
    }>
  >`
    SELECT p.sku, p.name, i.system_qty, i.counted_qty,
           CASE WHEN i.counted_qty IS NULL THEN NULL ELSE i.counted_qty - i.system_qty END AS variance,
           i.note, i.is_unexpected
    FROM opname_items i
    JOIN products p ON p.id = i.product_id
    WHERE i.session_id = ${sessionId}
    ORDER BY ABS(COALESCE(i.counted_qty - i.system_qty, 0)) DESC, p.sku ASC
  `;

  const header = 'sku,name,system_qty,counted_qty,variance,note,is_unexpected';
  const lines = rows.map((r) =>
    [
      csvSafe(r.sku),
      csvSafe(r.name),
      csvSafe(r.system_qty),
      csvSafe(r.counted_qty),
      csvSafe(r.variance),
      csvSafe(r.note),
      csvSafe(r.is_unexpected ? 'true' : 'false'),
    ].join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}

export async function listProducts(search?: string, page = 1) {
  const take = 50;
  const skip = (page - 1) * take;
  return prisma.product.findMany({
    where: search
      ? {
          OR: [
            { sku: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { sku: 'asc' },
    take,
    skip,
  });
}

export async function getStoreStock(user: AuthUser, storeId: string) {
  scopeSession(user, storeId);
  return prisma.storeStock.findMany({
    where: { storeId },
    include: { product: true },
    take: 100,
    orderBy: { productId: 'asc' },
  });
}

export { ACTIVE_STATUSES };
