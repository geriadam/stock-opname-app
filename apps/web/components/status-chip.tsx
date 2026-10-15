import { cn } from '@/lib/cn';

const styles: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-900',
  SUBMITTED: 'bg-amber-100 text-amber-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  APPLYING: 'bg-violet-100 text-violet-900',
  APPLY_FAILED: 'bg-red-100 text-red-900',
  APPLIED: 'bg-emerald-100 text-emerald-900',
  CANCELLED: 'bg-slate-200 text-slate-700',
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={cn('status-chip', styles[status] ?? 'bg-slate-100 text-slate-700')}>
      {status.replace('_', ' ')}
    </span>
  );
}
