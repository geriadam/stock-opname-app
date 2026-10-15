'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';
import { StatusChip } from '@/components/status-chip';
import { useAuth } from '@/lib/auth-context';
import { sessionsApi } from '@/lib/api';

export default function ManagerHomePage() {
  return (
    <RequireAuth role="MANAGER">
      <ManagerHome />
    </RequireAuth>
  );
}

function ManagerHome() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [startOpen, setStartOpen] = useState(false);
  const [blind, setBlind] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => sessionsApi.list(),
  });

  const createMut = useMutation({
    mutationFn: () => sessionsApi.create(user!.storeId, blind),
    onSuccess: () => {
      setStartOpen(false);
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <AppShell title="Manager workspace">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-ink/65">Start counts, review submissions, approve stock deltas.</p>
        <button type="button" className="btn-primary" onClick={() => setStartOpen(true)}>
          Start opname
        </button>
      </div>

      {isLoading && <p className="text-sm text-ink/60">Loading…</p>}

      <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white/70">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-mist/80 text-xs uppercase tracking-wide text-ink/55">
            <tr>
              <th className="px-3 py-2">Session</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Revision</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(data?.sessions ?? []).map((s) => (
              <tr key={s.id} className="border-t border-ink/5">
                <td className="px-3 py-2 font-mono text-xs">{s.id}</td>
                <td className="px-3 py-2">
                  <StatusChip status={s.status} />
                </td>
                <td className="px-3 py-2">{s.revision}</td>
                <td className="px-3 py-2 text-ink/60">
                  {new Date(s.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link className="text-pine underline" href={`/manager/sessions/${s.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {startOpen && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-ink/40 p-4">
          <div className="card-panel w-full max-w-md p-6">
            <h3 className="font-display text-xl font-semibold">Start opname</h3>
            <p className="mt-2 text-sm text-ink/65">
              Snapshots current stock for {user?.storeName ?? user?.storeId}. Only one active
              session per store.
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
              Blind count (hide system qty from staff)
            </label>
            {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setStartOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={createMut.isPending}
                onClick={() => {
                  setError(null);
                  createMut.mutate();
                }}
              >
                {createMut.isPending ? 'Creating…' : 'Create session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
