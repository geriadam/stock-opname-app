import { prisma } from '../db/prisma.js';
import type { Prisma } from '@prisma/client';

export async function writeAudit(
  actorId: string | null,
  entity: string,
  entityId: string,
  action: string,
  meta?: Prisma.InputJsonValue,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  await tx.auditLog.create({
    data: {
      actorId,
      entity,
      entityId,
      action,
      meta: meta ?? undefined,
    },
  });
}
