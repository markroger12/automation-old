// The rewrite prompt, built from the research doc's production prompt: an editorial rewrite with fixed facts, not an
// attempt to fool AI detectors. Only the paragraphs the check flagged are sent, each with what to fix in it.
import type { PromptDefinition, PromptVariableDoc } from '@/modules/types';
import type { ArticleReport } from './analyse';

export const HUMANIZER_PROMPT_VERSION = 'humanizer-v3';

/** Placeholders: {{keyword}}, {{problems}}, {{paragraphs}}. A line using {{keyword}} is left out when there is none. */
export const DEFAULT_HUMANIZER_PROMPT = `You are a senior magazine editor. Edit the numbered paragraphs below so they read like a careful human writer wrote them: natural, clear and specific. This is an editorial rewrite, not an attempt to fool AI-detection software.

Rules:
1. Keep every fact. Do not add facts, examples, statistics, quotes, sources or personal experience that are not already in the paragraph.
2. Keep every name, date, number and quotation exactly as written.
3. Links are marked like {L1}anchor text{/L1}. Keep every mark with exactly the same words inside it. Keep {b}…{/b} (bold) and {i}…{/i} (italic) marks around the same words.
4. Keep "{{keyword}}" exactly as often as it appears in each paragraph.
5. Remove filler that adds nothing, such as "It is important to note", "It is worth noting", "This highlights" or "In conclusion".
6. Do not start sentences with Additionally, Furthermore, Moreover, Notably, Overall or Ultimately. Connect sentences by meaning instead.
7. Replace inflated words (delve, pivotal, intricate, meticulous, underscore, showcase, testament, tapestry, realm, vibrant, embark, navigate, leverage, foster, crucial, remarkable, renowned, boasts) with plain words when the meaning stays the same.
8. Vary sentence length naturally: a short sentence now and then, a longer one where it helps. Do not add slang, typos or fragments on purpose.
9. Use few dashes; prefer commas or full stops.
10. Keep each paragraph about the same length (within 20%), in the same language and spelling, and as one paragraph.
11. Keep real uncertainty ("may", "reportedly", "estimated"). Do not turn a guess into a fact.

What to fix:
{{problems}}

Answer in the chat as plain text, not in a canvas or document. Give only the edited paragraphs. Put each one under the same label it has below, with the label alone on its own line, for example a line "[P4]" and the edited paragraph on the next line. No other text.

Paragraphs:
{{paragraphs}}`;

export interface PromptParagraph {
  number: number;
  text: string;
  reasons: string[];
}

/**
 * Habits of the whole article, sent with every part. The live test of 27 September 2026 showed why: told only about
 * words, ChatGPT swapped words, while 18 sentences still began with "Natalie" and every sentence stayed 11–23 words.
 */
export function articleNotes(report: ArticleReport): string[] {
  const notes: string[] = [];
  const openers = report.repeatedOpenings.filter((o) => o.count >= 5).slice(0, 3);
  if (openers.length) {
    const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    notes.push(
      `${openers.map((o) => `${o.count} sentences start with "${capital(o.word)}"`).join(', ')}: vary how sentences begin (a pronoun, a time, a place or a clause first)`,
    );
  }
  const { mean, sd, variation } = report.sentenceLength;
  if (report.sentences >= 8 && variation < 0.4) {
    notes.push(
      `most sentences are ${Math.max(1, Math.round(mean - sd))}–${Math.round(mean + sd)} words long: mix in some short sentences (under 8 words) and a few longer ones`,
    );
  }
  return notes;
}

/** What {{problems}} and {{paragraphs}} stand for in one prompt. */
export interface PromptPieces {
  problems: string;
  paragraphs: string;
}

export function promptPieces(paragraphs: PromptParagraph[], notes: string[] = []): PromptPieces {
  return {
    problems: [
      ...(notes.length ? [`All paragraphs: ${notes.join('; ')}.`] : []),
      ...paragraphs.map((p) => `P${p.number}: ${p.reasons.length ? p.reasons.join('; ') : 'make it read more naturally'}`),
    ].join('\n'),
    paragraphs: paragraphs.map((p) => `[P${p.number}]\n${p.text}`).join('\n\n'),
  };
}

export function renderHumanizerPrompt(template: string, keyword: string | undefined, paragraphs: PromptParagraph[], notes: string[] = []): string {
  const key = keyword?.trim() ?? '';
  const pieces = promptPieces(paragraphs, notes);
  return template
    .split('\n')
    .filter((line) => key || !line.includes('{{keyword}}'))
    .join('\n')
    .replaceAll('{{keyword}}', key)
    .replaceAll('{{problems}}', pieces.problems)
    .replaceAll('{{paragraphs}}', pieces.paragraphs)
    .trim();
}

/** The Humanizer stage every writer runs before the article is assembled (the user's rule, 27 September 2026). */
export const HUMANIZE_STAGE_KEY = 'HUMANIZE';
export const HUMANIZE_PROMPT_KEY = 'humanize';

/** The stage's prompt in each module's Prompt Manager; {{problems}} and {{paragraphs}} are filled in per part. */
export const HUMANIZE_PROMPT: PromptDefinition = {
  key: HUMANIZE_PROMPT_KEY,
  name: 'Humanizer Prompt',
  description:
    'Before the article is assembled, every paragraph is edited to read more naturally, in parts of about 1,200 words, each in a new chat. Keep {{problems}} and {{paragraphs}}; names, numbers, quotes, links and the keyword are checked afterwards and a paragraph that changed them stays as it was.',
  defaultContent: DEFAULT_HUMANIZER_PROMPT,
};

export const HUMANIZE_VARIABLES: PromptVariableDoc[] = [
  { name: 'problems', description: 'What to fix: the whole article’s habits and each paragraph’s signals (Humanizer only)', sample: 'P1: sentences open with "Additionally"' },
  { name: 'paragraphs', description: 'The paragraphs of this part, each under its [P#] label (Humanizer only)', sample: '[P1]\nParagraph text.' },
];

/** The edited paragraphs from ChatGPT's answer, by number. A paragraph split in two is joined again. */
export function parseRewrites(answer: string): Map<number, string> {
  const text = answer.replace(/^[ \t]*```[\w-]*[ \t]*$/gm, '');
  const label = /^[ \t]*(?:\*\*|__)?[ \t]*\[P(\d{1,3})\][ \t]*(?:\*\*|__)?[ \t]*:?[ \t]*/gm;
  const marks = [...text.matchAll(label)];
  const out = new Map<number, string>();
  marks.forEach((mark, i) => {
    const start = mark.index + mark[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const body = text
      .slice(start, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(line))
      .join(' ')
      .trim();
    if (body) out.set(Number(mark[1]), body);
  });
  return out;
}
