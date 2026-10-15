export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'ACTIVE_SESSION_EXISTS'
  | 'DUPLICATE_SKU'
  | 'UNKNOWN_SKU'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number = 400,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
