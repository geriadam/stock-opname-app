'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export function RequireAuth({
  role,
  children,
}: {
  role?: 'STAFF' | 'MANAGER';
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (role && user.role !== role) {
      router.replace(user.role === 'MANAGER' ? '/manager' : '/staff');
    }
  }, [user, loading, role, router]);

  if (loading || !user || (role && user.role !== role)) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-ink/60">
        Loading…
      </main>
    );
  }

  return <>{children}</>;
}
