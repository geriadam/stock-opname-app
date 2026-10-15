'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import type { ReactNode } from 'react';

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-ink/10 pb-4">
        <div>
          <p className="font-display text-3xl font-semibold tracking-tight text-pine">
            Stock Opname
          </p>
          <h1 className="mt-1 text-lg font-medium text-ink/80">{title}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {user && (
            <div className="text-right">
              <div className="font-medium">{user.name}</div>
              <div className="text-ink/55">
                {user.role} · {user.storeName ?? user.storeId}
              </div>
            </div>
          )}
          <Link href={user?.role === 'MANAGER' ? '/manager' : '/staff'} className="btn-secondary">
            Home
          </Link>
          <button type="button" className="btn-secondary" onClick={() => logout()}>
            Log out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
