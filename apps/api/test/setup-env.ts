process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/stock_opname_test?schema=public';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-32chars-min!!';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-32chars-min!';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL_DAYS = '7';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.COOKIE_SECURE = 'false';
process.env.APPLY_SYNC = '1';
process.env.RUN_DB_TESTS = process.env.RUN_DB_TESTS ?? '1';
delete process.env.FORCE_APPLY_FAIL;
