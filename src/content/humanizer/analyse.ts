// The humanizer's check: measures the style signals the research doc lists (marker words, filler, transition openers,
// dashes, regular sentence rhythm, word variety, repeated phrases). It is a diagnostic for editing, not an AI detector.
import { plainText, type ArticleDocument } from './blocks';
import { OPENER_WORDS, PHRASE_SIGNALS, STOP_WORDS, WORD_SIGNALS, type SignalKind } from './lexicon';

export interface SignalHit {
  label: string;
  kind: SignalKind | 'opener' | 'dash' | 'rhythm';
  /** The words as written, for highlighting. */
  texts: string[];
  count: number;
  weight: number;
}

export interface ParagraphReport {
  /** 1-based number among the article's paragraphs. */
  number: number;
  /** Index of the block in the parsed article. */
  block: number;
  words: number;
  score: number;
  flagged: boolean;
  hits: SignalHit[];
  /** Short notes on what to fix, also sent to ChatGPT. */
  reasons: string[];
}

export interface ArticleReport {
  words: number;
  sentences: number;
  paragraphs: number;
  /** Weighted sum of every signal. */
  signals: number;
  signalsPer1000: number;
  flaggedParagraphs: number;
  sentenceLength: { mean: number; sd: number; variation: number };
  /** Moving-average type–token ratio over 50 words (0–1): higher is more varied wording. */
  wordVariety: number;
  transitionOpeners: number;
  dashes: number;
  repeatedOpenings: Array<{ word: string; count: number }>;
  repeatedPhrases: Array<{ phrase: string; count: number }>;
  topSignals: Array<{ label: string; count: number }>;
  paragraphReports: ParagraphReport[];
}

/** A paragraph with at least this much weight is sent for rewriting. */
export const FLAG_SCORE = 2;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|Prof|vs|etc|Inc|Ltd|Co|No|U\.S|U\.K|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.$/;

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?…])["”’)\]]*\s+(?=["“‘(\[]?[\p{Lu}\p{N}])/u);
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${trimmed}`;
    else out.push(trimmed);
  }
  return out;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

function openerOf(sentence: string): string | null {
  const lower = sentence.toLowerCase().replace(/^["“‘(]+/, '');
  for (const opener of OPENER_WORDS) {
    if (lower.startsWith(opener) && /^[\s,]/.test(lower.slice(opener.length))) return opener;
  }
  return null;
}

function addHit(hits: Map<string, SignalHit>, hit: Omit<SignalHit, 'count' | 'texts'> & { text: string }): void {
  const existing = hits.get(hit.label);
  if (existing) {
    existing.count += 1;
    if (!existing.texts.includes(hit.text)) existing.texts.push(hit.text);
    return;
  }
  hits.set(hit.label, { label: hit.label, kind: hit.kind, weight: hit.weight, count: 1, texts: [hit.text] });
}

const quoteList = (texts: string[]) => [...new Set(texts)].slice(0, 6).map((t) => `"${t}"`).join(', ');

/** Every signal in one paragraph of plain prose. */
export function paragraphSignals(text: string): { hits: SignalHit[]; reasons: string[]; score: number } {
  const hits = new Map<string, SignalHit>();
  const list = sentences(text);

  for (const sentence of list) {
    const opener = openerOf(sentence);
    const lead = sentence.length - sentence.replace(/^["“‘(]+/, '').length;
    if (opener) {
      addHit(hits, { label: `opens with "${opener}"`, kind: 'opener', weight: 1, text: sentence.slice(lead, lead + opener.length) });
    }
    for (const signal of WORD_SIGNALS) {
      for (const match of sentence.matchAll(signal.pattern)) {
        // A sentence-opening "Additionally" already counts as an opener.
        if (opener && match.index === lead) continue;
        addHit(hits, { label: signal.label, kind: 'word', weight: signal.weight, text: match[0] });
      }
    }
    for (const signal of PHRASE_SIGNALS) {
      for (const match of sentence.matchAll(signal.pattern)) {
        addHit(hits, { label: signal.label, kind: signal.kind, weight: signal.weight, text: match[0] });
      }
    }
  }

  const dashes = (text.match(/—|\s–\s/g) ?? []).length;
  if (dashes >= 2) hits.set('dashes', { label: `${dashes} dashes`, kind: 'dash', weight: 1, count: dashes, texts: ['—'] });

  const lengths = list.map((s) => words(s).length);
  if (lengths.length >= 4 && sd(lengths) / mean(lengths) < 0.2) {
    hits.set('rhythm', { label: 'every sentence about the same length', kind: 'rhythm', weight: 1, count: 1, texts: [] });
  }

  const all = [...hits.values()];
  const score = all.reduce((sum, hit) => sum + (hit.kind === 'dash' || hit.kind === 'rhythm' ? hit.weight : hit.weight * hit.count), 0);

  const reasons: string[] = [];
  const openers = all.filter((h) => h.kind === 'opener');
  if (openers.length) reasons.push(`sentences open with ${quoteList(openers.flatMap((h) => h.texts))}`);
  const fillers = all.filter((h) => h.kind === 'filler');
  if (fillers.length) reasons.push(`filler: ${quoteList(fillers.flatMap((h) => h.texts))}`);
  const cliches = all.filter((h) => h.kind === 'cliche');
  if (cliches.length) reasons.push(`stock phrases: ${quoteList(cliches.flatMap((h) => h.texts))}`);
  const wordsHit = all.filter((h) => h.kind === 'word').sort((a, b) => b.weight - a.weight || b.count - a.count);
  if (wordsHit.length) reasons.push(`inflated words: ${quoteList(wordsHit.flatMap((h) => h.texts))}`);
  if (hits.has('dashes')) reasons.push(`${dashes} dashes (—)`);
  if (hits.has('rhythm')) reasons.push('every sentence is about the same length');

  return { hits: all, reasons, score: round(score) };
}

/** Moving-average type–token ratio: the share of different words in every 50-word window. */
export function wordVariety(tokens: string[], window = 50): number {
  const lower = tokens.map((t) => t.toLowerCase());
  if (!lower.length) return 0;
  if (lower.length <= window) return new Set(lower).size / lower.length;
  let total = 0;
  const steps = lower.length - window + 1;
  for (let i = 0; i < steps; i++) total += new Set(lower.slice(i, i + window)).size / window;
  return total / steps;
}

function repeatedPhrases(tokens: string[], keyword?: string): Array<{ phrase: string; count: number }> {
  const keywordWords = new Set(words(keyword ?? '').map((w) => w.toLowerCase()));
  const lower = tokens.map((t) => t.toLowerCase());
  const counts = new Map<string, number>();
  for (let i = 0; i + 3 <= lower.length; i++) {
    const gram = lower.slice(i, i + 3);
    if (gram.every((w) => STOP_WORDS.has(w) || keywordWords.has(w))) continue;
    const phrase = gram.join(' ');
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([phrase, count]) => ({ phrase, count }));
}

/** The whole check for a parsed article (only paragraphs are measured; headings, lists and tables are not prose). */
export function analyseDocument(doc: ArticleDocument, keyword?: string): ArticleReport {
  const paragraphReports: ParagraphReport[] = [];
  const allTokens: string[] = [];
  const sentenceLengths: number[] = [];
  const openings = new Map<string, number>();
  const signalCounts = new Map<string, number>();
  let transitionOpeners = 0;
  let dashes = 0;
  let number = 0;

  doc.blocks.forEach((block, index) => {
    if (block.kind !== 'paragraph') return;
    number += 1;
    const text = plainText(block.text);
    const tokens = words(text);
    allTokens.push(...tokens);
    for (const sentence of sentences(text)) {
      sentenceLengths.push(words(sentence).length);
      const first = words(sentence)[0]?.toLowerCase();
      if (first) openings.set(first, (openings.get(first) ?? 0) + 1);
    }
    const { hits, reasons, score } = paragraphSignals(text);
    for (const hit of hits) {
      if (hit.kind === 'opener') transitionOpeners += hit.count;
      else if (hit.kind === 'dash') dashes += hit.count;
      else if (hit.kind !== 'rhythm') signalCounts.set(hit.label, (signalCounts.get(hit.label) ?? 0) + hit.count);
    }
    // Dashes below the paragraph limit still count for the article.
    if (!hits.some((h) => h.kind === 'dash')) dashes += (text.match(/—|\s–\s/g) ?? []).length;
    paragraphReports.push({ number, block: index, words: tokens.length, score, flagged: score >= FLAG_SCORE, hits, reasons });
  });

  const totalSentences = sentenceLengths.length;
  const signals = paragraphReports.reduce((sum, p) => sum + p.score, 0);
  const lengthMean = mean(sentenceLengths);
  const lengthSd = sd(sentenceLengths);

  return {
    words: allTokens.length,
    sentences: totalSentences,
    paragraphs: paragraphReports.length,
    signals: round(signals),
    signalsPer1000: allTokens.length ? round((signals / allTokens.length) * 1000) : 0,
    flaggedParagraphs: paragraphReports.filter((p) => p.flagged).length,
    sentenceLength: { mean: round(lengthMean), sd: round(lengthSd), variation: lengthMean ? round(lengthSd / lengthMean, 2) : 0 },
    wordVariety: round(wordVariety(allTokens), 3),
    transitionOpeners,
    dashes,
    repeatedOpenings: [...openings.entries()]
      .filter(([word, count]) => count >= 3 && count / Math.max(1, totalSentences) >= 0.08 && word !== 'the' && word !== 'a')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, count]) => ({ word, count })),
    repeatedPhrases: repeatedPhrases(allTokens, keyword),
    topSignals: [...signalCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count })),
    paragraphReports,
  };
}
