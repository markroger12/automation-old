'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin text-current', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone = 'indigo', className }: { value: number; tone?: 'indigo' | 'green' | 'amber' | 'red' | 'gray'; className?: string }) {
  const colors = { indigo: 'bg-indigo-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-slate-400' };
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all duration-500', colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'error';

export function Alert({ tone = 'info', title, children, actions, className }: { tone?: AlertTone; title?: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string }) {
  const styles: Record<AlertTone, { box: string; icon: ReactNode }> = {
    info: { box: 'bg-sky-50 ring-sky-200 text-sky-900', icon: <Info className="h-5 w-5 text-sky-500" /> },
    success: { box: 'bg-emerald-50 ring-emerald-200 text-emerald-900', icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" /> },
    warning: { box: 'bg-amber-50 ring-amber-200 text-amber-900', icon: <AlertTriangle className="h-5 w-5 text-amber-500" /> },
    error: { box: 'bg-red-50 ring-red-200 text-red-900', icon: <XCircle className="h-5 w-5 text-red-500" /> },
  };
  const s = styles[tone];
  return (
    <div className={cn('flex gap-3 rounded-xl p-4 ring-1 ring-inset', s.box, className)}>
      <div className="shrink-0 pt-0.5">{s.icon}</div>
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-sm', title && 'mt-1')}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, icon, tone = 'slate', hint }: { label: string; value: ReactNode; icon?: ReactNode; tone?: 'slate' | 'indigo' | 'blue' | 'green' | 'amber' | 'red' | 'violet'; hint?: string }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    blue: 'bg-sky-50 text-sky-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && <span className={cn('rounded-lg p-2', tones[tone])}>{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function ScoreRing({ score, label, target }: { score: number | null | undefined; label: string; target?: number }) {
  const value = score ?? 0;
  const color = score === null || score === undefined ? '#cbd5e1' : value >= (target ?? 75) ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  const circumference = 2 * Math.PI * 28;
  return (
    <div className="flex items-center gap-3">
      <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true">
        <circle cx="34" cy="34" r="28" fill="none" stroke="#f1f5f9" strokeWidth="7" />
        <circle
          cx="34"
          cy="34"
          r="28"
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
          transform="rotate(-90 34 34)"
        />
        <text x="34" y="39" textAnchor="middle" className="fill-slate-900 text-[15px] font-semibold">
          {score ?? '—'}
        </text>
      </svg>
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{score === null || score === undefined ? 'Not available yet' : `${score}/100${target ? ` · target ${target}` : ''}`}</p>
      </div>
    </div>
  );
}
