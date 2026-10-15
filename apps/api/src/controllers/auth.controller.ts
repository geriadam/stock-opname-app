import type { Request, Response } from 'express';
import { REFRESH_COOKIE } from '../config.js';
import * as authService from '../services/auth.service.js';

export async function login(req: Request, res: Response) {
  const { email, password } = req.body as { email: string; password: string };
  const result = await authService.login(email, password, res);
  res.json(result);
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const result = await authService.refresh(token, res);
  res.json(result);
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  await authService.logout(token, res);
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  const result = await authService.me(req.user!.id);
  res.json(result);
}
