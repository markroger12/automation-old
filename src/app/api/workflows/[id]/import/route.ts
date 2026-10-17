import Papa from 'papaparse';
import { HttpError, param, route } from '@/lib/api';
import { addKeywordLines, type KeywordLine } from '@/lib/services/workflow';
import type { KeywordKindValue } from '@/lib/workflow/keyword-kind';
import { splitList } from '@/lib/utils';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;

type Row = Record<string, string | undefined>;

function pick(row: Row, ...names: string[]): string {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** "celebrity" / "person" → CELEBRITY, "tigram" / "other" → TIGRAM, anything else is worked out by the app. */
function kindOf(value: string): KeywordKindValue | undefined {
  const text = value.toLowerCase();
  if (!text) return undefined;
  if (/celebrit|person|people|promi/.test(text)) return 'CELEBRITY';
  if (/tigram|other|general|allgemein/.test(text)) return 'TIGRAM';
  return undefined;
}

/**
 * Adds keywords from a CSV file to the list of one workflow.
 * Columns: keyword (required), title, secondary_keywords, kind. Extra columns are ignored.
 */
export const POST = route(async (req, ctx) => {
  const id = await param(ctx, 'id');
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'Choose a CSV file first');
  if (file.size > MAX_BYTES) throw new HttpError(400, 'The file is larger than 2 MB');

  const parsed = Papa.parse<Row>(await file.text(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'),
  });
  if (!parsed.meta.fields?.includes('keyword')) throw new HttpError(400, 'The file needs a "keyword" column.');
  if (parsed.data.length > MAX_ROWS) throw new HttpError(400, `At most ${MAX_ROWS} rows can be added at once`);

  const lines: KeywordLine[] = [];
  for (const row of parsed.data) {
    const keyword = pick(row, 'keyword', 'kw', 'target_keyword').slice(0, 200);
    if (keyword.length < 2) continue;
    lines.push({
      keyword,
      title: pick(row, 'title', 'example_title', 'article_title').slice(0, 300) || null,
      secondaryKeywords: splitList(pick(row, 'secondary_keywords', 'secondary', 'keywords')).map((entry) => entry.slice(0, 200)).slice(0, 50),
      kind: kindOf(pick(row, 'kind', 'writer', 'type', 'module')),
    });
  }
  if (!lines.length) throw new HttpError(400, 'No usable keyword was found in the file.');
  const result = await addKeywordLines(id, lines);
  return { ...result, rows: parsed.data.length };
});
