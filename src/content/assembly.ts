import * as cheerio from 'cheerio';
import { sanitizeArticleHtml } from '@/lib/html/sanitize';
import { escapeHtml, normalizeWhitespace } from '@/lib/utils';
import type { ContentLocale } from '@/lib/content-locale';
import { renderFaqsHtml, type FaqItem } from './faqs';
import { extractInternalLink } from './internal-link';
import { renderQuickBioHtml, type BioRow } from './quick-bio';

export interface ArticleSection {
  heading: string;
  html: string;
}

export interface ArticleParts {
  introHtml: string;
  sections: ArticleSection[];
  conclusion: ArticleSection | null;
}

// Word boundaries that also work next to umlauts (\b only knows ASCII letters).
const words = (alternatives: string) => new RegExp(`(?<![\\p{L}])(${alternatives})(?![\\p{L}])`, 'iu');
const CONCLUSION_HEADING = words(
  'conclusion|concluding|final thoughts|final words|wrapping up|in summary|summing up|closing thoughts|the bottom line|bottom line|fazit|schlussfolgerung|schlusswort|zusammenfassung|abschließende gedanken|abschließend',
);
const INTRO_HEADING = /^(introduction|intro|overview|einleitung|einführung|überblick)$/iu;
const FAQ_HEADING = words('faqs?|frequently asked questions|häufig gestellte fragen|häufige fragen');
const BIO_HEADING = words('quick bio|quick facts|bio ?data|bio table|biography table|fast facts|steckbrief|kurzbiografie|kurzbiographie|kurzprofil|auf einen blick');

const SECTION_TITLES: Record<
  ContentLocale,
  { quickBio: (name: string) => string; bioColumns: [string, string]; faqs: (name: string) => string }
> = {
  en: { quickBio: (name) => `Quick Bio of ${name}`, bioColumns: ['Attribute', 'Details'], faqs: () => 'Frequently Asked Questions' },
  de: { quickBio: (name) => `Kurzbiografie von ${name}`, bioColumns: ['Attribut', 'Details'], faqs: () => 'Häufig gestellte Fragen' },
};

/** Splits article HTML into intro (before the first H2), H2 sections and a detected conclusion. */
export function splitArticle(html: string): ArticleParts {
  const $ = cheerio.load(html ?? '', null, false);
  let intro = '';
  const sections: ArticleSection[] = [];
  let current: ArticleSection | null = null;

  $.root()
    .contents()
    .each((_, node) => {
      if (node.type === 'text') {
        const text = normalizeWhitespace($(node).text());
        if (!text) return;
        const p = `<p>${escapeHtml(text)}</p>`;
        if (current) current.html += p;
        else intro += p;
        return;
      }
      if (node.type !== 'tag') return;
      const el = $(node);
      if (el.is('h2')) {
        current = { heading: normalizeWhitespace(el.text()), html: $.html(el) };
        sections.push(current);
        return;
      }
      if (current) current.html += $.html(el);
      else intro += $.html(el);
    });

  // "## Introduction" sections become the intro (avoids a duplicate introduction).
  while (sections.length && INTRO_HEADING.test(sections[0].heading)) {
    const s = sections.shift()!;
    intro += s.html.replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '');
  }

  let conclusion: ArticleSection | null = null;
  const last = sections[sections.length - 1];
  if (last && CONCLUSION_HEADING.test(last.heading)) conclusion = sections.pop()!;

  return { introHtml: intro, sections, conclusion };
}

function looksLikeBioTable(tableHtml: string): boolean {
  const $ = cheerio.load(tableHtml, null, false);
  const rows = $('tr');
  if (rows.length < 4) return false;
  const twoColumns = rows.toArray().every((tr) => $(tr).find('th,td').length === 2);
  return twoColumns && /(full name|date of birth|birthplace|nationality|net worth|profession)/i.test($.root().text());
}

function dedupeParagraphs(html: string): string {
  const $ = cheerio.load(html, null, false);
  const seen = new Set<string>();
  $('p').each((_, p) => {
    const key = normalizeWhitespace($(p).text()).toLowerCase();
    if (key.length < 40) return;
    if (seen.has(key)) $(p).remove();
    else seen.add(key);
  });
  return $.html();
}

function stripBioTables(html: string): string {
  const $ = cheerio.load(html, null, false);
  $('table').each((_, t) => {
    if (looksLikeBioTable($.html(t))) $(t).remove();
  });
  return $.html();
}

export interface AssembleInput {
  /** Language of the section titles the app adds (Quick Bio, FAQs). */
  locale?: ContentLocale;
  bodyHtml: string;
  faqs: FaqItem[];
  quickBio: BioRow[];
  subjectName: string;
}

export interface AssembledArticle {
  html: string;
  introHtml: string;
  hasConclusion: boolean;
  sectionCount: number;
}

/**
 * Programmatically combines: Introduction → Quick Bio Table → Main Article → FAQs → Conclusion → internal link.
 * Any FAQ / Quick Bio sections ChatGPT put inside the article body are replaced by the dedicated ones.
 */
export function assembleArticle(input: AssembleInput): AssembledArticle {
  // The internal link ("Das könnte Ihnen gefallen: …") is kept at the end of the body and stays the very last line.
  const { html: bodyHtml, paragraph: internalLink } = extractInternalLink(input.bodyHtml ?? '');
  const parts = splitArticle(bodyHtml);
  const hasOwnBio = input.quickBio.length > 0;
  const hasOwnFaqs = input.faqs.length > 0;

  const bodySections = parts.sections.filter((s) => {
    if (hasOwnFaqs && FAQ_HEADING.test(s.heading)) return false;
    if (hasOwnBio && BIO_HEADING.test(s.heading)) return false;
    return true;
  });

  const chunks: string[] = [];
  chunks.push(hasOwnBio ? stripBioTables(parts.introHtml) : parts.introHtml);
  const titles = SECTION_TITLES[input.locale ?? 'en'];
  if (hasOwnBio) chunks.push(renderQuickBioHtml(input.quickBio, titles.quickBio(input.subjectName), titles.bioColumns));
  for (const s of bodySections) chunks.push(hasOwnBio ? stripBioTables(s.html) : s.html);
  if (hasOwnFaqs) chunks.push(renderFaqsHtml(input.faqs, titles.faqs(input.subjectName)));
  if (parts.conclusion) chunks.push(parts.conclusion.html);
  if (internalLink) chunks.push(internalLink);

  const html = sanitizeArticleHtml(dedupeParagraphs(chunks.filter(Boolean).join('\n')));
  return {
    html,
    introHtml: parts.introHtml,
    hasConclusion: Boolean(parts.conclusion),
    sectionCount: bodySections.length,
  };
}

/** Returns the intro text of an article (paragraphs before the first H2). */
export function introText(html: string): string {
  const { introHtml } = splitArticle(html);
  const $ = cheerio.load(introHtml, null, false);
  return normalizeWhitespace(
    $('p')
      .map((_, p) => $(p).text())
      .get()
      .join(' '),
  );
}
