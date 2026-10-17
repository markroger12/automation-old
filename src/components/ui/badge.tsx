import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { STATUS_META, type StatusTone, type TaskStatusValue } from '@/lib/task-status';

const tones: Record<StatusTone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({ tone = 'gray', children, className, dot }: { tone?: StatusTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status as TaskStatusValue];
  if (!meta) return <Badge>{status}</Badge>;
  const animated = meta.group === 'running';
  return (
    <Badge tone={meta.tone} className={animated ? 'pr-2.5' : undefined}>
      {animated && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {meta.label}
    </Badge>
  );
}

export function SessionBadge({ status }: { status: string }) {
  const map: Record<string, { tone: StatusTone; label: string }> = {
    ACTIVE: { tone: 'green', label: 'Logged in' },
    LOGIN_REQUIRED: { tone: 'amber', label: 'Login required' },
    ERROR: { tone: 'red', label: 'Error' },
    UNKNOWN: { tone: 'gray', label: 'Not tested' },
  };
  const m = map[status] ?? map.UNKNOWN;
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export function ScoreBadge({ score, target = 75 }: { score: number | null | undefined; target?: number }) {
  if (score === null || score === undefined) return <span className="text-slate-400">—</span>;
  const tone: StatusTone = score >= target ? 'green' : score >= 50 ? 'amber' : 'red';
  return <Badge tone={tone}>{score}/100</Badge>;
}
