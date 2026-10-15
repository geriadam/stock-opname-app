'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';
import { StatusChip } from '@/components/status-chip';
import { sessionsApi, type SessionItem } from '@/lib/api';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'uncounted' | 'counted' | 'unexpected';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function StaffSessionPage() {
  return (
    <RequireAuth role="STAFF">
      <CountGrid />
    </RequireAuth>
  );
}

function CountGrid() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [deferredSearch, setDeferredSearch] = useState('');
  const [items, setItems] = useState<SessionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [importOpen, setImportOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  const loadItems = useCallback(
    async (reset: boolean) => {
      const qs = new URLSearchParams({
        filter,
        limit: '80',
      });
      if (deferredSearch) qs.set('search', deferredSearch);
      if (!reset && cursor) qs.set('cursor', cursor);
      const res = await sessionsApi.items(id, qs.toString());
      setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
      setCursor(res.nextCursor);
    },
    [id, filter, deferredSearch, cursor],
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    void (async () => {
      const qs = new URLSearchParams({ filter, limit: '80' });
      if (deferredSearch) qs.set('search', deferredSearch);
      const res = await sessionsApi.items(id, qs.toString());
      setItems(res.items);
      setCursor(res.nextCursor);
    })();
  }, [id, filter, deferredSearch]);

  const editable = useMemo(
    () => ['OPEN', 'REJECTED'].includes(sessionQuery.data?.status ?? ''),
    [sessionQuery.data?.status],
  );

  const queueSave = (sku: string, countedQty: number, note?: string | null) => {
    if (!editable) return;
    setSaveState('saving');
    const existing = timers.current.get(sku);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      try {
        await sessionsApi.saveItems(id, [{ sku, countedQty, note }]);
        setSaveState('saved');
        void qc.invalidateQueries({ queryKey: ['session', id] });
      } catch {
        setSaveState('error');
      }
    }, 400);
    timers.current.set(sku, t);
  };

  const submitMut = useMutation({
    mutationFn: () => sessionsApi.submit(id),
    onSuccess: () => {
      setSubmitOpen(false);
      void qc.invalidateQueries({ queryKey: ['session', id] });
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const withdrawMut = useMutation({
    mutationFn: () => sessionsApi.withdraw(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['session', id] }),
    onError: (err: Error) => setActionError(err.message),
  });

  const session = sessionQuery.data;
  const progress = session?.counters
    ? Math.round((session.counters.counted / Math.max(session.counters.total, 1)) * 100)
    : 0;

  return (
    <AppShell title="Count grid">
      <div className="sticky top-0 z-10 -mx-4 mb-4 space-y-3 border-b border-ink/10 bg-[rgba(243,246,249,0.92)] px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {session && <StatusChip status={session.status} />}
            <span className="text-sm text-ink/60">
              {session?.counters
                ? `${session.counters.counted}/${session.counters.total} counted`
                : '—'}
            </span>
            <span
              className={cn(
                'text-xs font-medium',
                saveState === 'error' ? 'text-rose-700' : 'text-ink/50',
              )}
            >
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'error' && 'Save failed'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && (
              <button type="button" className="btn-secondary" onClick={() => setImportOpen(true)}>
                Import CSV
              </button>
            )}
            {editable && (
              <button type="button" className="btn-primary" onClick={() => setSubmitOpen(true)}>
                Submit
              </button>
            )}
            {session?.status === 'SUBMITTED' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => withdrawMut.mutate()}
                disabled={withdrawMut.isPending}
              >
                Withdraw
              </button>
            )}
          </div>
        </div>

        {session?.counters && (
          <div className="h-2 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full bg-pine transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        {session?.reviewNote && session.status === 'REJECTED' && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
            Rejected by manager: {session.reviewNote}
          </p>
        )}

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

      {actionError && <p className="mb-3 text-sm text-rose-700">{actionError}</p>}

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-mist/80 text-xs uppercase tracking-wide text-ink/55">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">System</th>
              <th className="px-3 py-2">Counted</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.productId} className="border-t border-ink/5">
                <td className="px-3 py-2 font-mono text-xs">
                  {item.sku}
                  {item.isUnexpected && (
                    <span className="ml-1 text-[10px] font-semibold text-clay">NEW</span>
                  )}
                </td>
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2 text-ink/60">
                  {item.systemQty === undefined ? '—' : item.systemQty}
                </td>
                <td className="px-3 py-2">
                  <input
                    className="input w-24"
                    type="number"
                    min={0}
                    disabled={!editable}
                    defaultValue={item.countedQty ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '') return;
                      const n = Number(v);
                      if (!Number.isInteger(n) || n < 0) return;
                      setItems((prev) =>
                        prev.map((row) =>
                          row.productId === item.productId ? { ...row, countedQty: n } : row,
                        ),
                      );
                      queueSave(item.sku, n, item.note);
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="input min-w-[8rem]"
                    disabled={!editable}
                    defaultValue={item.note ?? ''}
                    onBlur={(e) => {
                      const note = e.target.value || null;
                      if (item.countedQty == null) return;
                      queueSave(item.sku, item.countedQty, note);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor && (
        <button
          type="button"
          className="btn-secondary mt-4"
          onClick={() => void loadItems(false)}
        >
          Load more
        </button>
      )}

      {importOpen && (
        <ImportDialog
          sessionId={id}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            setItems([]);
            setCursor(null);
            void qc.invalidateQueries({ queryKey: ['session', id] });
            const qs = new URLSearchParams({ filter, limit: '80' });
            void sessionsApi.items(id, qs.toString()).then((res) => {
              setItems(res.items);
              setCursor(res.nextCursor);
            });
          }}
        />
      )}

      {submitOpen && session?.counters && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4">
          <div className="card-panel w-full max-w-md p-6">
            <h3 className="font-display text-xl font-semibold">Submit for review?</h3>
            {session.counters.uncounted > 0 && (
              <p className="mt-2 text-sm text-amber-800">
                {session.counters.uncounted} items are still uncounted (blank ≠ 0). Continue?
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSubmitOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={submitMut.isPending}
                onClick={() => submitMut.mutate()}
              >
                {submitMut.isPending ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ImportDialog({
  sessionId,
  onClose,
  onDone,
}: {
  sessionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [mergeDuplicates, setMergeDuplicates] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof sessionsApi.importCsv>> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sessionsApi.importCsv(sessionId, file, dryRun, mergeDuplicates);
      setPreview(res);
      if (!dryRun && res.committed) onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4">
      <div className="card-panel w-full max-w-lg p-6">
        <h3 className="font-display text-xl font-semibold">Import CSV</h3>
        <p className="mt-1 text-sm text-ink/60">Columns: sku, counted_qty, note</p>
        <input
          className="mt-4 block w-full text-sm"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mergeDuplicates}
            onChange={(e) => setMergeDuplicates(e.target.checked)}
          />
          Merge duplicate SKUs (last wins)
        </label>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        {preview && (
          <div className="mt-3 max-h-40 overflow-auto rounded border border-ink/10 bg-sand p-2 text-xs">
            <div>
              Rows: {preview.rowCount} · Errors: {preview.errors.length}
            </div>
            {preview.errors.slice(0, 20).map((e, i) => (
              <div key={i} className="text-rose-700">
                L{e.line} {e.sku ?? ''} — {e.message}
              </div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!file || busy}
            onClick={() => void run(true)}
          >
            Dry run
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!file || busy || (preview != null && preview.errors.length > 0)}
            onClick={() => void run(false)}
          >
            Commit
          </button>
        </div>
      </div>
    </div>
  );
}
