'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Camera, ChevronRight } from 'lucide-react';
import type { LogItem } from '@/lib/client/types';
import { cn, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';

const levelTone = { DEBUG: 'gray', INFO: 'blue', WARN: 'amber', ERROR: 'red' } as const;

function DataView({ data }: { data: unknown }) {
  if (data === null || data === undefined) return null;
  const obj = data as Record<string, unknown>;
  const longText = (['prompt', 'response'] as const).filter((k) => typeof obj?.[k] === 'string');
  const rest = Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => !longText.includes(k as 'prompt' | 'response')));
  return (
    <div className="space-y-3">
      {longText.map((k) => (
        <div key={k}>
          <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{k === 'prompt' ? 'Prompt' : 'ChatGPT Response'}</p>
          <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs whitespace-pre-wrap text-slate-100">{String(obj[k])}</pre>
        </div>
      ))}
      {Object.keys(rest).length > 0 && (
        <pre className="scrollbar-thin max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-700 ring-1 ring-slate-200">
          {JSON.stringify(rest, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function LogList({ logs, showTask = true }: { logs: LogItem[]; showTask?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!logs.length) return <EmptyState title="No log entries" description="Logs appear here as the worker processes tasks." />;

  return (
    <ul className="divide-y divide-slate-100">
      {logs.map((log) => {
        const expandable = Boolean(log.data) || Boolean(log.screenshotPath);
        const isOpen = open === log.id;
        return (
          <li key={log.id} className="px-4 py-2.5">
            <div
              className={cn('flex items-start gap-3', expandable && 'cursor-pointer')}
              onClick={() => expandable && setOpen(isOpen ? null : log.id)}
            >
              <ChevronRight className={cn('mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition-transform', isOpen && 'rotate-90', !expandable && 'invisible')} />
              <span className="w-36 shrink-0 text-xs text-slate-500 tabular-nums">{formatDateTime(log.createdAt)}</span>
              <Badge tone={levelTone[log.level]} className="w-14 justify-center">
                {log.level}
              </Badge>
              <span className="hidden w-24 shrink-0 text-xs font-medium text-slate-500 md:inline">{log.category}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm break-words text-slate-800">{log.message}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  {log.stage && <span>Stage: {log.stage}</span>}
                  {showTask && log.taskId && (
                    <Link href={`/articles/${log.taskId}`} className="text-indigo-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {log.task?.keyword ?? log.taskId}
                    </Link>
                  )}
                  {log.screenshotPath && (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <Camera className="h-3 w-3" /> screenshot
                    </span>
                  )}
                </div>
              </div>
            </div>
            {isOpen && (
              <div className="mt-3 ml-7 space-y-3">
                {log.screenshotPath && (
                  <a href={`/api/screenshots/${log.screenshotPath}`} target="_blank" rel="noopener noreferrer" className="block max-w-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/screenshots/${log.screenshotPath}`} alt="Automation failure screenshot" className="rounded-lg ring-1 ring-slate-200" />
                  </a>
                )}
                <DataView data={log.data} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
