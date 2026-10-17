'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, CircleDashed, ExternalLink, Loader2, RefreshCcw, XCircle } from 'lucide-react';
import type { SeoCheckItem, SeoReportItem, StageItem, TaskDetail } from '@/lib/client/types';
import { cn, formatDateTime } from '@/lib/utils';
import { getModule } from '@/modules/registry';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ScoreRing } from '@/components/ui/feedback';
import { RegenerateModal } from '@/components/tasks/regenerate-modal';
import { useTaskAction } from '@/components/tasks/use-task-action';

function StageIcon({ status }: { status: StageItem['status'] }) {
  if (status === 'COMPLETED') return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
  if (status === 'RUNNING') return <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />;
  if (status === 'FAILED') return <XCircle className="h-5 w-5 text-red-500" />;
  if (status === 'SKIPPED') return <CircleDashed className="h-5 w-5 text-slate-300" />;
  return <Circle className="h-5 w-5 text-slate-300" />;
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function OverviewPanel({ task, onChanged, rankMathTarget }: { task: TaskDetail; onChanged: () => void; rankMathTarget: number }) {
  const [regenStage, setRegenStage] = useState<string | null>(null);
  const manifest = getModule(task.moduleKey);
  const regenerable = new Set(manifest?.stages.filter((s) => s.regenerable).map((s) => s.key));
  const busy = !['DRAFT_CREATED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED', 'LOGIN_REQUIRED', 'AWAITING_TITLE_APPROVAL', 'AWAITING_ARTICLE_APPROVAL'].includes(task.status);

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader title="Article metrics" description="Calculated by the application (not by ChatGPT)" />
          <CardBody>
            <div className="mb-5 grid gap-6 sm:grid-cols-2">
              <ScoreRing score={task.seoScore} label="SEO Readiness Score" target={70} />
              <ScoreRing score={task.rankMathScore} label="Actual Rank Math Score" target={rankMathTarget} />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Metric label="Word Count" value={task.wordCount?.toLocaleString() ?? '—'} />
              <Metric label="Keyword Occurrences" value={task.keywordCount ?? '—'} hint={`"${task.keyword}"`} />
              <Metric label="Keyword Density" value={task.keywordDensity !== null ? `${task.keywordDensity}%` : '—'} />
              <Metric label="H2 Headings" value={task.h2Count ?? '—'} />
              <Metric label="H3 Headings" value={task.h3Count ?? '—'} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Stages" description="Each stage is stored separately — failed or login-blocked tasks resume from here" />
          <ul className="divide-y divide-slate-100">
            {task.stages.map((stage) => (
              <li key={stage.id} className="flex items-start gap-3 px-5 py-3">
                <StageIcon status={stage.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{stage.label}</p>
                    {stage.attempts > 1 && <Badge tone="amber">{stage.attempts} attempts</Badge>}
                  </div>
                  <p className="text-xs text-slate-500">
                    {stage.completedAt ? `Completed ${formatDateTime(stage.completedAt)}` : stage.startedAt ? `Started ${formatDateTime(stage.startedAt)}` : 'Not started'}
                  </p>
                  {stage.error && <p className="mt-1 text-xs break-words text-red-600">{stage.error}</p>}
                </div>
                {regenerable.has(stage.key) && stage.status === 'COMPLETED' && (
                  <Button size="xs" variant="ghost" disabled={busy} icon={<RefreshCcw className="h-3.5 w-3.5" />} onClick={() => setRegenStage(stage.key)}>
                    Regenerate
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader title="Details" />
        <CardBody>
          <dl className="space-y-3 text-sm">
            {[
              ['Target keyword', task.keyword],
              ['Article title', task.selectedTitle ?? '—'],
              ['Example title', task.exampleTitle ?? '—'],
              ['Secondary keywords', task.secondaryKeywords.join(', ') || '—'],
              ['Website', task.website?.name ?? '—'],
              ['Category', task.categoryName ?? '—'],
              ['Tags', task.tags.join(', ') || '—'],
              ['Slug', task.slug ?? '—'],
              ['SEO title', task.seoTitle ?? '—'],
              ['Meta description', task.metaDescription ?? '—'],
              ['Country / Language', `${task.targetCountry ?? '—'} / ${task.language ?? '—'}`],
              ['Created', formatDateTime(task.createdAt)],
              ['Completed', formatDateTime(task.completedAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-slate-500">{label}</dt>
                <dd className="break-words text-slate-800">{value}</dd>
              </div>
            ))}
            {task.chatgptConversationUrl && (
              <a href={task.chatgptConversationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-indigo-600 hover:underline">
                ChatGPT conversation <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </dl>
        </CardBody>
      </Card>

      {regenStage && <RegenerateModal open initialStage={regenStage} taskId={task.id} moduleKey={task.moduleKey} onClose={() => setRegenStage(null)} onDone={onChanged} />}
    </div>
  );
}

export function TitlesPanel({ task, onChanged }: { task: TaskDetail; onChanged: () => void }) {
  const [choice, setChoice] = useState(task.selectedTitle ?? task.recommendedTitle ?? '');
  const [custom, setCustom] = useState('');
  const { run, isPending } = useTaskAction(onChanged);
  const options = task.titleOptions.length ? task.titleOptions : task.recommendedTitle ? [task.recommendedTitle] : [];
  const awaiting = task.status === 'AWAITING_TITLE_APPROVAL';
  const finalTitle = custom.trim() || choice;

  if (!options.length) return <EmptyState title="No titles yet" description="Titles appear after the Generate Titles stage completes." />;

  return (
    <Card>
      <CardHeader
        title={awaiting ? 'Choose the article title' : 'Title options'}
        description={awaiting ? 'The workflow is paused until you approve a title (Manual Title Approval is on).' : 'Change the selected title at any time.'}
      />
      <CardBody className="space-y-2">
        {options.map((t) => (
          <label key={t} className="flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ring-slate-200 hover:bg-slate-50 has-[:checked]:bg-indigo-50 has-[:checked]:ring-indigo-300">
            <input type="radio" name="title" className="mt-1 accent-indigo-600" checked={!custom && choice === t} onChange={() => { setChoice(t); setCustom(''); }} />
            <span className="text-sm text-slate-800">
              {t}
              {t === task.recommendedTitle && <Badge tone="green" className="ml-2">Recommended</Badge>}
              {t === task.selectedTitle && <Badge tone="indigo" className="ml-2">Selected</Badge>}
              <span className="ml-2 text-xs text-slate-400">{t.length} chars</span>
            </span>
          </label>
        ))}
        <div className="pt-2">
          <input
            className="block h-10 w-full rounded-lg border-0 px-3 text-sm ring-1 ring-slate-300 ring-inset focus:ring-2 focus:ring-indigo-500"
            placeholder="…or write your own title"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </div>
        <div className="flex justify-end pt-3">
          <Button loading={isPending(task.id, 'approve-title')} disabled={finalTitle.length < 3} onClick={() => run(task.id, { action: 'approve-title', title: finalTitle })}>
            {awaiting ? 'Approve title & continue' : 'Use this title'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function StageTextPanel({ stage, emptyText }: { stage: StageItem | undefined; emptyText: string }) {
  if (!stage?.output) return <EmptyState title="Not available yet" description={emptyText} />;
  return (
    <Card>
      <CardHeader title={stage.label} description={stage.completedAt ? `Saved ${formatDateTime(stage.completedAt)}` : undefined} />
      <CardBody>
        <div className="max-w-none text-sm leading-6 whitespace-pre-wrap text-slate-800">{stage.output}</div>
      </CardBody>
    </Card>
  );
}

export function PromptsPanel({ task }: { task: TaskDetail }) {
  const withPrompts = task.stages.filter((s) => s.prompt);
  if (!withPrompts.length) return <EmptyState title="No prompts sent yet" />;
  return (
    <div className="space-y-4">
      {withPrompts.map((s) => (
        <Card key={s.id}>
          <CardHeader title={s.label} description="Rendered prompt exactly as sent to ChatGPT" />
          <CardBody>
            <pre className="scrollbar-thin max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-5 whitespace-pre-wrap text-slate-100">{s.prompt}</pre>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

const checkTone = { pass: 'green', warn: 'amber', fail: 'red' } as const;

export function SeoReportPanel({ internal, rankMath }: { internal: SeoReportItem | null; rankMath: SeoReportItem | null }) {
  if (!internal && !rankMath) return <EmptyState title="No SEO report yet" description="Run an SEO check after the article is assembled." />;
  const checks = (internal?.checks ?? []) as SeoCheckItem[];
  const groups = Array.from(new Set(checks.map((c) => c.group)));
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {internal && (
          <Card>
            <CardHeader
              title={`SEO Readiness Score: ${internal.score}/100`}
              description={`Internal checker · ${formatDateTime(internal.createdAt)} · this is not the Rank Math score`}
            />
            {groups.map((group) => (
              <div key={group}>
                <p className="bg-slate-50 px-5 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{group}</p>
                <ul className="divide-y divide-slate-100">
                  {checks
                    .filter((c) => c.group === group)
                    .map((c) => (
                      <li key={c.id} className="flex items-start gap-3 px-5 py-2.5">
                        <Badge tone={checkTone[c.status]} className="mt-0.5 w-12 justify-center uppercase">
                          {c.status}
                        </Badge>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{c.label}</p>
                          <p className="text-xs break-words text-slate-500">{c.message}</p>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </Card>
        )}
      </div>
      <Card className="h-fit">
        <CardHeader title="Rank Math (inside WordPress)" description={rankMath ? formatDateTime(rankMath.createdAt) : 'Read from the Rank Math panel after the draft is created'} />
        <CardBody>
          {rankMath ? (
            <>
              <p className={cn('text-3xl font-semibold', (rankMath.score ?? 0) >= 75 ? 'text-emerald-600' : 'text-amber-600')}>
                {rankMath.score ?? '—'}
                <span className="text-base text-slate-400">/100</span>
              </p>
              <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">Remaining recommendations</p>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                {(rankMath.checks as { message: string }[]).map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    {c.message}
                  </li>
                ))}
                {(rankMath.checks as unknown[]).length === 0 && <li className="text-slate-500">None reported.</li>}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-500">No Rank Math score captured yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
