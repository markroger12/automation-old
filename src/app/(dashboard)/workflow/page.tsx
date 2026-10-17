'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ListPlus, Plus, RefreshCw, Trash2, Upload, Wand2 } from 'lucide-react';
import { apiFetch, useApi } from '@/lib/client/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import type { StatusTone } from '@/lib/task-status';
import { parseKeywordLines } from '@/lib/workflow/keyword-lines';

interface WorkflowSettings {
  id: string;
  isActive: boolean;
  publishTimes: string[];
  days: number[];
  writeAheadHours: number;
  images: boolean | null;
  indexAfterPublish: boolean;
}

interface WorkflowWebsite {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  canPublish: boolean;
  siteTimezone: string | null;
  searchConsoleProperty: string | null;
  tigramImages: boolean;
  workflow: WorkflowSettings | null;
  counts: Record<string, number>;
}

interface KeywordRow {
  id: string;
  keyword: string;
  title: string | null;
  kind: 'UNKNOWN' | 'CELEBRITY' | 'TIGRAM';
  kindSource: string | null;
  kindNote: string | null;
  state: string;
  attempts: number;
  lastError: string | null;
  publishedUrl: string | null;
  publishedAt: string | null;
  indexedAt: string | null;
  indexingEvidence: { screenshotPath: string | null; outcome: string | null; message: string; capturedAt: string } | null;
  publishAt: string | null;
  plannedFor: string | null;
  task: { id: string; status: string; moduleKey: string; wpEditUrl: string | null } | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

/** "16:30" → { hour: 4, minute: 30, half: 'PM' } for the pickers. */
function toClock(value: string): { hour: number; minute: number; half: 'AM' | 'PM' } {
  const [rawHour, rawMinute] = value.split(':');
  const hour24 = Math.min(23, Math.max(0, Number(rawHour) || 0));
  return { hour: hour24 % 12 === 0 ? 12 : hour24 % 12, minute: Math.min(59, Number(rawMinute) || 0), half: hour24 < 12 ? 'AM' : 'PM' };
}

/** Back to the way a time is stored. */
function toStored(clock: { hour: number; minute: number; half: 'AM' | 'PM' }): string {
  const hour = (clock.hour % 12) + (clock.half === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
}

/** The publish times, each one picked as hours, minutes and AM or PM. */
function PublishTimes({ times, onChange }: { times: string[]; onChange: (times: string[]) => void }) {
  const set = (index: number, next: Partial<{ hour: number; minute: number; half: 'AM' | 'PM' }>) => {
    const clock = { ...toClock(times[index]), ...next };
    onChange(times.map((value, position) => (position === index ? toStored(clock) : value)));
  };
  return (
    <div className="space-y-2">
      {times.map((value, index) => {
        const clock = toClock(value);
        return (
          <div key={`${value}-${index}`} className="flex items-center gap-1.5">
            <Select aria-label="Hour" value={clock.hour} onChange={(event) => set(index, { hour: Number(event.target.value) })} className="w-20">
              {HOURS.map((hour) => (
                <option key={hour} value={hour}>
                  {hour}
                </option>
              ))}
            </Select>
            <span className="text-slate-500">:</span>
            <Select
              aria-label="Minutes"
              value={String(clock.minute).padStart(2, '0')}
              onChange={(event) => set(index, { minute: Number(event.target.value) })}
              className="w-20"
            >
              {(MINUTES.includes(String(clock.minute).padStart(2, '0')) ? MINUTES : [...MINUTES, String(clock.minute).padStart(2, '0')].sort()).map((minute) => (
                <option key={minute} value={minute}>
                  {minute}
                </option>
              ))}
            </Select>
            <Select aria-label="AM or PM" value={clock.half} onChange={(event) => set(index, { half: event.target.value as 'AM' | 'PM' })} className="w-20">
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </Select>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange(times.filter((_, position) => position !== index))}
              title="Remove this time"
              disabled={times.length <= 1}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" onClick={() => onChange([...times, '12:00'])} icon={<Plus className="h-4 w-4" />}>
        Add a time
      </Button>
    </div>
  );
}

const STATE_TONES: Record<string, StatusTone> = {
  WAITING: 'gray',
  WRITING: 'blue',
  READY: 'indigo',
  SCHEDULED: 'violet',
  PUBLISHED: 'green',
  INDEXED: 'green',
  FAILED: 'red',
  SKIPPED: 'amber',
  DONE: 'green',
};

const KIND_LABELS: Record<string, string> = { CELEBRITY: 'Celebrity', TIGRAM: 'Tigram', UNKNOWN: 'Not decided' };

function Settings({ website, onSaved }: { website: WorkflowWebsite; onSaved: () => void }) {
  const toast = useToast();
  const workflow = website.workflow!;
  const [times, setTimes] = useState<string[]>(workflow.publishTimes);
  const [days, setDays] = useState<number[]>(workflow.days ?? []);
  const [ahead, setAhead] = useState(workflow.writeAheadHours);
  const [images, setImages] = useState<'site' | 'on' | 'off'>(workflow.images === null ? 'site' : workflow.images ? 'on' : 'off');
  const [indexing, setIndexing] = useState(workflow.indexAfterPublish);
  const [timezone, setTimezone] = useState(website.siteTimezone ?? '');
  const [property, setProperty] = useState(website.searchConsoleProperty ?? '');
  const [canPublish, setCanPublish] = useState(website.canPublish);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTimes(workflow.publishTimes);
    setDays(workflow.days ?? []);
    setAhead(workflow.writeAheadHours);
    setImages(workflow.images === null ? 'site' : workflow.images ? 'on' : 'off');
    setIndexing(workflow.indexAfterPublish);
    setTimezone(website.siteTimezone ?? '');
    setProperty(website.searchConsoleProperty ?? '');
    setCanPublish(website.canPublish);
  }, [workflow, website]);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        body: {
          publishTimes: times,
          days,
          writeAheadHours: Number(ahead),
          images: images === 'site' ? null : images === 'on',
          indexAfterPublish: indexing,
        },
      });
      await apiFetch(`/api/websites/${website.id}`, {
        method: 'PATCH',
        body: { canPublish, siteTimezone: timezone.trim(), searchConsoleProperty: property.trim() },
      });
      toast.success('Workflow saved');
      onSaved();
    } catch (err) {
      toast.error('Could not save the workflow', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleWorkflow = async (value: boolean) => {
    try {
      await apiFetch(`/api/workflows/${workflow.id}`, { method: 'PATCH', body: { isActive: value } });
      toast.success(value ? 'Workflow switched on' : 'Workflow switched off');
      onSaved();
    } catch (err) {
      toast.error('Could not switch the workflow', (err as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <Toggle
        checked={workflow.isActive}
        onChange={(value) => void toggleWorkflow(value)}
        label="Workflow is running"
        description="On: the app writes the keywords of this website by itself and schedules them for the times below."
      />

      <Field label="Publish times" hint={`Pakistan time. One article per time — ${times.length} article(s) a day.`}>
        <PublishTimes times={times} onChange={setTimes} />
      </Field>

      <Field label="Days" hint="Nothing ticked means every day.">
        <div className="flex flex-wrap gap-1">
          {DAYS.map((label, day) => (
            <button
              key={label}
              type="button"
              onClick={() => setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))}
              className={`rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset ${
                days.includes(day) ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Start writing"
          htmlFor="w-start"
          hint={
            ahead === 0
              ? 'Every keyword you add is written straight away and waits as a draft for its time. At most ten are written ahead at once; the rest follow.'
              : 'An article needs time: ChatGPT, the images and WordPress. Leave enough room before it goes live.'
          }
        >
          <div className="flex gap-2">
            <Select
              id="w-start"
              value={ahead === 0 ? 'now' : 'before'}
              onChange={(event) => setAhead(event.target.value === 'now' ? 0 : 12)}
              className="min-w-52"
            >
              <option value="now">As soon as I add the keywords</option>
              <option value="before">A set time before it goes live</option>
            </Select>
            {ahead !== 0 && (
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={72} value={ahead} onChange={(event) => setAhead(Number(event.target.value))} className="w-24" />
                <span className="text-sm text-slate-600">hours before</span>
              </div>
            )}
          </div>
        </Field>
        <Field label="Images" htmlFor="w-images" hint="The Image Template page holds the look of the images.">
          <Select id="w-images" value={images} onChange={(event) => setImages(event.target.value as 'site' | 'on' | 'off')}>
            <option value="site">
              Follow the website (Tigram {website.tigramImages ? 'on' : 'off'})
            </option>
            <option value="on">Always create images</option>
            <option value="off">Never create images</option>
          </Select>
        </Field>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <Toggle
          checked={canPublish}
          onChange={setCanPublish}
          label="This website may publish by itself"
          description="Off: the app only ever saves drafts for this website, as it always has. On: a finished article is scheduled in WordPress for its time."
        />
        <Field label="WordPress time zone" htmlFor="w-tz" hint="The time zone under Settings → General in WordPress, e.g. Europe/Berlin. The publish time above is converted into it.">
          <Input id="w-tz" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Karachi" />
        </Field>
        <Toggle
          checked={indexing}
          onChange={setIndexing}
          label="Ask Google to index it after publishing"
          description="Search Console is opened in this website's own browser profile and the article is sent for indexing."
        />
        <Field label="Search Console property" htmlFor="w-scp" hint='As it is written in Search Console: "https://example.com/" or "sc-domain:example.com".'>
          <Input id="w-scp" value={property} onChange={(event) => setProperty(event.target.value)} placeholder="sc-domain:example.com" />
        </Field>
      </div>

      <Button onClick={() => void save()} loading={saving}>
        Save settings
      </Button>
    </div>
  );
}

function Keywords({ workflowId, onChanged }: { workflowId: string; onChanged: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ keywords: KeywordRow[] }>(`/api/workflows/${workflowId}`, { refreshInterval: 20_000 });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const keywords = data?.keywords ?? [];
  // What the box will add, worked out while it is typed.
  const preview = parseKeywordLines(text);
  const known = new Set(keywords.map((row) => row.keyword.toLowerCase()));

  const refresh = useCallback(() => {
    void reload();
    onChanged();
  }, [reload, onChanged]);

  const add = async () => {
    setBusy(true);
    try {
      const result = await apiFetch<{ added: number; skipped: number }>(`/api/workflows/${workflowId}/keywords`, { method: 'POST', body: { text } });
      setText('');
      toast.success(`${result.added} keyword(s) added`, result.skipped ? `${result.skipped} were already in the list.` : undefined);
      refresh();
      if (result.added) void detect();
    } catch (err) {
      toast.error('Could not add the keywords', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** A CSV file with the columns keyword, title, secondary_keywords and kind. */
  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await apiFetch<{ added: number; skipped: number; rows: number }>(`/api/workflows/${workflowId}/import`, { formData: body });
      toast.success(`${result.added} keyword(s) added from ${file.name}`, result.skipped ? `${result.skipped} were already in the list.` : undefined);
      refresh();
      if (result.added) void detect();
    } catch (err) {
      toast.error('The file could not be used', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const detect = async () => {
    setBusy(true);
    try {
      const result = await apiFetch<{ checked: number; celebrity: number; tigram: number; unknown: number }>(
        `/api/workflows/${workflowId}/detect`,
        { method: 'POST' },
      );
      toast.success(
        `${result.checked} keyword(s) looked at`,
        `${result.celebrity} celebrity, ${result.tigram} Tigram${result.unknown ? `, ${result.unknown} still open` : ''}.`,
      );
      refresh();
    } catch (err) {
      toast.error('Could not work out the writers', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setKind = async (id: string, kind: string) => {
    try {
      await apiFetch(`/api/workflows/${workflowId}/keywords`, { method: 'PATCH', body: { id, kind } });
      refresh();
    } catch (err) {
      toast.error('Could not change the writer', (err as Error).message);
    }
  };

  const setTitle = async (id: string, title: string) => {
    try {
      await apiFetch(`/api/workflows/${workflowId}/keywords`, { method: 'PATCH', body: { id, title } });
      refresh();
    } catch (err) {
      toast.error('Could not save the title', (err as Error).message);
    }
  };

  const setState = async (id: string, state: 'WAITING' | 'SKIPPED') => {
    try {
      await apiFetch(`/api/workflows/${workflowId}/keywords`, { method: 'PATCH', body: { id, state } });
      refresh();
    } catch (err) {
      toast.error('Could not change the keyword', (err as Error).message);
    }
  };

  const retryIndexing = async (keywordId: string) => {
    setBusy(true);
    try {
      const result = await apiFetch<{ message: string }>(`/api/workflows/${workflowId}/indexing`, { method: 'POST', body: { keywordId } });
      toast.success(result.message);
      refresh();
    } catch (err) { toast.error('Could not queue indexing', (err as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try {
      const result = await apiFetch<{ removed: number }>(`/api/workflows/${workflowId}/keywords`, { method: 'DELETE', body: { ids: [id] } });
      if (!result.removed) toast.error('This keyword is being written or already scheduled', 'Cancel its article first.');
      refresh();
    } catch (err) {
      toast.error('Could not remove the keyword', (err as Error).message);
    }
  };

  const open = keywords.filter((row) => ['WAITING', 'WRITING', 'READY'].includes(row.state)).length;

  return (
    <div className="space-y-4">
      <Field
        label="Add keywords"
        htmlFor="w-bulk"
        hint="One article per line: keyword | secondary keywords | title. Only the keyword is needed; a title is used as the example for the article. Columns pasted from a sheet work too."
      >
        <Textarea
          id="w-bulk"
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'dillon brooks wife\nbest antivirus for windows 11 | free antivirus | The Best Antivirus for Windows 11 in 2026'}
        />
      </Field>
      {preview.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-lg ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Keyword</th>
                <th className="px-3 py-2 font-medium">Secondary keywords</th>
                <th className="px-3 py-2 font-medium">Title</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.map((line) => {
                const already = known.has(line.keyword.toLowerCase());
                return (
                  <tr key={line.keyword.toLowerCase()} className={already ? 'opacity-50' : undefined}>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {line.keyword}
                      {already && <span className="ml-2 text-xs font-normal text-amber-700">already in the list</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {line.secondaryKeywords.length ? line.secondaryKeywords.join(', ') : <span className="text-slate-400">none</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{line.title || <span className="text-slate-400">the writer makes one</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void add()} loading={busy} disabled={!preview.length} icon={<ListPlus className="h-4 w-4" />}>
          Add {preview.length || ''} to the list
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
          <Upload className="h-4 w-4" />
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              void importCsv(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <Button variant="outline" onClick={() => void detect()} loading={busy} icon={<Wand2 className="h-4 w-4" />}>
          Work out the writers
        </Button>
        <Button variant="ghost" onClick={refresh} icon={<RefreshCw className="h-4 w-4" />}>
          Refresh
        </Button>
        <span className="ml-auto self-center text-sm text-slate-500">{open} keyword(s) still to write</span>
      </div>

      {loading && !keywords.length && <Spinner />}
      {error && <Alert tone="error">{error}</Alert>}

      {keywords.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Keyword</th>
                <th className="px-3 py-2 font-medium">Writer</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Goes live</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {keywords.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{row.keyword}</p>
                    <input
                      defaultValue={row.title ?? ''}
                      placeholder="Title (optional)"
                      onBlur={(event) => {
                        if (event.target.value.trim() !== (row.title ?? '')) void setTitle(row.id, event.target.value.trim());
                      }}
                      className="mt-1 w-full max-w-md rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-slate-600 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none"
                    />
                    {row.kindNote && <p className="text-xs text-slate-500">{row.kindNote}</p>}
                    {row.lastError && <p className="text-xs text-red-600">{row.lastError}</p>}
                    {row.publishedUrl && (
                      <a href={row.publishedUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">
                        {row.publishedUrl}
                      </a>
                    )}
                    {row.indexingEvidence?.screenshotPath && (
                      <div className="mt-2">
                        <a href={`/api/screenshots/${row.indexingEvidence.screenshotPath}`} target="_blank" rel="noreferrer" className="inline-block text-xs text-indigo-600 hover:underline">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/screenshots/${row.indexingEvidence.screenshotPath}`} alt={`Search Console confirmation for ${row.keyword}`} loading="lazy" className="mb-1 max-h-32 w-56 rounded border border-slate-200 object-contain" />
                          View Search Console screenshot
                        </a>
                        <p className="text-xs text-slate-500">{row.indexingEvidence.message}</p>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Select value={row.kind} onChange={(event) => void setKind(row.id, event.target.value)} className="min-w-36">
                      <option value="UNKNOWN">{KIND_LABELS.UNKNOWN}</option>
                      <option value="CELEBRITY">{KIND_LABELS.CELEBRITY}</option>
                      <option value="TIGRAM">{KIND_LABELS.TIGRAM}</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={row.state === 'DONE' && row.lastError ? 'red' : STATE_TONES[row.state] ?? 'gray'}>
                      {row.state === 'INDEXED' ? (row.indexingEvidence?.outcome === 'already-indexed' ? 'On Google' : 'Indexing requested') : row.state === 'DONE' && row.lastError ? 'Indexing failed' : row.state.toLowerCase()}
                    </Badge>
                    {row.attempts > 0 && <p className="mt-1 text-xs text-slate-500">{row.attempts} try/tries</p>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                    {row.publishAt ? (
                      <span className="font-medium text-slate-800">{row.publishAt}</span>
                    ) : row.plannedFor ? (
                      <span className="text-slate-500">{row.plannedFor}</span>
                    ) : (
                      '—'
                    )}
                    <p className="text-xs text-slate-400">PK time</p>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {row.publishedUrl && ['PUBLISHED', 'DONE'].includes(row.state) && (
                        <Button variant="ghost" size="xs" disabled={busy} onClick={() => void retryIndexing(row.id)}>Check / request indexing</Button>
                      )}
                      {row.state === 'SKIPPED' || row.state === 'FAILED' ? (
                        <Button variant="ghost" size="xs" onClick={() => void setState(row.id, 'WAITING')}>
                          Put back
                        </Button>
                      ) : (
                        row.state === 'WAITING' && (
                          <Button variant="ghost" size="xs" onClick={() => void setState(row.id, 'SKIPPED')}>
                            Skip
                          </Button>
                        )
                      )}
                      <Button variant="ghost" size="xs" onClick={() => void remove(row.id)} title="Remove">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function WorkflowPage() {
  const { data, loading, error, reload } = useApi<{ websites: WorkflowWebsite[] }>('/api/workflows');
  const websites = data?.websites ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = websites.find((website) => website.id === selectedId) ?? websites[0] ?? null;
  const toast = useToast();

  useEffect(() => {
    if (!selectedId && websites.length) setSelectedId(websites[0].id);
  }, [selectedId, websites]);

  const setUp = async (websiteId: string) => {
    try {
      await apiFetch('/api/workflows', { method: 'POST', body: { websiteId } });
      toast.success('Workflow created', 'Add the keywords and the times, then switch it on.');
      void reload();
    } catch (err) {
      toast.error('Could not create the workflow', (err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow"
        description="Each website has its own keyword list. The app works out which writer a keyword needs, writes the article ahead of time, schedules it for its publish time and asks Google to index it."
      />
      {loading && <Spinner />}
      {error && <Alert tone="error">{error}</Alert>}
      {!loading && !websites.length && (
        <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No websites yet" description="Add a website first, then its workflow can be set up here." />
      )}

      {websites.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <nav className="space-y-1">
            {websites.map((website) => (
              <button
                key={website.id}
                type="button"
                onClick={() => setSelectedId(website.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  selected?.id === website.id ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="truncate">{website.name}</span>
                {website.workflow?.isActive ? (
                  <Badge tone="green">on</Badge>
                ) : website.workflow ? (
                  <Badge tone="gray">off</Badge>
                ) : null}
              </button>
            ))}
          </nav>

          {selected && (
            <div className="space-y-6">
              {!selected.workflow ? (
                <Card>
                  <CardBody>
                    <EmptyState
                      icon={<CalendarClock className="h-6 w-6" />}
                      title={`${selected.name} has no workflow yet`}
                      description="Set one up to give this website its own keyword list and publish times."
                      action={<Button onClick={() => void setUp(selected.id)}>Set up the workflow</Button>}
                    />
                  </CardBody>
                </Card>
              ) : (
                <>
                  <Card>
                    <CardHeader title="Settings" description={selected.url} />
                    <CardBody>
                      <Settings website={selected} onSaved={() => void reload()} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader
                      title="Keywords"
                      description="The list is worked through from the top. Each keyword becomes one article."
                    />
                    <CardBody>
                      <Keywords workflowId={selected.workflow.id} onChanged={() => void reload()} />
                    </CardBody>
                  </Card>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
