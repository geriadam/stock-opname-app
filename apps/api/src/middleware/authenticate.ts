import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../db/prisma.js';
import type { Role } from '@prisma/client';

type AccessPayload = { sub: string; role: Role; storeId: string };

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 'Missing access token', 401);
    }
    const token = header.slice('Bearer '.length);
    let payload: AccessPayload;
    try {
      payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
    } catch {
      throw new AppError('UNAUTHORIZED', 'Invalid or expired access token', 401);
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'User not found', 401);
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      storeId: user.storeId,
      name: user.name,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('UNAUTHORIZED', 'Not authenticated', 401));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', 'Insufficient permissions', 403));
    }
    next();
  };
}

/** Ensure resource store matches the caller's store. */
export function assertSameStore(userStoreId: string, resourceStoreId: string) {
  if (userStoreId !== resourceStoreId) {
    throw new AppError('FORBIDDEN', 'Store scope mismatch', 403);
  }
}
