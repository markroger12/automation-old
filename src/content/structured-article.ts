// Reads one ChatGPT answer that contains the whole article: labelled SEO title / meta description / slug lines,
// the article body and an FAQ section (used by the Tigram Article Writer).
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { htmlToText } from '@/lib/html/convert';
import { normalizeWhitespace } from '@/lib/utils';
import { parseFaqs, type FaqItem } from './faqs';

export interface StructuredArticle {
  title: string | null;
  metaDescription: string | null;
  slug: string | null;
  bodyHtml: string;
  faqs: FaqItem[];
}

const LABELS: { key: 'title' | 'metaDescription' | 'slug'; pattern: RegExp }[] = [
  { key: 'title', pattern: /^(?:seo\s*title|title|h1)(?:\s*\(h1\))?\s*[:\-–—]?\s*/i },
  { key: 'metaDescription', pattern: /^(?:meta\s*description|meta|description)\s*[:\-–—]?\s*/i },
  { key: 'slug', pattern: /^(?:url\s*slug|slug|permalink|url)\s*[:\-–—]?\s*/i },
];

const FAQ_HEADING = /^(?:faqs?|faq section|frequently asked questions|häufig gestellte fragen|häufige fragen)\b/iu;

/** Drops list numbering, bold markers and surrounding quotes ChatGPT adds around the labelled values. */
function clean(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/^\s*\d+[.)]\s*/, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/^["“„'‚]+|["“”'‘’]+$/g, ''),
  ).trim();
}

/** The text of one block as lines — <br> and block children count as line breaks. */
function linesOf($: cheerio.CheerioAPI, el: Element): string[] {
  const copy = cheerio.load($.html(el), null, false);
  copy('br').replaceWith('\n');
  return copy
    .root()
    .text()
    .split('\n')
    .map((line) => clean(line))
    .filter((line, index, all) => line.length > 0 || all.length === 1);
}

const ANY_LABEL = /\b(?:seo\s*title|meta\s*description|url\s*slug|permalink|slug)\s*:/gi;

/** "SEO TITLE: a META DESCRIPTION: b" → ["SEO TITLE: a", "META DESCRIPTION: b"] (all labels on one line). */
function labelSegments(line: string): string[] {
  const starts = [...line.matchAll(ANY_LABEL)].map((m) => m.index ?? 0);
  if (starts.length <= 1) return [line];
  return starts.map((start, i) => line.slice(start, starts[i + 1] ?? line.length).trim());
}

/** "Title here META DESCRIPTION: …" → "Title here" (labels sometimes end up on one line). */
function cutAtNextLabel(value: string): string {
  const next = /\b(?:seo\s*title|meta\s*description|url\s*slug|slug|permalink)\s*:/i.exec(value);
  return next ? clean(value.slice(0, next.index)) : value;
}

export function parseStructuredArticle(html: string): StructuredArticle {
  const $ = cheerio.load(html ?? '', null, false);
  const nodes = $.root().children().toArray() as Element[];
  const drop = new Set<Element>();
  const found: Record<string, string> = {};

  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (drop.has(el)) continue;
    // ChatGPT often puts all three labels in one block separated by <br>.
    const lines = linesOf($, el);
    if (!lines.length || lines.join(' ').length > 800) continue;
    let matchedLines = 0;
    for (const line of lines.flatMap(labelSegments)) {
      for (const { key, pattern } of LABELS) {
        const match = pattern.exec(line);
        if (!match || found[key]) continue;
        let value = cutAtNextLabel(clean(line.slice(match[0].length)));
        // "SEO TITLE" as a heading with the value in the next block.
        if (!value && lines.length === 1 && nodes[i + 1]) {
          value = clean($(nodes[i + 1]).text());
          if (value && value.length <= 250) drop.add(nodes[i + 1]);
          else value = '';
        }
        if (value && value.length <= 250) {
          found[key] = value;
          matchedLines++;
        }
        break;
      }
    }
    // Only drop the block when it carried nothing but those labels.
    if (matchedLines && matchedLines >= lines.filter((l) => l.length > 0).length) drop.add(el);
  }

  // The FAQ section becomes the task's FAQ list, so the app renders it with its own heading and keeps SEO checks happy.
  let faqs: FaqItem[] = [];
  const faqStart = nodes.findIndex((el) => /^h[1-4]$/.test(el.tagName) && FAQ_HEADING.test(normalizeWhitespace($(el).text())));
  if (faqStart >= 0) {
    const level = nodes[faqStart].tagName;
    let end = nodes.length;
    for (let i = faqStart + 1; i < nodes.length; i++) {
      if (/^h[1-4]$/.test(nodes[i].tagName) && nodes[i].tagName <= level) {
        end = i;
        break;
      }
    }
    const section = nodes.slice(faqStart + 1, end);
    const parsed = parseFaqs(htmlToText(section.map((n) => $.html(n)).join('\n')), 10);
    if (parsed.length >= 3) {
      faqs = parsed;
      for (const node of nodes.slice(faqStart, end)) drop.add(node);
    }
  }

  // A repeated title as the first heading (the post title already carries it).
  const first = nodes.find((n) => !drop.has(n));
  if (first && found.title && /^(h1|h2|p)$/.test(first.tagName) && clean($(first).text()).toLowerCase() === found.title.toLowerCase()) {
    drop.add(first);
  }

  const bodyHtml = nodes
    .filter((n) => !drop.has(n))
    .map((n) => $.html(n))
    .join('\n')
    .trim();

  return {
    title: found.title ?? null,
    metaDescription: found.metaDescription ?? null,
    slug: found.slug ? found.slug.replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+|\/+$/g, '') : null,
    bodyHtml,
    faqs,
  };
}
