// Text handling for the plagiarism check: words with their place in the original text (so a match can be shown where
// it is), sentences, and the plain prose of an article or a web page.
import * as cheerio from 'cheerio';

export interface Token {
  /** Normalised word: case-folded, curly apostrophes made straight. */
  word: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;

export function normalise(text: string): string {
  return text.normalize('NFKC').replace(/[​-‍﻿­]/g, '').replace(/[‘’]/g, "'").replace(/[“”„]/g, '"');
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    tokens.push({ word: normalise(match[0]).toLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

export interface Sentence {
  text: string;
  /** Token range [from, to). */
  from: number;
  to: number;
}

/** Sentences as token ranges of `tokens` (which must come from the same text). */
export function sentenceRanges(text: string, tokens: Token[]): Sentence[] {
  const out: Sentence[] = [];
  const boundary = /[.!?…]["”’)\]]*(?=\s+["“‘(\[]?[\p{Lu}\p{N}])|\n+/gu;
  let from = 0;
  let begin = 0;
  const cut = (endChar: number) => {
    let to = from;
    while (to < tokens.length && tokens[to].start < endChar) to++;
    if (to > from) out.push({ text: text.slice(begin, endChar).trim(), from, to });
    from = to;
    begin = endChar;
  };
  for (const match of text.matchAll(boundary)) cut(match.index + match[0].length);
  cut(text.length);
  return out;
}

/** Token ranges inside quotation marks: quoting a source is not plagiarism. */
export function quotedRanges(text: string, tokens: Token[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(/[“"„]([^”"“]{2,600})[”"“]/g)) {
    const startChar = match.index;
    const endChar = match.index + match[0].length;
    const from = tokens.findIndex((t) => t.start >= startChar);
    if (from < 0) continue;
    let to = from;
    while (to < tokens.length && tokens[to].end <= endChar) to++;
    if (to > from) ranges.push([from, to]);
  }
  return ranges;
}

/** The prose of an article: paragraphs, list items and quotes; headings, tables, images and the internal link line are left out. */
export function articleText(html: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(html)) return html.replace(/^#{1,6}\s.*$/gm, '').trim();
  const $ = cheerio.load(html, null, false);
  const parts: string[] = [];
  $('p, li, blockquote').each((_, el) => {
    if ($(el).parents('li, blockquote, table').length) return;
    const node = $(el);
    // The internal link line ("Also read: <a>…</a>" in bold) and image credits are not the article's prose.
    if (node.children('strong').length === 1 && node.text().trim() === node.children('strong').text().trim() && node.find('a').length) return;
    const text = node.text().replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  });
  return parts.join('\n');
}

/** The readable text of a web page, without menus, footers, scripts and sidebars. */
export function pageText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || $('h1').first().text().trim();
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg, button, [role="navigation"], [aria-hidden="true"], .sidebar, .comments, #comments, .related, .share').remove();
  const words = (el: cheerio.Cheerio<never>) => el.text().split(/\s+/).filter(Boolean).length;
  const candidates = ['article', 'main', '[role="main"]', '.entry-content', '#content', 'body'];
  let root = $('body');
  for (const selector of candidates) {
    const el = $(selector).first() as cheerio.Cheerio<never>;
    if (el.length && words(el) >= 150) {
      root = el as never;
      break;
    }
  }
  const parts: string[] = [];
  root.find('p, li, h1, h2, h3, h4, td, blockquote, dd').each((_, el) => {
    if ($(el).parents('p, li, blockquote').length) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.split(' ').length >= 3) parts.push(text);
  });
  return { title, text: (parts.length ? parts.join('\n') : root.text().replace(/\s+/g, ' ')).trim() };
}
