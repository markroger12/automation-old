'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Loader,
  PenSquare,
  Plus,
  Send,
  XCircle,
} from 'lucide-react';
import { useApi } from '@/lib/client/api';
import type { ProfileItem } from '@/lib/client/types';
import { statusLabel } from '@/lib/task-status';
import { timeAgo } from '@/lib/utils';
import { MODULES } from '@/modules/registry';
import { Badge, SessionBadge, StatusBadge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, ProgressBar, Spinner, StatCard } from '@/components/ui/feedback';
import { ModuleIcon } from '@/components/layout/module-icon';

interface StatsResponse {
  stats: { total: number; today: number; running: number; queued: number; completed: number; drafts: number; failed: number; needsReview: number; loginRequired: number };
  recentActivity: { id: string; level: string; category: string; message: string; createdAt: string; taskId: string | null; task: { keyword: string } | null }[];
  activeTasks: { id: string; keyword: string; status: string; progress: number; statusMessage: string | null; updatedAt: string; loginRequiredFor: string | null }[];
  profiles: ProfileItem[];
  workerOnline: boolean;
}

export default function DashboardPage() {
  const { data, error, loading } = useApi<StatsResponse>('/api/stats', { refreshInterval: 4000 });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live overview of article generation, WordPress drafts and browser sessions."
        actions={
          <LinkButton href="/modules/celebrity-writer" variant="primary" icon={<Plus className="h-4 w-4" />}>
            New Celebrity Article
          </LinkButton>
        }
      />

      {error && (
        <Alert tone="error" className="mb-6" title="Could not load dashboard data">
          {error}
        </Alert>
      )}
      {loading && !data && (
        <div className="flex justify-center py-20 text-slate-400">
          <Spinner />
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {!data.workerOnline && (
            <Alert tone="error" title="The automation worker is not running">
              Articles will stay queued and login buttons won&apos;t respond until it runs. Start the app with <code className="rounded bg-white/70 px-1">npm run dev:all</code> (it starts the dashboard and the worker together) and keep that window open.
            </Alert>
          )}
          {data.stats.loginRequired > 0 && (
            <Alert
              tone="warning"
              title={`${data.stats.loginRequired} task(s) are waiting for a login`}
              actions={
                <LinkButton href="/websites" size="xs">
                  Reconnect sessions
                </LinkButton>
              }
            >
              A saved ChatGPT or WordPress session expired. Log in again from the Websites page — waiting tasks resume from their last completed stage after a successful session test.
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total Articles" value={data.stats.total} icon={<FileText className="h-4 w-4" />} tone="slate" />
            <StatCard label="Articles Today" value={data.stats.today} icon={<Clock className="h-4 w-4" />} tone="indigo" />
            <StatCard label="Running Tasks" value={data.stats.running} icon={<Loader className="h-4 w-4" />} tone="blue" />
            <StatCard label="Queued Tasks" value={data.stats.queued} icon={<Layers className="h-4 w-4" />} tone="violet" />
            <StatCard label="Completed Articles" value={data.stats.completed} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
            <StatCard label="WordPress Drafts Created" value={data.stats.drafts} icon={<Send className="h-4 w-4" />} tone="green" />
            <StatCard label="Failed Tasks" value={data.stats.failed} icon={<XCircle className="h-4 w-4" />} tone="red" />
            <StatCard label="Needs Review" value={data.stats.needsReview} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Live Tasks" description="Queued, running and waiting articles" actions={<LinkButton href="/queue" size="xs">Open queue</LinkButton>} />
              {data.activeTasks.length === 0 ? (
                <EmptyState icon={<PenSquare className="h-8 w-8" />} title="No active tasks" description="Start a Celebrity Article to see live progress here." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.activeTasks.map((t) => (
                    <li key={t.id}>
                      <Link href={`/articles/${t.id}`} className="block px-5 py-3 hover:bg-slate-50">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate font-medium text-slate-900">{t.keyword}</p>
                          <StatusBadge status={t.status} />
                        </div>
                        <ProgressBar value={t.progress} className="mt-2" tone={t.status === 'LOGIN_REQUIRED' ? 'amber' : 'indigo'} />
                        <p className="mt-1 text-xs text-slate-500">
                          {t.statusMessage ?? statusLabel(t.status)} · updated {timeAgo(t.updatedAt)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader title="Recent Activity" actions={<LinkButton href="/logs" size="xs">All logs</LinkButton>} />
              {data.recentActivity.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ul className="scrollbar-thin max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
                  {data.recentActivity.map((a) => (
                    <li key={a.id} className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${a.level === 'ERROR' ? 'bg-red-500' : a.level === 'WARN' ? 'bg-amber-500' : 'bg-sky-500'}`}
                        />
                        <p className="line-clamp-2 text-sm text-slate-700">{a.message}</p>
                      </div>
                      <p className="mt-0.5 pl-4 text-xs text-slate-400">
                        {a.taskId ? (
                          <Link href={`/articles/${a.taskId}`} className="text-indigo-600 hover:underline">
                            {a.task?.keyword}
                          </Link>
                        ) : null}{' '}
                        · {timeAgo(a.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader title="Browser Sessions" description="Saved logins used by the automation" actions={<LinkButton href="/websites" size="xs">Manage</LinkButton>} />
              <ul className="divide-y divide-slate-100">
                {data.profiles.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {p.websites.map((w) => w.name).join(', ') || 'Not assigned'}
                        {p.lastCheckedAt ? ` · checked ${timeAgo(p.lastCheckedAt)}` : ''}
                      </p>
                    </div>
                    <SessionBadge status={p.sessionStatus} />
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader title="Modules" description="Content and SEO tools" />
              <CardBody className="grid gap-3 sm:grid-cols-2">
                {MODULES.map((m) => (
                  <Link
                    key={m.key}
                    href={m.href}
                    className={`flex gap-3 rounded-xl p-3 ring-1 transition ${m.status === 'active' ? 'ring-indigo-200 hover:bg-indigo-50/50' : 'ring-slate-200 opacity-70 hover:opacity-100'}`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${m.status === 'active' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      <ModuleIcon name={m.icon} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-slate-900">{m.name}</p>
                        {m.status === 'coming-soon' && <Badge>Soon</Badge>}
                      </div>
                      <p className="line-clamp-2 text-xs text-slate-500">{m.description}</p>
                    </div>
                  </Link>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
