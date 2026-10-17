'use client';

import { cn } from '@/lib/utils';

export interface TabItem {
  key: string;
  label: string;
  count?: number | null;
}

export function Tabs({ tabs, value, onChange, className }: { tabs: TabItem[]; value: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div className={cn('scrollbar-thin -mb-px flex gap-1 overflow-x-auto border-b border-slate-200', className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null && (
              <span className={cn('rounded-full px-1.5 py-0.5 text-xs', active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600')}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
