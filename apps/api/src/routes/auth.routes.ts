import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../lib/async-handler.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/authenticate.js';
import { loginSchema } from '../schemas/auth.js';
import * as ctrl from '../controllers/auth.controller.js';
import { env } from '../config.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: env.NODE_ENV === 'test' ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: { code: 'VALIDATION_ERROR', message: 'Too many login attempts' },
  },
});

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(ctrl.login),
);
authRouter.post('/refresh', asyncHandler(ctrl.refresh));
authRouter.post('/logout', asyncHandler(ctrl.logout));
authRouter.get('/me', authenticate, asyncHandler(ctrl.me));
