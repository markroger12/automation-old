'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, RotateCcw, Save } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import { renderPrompt } from '@/lib/prompts/render';
import { cn, formatDateTime } from '@/lib/utils';
import type { PromptVariableDoc } from '@/modules/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PageHeader, Spinner } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';

interface PromptItem {
  id: string;
  key: string;
  name: string;
  description: string;
  content: string;
  isDefault: boolean;
  updatedAt: string;
}

interface PromptsResponse {
  modules: { key: string; name: string; variables: PromptVariableDoc[]; prompts: PromptItem[] }[];
}

export default function PromptManagerPage() {
  const toast = useToast();
  const { data, loading, reload } = useApi<PromptsResponse>('/api/prompts');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const all = useMemo(() => data?.modules.flatMap((m) => m.prompts.map((p) => ({ ...p, module: m }))) ?? [], [data]);
  const selected = all.find((p) => p.id === selectedId) ?? all[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  useEffect(() => {
    if (selected) setDraft(selected.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt]);

  const dirty = selected ? draft !== selected.content : false;

  const select = (id: string) => {
    if (dirty && !window.confirm('Discard unsaved changes to this prompt?')) return;
    setSelectedId(id);
    setPreview(false);
  };

  const insertVariable = (name: string) => {
    const el = textareaRef.current;
    const token = `{{${name}}}`;
    if (!el) return setDraft((d) => d + token);
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = draft.slice(0, start) + token + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiFetch(`/api/prompts/${selected.id}`, { method: 'PATCH', body: { content: draft } });
      toast.success('Prompt saved', 'New tasks and regenerations will use this version.');
      await reload();
    } catch (err) {
      toast.error('Save failed', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!selected || !window.confirm(`Reset "${selected.name}" to the built-in default?`)) return;
    try {
      await apiFetch(`/api/prompts/${selected.id}`, { method: 'POST', body: { action: 'reset' } });
      toast.success('Prompt reset to default');
      await reload();
    } catch (err) {
      toast.error('Reset failed', (err as Error).message);
    }
  };

  const sampleVars = Object.fromEntries((selected?.module.variables ?? []).map((v) => [v.name, v.sample]));

  return (
    <>
      <PageHeader title="Prompt Manager" description="Edit every ChatGPT prompt without touching source code. Variables are filled in when the prompt is sent." />
      {loading && !data ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-4">
          <Card className="h-fit lg:col-span-1">
            {data?.modules.map((m) => (
              <div key={m.key}>
                <p className="border-b border-slate-100 px-4 py-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">{m.name}</p>
                <ul className="p-2">
                  {m.prompts.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => select(p.id)}
                        className={cn('w-full rounded-lg px-3 py-2 text-left text-sm', selected?.id === p.id ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-700 hover:bg-slate-50')}
                      >
                        <span className="flex items-center justify-between gap-2">
                          {p.name}
                          {!p.isDefault && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Customized" />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>

          {selected && (
            <div className="space-y-6 lg:col-span-3">
              <Card>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {selected.name}
                      {selected.isDefault ? <Badge>Default</Badge> : <Badge tone="amber">Customized</Badge>}
                      {dirty && <Badge tone="indigo">Unsaved</Badge>}
                    </span>
                  }
                  description={`${selected.description} · updated ${formatDateTime(selected.updatedAt)}`}
                  actions={
                    <>
                      <Button size="sm" variant="outline" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview((p) => !p)}>
                        {preview ? 'Edit' : 'Preview'}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" />} onClick={reset} disabled={selected.isDefault}>
                        Reset to default
                      </Button>
                      <Button size="sm" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!dirty} onClick={save}>
                        Save
                      </Button>
                    </>
                  }
                />
                <CardBody>
                  {preview ? (
                    <pre className="scrollbar-thin max-h-[560px] overflow-auto rounded-lg bg-slate-50 p-4 text-sm leading-6 whitespace-pre-wrap text-slate-800 ring-1 ring-slate-200">
                      {renderPrompt(draft, sampleVars)}
                    </pre>
                  ) : (
                    <Textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={24} spellCheck={false} className="font-mono text-[13px] leading-6" />
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    Syntax: <code>{'{{variable}}'}</code> inserts a value. <code>{'{{#if variable}}…{{/if}}'}</code> keeps a block only when the variable has a value.
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Variables" description="Click a variable to insert it at the cursor" />
                <CardBody className="grid gap-2 sm:grid-cols-2">
                  {selected.module.variables.map((v) => (
                    <button key={v.name} type="button" onClick={() => insertVariable(v.name)} disabled={preview} className="flex items-start gap-2 rounded-lg p-2 text-left ring-1 ring-slate-200 hover:bg-indigo-50/50 disabled:opacity-50">
                      <code className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs whitespace-nowrap text-indigo-700">{`{{${v.name}}}`}</code>
                      <span className="text-xs text-slate-600">{v.description}</span>
                    </button>
                  ))}
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
