'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Ban, Eye, ListOrdered, Play } from 'lucide-react';
import { useApi } from '@/lib/client/api';
import type { ProfileItem, TaskListResponse } from '@/lib/client/types';
import { timeAgo } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader, ProgressBar, Spinner } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/tabs';
import { ReconnectButton } from '@/components/tasks/reconnect-button';
import { useTaskAction } from '@/components/tasks/use-task-action';

const GROUPS = [
  { key: 'active', label: 'Active' },
  { key: 'running', label: 'Running' },
  { key: 'queued', label: 'Queued' },
  { key: 'waiting', label: 'Waiting / Login' },
  { key: 'done', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

export default function QueuePage() {
  const [group, setGroup] = useState('active');
  const { data, loading, reload } = useApi<TaskListResponse>(`/api/tasks?group=${group}&pageSize=100`, { refreshInterval: 3000 });
  const profiles = useApi<{ profiles: ProfileItem[] }>('/api/profiles', { refreshInterval: 15000 });
  const { run, isPending } = useTaskAction(reload);

  return (
    <>
      <PageHeader
        title="Article Queue"
        description="Live progress of every article job. Tasks run one stage at a time and resume from the last completed stage."
        actions={<LinkButton href="/modules/celebrity-writer" variant="primary">Add articles</LinkButton>}
      />
      <Card>
        <div className="px-4 pt-2">
          <Tabs tabs={GROUPS} value={group} onChange={setGroup} />
        </div>
        {loading && !data ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Spinner />
          </div>
        ) : !data?.tasks.length ? (
          <EmptyState icon={<ListOrdered className="h-8 w-8" />} title="Nothing here" description="Tasks matching this filter will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50/70 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Keyword</th>
                  <th className="px-4 py-3">Website</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="w-56 px-4 py-3">Progress</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.tasks.map((t) => (
                  <tr key={t.id} className="align-top hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/articles/${t.id}`} className="font-medium text-slate-900 hover:text-indigo-600">
                        {t.keyword}
                      </Link>
                      {t.selectedTitle && <p className="mt-0.5 line-clamp-1 max-w-xs text-xs text-slate-500">{t.selectedTitle}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.website?.name ?? '—'}
                      {t.categoryName && <p className="text-xs text-slate-400">{t.categoryName}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                      {(t.statusMessage || t.error) && <p className="mt-1 line-clamp-2 max-w-xs text-xs text-slate-500">{t.error ?? t.statusMessage}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar value={t.progress} tone={t.status === 'FAILED' ? 'red' : t.status === 'LOGIN_REQUIRED' ? 'amber' : t.status === 'DRAFT_CREATED' ? 'green' : 'indigo'} />
                      <p className="mt-1 text-xs text-slate-400">
                        {t.progress}%{t.currentStage ? ` · ${t.currentStage.replace(/_/g, ' ').toLowerCase()}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">{timeAgo(t.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {t.status === 'LOGIN_REQUIRED' && (
                          <ReconnectButton service={t.loginRequiredFor} websiteId={t.website?.id ?? null} profiles={profiles.data?.profiles ?? []} />
                        )}
                        {t.status === 'AWAITING_TITLE_APPROVAL' && (
                          <LinkButton href={`/articles/${t.id}?tab=titles`} size="xs" variant="primary">
                            Choose title
                          </LinkButton>
                        )}
                        {t.status === 'AWAITING_ARTICLE_APPROVAL' && (
                          <LinkButton href={`/articles/${t.id}?tab=editor`} size="xs" variant="primary">
                            Review article
                          </LinkButton>
                        )}
                        {['LOGIN_REQUIRED', 'FAILED', 'CANCELLED'].includes(t.status) && (
                          <Button size="xs" variant="outline" icon={<Play className="h-3.5 w-3.5" />} loading={isPending(t.id, 'resume')} onClick={() => run(t.id, { action: 'resume' })}>
                            Resume
                          </Button>
                        )}
                        {['QUEUED', 'OPENING_CHATGPT', 'GENERATING_TITLES', 'RESEARCHING', 'WRITING_ARTICLE', 'OPTIMIZING', 'GENERATING_FAQS', 'GENERATING_BIO_TABLE', 'SEO_CHECKING', 'OPENING_WORDPRESS', 'CREATING_DRAFT', 'RUNNING_RANKMATH', 'AWAITING_TITLE_APPROVAL', 'AWAITING_ARTICLE_APPROVAL', 'LOGIN_REQUIRED'].includes(t.status) && (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50"
                            icon={<Ban className="h-3.5 w-3.5" />}
                            loading={isPending(t.id, 'cancel')}
                            onClick={() => window.confirm(`Cancel "${t.keyword}"?`) && run(t.id, { action: 'cancel' })}
                          >
                            Cancel
                          </Button>
                        )}
                        <LinkButton href={`/articles/${t.id}`} size="xs" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />}>
                          View
                        </LinkButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
