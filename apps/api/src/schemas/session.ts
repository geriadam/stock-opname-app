import { z } from 'zod';

export const createSessionSchema = z.object({
  storeId: z.string().min(1),
  blindCount: z.boolean().optional(),
});

export const saveItemsSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        countedQty: z.number().int().min(0).max(1_000_000),
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const listSessionsQuery = z.object({
  status: z
    .enum(['OPEN', 'SUBMITTED', 'REJECTED', 'APPLYING', 'APPLY_FAILED', 'APPLIED', 'CANCELLED'])
    .optional(),
  storeId: z.string().optional(),
});

export const itemsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().optional(),
  filter: z.enum(['all', 'uncounted', 'counted', 'unexpected']).optional(),
});

export const idParam = z.object({
  id: z.string().min(1),
});
