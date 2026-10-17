'use client';

import { Bot, ExternalLink, RotateCcw, User } from 'lucide-react';
import { useApi } from '@/lib/client/api';
import type { ConversationItem, LogItem } from '@/lib/client/types';
import { formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { LogList } from '@/components/logs/log-list';

function useConversation(taskId: string) {
  return useApi<{ responses: ConversationItem[] }>(`/api/tasks/${taskId}/conversation`, { refreshInterval: 8000 });
}

export function ConversationPanel({ taskId, conversationUrl }: { taskId: string; conversationUrl: string | null }) {
  const { data, loading } = useConversation(taskId);
  if (loading && !data) return <div className="flex justify-center py-12 text-slate-400"><Spinner /></div>;
  if (!data?.responses.length) return <EmptyState title="No ChatGPT messages yet" />;

  return (
    <Card>
      <CardHeader
        title="ChatGPT conversation"
        description="One controlled conversation per article — every prompt and captured answer"
        actions={
          conversationUrl && (
            <a href={conversationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
              Open in ChatGPT <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )
        }
      />
      <CardBody className="space-y-6">
        {data.responses.map((r) => (
          <div key={r.id} className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Badge tone="indigo">{r.stageKey}</Badge>
              <span>{formatDateTime(r.createdAt)}</span>
              {r.durationMs !== null && <span>· {Math.round(r.durationMs / 1000)}s</span>}
            </div>
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"><User className="h-4 w-4" /></span>
              <div className="scrollbar-thin max-h-72 min-w-0 flex-1 overflow-auto rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3 text-sm whitespace-pre-wrap text-slate-800">{r.prompt}</div>
            </div>
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><Bot className="h-4 w-4" /></span>
              <div className="scrollbar-thin max-h-[32rem] min-w-0 flex-1 overflow-auto rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm whitespace-pre-wrap text-slate-800 ring-1 ring-slate-200">
                {r.responseText}
              </div>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function ResponsesPanel({ taskId }: { taskId: string }) {
  const { data, loading } = useConversation(taskId);
  if (loading && !data) return <div className="flex justify-center py-12 text-slate-400"><Spinner /></div>;
  if (!data?.responses.length) return <EmptyState title="No responses stored yet" />;
  return (
    <div className="space-y-4">
      {data.responses.map((r) => (
        <Card key={r.id}>
          <CardHeader
            title={`${r.stageKey} · attempt ${r.attempt}`}
            description={`${formatDateTime(r.createdAt)} · ${r.responseText.length.toLocaleString()} characters`}
            actions={r.reusedExisting && <Badge tone="amber"><RotateCcw className="h-3 w-3" /> Recovered after retry (not re-sent)</Badge>}
          />
          <CardBody>
            <pre className="scrollbar-thin max-h-96 overflow-auto rounded-lg bg-slate-50 p-4 text-xs leading-5 whitespace-pre-wrap text-slate-800 ring-1 ring-slate-200">{r.responseText}</pre>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function TaskLogsPanel({ taskId }: { taskId: string }) {
  const { data, loading } = useApi<{ logs: LogItem[] }>(`/api/logs?taskId=${taskId}&limit=200`, { refreshInterval: 5000 });
  if (loading && !data) return <div className="flex justify-center py-12 text-slate-400"><Spinner /></div>;
  return (
    <Card>
      <CardHeader title="Task logs" description="Browser actions, prompts, responses, retries, errors and screenshots" />
      <LogList logs={data?.logs ?? []} showTask={false} />
    </Card>
  );
}
