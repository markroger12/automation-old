'use client';

import { useMemo, useRef, useState } from 'react';
import { Plus, RefreshCcw, Save, ScanSearch, Send, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/client/api';
import type { BioRow, FaqItem, TaskDetail, WebsiteItem } from '@/lib/client/types';
import { cn, slugify } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { RegenerateModal } from '@/components/tasks/regenerate-modal';
import { useTaskAction } from '@/components/tasks/use-task-action';
import { WebsiteCategorySelect } from '@/components/tasks/website-category-select';
import { RichTextEditor, type RichTextEditorHandle } from './rich-text-editor';

function CharCount({ value, min, max }: { value: string; min?: number; max: number }) {
  const n = value.length;
  const ok = n <= max && (min === undefined || n >= min);
  return <span className={cn('tabular-nums', ok ? 'text-emerald-600' : 'text-amber-600')}>{n}{min !== undefined ? ` / ${min}–${max}` : ` / ${max}`}</span>;
}

interface HeadingRef {
  index: number;
  level: 'h2' | 'h3';
  text: string;
}

function readHeadings(html: string): HeadingRef[] {
  if (typeof window === 'undefined') return [];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return Array.from(doc.querySelectorAll('h2, h3')).map((h, index) => ({ index, level: h.tagName.toLowerCase() as 'h2' | 'h3', text: h.textContent ?? '' }));
}

function renameHeading(html: string, index: number, text: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const heading = doc.querySelectorAll('h2, h3')[index];
  if (heading) heading.textContent = text;
  return doc.getElementById('root')?.innerHTML ?? html;
}

export function ArticleEditor({ task, websites, onSaved }: { task: TaskDetail; websites: WebsiteItem[]; onSaved: () => void }) {
  const toast = useToast();
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [title, setTitle] = useState(task.selectedTitle ?? '');
  const [seoTitle, setSeoTitle] = useState(task.seoTitle ?? '');
  const [meta, setMeta] = useState(task.metaDescription ?? '');
  const [slug, setSlug] = useState(task.slug ?? '');
  const [focusKeyword, setFocusKeyword] = useState(task.focusKeyword ?? task.keyword);
  const [tags, setTags] = useState((task.tags.length ? task.tags : [task.keyword]).join(', '));
  const [site, setSite] = useState({ websiteId: task.websiteId ?? '', categoryId: task.categoryId ?? '' });
  const [faqs, setFaqs] = useState<FaqItem[]>(task.faqs ?? []);
  const [bio, setBio] = useState<BioRow[]>(task.quickBio ?? []);
  const [htmlVersion, setHtmlVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const { run, isPending } = useTaskAction(onSaved);
  const initialBody = useMemo(() => task.bodyHtml ?? '', [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const headings = useMemo(() => readHeadings(editorRef.current?.getHtml() ?? initialBody), [htmlVersion, initialBody]);

  const save = async (quiet = false): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await apiFetch<{ seoScore: number | null }>(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: {
          selectedTitle: title,
          bodyHtml: editorRef.current?.getHtml() ?? initialBody,
          seoTitle,
          metaDescription: meta,
          slug: slug || null,
          focusKeyword,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          websiteId: site.websiteId || null,
          categoryId: site.categoryId || null,
          faqs: faqs.filter((f) => f.question.trim() && f.answer.trim()),
          quickBio: bio.filter((r) => r.attribute.trim() && r.details.trim()),
        },
      });
      if (!quiet) toast.success('Article saved', res.seoScore !== null ? `SEO Readiness Score: ${res.seoScore}/100` : undefined);
      onSaved();
      return true;
    } catch (err) {
      toast.error('Save failed', (err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const outlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHtmlChange = () => {
    if (outlineTimer.current) clearTimeout(outlineTimer.current);
    outlineTimer.current = setTimeout(() => setHtmlVersion((v) => v + 1), 600);
  };

  if (!task.bodyHtml) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500">The editor becomes available once the Final Article stage has completed.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-16 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 rounded-xl bg-slate-50/90 px-1 py-2 backdrop-blur">
        <Button variant="outline" icon={<RefreshCcw className="h-4 w-4" />} onClick={() => setRegenOpen(true)}>
          Regenerate
        </Button>
        <Button
          variant="outline"
          icon={<ScanSearch className="h-4 w-4" />}
          loading={isPending(task.id, 'seo-check')}
          onClick={async () => (await save(true)) && run(task.id, { action: 'seo-check' })}
        >
          SEO Check
        </Button>
        <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={() => save()}>
          Save
        </Button>
        <Button
          variant="success"
          icon={<Send className="h-4 w-4" />}
          loading={isPending(task.id, 'send-to-wordpress')}
          disabled={!site.websiteId}
          title={!site.websiteId ? 'Select a website first' : undefined}
          onClick={async () => (await save(true)) && run(task.id, { action: 'send-to-wordpress' })}
        >
          {task.wpEditUrl ? 'Update WordPress Draft' : 'Create WordPress Draft'}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Article" description="Title and main content (intro, sections, conclusion). Quick Bio and FAQs are inserted automatically." />
            <CardBody className="space-y-4">
              <Field label="Article Title" htmlFor="title" aside={<CharCount value={title} max={70} />}>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <RichTextEditor ref={editorRef} initialHtml={initialBody} onChange={onHtmlChange} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Quick Bio"
              description="Two-column table inserted after the introduction"
              actions={
                <Button size="xs" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setBio((b) => [...b, { attribute: '', details: '' }])}>
                  Add row
                </Button>
              }
            />
            <CardBody className="space-y-2">
              {bio.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="w-48 shrink-0" value={row.attribute} placeholder="Attribute" onChange={(e) => setBio((b) => b.map((r, j) => (j === i ? { ...r, attribute: e.target.value } : r)))} />
                  <Input value={row.details} placeholder="Details" onChange={(e) => setBio((b) => b.map((r, j) => (j === i ? { ...r, details: e.target.value } : r)))} />
                  <Button size="sm" variant="ghost" aria-label="Remove row" onClick={() => setBio((b) => b.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-slate-400" />
                  </Button>
                </div>
              ))}
              {bio.length === 0 && <p className="text-sm text-slate-500">No Quick Bio rows.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="FAQs"
              description="Inserted before the conclusion as H3 questions"
              actions={
                <Button size="xs" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setFaqs((f) => [...f, { question: '', answer: '' }])}>
                  Add FAQ
                </Button>
              }
            />
            <CardBody className="space-y-4">
              {faqs.map((faq, i) => (
                <div key={i} className="space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <div className="flex gap-2">
                    <Input value={faq.question} placeholder="Question" onChange={(e) => setFaqs((f) => f.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
                    <Button size="sm" variant="ghost" aria-label="Remove FAQ" onClick={() => setFaqs((f) => f.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4 text-slate-400" />
                    </Button>
                  </div>
                  <Textarea rows={2} value={faq.answer} placeholder="Answer" onChange={(e) => setFaqs((f) => f.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
                </div>
              ))}
              {faqs.length === 0 && <p className="text-sm text-slate-500">No FAQs.</p>}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="SEO & Rank Math" />
            <CardBody className="space-y-4">
              <Field label="Focus Keyword" htmlFor="focus">
                <Input id="focus" value={focusKeyword} onChange={(e) => setFocusKeyword(e.target.value)} />
              </Field>
              <Field label="SEO Title" htmlFor="seoTitle" aside={<CharCount value={seoTitle} max={60} />}>
                <Input id="seoTitle" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
              </Field>
              <Field label="Meta Description" htmlFor="meta" aside={<CharCount value={meta} min={140} max={160} />}>
                <Textarea id="meta" rows={4} value={meta} onChange={(e) => setMeta(e.target.value)} />
              </Field>
              <Field
                label="Slug"
                htmlFor="slug"
                aside={
                  <button type="button" className="text-indigo-600 hover:underline" onClick={() => setSlug(slugify(focusKeyword || task.keyword))}>
                    From keyword
                  </button>
                }
              >
                <Input id="slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="WordPress" />
            <CardBody className="space-y-4">
              <WebsiteCategorySelect websites={websites} websiteId={site.websiteId} categoryId={site.categoryId} onChange={setSite} />
              <Field label="Tags" htmlFor="tags" hint="Comma separated. The target keyword is the main tag.">
                <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Headings" description="Rename H2/H3 headings in place" />
            <CardBody className="space-y-2">
              {headings.length === 0 && <p className="text-sm text-slate-500">No headings found.</p>}
              {headings.map((h) => (
                <div key={`${h.index}-${h.text}`} className={cn('flex items-center gap-2', h.level === 'h3' && 'pl-4')}>
                  <span className="w-6 shrink-0 text-xs font-semibold text-slate-400 uppercase">{h.level}</span>
                  <Input
                    defaultValue={h.text}
                    className="h-8"
                    onBlur={(e) => {
                      if (e.target.value === h.text || !editorRef.current) return;
                      editorRef.current.setHtml(renameHeading(editorRef.current.getHtml(), h.index, e.target.value));
                      setHtmlVersion((v) => v + 1);
                    }}
                  />
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>

      {regenOpen && <RegenerateModal open taskId={task.id} moduleKey={task.moduleKey} onClose={() => setRegenOpen(false)} onDone={onSaved} />}
    </div>
  );
}
