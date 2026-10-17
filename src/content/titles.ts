import { normalizeWhitespace } from '@/lib/utils';

export interface TitleExtraction {
  options: string[];
  recommended: string | null;
}

const RECOMMEND_LABEL =
  /(?:recommended title|best title|strongest title|top pick|top choice|my recommendation|final recommendation|recommendation|i recommend(?: using)?|best option|winner|empfohlener titel|bester titel|stärkster titel|meine empfehlung|empfehlung)\s*(?:to use)?\s*(?:is|would be|ist)?\s*[:\-–—]\s*(.*)$/i;

export function cleanTitle(value: string): string {
  let t = normalizeWhitespace(value)
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '')
    .replace(/\*\*|__/g, '')
    .trim();
  // Strip wrapping quotes (straight or curly).
  t = t.replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim();
  // Remove trailing explanations in parentheses or after " — why:" style separators.
  t = t.replace(/\s+\((?:recommended|best|strongest|empfohlen|beste)[^)]*\)\s*$/i, '').trim();
  return t.replace(/[.]+$/, '').trim();
}

function quoted(line: string): string | null {
  const m = /["“]([^"”]{10,200})["”]/.exec(line);
  return m ? m[1] : null;
}

function isPlausibleTitle(value: string): boolean {
  return value.length >= 10 && value.length <= 200 && !/[:]\s*$/.test(value);
}

export function extractTitles(text: string): TitleExtraction {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim());
  const options: string[] = [];

  for (const line of lines) {
    const m = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/.exec(line);
    if (!m) continue;
    const q = quoted(m[1]);
    const candidate = cleanTitle(q ?? m[1].split(/\s+[–—]\s+(?:why|this|it|great|good)\b/i)[0]);
    if (isPlausibleTitle(candidate) && !RECOMMEND_LABEL.test(line)) options.push(candidate);
  }

  let recommended: string | null = null;
  for (let i = lines.length - 1; i >= 0 && !recommended; i--) {
    const line = lines[i];
    const m = RECOMMEND_LABEL.exec(line.replace(/\*\*/g, ''));
    if (!m) continue;
    const inline = m[1]?.trim();
    const candidate = inline ? cleanTitle(quoted(inline) ?? inline) : null;
    if (candidate && isPlausibleTitle(candidate)) {
      recommended = candidate;
      break;
    }
    // Label on its own line: take the next non-empty line.
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j]) continue;
      const next = cleanTitle(quoted(lines[j]) ?? lines[j]);
      if (isPlausibleTitle(next)) recommended = next;
      break;
    }
  }

  const unique = Array.from(new Set(options));
  if (!recommended && unique.length) recommended = unique[0];
  if (recommended && !unique.some((o) => o.toLowerCase() === recommended!.toLowerCase())) unique.unshift(recommended);
  return { options: unique.slice(0, 20), recommended };
}
