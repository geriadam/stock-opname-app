'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role === 'MANAGER') router.replace('/manager');
    else router.replace('/staff');
  }, [user, loading, router]);

  return (
    <main className="grid min-h-screen place-items-center text-sm text-ink/60">
      Loading…
    </main>
  );
}
