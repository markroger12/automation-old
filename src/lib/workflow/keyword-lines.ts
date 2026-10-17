// The keyword box of a workflow. It runs in the browser as well, so the page can show what will be added before
// anything is saved.
import { splitList } from '@/lib/utils';
import type { KeywordKindValue } from './keyword-kind';

export interface KeywordLine {
  keyword: string;
  secondaryKeywords: string[];
  /** An example title for the article; empty lets the writer make its own. */
  title?: string | null;
  kind?: KeywordKindValue;
}

/**
 * Reads the keyword box: one article per line.
 *   keyword | secondary keywords | title
 * The two parts after the keyword are optional, and columns pasted from a sheet (tabs) work the same way.
 * A keyword that is already in the list is only kept once.
 */
export function parseKeywordLines(text: string): KeywordLine[] {
  const seen = new Set<string>();
  const lines: KeywordLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.split(/[|\t]/).map((part) => part.trim());
    const keyword = (parts[0] ?? '').slice(0, 200);
    if (keyword.length < 2) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      keyword,
      secondaryKeywords: splitList(parts[1] ?? '')
        .map((entry) => entry.slice(0, 200))
        .slice(0, 50),
      title: parts[2] ? parts[2].slice(0, 300) : null,
    });
  }
  return lines;
}
