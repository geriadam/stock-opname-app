'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';
import { StatusChip } from '@/components/status-chip';
import { sessionsApi } from '@/lib/api';

const ACTIVE = new Set(['OPEN', 'SUBMITTED', 'REJECTED', 'APPLYING', 'APPLY_FAILED']);

export default function StaffHomePage() {
  return (
    <RequireAuth role="STAFF">
      <StaffHome />
    </RequireAuth>
  );
}

function StaffHome() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => sessionsApi.list(),
  });

  const sessions = data?.sessions ?? [];
  const active = sessions.find((s) => ACTIVE.has(s.status));

  return (
    <AppShell title="Staff workspace">
      {isLoading && <p className="text-sm text-ink/60">Loading sessions…</p>}
      {error && <p className="text-sm text-rose-700">{(error as Error).message}</p>}

      {!isLoading && !active && (
        <div className="card-panel p-8">
          <h2 className="font-display text-2xl font-semibold">No active opname</h2>
          <p className="mt-2 text-ink/65">
            Wait for a manager to start a count session for your store.
          </p>
        </div>
      )}

      {active && (
        <Link href={`/staff/sessions/${active.id}`} className="card-panel block p-6 transition hover:bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold">Active session</h2>
              <p className="mt-1 text-sm text-ink/60">{active.id}</p>
            </div>
            <StatusChip status={active.status} />
          </div>
          {active.reviewNote && (
            <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Rejected: {active.reviewNote}
            </p>
          )}
          <p className="mt-4 text-sm text-pine">Open count grid →</p>
        </Link>
      )}

      <section className="mt-8">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">
          Recent sessions
        </h3>
        <div className="space-y-2">
          {sessions.slice(0, 8).map((s) => (
            <Link
              key={s.id}
              href={`/staff/sessions/${s.id}`}
              className="flex items-center justify-between rounded-lg border border-ink/10 bg-white/60 px-4 py-3 text-sm hover:bg-white"
            >
              <span className="font-mono text-xs text-ink/70">{s.id.slice(0, 12)}…</span>
              <StatusChip status={s.status} />
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
