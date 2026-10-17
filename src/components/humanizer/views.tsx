'use client';

// The Humanizer page's report views: the check, the before/after measures, each paragraph's outcome and the article.
import { useState, type ReactNode } from 'react';
import { ClipboardCopy } from 'lucide-react';
import type { ArticleReport, ParagraphReport } from '@/content/humanizer/analyse';
import type { HumanizeResult, ParagraphResult } from '@/content/humanizer/humanize';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';

export interface CheckResponse {
  format: 'html' | 'text';
  report: ArticleReport;
  texts: string[];
}

export type RunResult = HumanizeResult & { conversationUrls: string[]; durationMs: number };

// ——— Metrics ———

interface Metric {
  label: string;
  hint: string;
  value: (r: ArticleReport) => number;
  show?: (r: ArticleReport) => string;
  better: 'lower' | 'higher' | 'none';
}

const METRICS: Metric[] = [
  { label: 'AI-style signals per 1,000 words', hint: 'Marker words, filler, stock phrases, openers, dashes. Lower is better.', value: (r) => r.signalsPer1000, better: 'lower' },
  { label: 'Flagged paragraphs', hint: 'Paragraphs with enough signals to be rewritten.', value: (r) => r.flaggedParagraphs, show: (r) => `${r.flaggedParagraphs} of ${r.paragraphs}`, better: 'lower' },
  { label: 'Transition openers', hint: 'Sentences opening with Additionally, Furthermore, Moreover…', value: (r) => r.transitionOpeners, better: 'lower' },
  { label: 'Dashes (—)', hint: 'ChatGPT uses far more dashes than most writers.', value: (r) => r.dashes, better: 'lower' },
  { label: 'Sentence rhythm', hint: 'Variation of sentence length. Around 0.4 or more reads natural; low means every sentence is alike.', value: (r) => r.sentenceLength.variation, show: (r) => `${r.sentenceLength.variation} (avg ${r.sentenceLength.mean} words)`, better: 'higher' },
  { label: 'Word variety', hint: 'Share of different words in every 50 words. Higher is more varied.', value: (r) => r.wordVariety, better: 'higher' },
  { label: 'Words', hint: 'Paragraph prose only (headings, lists and tables are not counted).', value: (r) => r.words, better: 'none' },
];

export function signalTone(perThousand: number): 'green' | 'amber' | 'red' {
  return perThousand < 5 ? 'green' : perThousand < 12 ? 'amber' : 'red';
}

export function MetricsTable({ before, after }: { before: ArticleReport; after?: ArticleReport }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <tr>
            <th className="py-2 pr-4">Measure</th>
            <th className="py-2 pr-4">{after ? 'Before' : 'Value'}</th>
            {after && <th className="py-2 pr-4">After</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {METRICS.map((m) => {
            const a = m.value(before);
            const b = after ? m.value(after) : null;
            const improved = b !== null && m.better !== 'none' && (m.better === 'lower' ? b < a : b > a);
            const worse = b !== null && m.better !== 'none' && (m.better === 'lower' ? b > a : b < a);
            return (
              <tr key={m.label}>
                <td className="py-2 pr-4">
                  <p className="font-medium text-slate-800">{m.label}</p>
                  <p className="text-xs text-slate-500">{m.hint}</p>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap text-slate-700">{m.show ? m.show(before) : a}</td>
                {after && (
                  <td className={cn('py-2 pr-4 font-medium whitespace-nowrap', improved ? 'text-emerald-700' : worse ? 'text-red-600' : 'text-slate-700')}>
                    {m.show ? m.show(after) : b}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RepeatNotes({ report }: { report: ArticleReport }) {
  const notes: ReactNode[] = [];
  if (report.topSignals.length) {
    notes.push(
      <p key="signals">
        <span className="font-medium">Most used signals:</span> {report.topSignals.map((s) => `${s.label} ×${s.count}`).join(', ')}
      </p>,
    );
  }
  if (report.repeatedOpenings.length) {
    notes.push(
      <p key="openings">
        <span className="font-medium">Sentences often start with:</span> {report.repeatedOpenings.map((o) => `“${o.word}” ×${o.count}`).join(', ')}
      </p>,
    );
  }
  if (report.repeatedPhrases.length) {
    notes.push(
      <p key="phrases">
        <span className="font-medium">Repeated phrases:</span> {report.repeatedPhrases.map((p) => `“${p.phrase}” ×${p.count}`).join(', ')}
      </p>,
    );
  }
  return notes.length ? <div className="mt-4 space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{notes}</div> : null;
}

// ——— Paragraphs ———

function highlight(text: string, report: ParagraphReport): ReactNode {
  const words = [...new Set(report.hits.flatMap((h) => h.texts))].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-amber-100 px-0.5 text-amber-900">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function CheckedParagraphs({ check }: { check: CheckResponse }) {
  const [showAll, setShowAll] = useState(false);
  const list = check.report.paragraphReports.filter((p) => showAll || p.flagged);
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">{showAll ? 'All paragraphs' : 'Flagged paragraphs'}</p>
        <Button size="xs" variant="ghost" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Only flagged' : 'Show all'}
        </Button>
      </div>
      {!list.length && <p className="text-sm text-slate-500">No paragraph has enough AI-style signals to be rewritten.</p>}
      <div className="space-y-3">
        {list.map((p) => (
          <div key={p.number} className="rounded-lg p-3 ring-1 ring-slate-200">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={p.flagged ? 'amber' : 'gray'}>P{p.number}</Badge>
              <span className="text-xs text-slate-500">
                score {p.score} · {p.words} words
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-700">{highlight(check.texts[p.number - 1] ?? '', p)}</p>
            {p.reasons.length > 0 && <p className="mt-1.5 text-xs text-slate-500">{p.reasons.join(' · ')}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

const OUTCOME: Record<ParagraphResult['outcome'], { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  rewritten: { label: 'Rewritten', tone: 'green' },
  'kept-original': { label: 'Kept original', tone: 'amber' },
  missing: { label: 'Not returned', tone: 'red' },
  unchanged: { label: 'Not sent', tone: 'gray' },
};

export function ResultParagraphs({ result }: { result: RunResult }) {
  const [showAll, setShowAll] = useState(false);
  const list = result.paragraphs.filter((p) => showAll || p.outcome !== 'unchanged');
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">Paragraph by paragraph</p>
        <Button size="xs" variant="ghost" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Only sent ones' : 'Show all'}
        </Button>
      </div>
      <div className="space-y-3">
        {list.map((p) => (
          <div key={p.number} className="rounded-lg p-3 ring-1 ring-slate-200">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone="gray">P{p.number}</Badge>
              <Badge tone={OUTCOME[p.outcome].tone}>{OUTCOME[p.outcome].label}</Badge>
              {p.warnings.map((w) => (
                <span key={w} className="text-xs text-slate-500">
                  {w}
                </span>
              ))}
            </div>
            {p.rewritten ? (
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Before</p>
                  <p className="text-sm leading-relaxed text-slate-500">{p.original}</p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">ChatGPT</p>
                  <p className={cn('text-sm leading-relaxed', p.outcome === 'rewritten' ? 'text-slate-800' : 'text-slate-400 line-through')}>{p.rewritten}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-slate-600">{p.original}</p>
            )}
            {p.problems.length > 0 && <p className="mt-2 text-xs text-red-600">Not used: {p.problems.join(' · ')}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Output({ result }: { result: RunResult }) {
  const toast = useToast();
  const [view, setView] = useState(result.format === 'html' ? 'preview' : 'source');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.output);
      toast.success('Copied the humanized article');
    } catch {
      toast.error('Copy failed', 'Select the text and copy it yourself.');
    }
  };
  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Tabs
          tabs={[
            ...(result.format === 'html' ? [{ key: 'preview', label: 'Preview' }] : []),
            { key: 'source', label: result.format === 'html' ? 'HTML' : 'Text' },
          ]}
          value={view}
          onChange={setView}
        />
        <Button size="sm" variant="outline" icon={<ClipboardCopy className="h-4 w-4" />} onClick={copy}>
          Copy article
        </Button>
      </div>
      {view === 'preview' ? (
        <iframe
          title="Humanized article"
          sandbox=""
          className="h-[36rem] w-full rounded-lg bg-white ring-1 ring-slate-200"
          srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:16px/1.65 Georgia,serif;max-width:46rem;margin:24px auto;padding:0 16px;color:#1e293b}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px}</style>${result.output}`}
        />
      ) : (
        <Textarea readOnly value={result.output} rows={18} className="font-mono text-xs" />
      )}
    </div>
  );
}

