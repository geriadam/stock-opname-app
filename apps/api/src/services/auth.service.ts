import argon2 from 'argon2';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env, REFRESH_COOKIE } from '../config.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/errors.js';
import type { Response } from 'express';

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(user: { id: string; role: string; storeId: string }) {
  return jwt.sign(
    { sub: user.id, role: user.role, storeId: user.storeId },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'] },
  );
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

async function issueRefreshToken(userId: string, res: Response) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
    },
  });
  setRefreshCookie(res, raw);
}

export async function login(email: string, password: string, res: Response) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Invalid email or password', 401);
  }
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    throw new AppError('UNAUTHORIZED', 'Invalid email or password', 401);
  }

  const accessToken = signAccessToken(user);
  await issueRefreshToken(user.id, res);

  return {
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      storeId: user.storeId,
    },
  };
}

export async function refresh(rawToken: string | undefined, res: Response) {
  if (!rawToken) {
    throw new AppError('UNAUTHORIZED', 'Missing refresh token', 401);
  }

  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null },
    include: { user: true },
  });

  if (!stored || stored.expiresAt < new Date()) {
    throw new AppError('UNAUTHORIZED', 'Invalid refresh token', 401);
  }

  // Rotate: revoke old, issue new
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const accessToken = signAccessToken(stored.user);
  await issueRefreshToken(stored.user.id, res);

  return {
    accessToken,
    user: {
      id: stored.user.id,
      email: stored.user.email,
      name: stored.user.name,
      role: stored.user.role,
      storeId: stored.user.storeId,
    },
  };
}

export async function logout(rawToken: string | undefined, res: Response) {
  if (rawToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  clearRefreshCookie(res);
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { store: true },
  });
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found', 404);
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    storeId: user.storeId,
    storeName: user.store.name,
  };
}
