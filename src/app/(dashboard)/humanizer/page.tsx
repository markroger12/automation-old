'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, Square, Wand2 } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import { DEFAULT_HUMANIZER_PROMPT } from '@/content/humanizer/prompt';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import {
  CheckedParagraphs,
  MetricsTable,
  Output,
  RepeatNotes,
  ResultParagraphs,
  signalTone,
  type CheckResponse,
  type RunResult,
} from '@/components/humanizer/views';

interface ArticleOption {
  id: string;
  keyword: string;
  status: string;
  website: string | null;
}

interface JobStatus {
  id: string;
  state: 'waiting' | 'active' | 'completed' | 'failed';
  progress: string | null;
  result: RunResult | null;
  error: string | null;
}

const PROMPT_KEY = 'humanizer.prompt';

function readStoredPrompt(): string {
  try {
    return localStorage.getItem(PROMPT_KEY) || DEFAULT_HUMANIZER_PROMPT;
  } catch {
    return DEFAULT_HUMANIZER_PROMPT;
  }
}

function storePrompt(value: string): void {
  try {
    if (value === DEFAULT_HUMANIZER_PROMPT) localStorage.removeItem(PROMPT_KEY);
    else localStorage.setItem(PROMPT_KEY, value);
  } catch {
    // Private windows: the edited prompt is kept only until the page is left.
  }
}

// ——— Page ———

export default function HumanizerPage() {
  const toast = useToast();
  const meta = useApi<{ articles: ArticleOption[]; runningId: string | null }>('/api/humanizer');
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [rewriteAll, setRewriteAll] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_HUMANIZER_PROMPT);
  const [showPrompt, setShowPrompt] = useState(false);
  const [check, setCheck] = useState<CheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => setPrompt(readStoredPrompt()), []);
  // A test still running from before a reload is picked up again.
  useEffect(() => {
    if (meta.data?.runningId && !jobId) setJobId(meta.data.runningId);
  }, [meta.data?.runningId, jobId]);

  const job = useApi<JobStatus>(jobId ? `/api/humanizer/${jobId}` : null, { refreshInterval: 2000 });
  // useApi keeps the last answer while the next test's first one is on its way: only this test's status counts.
  const status = job.data && job.data.id === jobId ? job.data : null;
  const running = Boolean(jobId) && (!status || status.state === 'waiting' || status.state === 'active');

  useEffect(() => {
    if (!job.data || !jobId || job.data.id !== jobId) return;
    if (job.data.state === 'completed' && job.data.result) {
      setResult(job.data.result);
      setJobId(null);
      toast.success('Humanizer finished', `${job.data.result.rewritten} of ${job.data.result.sent} paragraph(s) rewritten`);
    } else if (job.data.state === 'failed') {
      setFailure(job.data.error ?? 'The humanizer test failed');
      setJobId(null);
    }
  }, [job.data, jobId, toast]);

  const promptEdited = prompt !== DEFAULT_HUMANIZER_PROMPT;
  const words = useMemo(() => (input.replace(/<[^>]+>/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length, [input]);

  const loadArticle = async (id: string) => {
    if (!id) return;
    setLoadingArticle(true);
    try {
      const article = await apiFetch<{ keyword: string; html: string }>(`/api/humanizer/articles/${id}`);
      setInput(article.html);
      setKeyword(article.keyword);
      setCheck(null);
      setResult(null);
    } catch (err) {
      toast.error('Could not load the article', (err as Error).message);
    } finally {
      setLoadingArticle(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await apiFetch<CheckResponse>('/api/humanizer/analyse', { body: { input, keyword } }));
    } catch (err) {
      toast.error('Check failed', (err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const start = async () => {
    setStarting(true);
    setFailure(null);
    setResult(null);
    try {
      const res = await apiFetch<{ id: string }>('/api/humanizer', { body: { input, keyword, rewriteAll, prompt: promptEdited ? prompt : undefined } });
      setJobId(res.id);
      void runCheck();
    } catch (err) {
      toast.error('Could not start', (err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (!jobId) return;
    await apiFetch(`/api/humanizer/${jobId}`, { method: 'DELETE' }).catch(() => undefined);
    job.reload();
  };

  return (
    <>
      <PageHeader
        title="AI Humanizer (test)"
        description="Checks an article for AI-style writing, then has ChatGPT rewrite only the flagged paragraphs. Names, numbers, quotes, links and the keyword are locked: a rewrite that changed them is thrown away."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Article" description="Paste text or HTML, or load one of your articles." />
          <CardBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Load an article" hint={loadingArticle ? 'Loading…' : 'Its HTML and focus keyword are filled in.'}>
                <Select defaultValue="" onChange={(e) => void loadArticle(e.target.value)} disabled={loadingArticle}>
                  <option value="">Choose an article…</option>
                  {meta.data?.articles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.keyword}
                      {a.website ? ` — ${a.website}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Keyword" hint="Kept as often as it appears in each paragraph. Optional.">
                <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. Gary Phillip Spector" />
              </Field>
            </div>
            <Field label="Article text or HTML" aside={`${words.toLocaleString()} words`}>
              <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={12} className="font-mono text-xs" placeholder="Paste the article here…" />
            </Field>
            <Toggle
              checked={rewriteAll}
              onChange={setRewriteAll}
              label="Rewrite every paragraph"
              description="Off: only the paragraphs the check flags go to ChatGPT (fewer changes, less risk)."
            />
            <div className="rounded-lg ring-1 ring-slate-200">
              <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-700" onClick={() => setShowPrompt((s) => !s)}>
                <span>
                  Rewrite prompt {promptEdited && <Badge tone="indigo">edited</Badge>}
                </span>
                <span className="text-xs text-slate-400">{showPrompt ? 'Hide' : 'Show'}</span>
              </button>
              {showPrompt && (
                <div className="space-y-2 border-t border-slate-100 p-3">
                  <Textarea
                    value={prompt}
                    rows={16}
                    className="font-mono text-xs"
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      storePrompt(e.target.value);
                    }}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      Keep {'{{problems}}'} and {'{{paragraphs}}'}. A line with {'{{keyword}}'} is left out when there is no keyword. Saved in this browser.
                    </p>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!promptEdited}
                      onClick={() => {
                        setPrompt(DEFAULT_HUMANIZER_PROMPT);
                        storePrompt(DEFAULT_HUMANIZER_PROMPT);
                      }}
                    >
                      Reset to built-in
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon={<Search className="h-4 w-4" />} loading={checking} disabled={!input.trim()} onClick={runCheck}>
                Check only
              </Button>
              <Button icon={<Wand2 className="h-4 w-4" />} loading={starting} disabled={!input.trim() || running} onClick={start}>
                Humanize with ChatGPT
              </Button>
              {running && (
                <Button variant="danger" icon={<Square className="h-4 w-4" />} onClick={stop}>
                  Stop
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        {running && (
          <Alert tone="info" title="Humanizing…">
            <span className="inline-flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              {status?.progress ?? (status?.state === 'active' ? 'Checking the article' : 'Waiting for the worker')}
            </span>
          </Alert>
        )}
        {failure && (
          <Alert tone="error" title="The humanizer test stopped">
            {failure}
          </Alert>
        )}

        {result && (
          <Card>
            <CardHeader
              title="Result"
              description={`${result.rewritten} of ${result.sent} paragraph(s) rewritten, ${result.keptOriginal} kept as they were · ${result.prompts} prompt(s) · ${Math.round(result.durationMs / 1000)} s · ${result.promptVersion}`}
              actions={
                result.conversationUrls.length ? (
                  <span className="flex flex-wrap gap-3">
                    {result.conversationUrls.map((url, i) => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
                        ChatGPT chat{result.conversationUrls.length > 1 ? ` ${i + 1}` : ''} <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ))}
                  </span>
                ) : undefined
              }
            />
            <CardBody>
              {result.failedPrompts.length > 0 && (
                <Alert tone="warning" title="Some parts got no answer from ChatGPT" className="mb-4">
                  {result.failedPrompts.join(' · ')} — those paragraphs stayed as they were.
                </Alert>
              )}
              {result.sent === 0 ? (
                <p className="text-sm text-slate-600">No paragraph was flagged, so nothing went to ChatGPT. Turn on “Rewrite every paragraph” to send them anyway.</p>
              ) : (
                <>
                  <MetricsTable before={result.before} after={result.after} />
                  <RepeatNotes report={result.after} />
                  <ResultParagraphs result={result} />
                  <Output result={result} />
                </>
              )}
            </CardBody>
          </Card>
        )}

        {check && (
          <Card>
            <CardHeader
              title="Check"
              description="Diagnostic only, not an AI detector: it counts the style habits the research links to AI writing."
              actions={<Badge tone={signalTone(check.report.signalsPer1000)}>{check.report.signalsPer1000} signals / 1,000 words</Badge>}
            />
            <CardBody>
              <MetricsTable before={check.report} />
              <RepeatNotes report={check.report} />
              <CheckedParagraphs check={check} />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
