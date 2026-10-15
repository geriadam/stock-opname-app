'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/lib/auth-context';

type Form = { email: string; password: string };

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const { register, handleSubmit } = useForm<Form>({
    defaultValues: { email: 'staff1@storeA.test', password: 'Password123!' },
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = handleSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const user = await login(values.email, values.password);
      router.replace(user.role === 'MANAGER' ? '/manager' : '/staff');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  });

  return (
    <main className="relative mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <div className="mb-10">
        <p className="font-display text-5xl font-semibold leading-none text-pine">Stock Opname</p>
        <p className="mt-3 max-w-md text-ink/70">
          Count stock per store, submit for review, and apply approved deltas safely.
        </p>
      </div>

      <form onSubmit={onSubmit} className="card-panel space-y-4 p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input className="input" type="email" autoComplete="username" {...register('email')} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Password</label>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </div>
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button className="btn-primary w-full" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-ink/50">
          Seed: manager@storeA.test / staff1@storeA.test — password in README
        </p>
      </form>
    </main>
  );
}
