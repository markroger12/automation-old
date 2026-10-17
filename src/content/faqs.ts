import { escapeHtml, normalizeWhitespace } from '@/lib/utils';

export interface FaqItem {
  question: string;
  answer: string;
}

const HEADER_LINE = /^(frequently asked questions|faqs?|häufig gestellte fragen|häufige fragen)(\s+(?:about|zu|über)\s.*)?[:.]?$/iu;
const QUESTION_PREFIX = /^(?:#{1,6}\s*)?(?:\*\*)?\s*(?:(?:q(?:uestion)?|f(?:rage)?)\s*\d*\s*[:.)\-–]\s*|\d+\s*[.)]\s*)?/i;
const ANSWER_PREFIX = /^(?:\*\*)?\s*(?:(?:a(?:nswer|ntwort)?)\s*\d*\s*[:.)\-–])\s*(?:\*\*)?\s*/i;

function stripMarkdown(value: string): string {
  return normalizeWhitespace(value.replace(/\*\*|__/g, '').replace(/^[-*•]\s+/, ''));
}

/**
 * Parses FAQs from ChatGPT text output. Handles common shapes:
 *   "1. Question?\nAnswer", "**Q: Question?**\nA: Answer", "### Question?\nAnswer",
 *   "**Question?** Answer on the same line".
 */
export function parseFaqs(text: string, limit?: number): FaqItem[] {
  const items: FaqItem[] = [];
  let current: FaqItem | null = null;
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const rawLine of lines) {
    if (HEADER_LINE.test(stripMarkdown(rawLine).replace(/^#+\s*/, ''))) continue;

    const isAnswerLine = ANSWER_PREFIX.test(rawLine);
    const withoutPrefix = rawLine.replace(QUESTION_PREFIX, '');
    const qIndex = withoutPrefix.indexOf('?');

    if (!isAnswerLine && qIndex > 5) {
      const questionPart = stripMarkdown(withoutPrefix.slice(0, qIndex + 1));
      const rest = stripMarkdown(withoutPrefix.slice(qIndex + 1).replace(/^\s*\*\*/, '').replace(ANSWER_PREFIX, ''));
      const looksLikeQuestionLine =
        questionPart.length <= 220 && (rest.length === 0 || /^\*\*|^q/i.test(rawLine) || /^\d+\s*[.)]/.test(rawLine) || /^#/.test(rawLine));
      if (looksLikeQuestionLine) {
        if (current && current.answer) items.push(current);
        current = { question: questionPart, answer: rest };
        continue;
      }
    }

    if (current) {
      const answerText = stripMarkdown(rawLine.replace(ANSWER_PREFIX, ''));
      current.answer = current.answer ? `${current.answer} ${answerText}` : answerText;
    }
  }
  if (current && current.answer) items.push(current);

  const cleaned = items
    .map((i) => ({ question: i.question.trim(), answer: i.answer.trim() }))
    .filter((i) => i.question.length > 5 && i.answer.length > 1);
  return typeof limit === 'number' ? cleaned.slice(0, limit) : cleaned;
}

function inlineMarkup(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function renderFaqsHtml(faqs: FaqItem[], heading: string): string {
  if (!faqs.length) return '';
  return [
    `<h2>${escapeHtml(heading)}</h2>`,
    ...faqs.map((f) => `<h3>${escapeHtml(f.question)}</h3>\n<p>${inlineMarkup(f.answer)}</p>`),
  ].join('\n');
}
