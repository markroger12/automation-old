import * as cheerio from 'cheerio';
import { escapeHtml, normalizeWhitespace } from '@/lib/utils';

export interface BioRow {
  attribute: string;
  details: string;
}

const HEADER_ROW = /^(attribute?|field|detail|details|information|info|category|value|attribut|merkmal|eigenschaft(en)?|angabe|angaben|information(en)?|kategorie|wert(e)?|feld(er)?)s?$/iu;

/** A table header row that ChatGPT wrote as a normal row (e.g. "Attribut | Details" in German answers). */
const isHeaderRow = (row: BioRow) => HEADER_ROW.test(row.attribute.trim()) && HEADER_ROW.test(row.details.trim());

function clean(value: string): string {
  return normalizeWhitespace(value.replace(/\*\*|__|`/g, '').replace(/<br\s*\/?>/gi, ', '));
}

function rowsFromHtml(html: string): BioRow[] {
  const $ = cheerio.load(html, null, false);
  const rows: BioRow[] = [];
  $('table')
    .first()
    .find('tr')
    .each((_, tr) => {
      const cells = $(tr)
        .find('th,td')
        .map((__, c) => clean($(c).text()))
        .get();
      if (cells.length >= 2) rows.push({ attribute: cells[0], details: cells.slice(1).join(' ') });
    });
  return rows;
}

function rowsFromMarkdown(text: string): BioRow[] {
  const rows: BioRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|?\s*:?-{2,}/.test(t)) continue;
    const cells = t
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(clean);
    if (cells.length >= 2 && cells[0]) rows.push({ attribute: cells[0], details: cells.slice(1).join(' ') });
  }
  return rows;
}

function rowsFromKeyValue(text: string): BioRow[] {
  const rows: BioRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]\s*)?(?:\*\*)?(\p{L}[\p{L} /&'()-]{1,40}?)(?:\*\*)?\s*[:\-–]\s*(.+)$/u.exec(line);
    if (m) rows.push({ attribute: clean(m[1]), details: clean(m[2]) });
  }
  return rows;
}

/** Extracts Quick Bio rows from ChatGPT output (rendered table, HTML in a code block, Markdown table or key/value lines). */
export function parseQuickBio(html: string | null | undefined, text: string | null | undefined): BioRow[] {
  const candidates: BioRow[][] = [];
  if (html) {
    candidates.push(rowsFromHtml(html));
    const $ = cheerio.load(html, null, false);
    $('pre code, code').each((_, el) => {
      const code = $(el).text();
      if (/<table/i.test(code)) candidates.push(rowsFromHtml(code));
    });
  }
  if (text) {
    if (/<table/i.test(text)) candidates.push(rowsFromHtml(text));
    candidates.push(rowsFromMarkdown(text));
    candidates.push(rowsFromKeyValue(text));
  }
  const best = candidates
    .map((rows) =>
      rows.filter(
        (r) => r.attribute && r.details && !isHeaderRow(r) && r.attribute.length <= 60,
      ),
    )
    .sort((a, b) => b.length - a.length)[0];
  const seen = new Set<string>();
  return (best ?? []).filter((r) => {
    const k = r.attribute.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function renderQuickBioHtml(rows: BioRow[], heading: string, columns: [string, string] = ['Attribute', 'Details']): string {
  // Rows saved before header rows were recognised may still contain one.
  const dataRows = rows.filter((r) => !isHeaderRow(r));
  if (!dataRows.length) return '';
  const body = dataRows
    .map((r) => `<tr><td><strong>${escapeHtml(r.attribute)}</strong></td><td>${escapeHtml(r.details)}</td></tr>`)
    .join('\n');
  return `<h2>${escapeHtml(heading)}</h2>
<table class="quick-bio-table">
<thead><tr><th>${escapeHtml(columns[0])}</th><th>${escapeHtml(columns[1])}</th></tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}
