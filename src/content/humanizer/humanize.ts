// Our own humanizer (Plan A from 27 September 2026): check the article locally, send only the flagged paragraphs to
// ChatGPT with what to fix in each, then keep a rewrite only when its facts survived. Asking ChatGPT is passed in, so
// the same code runs in the worker and in tests.
import { analyseDocument, type ArticleReport } from './analyse';
import { buildDocument, fromPromptMarks, LEFTOVER_MARK, parseDocument, toPromptMarks, type ArticleDocument } from './blocks';
import { checkRewrite } from './protect';
import {
  articleNotes,
  DEFAULT_HUMANIZER_PROMPT,
  HUMANIZER_PROMPT_VERSION,
  parseRewrites,
  promptPieces,
  renderHumanizerPrompt,
  type PromptParagraph,
  type PromptPieces,
} from './prompt';

export type ParagraphOutcome = 'unchanged' | 'rewritten' | 'kept-original' | 'missing';

export interface ParagraphResult {
  number: number;
  flagged: boolean;
  reasons: string[];
  original: string;
  rewritten?: string;
  outcome: ParagraphOutcome;
  problems: string[];
  warnings: string[];
}

export interface HumanizeResult {
  format: ArticleDocument['format'];
  output: string;
  before: ArticleReport;
  after: ArticleReport;
  paragraphs: ParagraphResult[];
  sent: number;
  rewritten: number;
  keptOriginal: number;
  prompts: number;
  /** Prompts ChatGPT could not answer; their paragraphs stayed as they were. */
  failedPrompts: string[];
  promptVersion: string;
}

export interface HumanizeOptions {
  input: string;
  keyword?: string;
  promptTemplate?: string;
  /** Send every paragraph, not only the flagged ones. */
  rewriteAll?: boolean;
  /**
   * Sends one prompt to ChatGPT and returns the answer text. `prompt` is the template filled in; a pipeline stage sends
   * its own module prompt with `pieces` instead.
   */
  ask: (prompt: string, part: number, parts: number, pieces: PromptPieces) => Promise<string>;
  /** Errors that end the whole run (stopped, logged out…); any other failed prompt only leaves its paragraphs as they were. */
  stopOn?: (err: unknown) => boolean;
  onProgress?: (message: string) => unknown;
  /** Paragraph words per prompt; a long article goes in several prompts in the same chat. */
  maxWordsPerPrompt?: number;
}

/** Paragraphs shorter than this are never worth a rewrite (captions, one-liners). */
const MIN_WORDS = 8;

export function batches<T extends { words: number }>(items: T[], maxWords: number): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    if (current.length && size + item.words > maxWords) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.words;
  }
  if (current.length) out.push(current);
  return out;
}

export async function humanize(options: HumanizeOptions): Promise<HumanizeResult> {
  const doc = parseDocument(options.input);
  const before = analyseDocument(doc, options.keyword);
  const template = options.promptTemplate?.trim() || DEFAULT_HUMANIZER_PROMPT;

  const results = new Map<number, ParagraphResult>();
  for (const report of before.paragraphReports) {
    results.set(report.number, {
      number: report.number,
      flagged: report.flagged,
      reasons: report.reasons,
      original: doc.blocks[report.block].text,
      outcome: 'unchanged',
      problems: [],
      warnings: [],
    });
  }

  const targets = before.paragraphReports.filter((p) => p.words >= MIN_WORDS && (options.rewriteAll || p.flagged));
  const parts = batches(targets, options.maxWordsPerPrompt ?? 1200);
  const replacements = new Map<number, string>();

  const failedPrompts: string[] = [];
  const notes = articleNotes(before);
  for (const [i, part] of parts.entries()) {
    await options.onProgress?.(`Asking ChatGPT: part ${i + 1} of ${parts.length} (${part.length} paragraph(s))`);
    const marked = new Map(part.map((p) => [p.number, toPromptMarks(doc.blocks[p.block].text)]));
    const paragraphs: PromptParagraph[] = part.map((p) => ({ number: p.number, text: marked.get(p.number)!.text, reasons: p.reasons }));
    let answer: string;
    try {
      answer = await options.ask(renderHumanizerPrompt(template, options.keyword, paragraphs, notes), i + 1, parts.length, promptPieces(paragraphs, notes));
    } catch (err) {
      if (options.stopOn?.(err) || failedPrompts.length + 1 === parts.length) throw err;
      // One failed prompt must not throw away the parts ChatGPT already answered.
      const message = (err as Error)?.message ?? String(err);
      failedPrompts.push(`Part ${i + 1}: ${message}`);
      for (const report of part) {
        const result = results.get(report.number)!;
        result.outcome = 'missing';
        result.problems = [`ChatGPT failed on this part: ${message}`];
      }
      continue;
    }
    const rewrites = parseRewrites(answer);
    for (const report of part) {
      const result = results.get(report.number)!;
      const answered = rewrites.get(report.number);
      if (!answered) {
        result.outcome = 'missing';
        result.problems = ['ChatGPT did not return this paragraph'];
        continue;
      }
      const rewritten = fromPromptMarks(answered, marked.get(report.number)!.links);
      result.rewritten = rewritten;
      const check = checkRewrite(result.original, rewritten, options.keyword);
      result.problems = LEFTOVER_MARK.test(rewritten) ? ['kept a link or bold mark that was not in the paragraph', ...check.problems] : check.problems;
      result.warnings = check.warnings;
      if (!result.problems.length) {
        result.outcome = 'rewritten';
        replacements.set(report.block, rewritten);
      } else {
        result.outcome = 'kept-original';
      }
    }
  }

  const output = replacements.size ? buildDocument(doc, replacements) : options.input;
  const after = replacements.size ? analyseDocument(parseDocument(output), options.keyword) : before;
  const paragraphs = [...results.values()];
  return {
    format: doc.format,
    output,
    before,
    after,
    paragraphs,
    sent: targets.length,
    rewritten: paragraphs.filter((p) => p.outcome === 'rewritten').length,
    keptOriginal: paragraphs.filter((p) => p.outcome === 'kept-original' || p.outcome === 'missing').length,
    prompts: parts.length,
    failedPrompts,
    promptVersion: template === DEFAULT_HUMANIZER_PROMPT ? HUMANIZER_PROMPT_VERSION : `${HUMANIZER_PROMPT_VERSION}-edited`,
  };
}
