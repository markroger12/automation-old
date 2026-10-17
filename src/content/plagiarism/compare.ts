// Compares an article with one source, as the user's research doc (27 September 2026) lays out: cheap 5-word anchors
// find where the texts meet, exact runs of 8+ words are the verbatim evidence, and a word-level edit distance on
// sentences catches lightly edited copies. Quoted text and phrases common to many of the user's own articles are
// shown but not counted. The result is evidence to review, never a verdict.
import { quotedRanges, sentenceRanges, tokenize, type Sentence, type Token } from './text';

export const ANCHOR = 5;
/** A verbatim run shorter than this is ordinary language (the doc's "≥8–12 consecutive words"). */
export const MIN_RUN = 8;
/** Words other than function words a verbatim run must hold to count. */
export const MIN_CONTENT_WORDS = 4;
/** Word-level similarity from which a sentence counts as a close copy. */
export const NEAR_SIMILARITY = 0.8;

const STOP = new Set(
  'a an the and or but if of to in on at by for with from as into is are was were be been has have had do does did it its he she they his her their this that these those not no also who which what when where than then so such very can could would will may one two same more most other about there der die das und oder ist sind war mit von zu im in den dem des ein eine auf für nicht auch sich'.split(' '),
);

export interface PreparedText {
  text: string;
  tokens: Token[];
  sentences: Sentence[];
  /** 5-word anchor → token positions. */
  grams: Map<string, number[]>;
}

export function gramAt(tokens: Token[], i: number, k = ANCHOR): string {
  let key = tokens[i].word;
  for (let j = 1; j < k; j++) key += ` ${tokens[i + j].word}`;
  return key;
}

export function prepare(text: string): PreparedText {
  const tokens = tokenize(text);
  const grams = new Map<string, number[]>();
  for (let i = 0; i + ANCHOR <= tokens.length; i++) {
    const key = gramAt(tokens, i);
    const list = grams.get(key);
    if (list) list.push(i);
    else grams.set(key, [i]);
  }
  return { text, tokens, sentences: sentenceRanges(text, tokens), grams };
}

export interface MatchSpan {
  /** Token range in the article. */
  from: number;
  to: number;
  /** Token range in the source. */
  sourceFrom: number;
  sourceTo: number;
  kind: 'exact' | 'near';
  /** 1 for an exact run; the edit similarity for a close copy. */
  similarity: number;
  /** Inside quotation marks in the article. */
  quoted: boolean;
  /** Made only of phrases many of the user's own articles share (template text). */
  boilerplate: boolean;
}

export interface Comparison {
  spans: MatchSpan[];
  /** Article words covered by counted (not quoted, not boilerplate) matches. */
  copiedWords: number;
  share: number;
  /** Share of the article's 5-word phrases that are in the source. */
  containment: number;
  /** Jaccard of the two texts' 5-word phrase sets. */
  jaccard: number;
}

export interface CompareOptions {
  /** 5-word phrases that are template text across the user's own articles. */
  common?: Set<string>;
  quoted?: Array<[number, number]>;
}

/** Word-level edit similarity: 1 − distance / longer length. */
export function editSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function inside(ranges: Array<[number, number]>, from: number, to: number): boolean {
  let covered = 0;
  for (const [a, b] of ranges) covered += Math.max(0, Math.min(to, b) - Math.max(from, a));
  return covered >= (to - from) * 0.8;
}

function exactRuns(article: PreparedText, source: PreparedText): Array<Pick<MatchSpan, 'from' | 'to' | 'sourceFrom' | 'sourceTo'>> {
  const a = article.tokens;
  const s = source.tokens;
  const runs: Array<Pick<MatchSpan, 'from' | 'to' | 'sourceFrom' | 'sourceTo'>> = [];
  for (let i = 0; i + ANCHOR <= a.length; ) {
    const positions = source.grams.get(gramAt(a, i));
    let best = 0;
    let at = -1;
    for (const p of positions?.slice(0, 200) ?? []) {
      let length = ANCHOR;
      while (i + length < a.length && p + length < s.length && a[i + length].word === s[p + length].word) length++;
      if (length > best) {
        best = length;
        at = p;
      }
    }
    if (best >= MIN_RUN) {
      runs.push({ from: i, to: i + best, sourceFrom: at, sourceTo: at + best });
      i += best;
    } else {
      i++;
    }
  }
  return runs;
}

function contentWords(tokens: Token[], from: number, to: number): string[] {
  return tokens.slice(from, to).map((t) => t.word).filter((w) => w.length > 2 && !STOP.has(w));
}

export function compareTexts(article: PreparedText, source: PreparedText, options: CompareOptions = {}): Comparison {
  const common = options.common ?? new Set<string>();
  const quoted = options.quoted ?? quotedRanges(article.text, article.tokens);
  // A run of everyday words ("it does not have the same level of", seen live on Tommy Gooding) is ordinary English,
  // not copying: a verbatim run needs at least MIN_CONTENT_WORDS real words.
  const runs = exactRuns(article, source).filter((run) => contentWords(article.tokens, run.from, run.to).length >= MIN_CONTENT_WORDS);
  const spans: MatchSpan[] = runs.map((run) => {
    let commonGrams = 0;
    for (let i = run.from; i + ANCHOR <= run.to; i++) if (common.has(gramAt(article.tokens, i))) commonGrams++;
    return {
      ...run,
      kind: 'exact',
      similarity: 1,
      quoted: inside(quoted, run.from, run.to),
      boilerplate: commonGrams >= (run.to - run.from - ANCHOR + 1) * 0.8,
    };
  });

  const covered = new Uint8Array(article.tokens.length);
  for (const span of spans) covered.fill(1, span.from, span.to);

  // Close copies: sentences that share most of their words with one source sentence.
  const index = new Map<string, Set<number>>();
  source.sentences.forEach((sentence, n) => {
    for (const word of contentWords(source.tokens, sentence.from, sentence.to)) {
      const set = index.get(word);
      if (set) set.add(n);
      else index.set(word, new Set([n]));
    }
  });
  for (const sentence of article.sentences) {
    const length = sentence.to - sentence.from;
    if (length < MIN_RUN) continue;
    let already = 0;
    for (let i = sentence.from; i < sentence.to; i++) already += covered[i];
    if (already >= length * 0.5) continue;
    const words = new Set(contentWords(article.tokens, sentence.from, sentence.to));
    if (words.size < 4) continue;
    const shared = new Map<number, number>();
    for (const word of words) for (const n of index.get(word) ?? []) shared.set(n, (shared.get(n) ?? 0) + 1);
    const candidates = [...shared.entries()].filter(([, count]) => count >= words.size * 0.5).sort((x, y) => y[1] - x[1]).slice(0, 5);
    const mine = article.tokens.slice(sentence.from, sentence.to).map((t) => t.word);
    let best: { n: number; similarity: number } | null = null;
    for (const [n] of candidates) {
      const other = source.sentences[n];
      const theirs = source.tokens.slice(other.from, other.to).map((t) => t.word);
      if (theirs.length < mine.length * 0.6 || theirs.length > mine.length * 1.6) continue;
      const similarity = editSimilarity(mine, theirs);
      if (similarity >= NEAR_SIMILARITY && (!best || similarity > best.similarity)) best = { n, similarity };
    }
    if (!best) continue;
    const other = source.sentences[best.n];
    spans.push({
      from: sentence.from,
      to: sentence.to,
      sourceFrom: other.from,
      sourceTo: other.to,
      kind: 'near',
      similarity: Math.round(best.similarity * 100) / 100,
      quoted: inside(quoted, sentence.from, sentence.to),
      boilerplate: false,
    });
  }
  spans.sort((x, y) => x.from - y.from);

  const counted = new Uint8Array(article.tokens.length);
  for (const span of spans) if (!span.quoted && !span.boilerplate) counted.fill(1, span.from, span.to);
  const copiedWords = counted.reduce((sum, v) => sum + v, 0);

  let shared = 0;
  for (const key of article.grams.keys()) if (source.grams.has(key)) shared++;
  const union = article.grams.size + source.grams.size - shared;
  return {
    spans,
    copiedWords,
    share: article.tokens.length ? copiedWords / article.tokens.length : 0,
    containment: article.grams.size ? shared / article.grams.size : 0,
    jaccard: union ? shared / union : 0,
  };
}

/** 5-word phrases that appear in many of the user's own articles: their template text, which never counts as copying. */
export function commonPhrases(texts: PreparedText[], minShare = 0.1, minDocs = 4): Set<string> {
  const df = new Map<string, number>();
  for (const text of texts) for (const key of text.grams.keys()) df.set(key, (df.get(key) ?? 0) + 1);
  const limit = Math.max(minDocs, Math.ceil(texts.length * minShare));
  return new Set([...df.entries()].filter(([, count]) => count >= limit).map(([key]) => key));
}
