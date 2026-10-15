const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'STAFF' | 'MANAGER';
  storeId: string;
  storeName?: string;
};

export type ApiError = {
  error: { code: string; message: string; details?: unknown };
};

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (typeof window !== 'undefined') {
    if (token) sessionStorage.setItem('accessToken', token);
    else sessionStorage.removeItem('accessToken');
  }
}

export function getAccessToken() {
  if (accessToken) return accessToken;
  if (typeof window !== 'undefined') {
    accessToken = sessionStorage.getItem('accessToken');
  }
  return accessToken;
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as ApiError)?.error?.message ?? res.statusText;
    const err = new Error(message) as Error & { code?: string; status?: number; details?: unknown };
    err.code = (data as ApiError)?.error?.code;
    err.status = res.status;
    err.details = (data as ApiError)?.error?.details;
    throw err;
  }
  return data as T;
}

async function refreshAccess(): Promise<string | null> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    setAccessToken(null);
    return null;
  }
  const data = await res.json();
  setAccessToken(data.accessToken);
  return data.accessToken as string;
}

export async function api<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);

  let res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !path.includes('/auth/login')) {
    const next = await refreshAccess();
    if (next) {
      headers.set('Authorization', `Bearer ${next}`);
      res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
    }
  }

  if (res.status === 204) return undefined as T;
  return parseJson<T>(res);
}

export const authApi = {
  login: (email: string, password: string) =>
    api<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  me: () => api<User>('/me'),
};

export type Session = {
  id: string;
  storeId: string;
  status: string;
  revision: number;
  blindCount: boolean;
  createdAt: string;
  submittedAt?: string | null;
  reviewNote?: string | null;
  applyError?: string | null;
  applyAttempts?: number;
  counters?: {
    total: number;
    counted: number;
    uncounted: number;
    unexpected: number;
    variancePositive: number;
    varianceNegative: number;
    varianceAbs: number;
  };
  store?: { id: string; name: string };
};

export type SessionItem = {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  systemQty?: number;
  countedQty: number | null;
  note: string | null;
  isUnexpected: boolean;
  updatedAt: string;
  variance?: number;
};

export const sessionsApi = {
  list: (qs = '') => api<{ sessions: Session[] }>(`/sessions${qs}`),
  get: (id: string) => api<Session>(`/sessions/${id}`),
  create: (storeId: string, blindCount?: boolean) =>
    api<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ storeId, blindCount }),
    }),
  items: (id: string, qs: string) =>
    api<{ items: SessionItem[]; nextCursor: string | null }>(`/sessions/${id}/items?${qs}`),
  saveItems: (id: string, items: Array<{ sku: string; countedQty: number; note?: string | null }>) =>
    api<{ saved: number }>(`/sessions/${id}/items`, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    }),
  importCsv: (id: string, file: File, dryRun: boolean, mergeDuplicates: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    return api<{
      dryRun: boolean;
      committed: boolean;
      rowCount: number;
      errors: Array<{ line: number; sku?: string; message: string }>;
      duplicates: Array<{ sku: string; lines: number[] }>;
    }>(`/sessions/${id}/items/import?dryRun=${dryRun}&mergeDuplicates=${mergeDuplicates}`, {
      method: 'POST',
      body: fd,
    });
  },
  submit: (id: string) =>
    api(`/sessions/${id}/submit`, {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
    }),
  withdraw: (id: string) => api(`/sessions/${id}/withdraw`, { method: 'POST' }),
  approve: (id: string) =>
    api(`/sessions/${id}/approve`, {
      method: 'POST',
      idempotencyKey: crypto.randomUUID(),
    }),
  reject: (id: string, reason: string) =>
    api(`/sessions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  retry: (id: string) => api(`/sessions/${id}/retry-apply`, { method: 'POST' }),
  cancel: (id: string) => api(`/sessions/${id}/cancel`, { method: 'POST' }),
  history: (id: string) =>
    api<{
      submissions: unknown[];
      audits: Array<{
        id: string;
        action: string;
        createdAt: string;
        actor?: { name: string } | null;
      }>;
    }>(`/sessions/${id}/history`),
  reportUrl: (id: string) => `${API_URL}/sessions/${id}/report.csv`,
};
