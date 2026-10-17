import { splitList } from './utils';

export interface BulkKeywordLine {
  keyword: string;
  secondaryKeywords: string[];
}

/**
 * Parses the "Multiple keywords" box: one article per line, with that keyword's own secondary keywords
 * after a "|" (comma separated). Tab-separated columns pasted from Google Sheets / Excel work too.
 *   Sydney Sweeney | Sydney Sweeney movies, Sydney Sweeney height
 * Lines with a keyword that is already listed are ignored.
 */
export function parseBulkKeywords(text: string): BulkKeywordLine[] {
  const seen = new Set<string>();
  const lines: BulkKeywordLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const separator = line.search(/[|\t]/);
    const keyword = (separator === -1 ? line : line.slice(0, separator)).trim().slice(0, 200);
    if (keyword.length < 2) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rest = separator === -1 ? '' : line.slice(separator + 1).replace(/[|\t]/g, ',');
    lines.push({ keyword, secondaryKeywords: splitList(rest).map((k) => k.slice(0, 200)).slice(0, 50) });
  }
  return lines;
}
