'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, FileUp, ListPlus, Play, Star } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import { parseBulkKeywords } from '@/lib/bulk-keywords';
import { websiteLanguage } from '@/lib/content-locale';
import type { TaskListResponse, WebsiteItem } from '@/lib/client/types';
import type { AppSettings } from '@/lib/settings-schema';
import { timeAgo } from '@/lib/utils';
import type { ModuleManifest } from '@/modules/types';
import { StatusBadge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, ProgressBar } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { WebsiteCategorySelect } from '@/components/tasks/website-category-select';

interface SharedFields {
  websiteId: string;
  categoryId: string;
  secondaryKeywords: string;
  targetCountry: string;
  language: string;
}

/** The page of a celebrity writer module (1.0 and 2.0 share it; only the manifest and the texts differ). */
export function CelebrityWriterView({
  manifest,
  title,
  description,
  keywordOnly = false,
}: {
  manifest: ModuleManifest;
  title: string;
  description: string;
  /** The writer's prompt takes the keyword only (Celebrity Writer 2.0): no example title, no secondary keywords. */
  keywordOnly?: boolean;
}) {
  const MODULE_KEY = manifest.key;
  const toast = useToast();
  const [mode, setMode] = useState('single');
  const websites = useApi<{ websites: WebsiteItem[] }>('/api/websites');
  const settings = useApi<{ settings: AppSettings }>('/api/settings');
  const recent = useApi<TaskListResponse>(`/api/tasks?moduleKey=${MODULE_KEY}&pageSize=8`, { refreshInterval: 3000 });

  const [keyword, setKeyword] = useState('');
  const [exampleTitle, setExampleTitle] = useState('');
  const [bulk, setBulk] = useState('');
  const [shared, setShared] = useState<SharedFields>({ websiteId: '', categoryId: '', secondaryKeywords: '', targetCountry: '', language: '' });
  const [submitting, setSubmitting] = useState(false);
  const [csvResult, setCsvResult] = useState<{ created: number; errors: { row: number; message: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const s = settings.data?.settings;
  // A .de / .at / .ch website writes German articles unless a language is typed in.
  const siteLanguage = websiteLanguage(websites.data?.websites.find((w) => w.id === shared.websiteId)?.url);
  const sharedBody = {
    moduleKey: MODULE_KEY,
    websiteId: shared.websiteId || null,
    categoryId: shared.categoryId || null,
    secondaryKeywords: shared.secondaryKeywords,
    targetCountry: shared.targetCountry || null,
    language: shared.language || null,
  };

  const afterCreate = (res: { created: number; warning?: string | null }) => {
    toast.success(`${res.created} article task${res.created === 1 ? '' : 's'} added to the queue`);
    if (res.warning) toast.warning('Queue notice', res.warning);
    void recent.reload();
  };

  const submitSingle = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch<{ created: number; warning?: string | null }>('/api/tasks', {
        method: 'POST',
        body: { ...sharedBody, keyword, exampleTitle: keywordOnly ? '' : exampleTitle },
      });
      afterCreate(res);
      setKeyword('');
      setExampleTitle('');
    } catch (err) {
      toast.error('Could not start the article', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const bulkLines = parseBulkKeywords(bulk).map((line) => (keywordOnly ? { ...line, secondaryKeywords: [] } : line));

  const submitBulk = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch<{ created: number; warning?: string | null }>('/api/tasks', {
        method: 'POST',
        body: { ...sharedBody, secondaryKeywords: '', items: bulkLines },
      });
      afterCreate(res);
      setBulk('');
    } catch (err) {
      toast.error('Could not queue keywords', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submitCsv = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.warning('Choose a CSV file first');
    const form = new FormData();
    form.append('file', file);
    form.append('moduleKey', MODULE_KEY);
    setSubmitting(true);
    setCsvResult(null);
    try {
      const res = await apiFetch<{ created: number; errors: { row: number; message: string }[]; warning?: string | null }>('/api/tasks/import', { formData: form });
      setCsvResult(res);
      if (res.created) afterCreate(res);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      toast.error('CSV import failed', (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const sharedFields = (withSecondaryKeywords: boolean) => (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <WebsiteCategorySelect
          websites={websites.data?.websites ?? []}
          websiteId={shared.websiteId}
          categoryId={shared.categoryId}
          onChange={(v) => setShared((p) => ({ ...p, ...v }))}
        />
      </div>
      {withSecondaryKeywords && (
        <Field label="Secondary Keywords" htmlFor="secondary" hint="Comma separated (optional)">
          <Input
            id="secondary"
            value={shared.secondaryKeywords}
            onChange={(e) => setShared((p) => ({ ...p, secondaryKeywords: e.target.value }))}
            placeholder="Sydney Sweeney movies, Sydney Sweeney height"
          />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Target Country" htmlFor="country">
          <Input id="country" value={shared.targetCountry} onChange={(e) => setShared((p) => ({ ...p, targetCountry: e.target.value }))} placeholder={siteLanguage?.country ?? s?.targetCountry ?? 'United States'} />
        </Field>
        <Field label="Article Language" htmlFor="language">
          <Input id="language" value={shared.language} onChange={(e) => setShared((p) => ({ ...p, language: e.target.value }))} placeholder={siteLanguage?.language ?? s?.defaultLanguage ?? 'English'} />
        </Field>
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={<LinkButton href="/prompts">Edit prompts</LinkButton>}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Star className="h-4 w-4 text-indigo-500" /> New article
              </span>
            }
            description="Add one keyword, several keywords, or import a CSV."
          />
          <div className="px-5">
            <Tabs
              value={mode}
              onChange={setMode}
              tabs={[
                { key: 'single', label: 'Single article' },
                { key: 'bulk', label: 'Multiple keywords' },
                { key: 'csv', label: 'CSV import' },
              ]}
            />
          </div>
          <CardBody>
            {mode === 'single' && (
              <form onSubmit={submitSingle} className="space-y-4">
                <Field label="Target Keyword" htmlFor="keyword" required hint="The main keyword — usually the celebrity's name.">
                  <Input id="keyword" required minLength={2} maxLength={200} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Sydney Sweeney" />
                </Field>
                {!keywordOnly && (
                  <Field label="Example Article Title" htmlFor="example" hint="Optional — guides the title ideas.">
                    <Input
                      id="example"
                      maxLength={300}
                      value={exampleTitle}
                      onChange={(e) => setExampleTitle(e.target.value)}
                      placeholder="Sydney Sweeney Age, Biography, Family, Career, Net Worth and Latest Updates"
                    />
                  </Field>
                )}
                {sharedFields(!keywordOnly)}
                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-xs text-slate-500">
                    Manual title approval is <strong>{s?.manualTitleApproval ? 'on' : 'off'}</strong> · Auto-send to WordPress is{' '}
                    <strong>{s?.autoSendToWordPress ? 'on' : 'off'}</strong> ·{' '}
                    <Link href="/settings" className="text-indigo-600 hover:underline">
                      change
                    </Link>
                  </p>
                  <Button type="submit" size="md" loading={submitting} disabled={keyword.trim().length < 2} icon={<Play className="h-4 w-4" />}>
                    Start Article
                  </Button>
                </div>
              </form>
            )}

            {mode === 'bulk' && (
              <form onSubmit={submitBulk} className="space-y-4">
                <Field
                  label={keywordOnly ? 'Keywords' : 'Keywords and their secondary keywords'}
                  htmlFor="bulk"
                  required
                  aside={`${bulkLines.length} keyword(s)`}
                  hint={
                    keywordOnly
                      ? 'One keyword per line — one article each.'
                      : "One article per line: the keyword, then | and that keyword's own secondary keywords separated by commas. Two columns copied from Google Sheets work too."
                  }
                >
                  <Textarea
                    id="bulk"
                    rows={7}
                    value={bulk}
                    onChange={(e) => setBulk(e.target.value)}
                    placeholder={
                      keywordOnly
                        ? 'Sydney Sweeney\nJenna Ortega\nEmma Myers'
                        : 'Sydney Sweeney | Sydney Sweeney movies, Sydney Sweeney height\nJenna Ortega | Jenna Ortega age, Jenna Ortega boyfriend\nEmma Myers'
                    }
                  />
                </Field>
                {bulkLines.length > 0 && (
                  <div className="max-h-64 overflow-auto rounded-lg ring-1 ring-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Keyword</th>
                          {!keywordOnly && <th className="px-3 py-2 font-medium">Secondary keywords</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bulkLines.map((line) => (
                          <tr key={line.keyword.toLowerCase()}>
                            <td className="px-3 py-2 font-medium text-slate-900">{line.keyword}</td>
                            {!keywordOnly && (
                              <td className="px-3 py-2 text-slate-600">
                                {line.secondaryKeywords.length ? line.secondaryKeywords.join(', ') : <span className="text-slate-400">none</span>}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {sharedFields(false)}
                <div className="flex justify-end pt-2">
                  <Button type="submit" size="md" loading={submitting} disabled={bulkLines.length === 0} icon={<ListPlus className="h-4 w-4" />}>
                    Add {bulkLines.length || ''} to Queue
                  </Button>
                </div>
              </form>
            )}

            {mode === 'csv' && (
              <form onSubmit={submitCsv} className="space-y-4">
                <Alert tone="info" title="CSV format">
                  Header row with columns <code className="rounded bg-white/60 px-1">keyword</code>,{' '}
                  <code className="rounded bg-white/60 px-1">example_title</code>, <code className="rounded bg-white/60 px-1">website</code> (name or domain),{' '}
                  <code className="rounded bg-white/60 px-1">category</code>, <code className="rounded bg-white/60 px-1">secondary_keywords</code>. Only{' '}
                  <code>keyword</code> is required. Unknown categories are added to the website&apos;s local category list.
                </Alert>
                <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                  {`keyword,example_title,website,category,secondary_keywords
Sydney Sweeney,"Sydney Sweeney Age, Biography, Net Worth",My Celeb Blog,Actresses,"Sydney Sweeney movies, Sydney Sweeney height"
Jenna Ortega,,My Celeb Blog,Actresses,`}
                </pre>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
                />
                {csvResult && (
                  <Alert tone={csvResult.errors.length ? 'warning' : 'success'} title={`${csvResult.created} task(s) created`}>
                    {csvResult.errors.length > 0 && (
                      <ul className="mt-1 list-disc pl-5">
                        {csvResult.errors.slice(0, 20).map((e) => (
                          <li key={e.row}>
                            Row {e.row}: {e.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Alert>
                )}
                <div className="flex justify-end">
                  <Button type="submit" size="md" loading={submitting} icon={<FileUp className="h-4 w-4" />}>
                    Import CSV
                  </Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Recent articles" actions={<LinkButton href="/queue" size="xs">Queue</LinkButton>} />
            {recent.data?.tasks.length ? (
              <ul className="divide-y divide-slate-100">
                {recent.data.tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/articles/${t.id}`} className="block px-5 py-3 hover:bg-slate-50">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-900">{t.keyword}</p>
                        <StatusBadge status={t.status} />
                      </div>
                      <ProgressBar value={t.progress} className="mt-2" tone={t.status === 'FAILED' ? 'red' : t.status === 'DRAFT_CREATED' ? 'green' : 'indigo'} />
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {t.statusMessage ?? t.selectedTitle ?? '—'} · {timeAgo(t.updatedAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No articles yet" description="Your queued articles appear here with live progress." />
            )}
          </Card>

          <Card>
            <CardHeader title="Workflow" description="Runs in one ChatGPT conversation per article" />
            <CardBody>
              <ol className="space-y-2.5">
                {manifest.stages.map((stage, i) => (
                  <li key={stage.key} className="flex items-center gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">{i + 1}</span>
                    <span className="text-slate-700">{stage.label}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      {stage.kind === 'chatgpt' ? 'ChatGPT' : stage.kind === 'wordpress' ? 'WordPress' : stage.kind === 'gate' ? 'Optional pause' : 'App'}
                    </span>
                  </li>
                ))}
                <li className="flex items-center gap-3 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="h-6 w-6" /> Saved as Draft — never published
                </li>
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
