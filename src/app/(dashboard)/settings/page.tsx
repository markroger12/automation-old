'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Save } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import type { AppSettings } from '@/lib/settings-schema';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { ExtensionConnectionCard } from '@/components/sessions/extension-connection';

function NumberField({ label, value, onChange, min, max, hint, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; hint?: ReactNode; suffix?: string }) {
  return (
    <Field label={label} hint={hint} aside={suffix}>
      <Input type="number" min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { data, loading } = useApi<{ settings: AppSettings; defaults: AppSettings }>('/api/settings');
  const [form, setForm] = useState<AppSettings | null>(null);
  const [overrides, setOverrides] = useState('{}');
  const [overridesError, setOverridesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !form) {
      setForm(data.settings);
      setOverrides(JSON.stringify(data.settings.selectorOverrides, null, 2));
    }
  }, [data, form]);

  if (loading || !form) {
    return (
      <div className="flex justify-center py-20 text-slate-400">
        <Spinner />
      </div>
    );
  }

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    let selectorOverrides: AppSettings['selectorOverrides'];
    try {
      selectorOverrides = JSON.parse(overrides || '{}');
      setOverridesError(null);
    } catch {
      setOverridesError('Selector overrides must be valid JSON');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch<{ settings: AppSettings }>('/api/settings', { method: 'PUT', body: { ...form, selectorOverrides } });
      setForm(res.settings);
      toast.success('Settings saved', 'Browser mode and concurrency changes apply to the next browser launch / within 30 seconds.');
    } catch (err) {
      toast.error('Could not save settings', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workflow, content, SEO and browser automation settings."
        actions={
          <Button icon={<Save className="h-4 w-4" />} loading={saving} onClick={save}>
            Save settings
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Browser" description="Playwright with Chrome/Chromium and persistent profiles" />
          <CardBody className="space-y-4">
            <Field
              label="WordPress Browser Mode"
              hint="For the browser that creates WordPress drafts. Headless runs invisibly. Background opens a real window positioned off-screen. Visible shows the browser — useful for watching or debugging. Login windows always open as a normal Chrome window."
            >
              <Select value={form.browserMode} onChange={(e) => set('browserMode', e.target.value as AppSettings['browserMode'])}>
                <option value="headless">Headless (invisible)</option>
                <option value="background">Background window (off-screen)</option>
                <option value="visible">Visible browser</option>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Browser Timeout" suffix="seconds" min={10} max={600} value={form.browserTimeoutSec} onChange={(v) => set('browserTimeoutSec', v)} hint="Page loads and element waits" />
              <NumberField label="ChatGPT Response Timeout" suffix="seconds" min={60} max={3600} value={form.generationTimeoutSec} onChange={(v) => set('generationTimeoutSec', v)} hint="Maximum time for one answer" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ChatGPT URL">
                <Input value={form.chatgptUrl} onChange={(e) => set('chatgptUrl', e.target.value)} />
              </Field>
              <Field label="Chrome for ChatGPT" hint="Opened automatically when articles are waiting">
                <Select value={form.chatgptChromeMode} onChange={(e) => set('chatgptChromeMode', e.target.value as typeof form.chatgptChromeMode)}>
                  <option value="separate">Separate automation Chrome — works behind other windows (recommended)</option>
                  <option value="profile">A profile of my normal Chrome</option>
                </Select>
              </Field>
            </div>
            {form.chatgptChromeMode === 'profile' && (
              <Field
                label="Chrome profile with the extension"
                hint="In a profile of the normal Chrome, the ChatGPT window has to come to the front when it is covered by other windows."
              >
                <Input value={form.chatgptChromeProfile} onChange={(e) => set('chatgptChromeProfile', e.target.value)} placeholder="automation" />
              </Field>
            )}
            <Toggle checked={form.captureScreenshots} onChange={(v) => set('captureScreenshots', v)} label="Capture failure screenshots" description="Saves ChatGPT / WordPress / Rank Math screenshots when a stage fails." />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Workflow" />
          <CardBody className="divide-y divide-slate-100">
            <Toggle checked={form.manualTitleApproval} onChange={(v) => set('manualTitleApproval', v)} label="Manual Title Approval" description="Pause after title generation so you can pick the title." />
            <Field label="Writer for celebrity keywords in Workflows" hint="Celebrity Writer 2.0 verifies the person first and writes the whole article in one ChatGPT answer. Articles you start yourself use the writer whose page you start them on.">
              <Select value={form.workflowCelebrityWriter} onChange={(e) => set('workflowCelebrityWriter', e.target.value as AppSettings['workflowCelebrityWriter'])}>
                <option value="celebrity-writer">Celebrity Article Writer (1.0)</option>
                <option value="celebrity-writer-2">Celebrity Writer 2.0</option>
              </Select>
            </Field>
            <Toggle checked={form.manualArticleApproval} onChange={(v) => set('manualArticleApproval', v)} label="Manual Article Approval" description="Pause before WordPress so you can review and edit the article." />
            <Toggle checked={form.autoSendToWordPress} onChange={(v) => set('autoSendToWordPress', v)} label="Automatically Send to WordPress" description="Create the WordPress draft as soon as the article is ready." />
            <Toggle checked={form.createMissingCategory} onChange={(v) => set('createMissingCategory', v)} label="Create missing categories in WordPress" description="If the selected category does not exist in the editor, add it there (otherwise the task is flagged for review)." />
            <div className="grid gap-4 pt-4 sm:grid-cols-2">
              <NumberField label="Task Concurrency" min={1} max={5} value={form.taskConcurrency} onChange={(v) => set('taskConcurrency', v)} hint="Articles processed at the same time" />
              <NumberField label="Retry Attempts" min={0} max={5} value={form.retryAttempts} onChange={(v) => set('retryAttempts', v)} hint="Per stage, before the task fails" />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Content" />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Maximum Article Word Count" min={300} max={5000} value={form.maxArticleWordCount} onChange={(v) => set('maxArticleWordCount', v)} />
              <NumberField label="Number of FAQs" min={1} max={15} value={form.faqCount} onChange={(v) => set('faqCount', v)} />
              <NumberField label="Minimum Keyword Occurrences" min={1} max={100} value={form.minKeywordOccurrences} onChange={(v) => set('minKeywordOccurrences', v)} />
              <NumberField label="Maximum Keyword Occurrences" min={1} max={150} value={form.maxKeywordOccurrences} onChange={(v) => set('maxKeywordOccurrences', v)} />
              <NumberField label="Quick Bio Rows" min={5} max={25} value={form.quickBioRows} onChange={(v) => set('quickBioRows', v)} hint={`Prompt asks for ${Math.max(3, form.quickBioRows - 1)} to ${form.quickBioRows + 1} rows`} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default Language">
                <Input value={form.defaultLanguage} onChange={(e) => set('defaultLanguage', e.target.value)} />
              </Field>
              <Field label="Target Country">
                <Input value={form.targetCountry} onChange={(e) => set('targetCountry', e.target.value)} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="SEO & Rank Math" />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Rank Math Target Score" min={0} max={100} value={form.rankMathTargetScore} onChange={(v) => set('rankMathTargetScore', v)} />
              <NumberField label="Maximum Rank Math Optimization Attempts" min={0} max={10} value={form.maxRankMathAttempts} onChange={(v) => set('maxRankMathAttempts', v)} />
              <NumberField label="SEO Readiness review threshold" min={0} max={100} value={form.seoReviewThreshold} onChange={(v) => set('seoReviewThreshold', v)} hint="Below this internal score the task is marked Needs Review" />
            </div>
            <Toggle
              checked={form.externalLinks}
              onChange={(v) => set('externalLinks', v)}
              label="Add external links"
              description="ChatGPT suggests links for people, movies, universities and places in the article (Wikipedia in the article language, IMDb, official sites). Every link is checked — trusted site, page exists and is about those words — before it is added."
            />
            {form.externalLinks && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Maximum external links" min={1} max={8} value={form.maxExternalLinks} onChange={(v) => set('maxExternalLinks', v)} hint="Per article; only checked links are added" />
              </div>
            )}
            <Toggle
              checked={form.articleImages}
              onChange={(v) => set('articleImages', v)}
              label="Add article images"
              description="Celebrity articles use colour/background pictures found in ChatGPT and your website's featured and body templates. Tigram articles use ChatGPT-generated pictures. Both add a featured image and two body images to WordPress with alt text. Each writer can also be switched off per website. Missing images are reported for review."
            />
            {form.articleImages && (
              <Toggle
                checked={form.enhanceCelebrityImages}
                onChange={(v) => set('enhanceCelebrityImages', v)}
                label="Enhance low-quality celebrity photos"
                description="A small ChatGPT picture that the template would stretch is first enlarged 4× on this computer with Upscayl (model remacri-4x, in data\tools\upscayl), about a minute per picture on this PC. If it is missing or fails, the original picture is used and the task log says why. Celebrity articles only."
              />
            )}
            {form.articleImages && (
              <Toggle
                checked={form.celebrityPhotoReview}
                onChange={(v) => set('celebrityPhotoReview', v)}
                label="Check celebrity photos with ChatGPT"
                description="The chosen gallery photos (up to 8) are attached to one more ChatGPT prompt, the Photo Check Prompt. Photos with a watermark or another site's name are used last, and every image gets an alt text that says what the photo shows. About a minute more per article. If the check fails, the images are made without it."
              />
            )}
            <Alert tone="info">
              Corrections are bounded: SEO title, meta description and slug fixes, plus at most one content revision per attempt via the SEO Correction Prompt. Revisions that add keyword stuffing, exceed the word limit or drop headings are rejected.
            </Alert>
          </CardBody>
        </Card>

        <ExtensionConnectionCard />

        <Card className="lg:col-span-2">
          <CardHeader title="Advanced: selector overrides" description="Extra selectors tried before the built-in ones — use if WordPress or Rank Math change their UI." />
          <CardBody>
            <Textarea rows={8} spellCheck={false} className="font-mono text-xs" value={overrides} onChange={(e) => setOverrides(e.target.value)} />
            {overridesError ? (
              <p className="mt-1 text-xs text-red-600">{overridesError}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Example: {'{ "wordpress": { "saveDraft": ["button.editor-post-save-draft"] }, "rankmath": { "score": [".rank-math-toolbar-score .score-text"] } }'}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
