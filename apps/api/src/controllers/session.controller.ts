import type { Request, Response } from 'express';
import type { SessionStatus } from '@prisma/client';
import * as sessionService from '../services/session.service.js';
import { AppError } from '../lib/errors.js';
import { CSV_MAX_BYTES } from '../config.js';

export async function createSession(req: Request, res: Response) {
  const { storeId, blindCount } = req.body as { storeId: string; blindCount?: boolean };
  const session = await sessionService.createSession(req.user!, storeId, blindCount ?? false);
  res.status(201).json(session);
}

export async function listSessions(req: Request, res: Response) {
  const status = req.query.status as SessionStatus | undefined;
  const storeId = req.query.storeId as string | undefined;
  const sessions = await sessionService.listSessions(req.user!, { status, storeId });
  res.json({ sessions });
}

export async function getSession(req: Request, res: Response) {
  const detail = await sessionService.getSessionDetail(req.user!, req.params.id!);
  res.json(detail);
}

export async function listItems(req: Request, res: Response) {
  const result = await sessionService.listItems(req.user!, req.params.id!, {
    cursor: req.query.cursor as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    search: req.query.search as string | undefined,
    filter: (req.query.filter as 'all' | 'uncounted' | 'counted' | 'unexpected') ?? 'all',
  });
  res.json(result);
}

export async function saveItems(req: Request, res: Response) {
  const { items } = req.body as {
    items: Array<{ sku: string; countedQty: number; note?: string | null }>;
  };
  const result = await sessionService.saveCounts(req.user!, req.params.id!, items);
  res.json(result);
}

export async function importItems(req: Request, res: Response) {
  const file = req.file;
  if (!file) {
    throw new AppError('VALIDATION_ERROR', 'CSV file is required', 400);
  }
  if (file.size > CSV_MAX_BYTES) {
    throw new AppError('VALIDATION_ERROR', 'CSV exceeds 5 MB', 400);
  }
  const dryRun = String(req.query.dryRun ?? 'false') === 'true';
  const mergeDuplicates = String(req.query.mergeDuplicates ?? 'false') === 'true';
  const result = await sessionService.importCsv(req.user!, req.params.id!, file.buffer, {
    dryRun,
    mergeDuplicates,
  });
  res.json(result);
}

export async function submit(req: Request, res: Response) {
  const key = req.header('Idempotency-Key') ?? undefined;
  const result = await sessionService.submitSession(req.user!, req.params.id!, key);
  res.json(result);
}

export async function withdraw(req: Request, res: Response) {
  const session = await sessionService.withdrawSession(req.user!, req.params.id!);
  res.json(session);
}

export async function approve(req: Request, res: Response) {
  const key = req.header('Idempotency-Key') ?? undefined;
  const result = await sessionService.approveSession(req.user!, req.params.id!, key);
  res.status(202).json(result);
}

export async function reject(req: Request, res: Response) {
  const { reason } = req.body as { reason: string };
  const session = await sessionService.rejectSession(req.user!, req.params.id!, reason);
  res.json(session);
}

export async function retryApply(req: Request, res: Response) {
  const result = await sessionService.retryApply(req.user!, req.params.id!);
  res.status(202).json(result);
}

export async function cancel(req: Request, res: Response) {
  const session = await sessionService.cancelSession(req.user!, req.params.id!);
  res.json(session);
}

export async function history(req: Request, res: Response) {
  const result = await sessionService.getHistory(req.user!, req.params.id!);
  res.json(result);
}

export async function report(req: Request, res: Response) {
  const csv = await sessionService.exportReportCsv(req.user!, req.params.id!);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="opname-${req.params.id}.csv"`);
  res.send(csv);
}

export async function products(req: Request, res: Response) {
  const search = req.query.search as string | undefined;
  const page = req.query.page ? Number(req.query.page) : 1;
  const items = await sessionService.listProducts(search, page);
  res.json({ products: items });
}

export async function storeStock(req: Request, res: Response) {
  const stock = await sessionService.getStoreStock(req.user!, req.params.id!);
  res.json({ stock });
}
