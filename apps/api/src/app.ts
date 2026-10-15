import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config.js';
import { authRouter } from './routes/auth.routes.js';
import { sessionRouter } from './routes/session.routes.js';
import { catalogRouter } from './routes/catalog.routes.js';
import { errorHandler } from './middleware/error-handler.js';
import { authenticate } from './middleware/authenticate.js';
import { asyncHandler } from './lib/async-handler.js';
import * as authCtrl from './controllers/auth.controller.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/v1/auth', authRouter);
  app.get('/api/v1/me', authenticate, asyncHandler(authCtrl.me));
  app.use('/api/v1/sessions', sessionRouter);
  app.use('/api/v1', catalogRouter);

  app.use(errorHandler);
  return app;
}
