'use client';

import { useState } from 'react';
import { Ban, Download, Globe, RotateCw, ScanSearch, Send, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import type { TaskListItem, WebsiteItem } from '@/lib/client/types';
import { STATUS_META, type TaskStatusValue } from '@/lib/task-status';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { WebsiteCategorySelect } from './website-category-select';

type BulkAction = 'send-to-wordpress' | 'retry' | 'seo-check' | 'assign-website' | 'cancel' | 'delete';

interface BulkResult {
  succeeded: number;
  failed: number;
  results: { id: string; keyword: string; ok: boolean; message: string }[];
}

const ACTION_LABELS: Record<BulkAction, string> = {
  'send-to-wordpress': 'Send to WordPress',
  retry: 'Retry',
  'seo-check': 'SEO check',
  'assign-website': 'Assign website',
  cancel: 'Cancel',
  delete: 'Delete',
};

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Downloads the selected rows as a CSV file (opens in Excel / Google Sheets). */
function exportCsv(tasks: TaskListItem[]): void {
  const header = ['Keyword', 'Title', 'Website', 'Category', 'Created', 'Words', 'SEO Readiness', 'Rank Math', 'Status', 'WordPress draft'];
  const rows = tasks.map((t) => [
    t.keyword,
    t.selectedTitle,
    t.website?.name,
    t.categoryName,
    t.createdAt,
    t.wordCount,
    t.seoScore,
    t.rankMathScore,
    STATUS_META[t.status as TaskStatusValue]?.label ?? t.status,
    t.wpEditUrl,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `articles-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Action bar shown above the Article History table while articles are selected. */
export function BulkActionBar({
  selected,
  websites,
  onClear,
  onDone,
}: {
  selected: TaskListItem[];
  websites: WebsiteItem[];
  onClear: () => void;
  /** Called with the ids that could not be processed (they stay selected). */
  onDone: (failedIds: string[]) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [target, setTarget] = useState({ websiteId: '', categoryId: '' });
  const count = selected.length;

  const run = async (action: BulkAction, extra: { websiteId?: string; categoryId?: string } = {}) => {
    if (action === 'delete' && !window.confirm(`Delete ${count} article task(s) with all their stages, responses and logs? WordPress drafts are not affected.`)) return;
    if (action === 'cancel' && !window.confirm(`Cancel ${count} article task(s)?`)) return;
    setBusy(action);
    try {
      const res = await apiFetch<BulkResult>('/api/tasks/bulk', { method: 'POST', body: { ids: selected.map((t) => t.id), action, ...extra } });
      const failures = res.results.filter((r) => !r.ok);
      const summary = `${ACTION_LABELS[action]}: ${res.succeeded} done${res.failed ? `, ${res.failed} skipped` : ''}`;
      const details = failures
        .slice(0, 4)
        .map((f) => `${f.keyword} — ${f.message}`)
        .join('\n');
      if (!res.failed) toast.success(summary);
      else if (res.succeeded) toast.warning(summary, details);
      else toast.error(summary, details);
      onDone(failures.map((f) => f.id));
      if (action === 'assign-website') setAssignOpen(false);
    } catch (err) {
      toast.error(`${ACTION_LABELS[action]} failed`, (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!count) return null;

  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/90 px-4 py-2.5 backdrop-blur">
        <span className="mr-1 text-sm font-medium text-indigo-900">{count} selected</span>
        <Button size="xs" icon={<Send className="h-3.5 w-3.5" />} loading={busy === 'send-to-wordpress'} disabled={Boolean(busy)} onClick={() => run('send-to-wordpress')}>
          Send to WordPress
        </Button>
        <Button size="xs" variant="outline" icon={<Globe className="h-3.5 w-3.5" />} disabled={Boolean(busy)} onClick={() => setAssignOpen(true)}>
          Assign website
        </Button>
        <Button size="xs" variant="outline" icon={<RotateCw className="h-3.5 w-3.5" />} loading={busy === 'retry'} disabled={Boolean(busy)} onClick={() => run('retry')}>
          Retry
        </Button>
        <Button size="xs" variant="outline" icon={<ScanSearch className="h-3.5 w-3.5" />} loading={busy === 'seo-check'} disabled={Boolean(busy)} onClick={() => run('seo-check')}>
          SEO check
        </Button>
        <Button size="xs" variant="outline" icon={<Download className="h-3.5 w-3.5" />} disabled={Boolean(busy)} onClick={() => exportCsv(selected)}>
          Export CSV
        </Button>
        <Button size="xs" variant="outline" icon={<Ban className="h-3.5 w-3.5" />} loading={busy === 'cancel'} disabled={Boolean(busy)} onClick={() => run('cancel')}>
          Cancel
        </Button>
        <Button size="xs" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} loading={busy === 'delete'} disabled={Boolean(busy)} onClick={() => run('delete')}>
          Delete
        </Button>
        <Button size="xs" variant="ghost" className="ml-auto" icon={<X className="h-3.5 w-3.5" />} disabled={Boolean(busy)} onClick={onClear}>
          Clear selection
        </Button>
      </div>

      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title={`Assign website to ${count} article(s)`}
        description="Use this for articles written without a website, then click Send to WordPress."
        footer={
          <>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Close
            </Button>
            <Button
              loading={busy === 'assign-website'}
              disabled={!target.websiteId}
              onClick={() => run('assign-website', { websiteId: target.websiteId, categoryId: target.categoryId || undefined })}
            >
              Assign
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <WebsiteCategorySelect websites={websites} websiteId={target.websiteId} categoryId={target.categoryId} onChange={setTarget} />
        </div>
      </Modal>
    </>
  );
}
