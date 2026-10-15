'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';
import { StatusChip } from '@/components/status-chip';
import { getAccessToken, sessionsApi, type SessionItem } from '@/lib/api';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'uncounted' | 'counted' | 'unexpected';

export default function ManagerSessionPage() {
  return (
    <RequireAuth role="MANAGER">
      <ReviewPanel />
    </RequireAuth>
  );
}

function ReviewPanel() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [deferredSearch, setDeferredSearch] = useState('');
  const [items, setItems] = useState<SessionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDeferredSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const sessionQuery = useQuery({
    queryKey: ['session', id],
    queryFn: () => sessionsApi.get(id),
    refetchInterval: (q) =>
      q.state.data?.status === 'APPLYING' ? 2000 : false,
  });

  const historyQuery = useQuery({
    queryKey: ['history', id],
    queryFn: () => sessionsApi.history(id),
  });

  useEffect(() => {
    let cancelled = false;
    setLoadingItems(true);
    setItems([]);
    setCursor(null);
    const qs = new URLSearchParams({ filter, limit: '100' });
    if (deferredSearch) qs.set('search', deferredSearch);
    void sessionsApi
      .items(id, qs.toString())
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingItems(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, filter, deferredSearch]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingItems(true);
    try {
      const qs = new URLSearchParams({ filter, limit: '100', cursor });
      if (deferredSearch) qs.set('search', deferredSearch);
      const res = await sessionsApi.items(id, qs.toString());
      setItems((prev) => [...prev, ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load items');
    } finally {
      setLoadingItems(false);
    }
  };

  const approveMut = useMutation({
    mutationFn: () => sessionsApi.approve(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['session', id] }),
    onError: (err: Error) => setError(err.message),
  });

  const rejectMut = useMutation({
    mutationFn: () => sessionsApi.reject(id, reason),
    onSuccess: () => {
      setRejectOpen(false);
      void qc.invalidateQueries({ queryKey: ['session', id] });
      void qc.invalidateQueries({ queryKey: ['history', id] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const retryMut = useMutation({
    mutationFn: () => sessionsApi.retry(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['session', id] }),
    onError: (err: Error) => setError(err.message),
  });

  const cancelMut = useMutation({
    mutationFn: () => sessionsApi.cancel(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['session', id] }),
    onError: (err: Error) => setError(err.message),
  });

  const session = sessionQuery.data;
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0),
      ),
    [items],
  );

  const downloadReport = async () => {
    const token = getAccessToken();
    const res = await fetch(sessionsApi.reportUrl(id), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opname-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell title="Session review">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            {session && <StatusChip status={session.status} />}
            <span className="font-mono text-xs text-ink/50">{id}</span>
          </div>
          {session?.applyError && (
            <p className="mt-2 text-sm text-rose-700">Apply error: {session.applyError}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => void downloadReport()}>
            Export CSV
          </button>
          {session?.status === 'SUBMITTED' && (
            <>
              <button
                type="button"
                className="btn-danger"
                onClick={() => setRejectOpen(true)}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={approveMut.isPending}
                onClick={() => {
                  setError(null);
                  approveMut.mutate();
                }}
              >
                Approve
              </button>
            </>
          )}
          {session?.status === 'APPLY_FAILED' && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => retryMut.mutate()}
              disabled={retryMut.isPending}
            >
              Retry apply
            </button>
          )}
          {session && ['OPEN', 'REJECTED'].includes(session.status) && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => cancelMut.mutate()}
              disabled={cancelMut.isPending}
            >
              Cancel session
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-rose-700">{error}</p>}

      {session?.status === 'APPLYING' && (
        <div className="card-panel mb-6 p-4 text-sm text-violet-900">
          Applying stock deltas… polling every 2s
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Items', session?.counters?.total],
          ['Counted', session?.counters?.counted],
          ['Uncounted', session?.counters?.uncounted],
          ['|Variance|', session?.counters?.varianceAbs],
        ].map(([label, value]) => (
          <div key={String(label)} className="card-panel p-4">
            <div className="text-xs uppercase tracking-wide text-ink/50">{label}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{value ?? '—'}</div>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Products</h2>
          <div className="flex flex-wrap gap-2">
            <input
              className="input max-w-xs"
              placeholder="Search SKU or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {(['all', 'uncounted', 'counted', 'unexpected'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                className={cn('btn-secondary capitalize', filter === f && 'ring-2 ring-pine/40')}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-mist/80 text-xs uppercase tracking-wide text-ink/55">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">System</th>
                <th className="px-3 py-2">Counted</th>
                <th className="px-3 py-2">Δ</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.productId} className="border-t border-ink/5">
                  <td className="px-3 py-2 font-mono text-xs">
                    {item.sku}
                    {item.isUnexpected && (
                      <span className="ml-1 text-[10px] font-semibold text-clay">NEW</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2">{item.systemQty}</td>
                  <td className="px-3 py-2 text-ink/70">
                    {item.countedQty == null ? '—' : item.countedQty}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {item.countedQty == null ? (
                      '—'
                    ) : (
                      <>
                        {(item.variance ?? 0) > 0 ? '+' : ''}
                        {item.variance ?? 0}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!loadingItems && sorted.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-ink/50">
                    No products match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {cursor && (
          <button
            type="button"
            className="btn-secondary mt-4"
            disabled={loadingItems}
            onClick={() => void loadMore()}
          >
            {loadingItems ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl font-semibold">History</h2>
        <ol className="space-y-2">
          {(historyQuery.data?.audits ?? []).map(
            (a: {
              id: string;
              action: string;
              createdAt: string;
              actor?: { name: string } | null;
            }) => (
              <li
                key={a.id}
                className="rounded-lg border border-ink/10 bg-white/60 px-4 py-2 text-sm"
              >
                <span className="font-medium">{a.action}</span>
                <span className="text-ink/50">
                  {' '}
                  · {a.actor?.name ?? 'system'} · {new Date(a.createdAt).toLocaleString()}
                </span>
              </li>
            ),
          )}
        </ol>
      </section>

      {rejectOpen && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4">
          <div className="card-panel w-full max-w-md p-6">
            <h3 className="font-display text-xl font-semibold">Reject submission</h3>
            <textarea
              className="input mt-3 min-h-[100px]"
              placeholder="Reason (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setRejectOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={!reason.trim() || rejectMut.isPending}
                onClick={() => rejectMut.mutate()}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
