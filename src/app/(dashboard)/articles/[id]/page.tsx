'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Ban, ExternalLink, Play, RefreshCcw, RotateCw, ScanSearch, Send, Trash2 } from 'lucide-react';
import { useApi } from '@/lib/client/api';
import type { ProfileItem, TaskDetailResponse, WebsiteItem } from '@/lib/client/types';
import type { AppSettings } from '@/lib/settings-schema';
import { isInFlight, STATUS_META, type TaskStatusValue } from '@/lib/task-status';
import { StatusBadge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Alert, PageHeader, ProgressBar, Spinner } from '@/components/ui/feedback';
import { Tabs } from '@/components/ui/tabs';
import { ArticleEditor } from '@/components/editor/article-editor';
import { OverviewPanel, PromptsPanel, SeoReportPanel, StageTextPanel, TitlesPanel } from '@/components/article/panels';
import { ConversationPanel, ResponsesPanel, TaskLogsPanel } from '@/components/article/conversation-panels';
import { ReconnectButton } from '@/components/tasks/reconnect-button';
import { RegenerateModal } from '@/components/tasks/regenerate-modal';
import { useTaskAction } from '@/components/tasks/use-task-action';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'editor', label: 'Editor' },
  { key: 'titles', label: 'Titles' },
  { key: 'research', label: 'Research' },
  { key: 'conversation', label: 'ChatGPT Conversation' },
  { key: 'prompts', label: 'Prompts' },
  { key: 'responses', label: 'Responses' },
  { key: 'seo', label: 'SEO Report' },
  { key: 'logs', label: 'Logs' },
];

function ArticleDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState(search.get('tab') ?? 'overview');
  const [regenOpen, setRegenOpen] = useState(false);

  const { data, error, loading, reload } = useApi<TaskDetailResponse>(`/api/tasks/${id}`, { refreshInterval: 3000 });
  const websites = useApi<{ websites: WebsiteItem[] }>('/api/websites');
  const profiles = useApi<{ profiles: ProfileItem[] }>('/api/profiles');
  const settings = useApi<{ settings: AppSettings }>('/api/settings');
  const { run, remove, isPending } = useTaskAction(reload);

  const changeTab = (key: string) => {
    setTab(key);
    router.replace(`/articles/${id}?tab=${key}`, { scroll: false });
  };

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20 text-slate-400">
        <Spinner />
      </div>
    );
  }
  if (error && !data) return <Alert tone="error" title="Could not load the article">{error}</Alert>;
  if (!data) return null;

  const { task } = data;
  const status = task.status as TaskStatusValue;
  const running = isInFlight(status);
  const rankMathTarget = settings.data?.settings.rankMathTargetScore ?? 75;
  const research = task.stages.find((s) => s.key === 'RESEARCH');

  return (
    <>
      <PageHeader
        title={task.keyword}
        description={task.selectedTitle ?? 'Title not selected yet'}
        actions={
          <>
            {['FAILED', 'CANCELLED', 'LOGIN_REQUIRED', 'NEEDS_REVIEW'].includes(status) && (
              <Button variant="outline" icon={<RotateCw className="h-4 w-4" />} loading={isPending(task.id, 'retry')} onClick={() => run(task.id, { action: 'retry' })}>
                {status === 'NEEDS_REVIEW' ? 'Retry' : 'Resume'}
              </Button>
            )}
            {(running || status.startsWith('AWAITING')) && (
              <Button variant="outline" className="text-red-600" icon={<Ban className="h-4 w-4" />} loading={isPending(task.id, 'cancel')} onClick={() => run(task.id, { action: 'cancel' })}>
                Cancel
              </Button>
            )}
            <Button variant="outline" icon={<RefreshCcw className="h-4 w-4" />} disabled={running} onClick={() => setRegenOpen(true)}>
              Regenerate Stage
            </Button>
            <Button variant="outline" icon={<ScanSearch className="h-4 w-4" />} disabled={!task.bodyHtml} loading={isPending(task.id, 'seo-check')} onClick={() => run(task.id, { action: 'seo-check' })}>
              Run SEO Check
            </Button>
            <Button
              variant="success"
              icon={<Send className="h-4 w-4" />}
              disabled={running || !task.contentHtml || !task.websiteId}
              loading={isPending(task.id, 'send-to-wordpress')}
              onClick={() => run(task.id, { action: 'send-to-wordpress' })}
            >
              Send to WordPress
            </Button>
            {task.wpEditUrl && (
              <LinkButton href={task.wpEditUrl} external variant="primary" icon={<ExternalLink className="h-4 w-4" />}>
                Open WordPress Draft
              </LinkButton>
            )}
            <Button
              variant="ghost"
              className="text-red-600 hover:bg-red-50"
              aria-label="Delete task"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={async () => (await remove(task.id, task.keyword)) && router.push('/history')}
            />
          </>
        }
      />

      <div className="mb-6 space-y-4">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <StatusBadge status={status} />
              <span className="text-sm text-slate-600">{task.statusMessage ?? STATUS_META[status]?.label}</span>
            </div>
            <span className="text-sm font-medium text-slate-700 tabular-nums">{task.progress}%</span>
          </div>
          <ProgressBar value={task.progress} className="mt-3" tone={status === 'FAILED' ? 'red' : status === 'LOGIN_REQUIRED' ? 'amber' : status === 'DRAFT_CREATED' ? 'green' : 'indigo'} />
        </div>

        {task.wpEditUrl && (status === 'DRAFT_CREATED' || status === 'NEEDS_REVIEW') && (
          <Alert
            tone="success"
            title="Draft Created Successfully"
            actions={
              <LinkButton href={task.wpEditUrl} external size="xs" variant="success" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                Open WordPress Draft
              </LinkButton>
            }
          >
            Rank Math Score: <strong>{task.rankMathScore ?? 'not detected'}</strong> · SEO Readiness Score: <strong>{task.seoScore ?? '—'}/100</strong> · Status in WordPress: Draft (never published automatically)
          </Alert>
        )}

        {status === 'LOGIN_REQUIRED' && (
          <Alert
            tone="warning"
            title={task.loginRequiredFor === 'chatgpt' ? 'ChatGPT login required' : 'WordPress login required'}
            actions={
              <>
                <ReconnectButton service={task.loginRequiredFor} websiteId={task.websiteId} profiles={profiles.data?.profiles ?? []} size="sm" />
                <Button size="sm" variant="outline" icon={<Play className="h-4 w-4" />} loading={isPending(task.id, 'resume')} onClick={() => run(task.id, { action: 'resume' })}>
                  Resume task
                </Button>
              </>
            }
          >
            {task.statusMessage} After logging in, close the browser window and click Resume (or run Test Session on the Websites page — waiting tasks resume automatically). The task continues from its last completed stage.
          </Alert>
        )}

        {status === 'AWAITING_TITLE_APPROVAL' && tab !== 'titles' && (
          <Alert tone="info" title="Waiting for title approval" actions={<Button size="sm" onClick={() => changeTab('titles')}>Choose title</Button>}>
            Manual Title Approval is enabled. Pick a title to continue.
          </Alert>
        )}

        {status === 'AWAITING_ARTICLE_APPROVAL' && (
          <Alert
            tone="info"
            title="Waiting for article approval"
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => changeTab('editor')}>Review in editor</Button>
                <Button size="sm" variant="success" loading={isPending(task.id, 'approve-article')} onClick={() => run(task.id, { action: 'approve-article' })}>
                  Approve & create draft
                </Button>
              </>
            }
          >
            Manual Article Approval is enabled. Review the article, then approve it to send it to WordPress.
          </Alert>
        )}

        {status === 'NEEDS_REVIEW' && task.reviewReasons.length > 0 && (
          <Alert tone="warning" title="Needs review">
            <ul className="list-disc space-y-0.5 pl-5">
              {task.reviewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Alert>
        )}

        {status === 'FAILED' && task.error && (
          <Alert tone="error" title="Task failed" actions={<Button size="sm" variant="outline" onClick={() => changeTab('logs')}>View logs & screenshots</Button>}>
            {task.error}
          </Alert>
        )}
      </div>

      <Tabs tabs={TABS} value={tab} onChange={changeTab} className="mb-6" />

      {tab === 'overview' && <OverviewPanel task={task} onChanged={reload} rankMathTarget={rankMathTarget} />}
      {tab === 'editor' && (
        <ArticleEditor key={`${task.id}-${task.bodyHtml?.length ?? 0}`} task={task} websites={websites.data?.websites ?? []} onSaved={reload} />
      )}
      {tab === 'titles' && <TitlesPanel task={task} onChanged={reload} />}
      {tab === 'research' && <StageTextPanel stage={research} emptyText="Research appears after the Celebrity Research stage completes." />}
      {tab === 'conversation' && <ConversationPanel taskId={task.id} conversationUrl={task.chatgptConversationUrl} />}
      {tab === 'prompts' && <PromptsPanel task={task} />}
      {tab === 'responses' && <ResponsesPanel taskId={task.id} />}
      {tab === 'seo' && <SeoReportPanel internal={data.internalReport} rankMath={data.rankMathReport} />}
      {tab === 'logs' && <TaskLogsPanel taskId={task.id} />}

      {regenOpen && <RegenerateModal open taskId={task.id} moduleKey={task.moduleKey} onClose={() => setRegenOpen(false)} onDone={reload} />}
    </>
  );
}

export default function ArticleDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20 text-slate-400">
          <Spinner />
        </div>
      }
    >
      <ArticleDetail />
    </Suspense>
  );
}
