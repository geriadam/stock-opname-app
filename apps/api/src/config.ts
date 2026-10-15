import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().default(4000),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const env = envSchema.parse(process.env);

export const REFRESH_COOKIE = 'refresh_token';
export const MAX_BATCH_ITEMS = 500;
export const MAX_COUNTED_QTY = 1_000_000;
export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 100_000;
