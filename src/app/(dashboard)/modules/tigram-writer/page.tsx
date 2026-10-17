'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { CheckCircle2, ListPlus, PenLine, Play } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import { parseBulkKeywords } from '@/lib/bulk-keywords';
import { websiteLanguage } from '@/lib/content-locale';
import type { TaskListResponse, WebsiteItem } from '@/lib/client/types';
import type { AppSettings } from '@/lib/settings-schema';
import { timeAgo } from '@/lib/utils';
import { tigramWriterManifest } from '@/modules/tigram-writer/manifest';
import { StatusBadge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, ProgressBar } from '@/components/ui/feedback';
import { Field, Input, Textarea, Toggle } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { WebsiteCategorySelect } from '@/components/tasks/website-category-select';

const MODULE_KEY = tigramWriterManifest.key;

interface SharedFields {
  websiteId: string;
  categoryId: string;
  secondaryKeywords: string;
  targetCountry: string;
  language: string;
}

export default function TigramWriterPage() {
  const toast = useToast();
  const [mode, setMode] = useState('single');
  const websites = useApi<{ websites: WebsiteItem[] }>('/api/websites');
  const settings = useApi<{ settings: AppSettings }>('/api/settings');
  const recent = useApi<TaskListResponse>(`/api/tasks?moduleKey=${MODULE_KEY}&pageSize=8`, { refreshInterval: 3000 });

  const [keyword, setKeyword] = useState('');
  const [exampleTitle, setExampleTitle] = useState('');
  const [bulk, setBulk] = useState('');
  const [autoCategory, setAutoCategory] = useState(true);
  const [shared, setShared] = useState<SharedFields>({ websiteId: '', categoryId: '', secondaryKeywords: '', targetCountry: '', language: '' });
  const [submitting, setSubmitting] = useState(false);

  const s = settings.data?.settings;
  const website = websites.data?.websites.find((w) => w.id === shared.websiteId);
  // A .de / .at / .ch website writes German articles unless a language is typed in.
  const siteLanguage = websiteLanguage(website?.url);
  const sharedBody = {
    moduleKey: MODULE_KEY,
    websiteId: shared.websiteId || null,
    categoryId: autoCategory ? null : shared.categoryId || null,
    autoCategory,
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
        body: { ...sharedBody, keyword, exampleTitle },
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

  const bulkLines = parseBulkKeywords(bulk);

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

  const sharedFields = (withSecondaryKeywords: boolean) => (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <WebsiteCategorySelect
          websites={websites.data?.websites ?? []}
          websiteId={shared.websiteId}
          categoryId={autoCategory ? '' : shared.categoryId}
          onChange={(v) => setShared((p) => ({ ...p, ...v }))}
        />
      </div>
      <Toggle
        checked={autoCategory}
        onChange={setAutoCategory}
        label="Let ChatGPT pick the category"
        description={
          website && website.categories.length === 0
            ? 'This website has no categories in the app yet — add them on the Websites page.'
            : `ChatGPT chooses one of the categories saved for this website${website ? ` (${website.categories.map((c) => c.name).join(', ') || 'none yet'})` : ''}.`
        }
      />
      {withSecondaryKeywords && (
        <Field label="Secondary Keywords" htmlFor="secondary" hint="Comma separated (optional)">
          <Input
            id="secondary"
            value={shared.secondaryKeywords}
            onChange={(e) => setShared((p) => ({ ...p, secondaryKeywords: e.target.value }))}
            placeholder="alo yoga promo code, alo coupon 2026"
          />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Target Country" htmlFor="country">
          <Input
            id="country"
            value={shared.targetCountry}
            onChange={(e) => setShared((p) => ({ ...p, targetCountry: e.target.value }))}
            placeholder={siteLanguage?.country ?? s?.targetCountry ?? 'United States'}
          />
        </Field>
        <Field label="Article Language" htmlFor="language">
          <Input
            id="language"
            value={shared.language}
            onChange={(e) => setShared((p) => ({ ...p, language: e.target.value }))}
            placeholder={siteLanguage?.language ?? s?.defaultLanguage ?? 'English'}
          />
        </Field>
      </div>
    </>
  );

  return (
    <>
      <PageHeader
        title="Tigram Article Writer"
        description="For any keyword — software, apps, discount codes, product questions, how-to and local searches. One ChatGPT answer writes the whole SEO article, then it is saved as a WordPress draft with Rank Math fields."
        actions={<LinkButton href="/prompts">Edit prompts</LinkButton>}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <PenLine className="h-4 w-4 text-indigo-500" /> New article
              </span>
            }
            description="Add one keyword or several keywords at once."
          />
          <div className="px-5">
            <Tabs
              value={mode}
              onChange={setMode}
              tabs={[
                { key: 'single', label: 'Single article' },
                { key: 'bulk', label: 'Multiple keywords' },
              ]}
            />
          </div>
          <CardBody>
            {mode === 'single' && (
              <form onSubmit={submitSingle} className="space-y-4">
                <Field label="Target Keyword" htmlFor="keyword" required hint="Exactly what people search for.">
                  <Input
                    id="keyword"
                    required
                    minLength={2}
                    maxLength={200}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="alo discount code"
                  />
                </Field>
                <Field label="Example Article Title" htmlFor="example" hint="Optional — guides the SEO title.">
                  <Input
                    id="example"
                    maxLength={300}
                    value={exampleTitle}
                    onChange={(e) => setExampleTitle(e.target.value)}
                    placeholder="Alo Discount Code: Working Ways to Save in 2026"
                  />
                </Field>
                {sharedFields(true)}
                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-xs text-slate-500">
                    Auto-send to WordPress is <strong>{s?.autoSendToWordPress ? 'on' : 'off'}</strong> · External links are{' '}
                    <strong>{s?.externalLinks ? 'on' : 'off'}</strong> ·{' '}
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
                  label="Keywords and their secondary keywords"
                  htmlFor="bulk"
                  required
                  aside={`${bulkLines.length} keyword(s)`}
                  hint="One article per line: the keyword, then | and that keyword's own secondary keywords separated by commas. Two columns copied from Google Sheets work too."
                >
                  <Textarea
                    id="bulk"
                    rows={7}
                    value={bulk}
                    onChange={(e) => setBulk(e.target.value)}
                    placeholder={
                      'Antivirus FreeDoor2.4.6.8 | freedoor antivirus review, freedoor download\nalo discount code | alo yoga promo code\nBest Pasticho Venezuelan Lasagna Near Me'
                    }
                  />
                </Field>
                {bulkLines.length > 0 && (
                  <div className="max-h-64 overflow-auto rounded-lg ring-1 ring-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-medium">Keyword</th>
                          <th className="px-3 py-2 font-medium">Secondary keywords</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bulkLines.map((line) => (
                          <tr key={line.keyword.toLowerCase()}>
                            <td className="px-3 py-2 font-medium text-slate-900">{line.keyword}</td>
                            <td className="px-3 py-2 text-slate-600">
                              {line.secondaryKeywords.length ? line.secondaryKeywords.join(', ') : <span className="text-slate-400">none</span>}
                            </td>
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
                {tigramWriterManifest.stages.map((stage, i) => (
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

          <Alert tone="info" title={`Images are ${s?.articleImages ? 'on' : 'off'}`}>
            {s?.articleImages
              ? 'Each article gets a featured image with a short title and two simple body images (1920×1080, named after the keyword, with alt text).'
              : 'Switch "Add images" on in Settings to add a featured image and two body images to every article.'}{' '}
            <Link href="/settings" className="text-indigo-600 hover:underline">
              Settings
            </Link>
          </Alert>
        </div>
      </div>
    </>
  );
}
