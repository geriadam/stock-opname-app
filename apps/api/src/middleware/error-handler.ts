import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../lib/errors.js';
import { env } from '../config.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: err.flatten(),
      },
    });
  }

  if (isAppError(err)) {
    return res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  // Prisma unique violation → active session race
  const prismaCode = (err as { code?: string })?.code;
  if (prismaCode === 'P2002') {
    const target = (err as { meta?: { target?: string[] } }).meta?.target ?? [];
    if (target.includes('store_id') || String(err).includes('uniq_active_session_per_store')) {
      return res.status(409).json({
        error: {
          code: 'ACTIVE_SESSION_EXISTS',
          message: 'An active opname session already exists for this store',
        },
      });
    }
  }

  console.error(err);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Internal server error' : String(err),
    },
  });
}
