import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { escapeHtml, normalizeWhitespace } from '@/lib/utils';

/** The "read next" line at the end of an article, e.g. "Das könnte Ihnen gefallen: <previous article>". */
export interface InternalLink {
  /** Text before the link, set per website (e.g. "Das könnte Ihnen gefallen:"). */
  line: string;
  url: string;
  title: string;
}

export function renderInternalLink(link: InternalLink): string {
  return `<p><strong>${escapeHtml(normalizeWhitespace(link.line))} <a href="${escapeHtml(link.url)}">${escapeHtml(normalizeWhitespace(link.title))}</a></strong></p>`;
}

type Doc = cheerio.CheerioAPI;

const meaningful = ($: Doc, el: Element) => $(el).contents().toArray().filter((n) => n.type !== 'text' || normalizeWhitespace($(n).text()) !== '');

/** The line text of a paragraph shaped like renderInternalLink's output, or null. */
function internalLinkLine($: Doc, el: Element): string | null {
  if (el.tagName !== 'p') return null;
  const children = meaningful($, el);
  if (children.length !== 1 || children[0].type !== 'tag' || (children[0] as Element).tagName !== 'strong') return null;
  const inner = meaningful($, children[0] as Element);
  const last = inner[inner.length - 1];
  if (inner.length !== 2 || inner[0].type !== 'text' || last.type !== 'tag' || (last as Element).tagName !== 'a') return null;
  if (!/^https?:\/\//i.test($(last).attr('href') ?? '')) return null;
  const line = normalizeWhitespace($(inner[0]).text());
  return line.length > 0 && line.length <= 150 ? line : null;
}

/** Takes the internal link paragraph off the end of the article body (the app always puts it last). */
export function extractInternalLink(html: string): { html: string; paragraph: string | null } {
  const $ = cheerio.load(html ?? '', null, false);
  const tags = $.root().children().toArray() as Element[];
  const last = tags[tags.length - 1];
  if (!last || !internalLinkLine($, last)) return { html: html ?? '', paragraph: null };
  const paragraph = $.html(last);
  $(last).remove();
  return { html: $.html().trimEnd(), paragraph };
}

function lineOf(paragraph: string | null): string | null {
  if (!paragraph) return null;
  const $ = cheerio.load(paragraph, null, false);
  const first = $.root().children().toArray()[0] as Element | undefined;
  return first ? internalLinkLine($, first) : null;
}

/**
 * Replaces the internal link paragraph at the end of the article with `paragraph` (`null` only removes it). Copies of
 * the same line elsewhere — e.g. moved or reformatted by ChatGPT — are removed too, so the article never has two.
 */
export function withInternalLink(html: string, paragraph: string | null): string {
  const { html: body, paragraph: old } = extractInternalLink(html);
  const lines = [lineOf(old), lineOf(paragraph)].filter((l): l is string => Boolean(l)).map((l) => l.toLowerCase());
  const $ = cheerio.load(body, null, false);
  for (const el of $.root().children().toArray() as Element[]) {
    if (el.tagName !== 'p' || $(el).find('a').length === 0) continue;
    const text = normalizeWhitespace($(el).text()).toLowerCase();
    if (lines.some((line) => text.startsWith(line))) $(el).remove();
  }
  const rest = $.html().trimEnd();
  return paragraph ? `${rest}\n${paragraph}` : rest;
}
