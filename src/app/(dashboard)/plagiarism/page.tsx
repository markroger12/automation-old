'use client';

import { useMemo, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import type { PlagiarismReport } from '@/content/plagiarism/check';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, PageHeader } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { MarkedArticle, SourceList, Summary } from '@/components/plagiarism/report';

interface ArticleOption {
  id: string;
  keyword: string;
  website: string | null;
}

export default function PlagiarismPage() {
  const toast = useToast();
  // The same article list the Humanizer page uses.
  const meta = useApi<{ articles: ArticleOption[] }>('/api/humanizer');
  const status = useApi<{ google: boolean }>('/api/plagiarism');
  const [google, setGoogle] = useState(true);
  const [taskId, setTaskId] = useState('');
  const [input, setInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [urls, setUrls] = useState('');
  const [language, setLanguage] = useState<'auto' | 'en' | 'de'>('auto');
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<PlagiarismReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const words = useMemo(() => (input.replace(/<[^>]+>/g, ' ').match(/[\p{L}\p{N}]+/gu) ?? []).length, [input]);
  const urlList = urls
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);

  const loadArticle = async (id: string) => {
    setTaskId(id);
    if (!id) return;
    setLoadingArticle(true);
    try {
      const article = await apiFetch<{ keyword: string; html: string }>(`/api/humanizer/articles/${id}`);
      setInput(article.html);
      setKeyword(article.keyword);
      setReport(null);
    } catch (err) {
      toast.error('Could not load the article', (err as Error).message);
    } finally {
      setLoadingArticle(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setFailure(null);
    try {
      setReport(await apiFetch<PlagiarismReport>('/api/plagiarism', { body: { input, keyword, taskId: taskId || undefined, urls: urlList, language, google } }));
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Plagiarism Check (test)"
        description="Compares an article with Google, your own articles, the pages it links to, Wikipedia and any pages you add, and shows every matching passage side by side. It is evidence to review — a percentage alone never proves plagiarism."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Article" description="Load one of your articles or paste text or HTML." />
          <CardBody className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Load an article" hint={loadingArticle ? 'Loading…' : 'It is then not compared with itself.'}>
                <Select value={taskId} onChange={(e) => void loadArticle(e.target.value)} disabled={loadingArticle}>
                  <option value="">Choose an article…</option>
                  {meta.data?.articles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.keyword}
                      {a.website ? ` — ${a.website}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Keyword" hint="Its Wikipedia page is compared too. Optional.">
                <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. Tommy Gooding" />
              </Field>
              <Field label="Wikipedia language">
                <Select value={language} onChange={(e) => setLanguage(e.target.value as 'auto' | 'en' | 'de')}>
                  <option value="auto">From the article</option>
                  <option value="en">English</option>
                  <option value="de">German</option>
                </Select>
              </Field>
            </div>
            <Field label="Article text or HTML" aside={`${words.toLocaleString()} words`}>
              <Textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setTaskId('');
                }}
                rows={10}
                className="font-mono text-xs"
                placeholder="Paste the article here…"
              />
            </Field>
            <Field label="Also compare these pages" hint="One web address per line (up to 10), e.g. the pages that rank for the keyword.">
              <Textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} className="font-mono text-xs" placeholder="https://…" />
            </Field>
            {status.data?.google ? (
              <Toggle
                checked={google}
                onChange={setGoogle}
                label="Search Google too"
                description="About 10 of the article's most distinctive phrases are searched word for word on Google (serper.dev: one credit each); the pages found are opened and compared."
              />
            ) : (
              <p className="text-xs text-slate-500">Google is not searched: there is no SERPER_API_KEY in the .env file.</p>
            )}
            <Button icon={<ScanSearch className="h-4 w-4" />} loading={checking} disabled={!input.trim()} onClick={check}>
              {checking ? 'Checking… (reading the pages can take up to a minute)' : 'Check for plagiarism'}
            </Button>
          </CardBody>
        </Card>

        {failure && (
          <Alert tone="error" title="The check did not finish">
            {failure}
          </Alert>
        )}

        {report && (
          <Card>
            <CardHeader title="Result" description="Quoted text and phrases your own articles all share are shown but not counted." />
            <CardBody className="space-y-5">
              <Summary report={report} />
              {report.notes.map((note) => (
                <Alert key={note} tone="warning">
                  {note}
                </Alert>
              ))}
              <MarkedArticle report={report} />
              <div>
                <p className="mb-2 text-sm font-medium text-slate-800">Sources</p>
                <SourceList report={report} />
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
