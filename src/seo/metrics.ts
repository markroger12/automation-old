import * as cheerio from 'cheerio';
import { htmlToText } from '@/lib/html/convert';
import { escapeRegExp, normalizeWhitespace } from '@/lib/utils';

export interface ArticleMetrics {
  /** Words in the full assembled article (intro, bio table, body, FAQs, conclusion) */
  wordCount: number;
  /** Words in the main article only (without Quick Bio and FAQ sections) */
  bodyWordCount: number;
  keywordCount: number;
  /** keywordCount / wordCount × 100 (Rank Math style) */
  keywordDensity: number;
  h2Count: number;
  h3Count: number;
  paragraphCount: number;
  longParagraphCount: number;
  averageParagraphWords: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

function normalizeText(value: string): string {
  return (value ?? '').normalize('NFC').replace(/[’‘]/g, "'").replace(/ /g, ' ');
}

export function countWords(text: string): number {
  return normalizeText(text).match(WORD)?.length ?? 0;
}

/** Exact, case-insensitive, whole-phrase keyword occurrences (Unicode aware). */
export function countKeyword(text: string, keyword: string): number {
  const kw = normalizeWhitespace(normalizeText(keyword));
  if (!kw) return 0;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(kw).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`,
    'giu',
  );
  return normalizeText(text).match(pattern)?.length ?? 0;
}

export function keywordDensity(keywordCount: number, wordCount: number): number {
  if (!wordCount) return 0;
  return Math.round((keywordCount / wordCount) * 10000) / 100;
}

/** Body HTML without the Quick Bio and FAQ sections added during assembly. */
export function stripGeneratedSections(html: string): string {
  const $ = cheerio.load(html ?? '', null, false);
  let skipping = false;
  $.root()
    .children()
    .each((_, el) => {
      const node = $(el);
      if (node.is('h2')) {
        skipping = /\b(quick bio|frequently asked questions|faqs?)\b/i.test(node.text());
      }
      if (skipping) node.remove();
    });
  return $.html();
}

export function computeMetrics(html: string, keyword: string): ArticleMetrics {
  const text = htmlToText(html);
  const wordCount = countWords(text);
  const bodyWordCount = countWords(htmlToText(stripGeneratedSections(html)));
  const keywordCount = countKeyword(text, keyword);
  const $ = cheerio.load(html ?? '', null, false);
  const paragraphWords = $('p')
    .map((_, p) => countWords($(p).text()))
    .get()
    .filter((n) => n > 0);
  return {
    wordCount,
    bodyWordCount,
    keywordCount,
    keywordDensity: keywordDensity(keywordCount, wordCount),
    h2Count: $('h2').length,
    h3Count: $('h3').length,
    paragraphCount: paragraphWords.length,
    longParagraphCount: paragraphWords.filter((n) => n > 150).length,
    averageParagraphWords: paragraphWords.length
      ? Math.round(paragraphWords.reduce((a, b) => a + b, 0) / paragraphWords.length)
      : 0,
  };
}
