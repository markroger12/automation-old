import * as cheerio from 'cheerio';
import { htmlToText } from '@/lib/html/convert';
import { normalizeWhitespace, slugify } from '@/lib/utils';
import { splitArticle } from '@/content/assembly';
import { containsKeyword } from '@/content/seo-meta';
import type { FaqItem } from '@/content/faqs';
import type { BioRow } from '@/content/quick-bio';
import { computeMetrics, countKeyword, countWords, type ArticleMetrics } from './metrics';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface SeoCheck {
  id: string;
  label: string;
  group: 'Keyword' | 'Content' | 'Meta' | 'Structure' | 'Quality' | 'WordPress';
  status: CheckStatus;
  message: string;
  weight: number;
}

export interface SeoCheckInput {
  /** Article language (slug spelling). */
  locale?: 'en' | 'de';
  keyword: string;
  articleTitle: string | null;
  seoTitle: string | null;
  slug: string | null;
  metaDescription: string | null;
  contentHtml: string;
  faqs: FaqItem[];
  quickBio: BioRow[];
  categoryName: string | null;
  tags: string[];
  settings: {
    maxArticleWordCount: number;
    minKeywordOccurrences: number;
    maxKeywordOccurrences: number;
    faqCount: number;
  };
}

export interface SeoReportResult {
  score: number;
  checks: SeoCheck[];
  metrics: ArticleMetrics;
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'source', 'wbr', 'area', 'base']);

export function findHtmlProblems(html: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  for (const m of html.matchAll(tagRe)) {
    const name = m[1].toLowerCase();
    const closing = m[0].startsWith('</');
    if (VOID_TAGS.has(name) || m[2] === '/') continue;
    if (!closing) {
      stack.push(name);
      continue;
    }
    if (stack[stack.length - 1] === name) {
      stack.pop();
    } else if (stack.includes(name)) {
      while (stack.length && stack[stack.length - 1] !== name) problems.push(`Unclosed <${stack.pop()}>`);
      stack.pop();
    } else {
      problems.push(`Unexpected closing </${name}>`);
    }
  }
  for (const name of stack) problems.push(`Unclosed <${name}>`);

  const text = htmlToText(html);
  if (/(^|\n)\s*#{1,6}\s+\S/.test(text)) problems.push('Markdown heading markers (#) in text');
  if (/\*\*[^*\n]+\*\*/.test(text)) problems.push('Markdown bold markers (**) in text');
  if (/```/.test(text)) problems.push('Markdown code fence in text');
  if (/&lt;\/?(p|h[1-6]|table|tr|td|strong|em)\b/i.test(html)) problems.push('Escaped HTML tags rendered as text');
  return Array.from(new Set(problems)).slice(0, 10);
}

const AI_PHRASES =
  /\b(as an ai\b|i hope this helps|here is your article|here(?:'|’)s your article|certainly!|let me know if you|feel free to ask|in today(?:'|’)s fast-paced world|delve into|it(?:'|’)s important to note that|als ki\b|ich hoffe, das hilft|hier ist ihr artikel|hier ist dein artikel|in der heutigen schnelllebigen welt|es ist wichtig zu beachten)/i;

export function runSeoChecks(input: SeoCheckInput): SeoReportResult {
  const { keyword, settings } = input;
  const html = input.contentHtml ?? '';
  const metrics = computeMetrics(html, keyword);
  const $ = cheerio.load(html, null, false);
  const checks: SeoCheck[] = [];
  const add = (c: SeoCheck) => checks.push(c);

  // ── Keyword placement ───────────────────────────────
  const title = input.articleTitle ?? '';
  add({
    id: 'keyword_in_title',
    label: 'Keyword in Article Title',
    group: 'Keyword',
    weight: 5,
    status: containsKeyword(title, keyword) ? 'pass' : 'fail',
    message: title ? (containsKeyword(title, keyword) ? 'The article title contains the keyword.' : 'Add the keyword to the article title.') : 'No article title set.',
  });

  const seoTitle = input.seoTitle ?? '';
  const seoTitleHasKw = containsKeyword(seoTitle, keyword);
  const kwPos = seoTitle.toLowerCase().indexOf(keyword.toLowerCase());
  add({
    id: 'keyword_in_seo_title',
    label: 'Keyword in SEO Title',
    group: 'Meta',
    weight: 6,
    status: seoTitleHasKw ? 'pass' : 'fail',
    message: !seoTitle
      ? 'No SEO title set.'
      : seoTitleHasKw
        ? kwPos >= 0 && kwPos <= seoTitle.length / 2
          ? 'Keyword appears in the first half of the SEO title.'
          : 'Keyword is in the SEO title (consider moving it closer to the start).'
        : 'Add the keyword to the SEO title.',
  });

  const slug = input.slug ?? '';
  const kwSlug = slugify(keyword, 75, input.locale);
  const slugWords = kwSlug.split('-').filter(Boolean);
  add({
    id: 'keyword_in_slug',
    label: 'Keyword in Slug',
    group: 'Meta',
    weight: 5,
    status: slug.includes(kwSlug) ? 'pass' : slugWords.every((w) => slug.split('-').includes(w)) && slug ? 'warn' : 'fail',
    message: !slug ? 'No slug set.' : slug.includes(kwSlug) ? `Slug "${slug}" contains the keyword.` : `Slug "${slug}" should contain "${kwSlug}".`,
  });

  const parts = splitArticle(html);
  const introPlain = htmlToText(parts.introHtml);
  const allText = htmlToText(html);
  const firstTenPercent = allText.split(/\s+/).slice(0, Math.max(60, Math.round(metrics.wordCount * 0.1))).join(' ');
  const inIntro = containsKeyword(introPlain, keyword);
  add({
    id: 'keyword_in_intro',
    label: 'Keyword in Introduction',
    group: 'Keyword',
    weight: 6,
    status: inIntro ? 'pass' : containsKeyword(firstTenPercent, keyword) ? 'warn' : 'fail',
    message: inIntro
      ? 'The introduction uses the keyword.'
      : 'Use the keyword naturally in the first paragraph of the introduction.',
  });

  const bodyText = htmlToText(parts.sections.map((s) => s.html).join('\n'));
  const bodyKw = countKeyword(bodyText, keyword);
  add({
    id: 'keyword_in_body',
    label: 'Keyword in Article Body',
    group: 'Keyword',
    weight: 2,
    status: bodyKw > 0 ? 'pass' : 'fail',
    message: bodyKw > 0 ? `Keyword used ${bodyKw} time(s) in the body sections.` : 'The keyword does not appear in the body sections.',
  });

  const headings = $('h2, h3')
    .map((_, h) => normalizeWhitespace($(h).text()))
    .get();
  const headingsWithKw = headings.filter((h) => containsKeyword(h, keyword));
  add({
    id: 'keyword_in_heading',
    label: 'Keyword in Relevant Heading',
    group: 'Keyword',
    weight: 5,
    status: headingsWithKw.length > 0 ? 'pass' : 'fail',
    message: headingsWithKw.length
      ? `${headingsWithKw.length} heading(s) contain the keyword.`
      : 'Use the keyword in at least one relevant H2 or H3 heading.',
  });

  const { minKeywordOccurrences: min, maxKeywordOccurrences: max } = settings;
  const kc = metrics.keywordCount;
  add({
    id: 'keyword_frequency',
    label: 'Keyword Frequency',
    group: 'Keyword',
    weight: 5,
    status: kc >= min && kc <= max ? 'pass' : kc >= Math.floor(min * 0.6) && kc <= Math.ceil(max * 1.35) ? 'warn' : 'fail',
    message: `Exact keyword used ${kc} time(s). Target range: ${min}–${max}.`,
  });

  const d = metrics.keywordDensity;
  add({
    id: 'keyword_density',
    label: 'Keyword Density',
    group: 'Keyword',
    weight: 5,
    status: d >= 0.8 && d <= 2 ? 'pass' : d >= 0.5 && d <= 2.5 ? 'warn' : 'fail',
    message: `Keyword density is ${d}% (recommended 0.8%–2.0%).`,
  });

  // ── Content ───────────────────────────────────────────
  const maxWords = settings.maxArticleWordCount;
  const bw = metrics.bodyWordCount;
  add({
    id: 'word_count',
    label: 'Article Word Count',
    group: 'Content',
    weight: 6,
    status:
      metrics.wordCount < 500 || bw > maxWords * 1.25
        ? 'fail'
        : bw <= maxWords * 1.1 && bw >= Math.min(600, maxWords * 0.5)
          ? 'pass'
          : 'warn',
    message: `Main article: ${bw} words (max ${maxWords}). Full article incl. Quick Bio and FAQs: ${metrics.wordCount} words.`,
  });

  const meta = input.metaDescription ?? '';
  add({
    id: 'meta_description_length',
    label: 'Meta Description Length',
    group: 'Meta',
    weight: 5,
    status: !meta ? 'fail' : meta.length >= 140 && meta.length <= 160 ? 'pass' : meta.length >= 120 && meta.length <= 170 ? 'warn' : 'fail',
    message: meta ? `Meta description is ${meta.length} characters (target 140–160).` : 'No meta description set.',
  });

  add({
    id: 'title_length',
    label: 'Title Length',
    group: 'Meta',
    weight: 4,
    status: !seoTitle
      ? 'fail'
      : seoTitle.length >= 40 && seoTitle.length <= 60
        ? 'pass'
        : seoTitle.length >= 30 && seoTitle.length <= 70
          ? 'warn'
          : 'fail',
    message: `SEO title is ${seoTitle.length} characters (target 40–60). Article title is ${title.length} characters.`,
  });

  add({
    id: 'h2_count',
    label: 'Number of H2 Headings',
    group: 'Structure',
    weight: 4,
    status: metrics.h2Count >= 4 ? 'pass' : metrics.h2Count >= 2 ? 'warn' : 'fail',
    message: `${metrics.h2Count} H2 heading(s).`,
  });

  add({
    id: 'h3_count',
    label: 'Number of H3 Headings',
    group: 'Structure',
    weight: 2,
    status: metrics.h3Count >= 2 ? 'pass' : 'warn',
    message: `${metrics.h3Count} H3 heading(s).`,
  });

  add({
    id: 'paragraph_length',
    label: 'Paragraph Length',
    group: 'Content',
    weight: 4,
    status: metrics.longParagraphCount === 0 ? 'pass' : metrics.longParagraphCount <= 2 ? 'warn' : 'fail',
    message:
      metrics.longParagraphCount === 0
        ? `All paragraphs are under 150 words (average ${metrics.averageParagraphWords}).`
        : `${metrics.longParagraphCount} paragraph(s) exceed 150 words.`,
  });

  add({
    id: 'faq_exists',
    label: 'FAQ Exists',
    group: 'Structure',
    weight: 4,
    status: input.faqs.length >= settings.faqCount ? 'pass' : input.faqs.length > 0 ? 'warn' : 'fail',
    message: `${input.faqs.length} FAQ(s) (expected ${settings.faqCount}).`,
  });

  add({
    id: 'quick_bio_exists',
    label: 'Quick Bio Table Exists',
    group: 'Structure',
    weight: 4,
    status: input.quickBio.length >= 8 ? 'pass' : input.quickBio.length > 0 ? 'warn' : 'fail',
    message: `${input.quickBio.length} Quick Bio row(s).`,
  });

  // ── Quality ───────────────────────────────────────────
  const paragraphTexts = $('p')
    .map((_, p) => normalizeWhitespace($(p).text()).toLowerCase())
    .get()
    .filter((t) => t.length >= 40);
  const duplicates = paragraphTexts.length - new Set(paragraphTexts).size;
  add({
    id: 'duplicate_paragraphs',
    label: 'Duplicate Paragraphs',
    group: 'Quality',
    weight: 4,
    status: duplicates === 0 ? 'pass' : 'fail',
    message: duplicates === 0 ? 'No duplicate paragraphs.' : `${duplicates} duplicate paragraph(s) found.`,
  });

  const stuffedParagraphs = $('p')
    .toArray()
    .filter((p) => {
      const t = $(p).text();
      const n = countKeyword(t, keyword);
      return n >= 4 || (n >= 3 && countWords(t) < 80);
    }).length;
  const headingRatio = headings.length >= 4 ? headingsWithKw.length / headings.length : 0;
  const stuffing = d > 3 || stuffedParagraphs > 1 || kc > max * 1.6;
  add({
    id: 'keyword_stuffing',
    label: 'Keyword Stuffing',
    group: 'Quality',
    weight: 6,
    status: stuffing ? 'fail' : stuffedParagraphs === 1 || headingRatio > 0.7 ? 'warn' : 'pass',
    message: stuffing
      ? 'The keyword is overused. Replace some occurrences with pronouns or name variations.'
      : stuffedParagraphs === 1
        ? 'One paragraph repeats the keyword heavily.'
        : headingRatio > 0.7
          ? 'Most headings repeat the keyword — vary them for readability.'
          : 'No keyword stuffing detected.',
  });

  let emptyHeadings = 0;
  $('h2, h3, h4').each((_, h) => {
    const el = $(h);
    const next = el.next();
    const text = normalizeWhitespace(el.text());
    const nextIsHeadingSameOrHigher = el.is('h2') ? next.is('h2') : el.is('h3') ? next.is('h2,h3') : next.is('h2,h3,h4');
    if (!text || !next.length || nextIsHeadingSameOrHigher) emptyHeadings++;
  });
  add({
    id: 'empty_headings',
    label: 'Empty Headings',
    group: 'Structure',
    weight: 3,
    status: emptyHeadings === 0 ? 'pass' : 'fail',
    message: emptyHeadings === 0 ? 'Every heading has content beneath it.' : `${emptyHeadings} heading(s) have no content beneath them.`,
  });

  const problems = findHtmlProblems(html);
  add({
    id: 'broken_html',
    label: 'Broken HTML',
    group: 'Quality',
    weight: 5,
    status: problems.length === 0 ? 'pass' : 'fail',
    message: problems.length === 0 ? 'HTML structure is valid.' : problems.join('; '),
  });

  const listCount = $('ul, ol').length;
  add({
    id: 'formatting_lists',
    label: 'Paragraph Formatting (no lists)',
    group: 'Content',
    weight: 2,
    status: listCount === 0 ? 'pass' : 'warn',
    message: listCount === 0 ? 'Article is written in paragraphs.' : `${listCount} list(s) found in the article.`,
  });

  add({
    id: 'ai_phrases',
    label: 'AI Commentary / Phrases',
    group: 'Quality',
    weight: 2,
    status: AI_PHRASES.test(allText) ? 'warn' : 'pass',
    message: AI_PHRASES.test(allText) ? 'Obvious AI phrasing or commentary detected.' : 'No obvious AI commentary detected.',
  });

  // ── WordPress ─────────────────────────────────────────
  add({
    id: 'category_selected',
    label: 'Category Selected',
    group: 'WordPress',
    weight: 3,
    status: input.categoryName ? 'pass' : 'fail',
    message: input.categoryName ? `Category: ${input.categoryName}` : 'No WordPress category selected.',
  });
  add({
    id: 'tag_selected',
    label: 'Tag Selected',
    group: 'WordPress',
    weight: 3,
    status: input.tags.length ? 'pass' : 'fail',
    message: input.tags.length ? `Tags: ${input.tags.join(', ')}` : 'No tag set.',
  });

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight / 2 : 0), 0);
  return { score: Math.round((earned / total) * 100), checks, metrics };
}
