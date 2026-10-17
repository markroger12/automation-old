'use client';

// The Plagiarism Check page's report: the article with its matches marked, every source with its passages side by side.
// It shows evidence to review; a percentage here is never a verdict (the user's research doc, 28 September 2026).
import { useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PlagiarismReport, SourceKind, SourceResult } from '@/content/plagiarism/check';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const KIND_LABEL: Record<SourceKind, string> = { own: 'Your article', link: 'Linked page', wikipedia: 'Wikipedia', url: 'Page you added', google: 'Found on Google' };
const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

export function shareTone(share: number): 'green' | 'amber' | 'red' {
  return share < 0.05 ? 'green' : share < 0.15 ? 'amber' : 'red';
}

export function Summary({ report }: { report: PlagiarismReport }) {
  const failed = report.sources.filter((s) => s.status === 'failed').length;
  const items: Array<[string, ReactNode]> = [
    ['Matched text', <Badge key="m" tone={shareTone(report.matchedShare)}>{pct(report.matchedShare)} ({report.matchedWords.toLocaleString()} of {report.words.toLocaleString()} words)</Badge>],
    ['Google', report.google ? `${report.google.searches} phrase search(es), ${report.google.pagesFound} page(s) found` : 'not searched'],
    ['Your articles compared', `${report.ownCompared} (only those sharing a passage are listed)`],
    ['Web pages compared', `${report.sources.filter((s) => s.kind !== 'own' && s.status === 'checked').length}${failed ? ` (${failed} could not be read)` : ''}`],
    ['In quotation marks', `${report.quotedWords} words (not counted)`],
    ['Your template text', `${report.boilerplateWords} words (not counted)`],
    ['Wikipedia language', report.language === 'de' ? 'German' : 'English'],
    ['Time', `${Math.round(report.durationMs / 100) / 10} s`],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs text-slate-500">{label}</p>
          <div className="mt-0.5 text-sm font-medium text-slate-800">{value}</div>
        </div>
      ))}
    </div>
  );
}

/** The article with exact copies in red and close copies in amber. */
export function MarkedArticle({ report }: { report: PlagiarismReport }) {
  const parts: ReactNode[] = [];
  let at = 0;
  report.highlights.forEach((h, i) => {
    if (h.start > at) parts.push(report.text.slice(at, h.start));
    parts.push(
      <mark key={i} className={cn('rounded px-0.5', h.kind === 'exact' ? 'bg-rose-100 text-rose-900' : 'bg-amber-100 text-amber-900')}>
        {report.text.slice(h.start, h.end)}
      </mark>,
    );
    at = h.end;
  });
  parts.push(report.text.slice(at));
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        <mark className="rounded bg-rose-100 px-1 text-rose-900">red</mark> = the same words (8 or more in a row) ·{' '}
        <mark className="rounded bg-amber-100 px-1 text-amber-900">amber</mark> = a lightly edited copy of a sentence
      </p>
      <div className="max-h-[28rem] overflow-y-auto rounded-lg p-3 text-sm leading-relaxed whitespace-pre-line text-slate-700 ring-1 ring-slate-200">{parts}</div>
    </div>
  );
}

function SourceRow({ source }: { source: SourceResult }) {
  const [open, setOpen] = useState(false);
  const shown = source.passages.filter((p) => open || (!p.quoted && !p.boilerplate));
  return (
    <div className="rounded-lg p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="gray">{KIND_LABEL[source.kind]}</Badge>
        {source.url ? (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium text-indigo-700 hover:underline">
            {source.title} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          </a>
        ) : (
          <span className="text-sm font-medium text-slate-800">{source.title}</span>
        )}
        {source.status === 'checked' ? (
          <Badge tone={shareTone(source.share)}>{pct(source.share)} of the article</Badge>
        ) : (
          <Badge tone="red">not read: {source.error}</Badge>
        )}
        {source.status === 'checked' && (
          <span className="text-xs text-slate-500">
            {source.exactPassages} same-words passage(s) · {source.nearPassages} close copy(ies) · {pct(source.containment)} of phrases shared
          </span>
        )}
        {source.googleHits ? <span className="text-xs text-slate-500">· Google showed it for {source.googleHits} searched phrase(s)</span> : null}
        {source.passages.length > 0 && (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : `Show passages (${source.passages.length})`}
          </Button>
        )}
      </div>
      {source.status === 'failed' && source.snippet && <p className="mt-2 text-xs text-slate-500">Google’s snippet: “{source.snippet}”</p>}
      {open && (
        <div className="mt-3 space-y-3">
          {shown.map((p, i) => (
            <div key={i} className="grid gap-3 rounded-md bg-slate-50 p-2 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                  Article · {p.kind === 'exact' ? `${p.words} words the same` : `close copy (${Math.round(p.similarity * 100)}% alike)`}
                  {p.quoted && ' · quoted, not counted'}
                  {p.boilerplate && ' · your template text, not counted'}
                </p>
                <p className="text-sm text-slate-800">{p.articleText}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Source</p>
                <p className="text-sm text-slate-600">{p.sourceText}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SourceList({ report }: { report: PlagiarismReport }) {
  if (!report.sources.length) return <p className="text-sm text-slate-500">No source shared a passage with this article.</p>;
  return (
    <div className="space-y-2">
      {report.sources.map((source) => (
        <SourceRow key={source.id} source={source} />
      ))}
    </div>
  );
}
