'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Edit3,
  ExternalLink,
  Eye,
  FileSearch,
  MessagesSquare,
  MoreHorizontal,
  RefreshCcw,
  RotateCw,
  ScanSearch,
  ScrollText,
  Send,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useApi } from '@/lib/client/api';
import type { TaskListResponse, WebsiteItem } from '@/lib/client/types';
import { STATUS_META, TASK_STATUSES } from '@/lib/task-status';
import { formatDateTime } from '@/lib/utils';
import { ScoreBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dropdown } from '@/components/ui/dropdown';
import { EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { BulkActionBar } from '@/components/tasks/bulk-actions';
import { RegenerateModal } from '@/components/tasks/regenerate-modal';
import { useTaskAction } from '@/components/tasks/use-task-action';

export default function HistoryPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [websiteId, setWebsiteId] = useState('');
  const [page, setPage] = useState(1);
  const [regen, setRegen] = useState<{ id: string; moduleKey: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // A new page or filter shows other rows: start a fresh selection.
  useEffect(() => setSelectedIds(new Set()), [page, debounced, status, websiteId]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (debounced) params.set('q', debounced);
  if (status) params.set('status', status);
  if (websiteId) params.set('websiteId', websiteId);

  const { data, loading, reload } = useApi<TaskListResponse>(`/api/tasks?${params}`, { refreshInterval: 10000 });
  const websites = useApi<{ websites: WebsiteItem[] }>('/api/websites');
  const { run, remove } = useTaskAction(reload);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const rows = data?.tasks ?? [];
  const selected = rows.filter((t) => selectedIds.has(t.id));
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(rows.map((t) => t.id)));

  return (
    <>
      <PageHeader title="Article History" description="Every generated article with its SEO scores and WordPress draft." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row">
          <Input placeholder="Search keyword or title…" value={search} onChange={(e) => setSearch(e.target.value)} className="md:max-w-xs" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="md:max-w-[220px]">
            <option value="">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <Select value={websiteId} onChange={(e) => { setWebsiteId(e.target.value); setPage(1); }} className="md:max-w-[220px]">
            <option value="">All websites</option>
            {websites.data?.websites.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>

        {loading && !data ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Spinner />
          </div>
        ) : !data?.tasks.length ? (
          <EmptyState title="No articles found" description="Try a different filter or create a new article." />
        ) : (
          <div className="overflow-x-auto">
            <BulkActionBar
              selected={selected}
              websites={websites.data?.websites ?? []}
              onClear={() => setSelectedIds(new Set())}
              onDone={(failedIds) => {
                setSelectedIds(new Set(failedIds));
                void reload();
              }}
            />
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="w-10 py-3 pr-0 pl-4">
                    <input
                      type="checkbox"
                      aria-label="Select all articles on this page"
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = selected.length > 0 && !allSelected;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-4 py-3">Keyword / Title</th>
                  <th className="px-4 py-3">Website</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Words</th>
                  <th className="px-4 py-3">SEO Readiness</th>
                  <th className="px-4 py-3">Rank Math</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Draft</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.tasks.map((t) => (
                  <tr key={t.id} className={selectedIds.has(t.id) ? 'bg-indigo-50/50' : 'hover:bg-slate-50/60'}>
                    <td className="w-10 py-3 pr-0 pl-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.keyword}`}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggle(t.id)}
                      />
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <Link href={`/articles/${t.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                        {t.keyword}
                      </Link>
                      <p className="line-clamp-1 text-xs text-slate-500">{t.selectedTitle ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{t.website?.name ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{t.categoryName ?? '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">{formatDateTime(t.createdAt)}</td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{t.wordCount?.toLocaleString() ?? '—'}</td>
                    <td className="px-4 py-3">
                      <ScoreBadge score={t.seoScore} target={70} />
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBadge score={t.rankMathScore} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3">
                      {t.wpEditUrl ? (
                        <a href={t.wpEditUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Dropdown
                        trigger={
                          <Button size="xs" variant="ghost" aria-label="Actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                        items={[
                          { label: 'View', icon: <Eye className="h-4 w-4" />, href: `/articles/${t.id}` },
                          { label: 'Edit', icon: <Edit3 className="h-4 w-4" />, href: `/articles/${t.id}?tab=editor` },
                          { label: 'View Research', icon: <FileSearch className="h-4 w-4" />, href: `/articles/${t.id}?tab=research` },
                          { label: 'View ChatGPT Conversation', icon: <MessagesSquare className="h-4 w-4" />, href: `/articles/${t.id}?tab=conversation` },
                          { label: 'View Prompts', icon: <Terminal className="h-4 w-4" />, href: `/articles/${t.id}?tab=prompts` },
                          { label: 'View Responses', icon: <ScrollText className="h-4 w-4" />, href: `/articles/${t.id}?tab=responses` },
                          { label: '', divider: true },
                          { label: 'Retry', icon: <RotateCw className="h-4 w-4" />, onSelect: () => run(t.id, { action: 'retry' }) },
                          { label: 'Regenerate Stage…', icon: <RefreshCcw className="h-4 w-4" />, onSelect: () => setRegen({ id: t.id, moduleKey: t.moduleKey }) },
                          { label: 'Run SEO Check', icon: <ScanSearch className="h-4 w-4" />, onSelect: () => run(t.id, { action: 'seo-check' }) },
                          { label: 'Send to WordPress', icon: <Send className="h-4 w-4" />, onSelect: () => run(t.id, { action: 'send-to-wordpress' }) },
                          { label: 'Open WordPress Draft', icon: <ExternalLink className="h-4 w-4" />, href: t.wpEditUrl ?? '#', external: true, disabled: !t.wpEditUrl },
                          { label: '', divider: true },
                          { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => remove(t.id, t.keyword) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {data.total} articles
            </span>
            <div className="flex gap-2">
              <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="xs" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {regen && <RegenerateModal open taskId={regen.id} moduleKey={regen.moduleKey} onClose={() => setRegen(null)} onDone={reload} />}
    </>
  );
}
