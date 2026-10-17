import * as cheerio from 'cheerio';
import { looksLikeHtml, looksLikeMarkdown, markdownToHtml } from '@/lib/html/convert';
import { sanitizeArticleHtml } from '@/lib/html/sanitize';
import { normalizeWhitespace } from '@/lib/utils';

const LEADING_COMMENTARY =
  /^(sure|certainly|absolutely|of course|great|okay|ok|alright|got it|here(?:'|’)s|here is|here are|below is|below are|i(?:'|’)ve (?:rewritten|created|written|optimized|revised|prepared|updated)|i have (?:rewritten|created|written|optimized|revised|prepared|updated)|this (?:version|article|rewrite) (?:is|has|keeps))\b/i;

const TRAILING_COMMENTARY =
  /^(i hope|hope this|let me know|feel free|if you(?:'|’)d like|if you want|would you like|do you want|want me to|shall i|i can also|need any|happy to help|word count|total word count|\(word count)/i;

const AI_COMMENT_ANYWHERE = /^(\(?word count\s*[:\-–]|\(?approx(?:\.|imately)? \d[\d,]* words\)?$)/i;

export function normalizeForCompare(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[“”"'’‘`*_#]/g, '')
    .replace(/[.:!?]+$/g, '')
    .trim();
}

/** Does a text block look like AI small talk rather than article content? */
export function isCommentary(text: string, position: 'leading' | 'trailing'): boolean {
  const t = normalizeWhitespace(text);
  if (!t) return true;
  if (AI_COMMENT_ANYWHERE.test(t)) return true;
  if (position === 'leading') return t.length < 200 && LEADING_COMMENTARY.test(t);
  return t.length < 320 && TRAILING_COMMENTARY.test(t);
}

/**
 * ChatGPT's writing-document ("canvas") marks as they come in the conversation data — `:::writing{variant="document"
 * id="68431" title="…"}` on the line before the text and `:::` on the line after it. Seen on 26 September 2026 in the
 * articles of justin biel, Lola Simone Rock and Jordan Rock, where they were published as text.
 */
const DIRECTIVE_OPEN = /^[ \t]*:{3,}[A-Za-z][\w-]*(?:\{[^}\n]*\})?[ \t]*/;

/** Removes those marks from answer text (Markdown), keeping everything between them. */
export function stripChatGPTDirectives(text: string): string {
  if (!text?.includes(':::')) return text ?? '';
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*:{3,}\s*$/.test(line)) continue;
    if (DIRECTIVE_OPEN.test(line)) {
      const rest = line.replace(DIRECTIVE_OPEN, '');
      if (rest.trim()) lines.push(rest);
      continue;
    }
    // A closing mark that ended up on the same line as the last sentence.
    lines.push(line.replace(/[ \t]+:{3,}[ \t]*$/, ''));
  }
  return lines.join('\n');
}

/** The same for HTML made from such text: the opening mark may even carry a link that was put into its title. */
export function stripChatGPTDirectivesHtml(html: string): string {
  if (!html?.includes(':::')) return html ?? '';
  return html
    .replace(/:{3,}[A-Za-z][\w-]*\{[^}]*\}[ \t]*(?:\r?\n|<br\s*\/?>)?/g, '')
    .replace(/(?:\s|<br\s*\/?>)*:{3,}(?=\s*<\/(?:p|li|td|h[1-6]|blockquote)>)/g, '')
    .replace(/<p>\s*<\/p>/g, '');
}

/**
 * Turns the innerHTML of a ChatGPT answer (or plain Markdown text) into clean article HTML:
 * unwraps code fences, removes UI chrome and AI commentary, normalises heading levels,
 * and applies the article sanitizer.
 */
export function cleanChatGPTHtml(raw: string, options: { title?: string | null; fallbackText?: string | null } = {}): string {
  let source = stripChatGPTDirectivesHtml(raw ?? '');
  if (!source.trim() && options.fallbackText) source = markdownToHtml(stripChatGPTDirectives(options.fallbackText));
  if (!looksLikeHtml(source) && looksLikeMarkdown(source)) source = markdownToHtml(source);

  const $ = cheerio.load(source, null, false);

  // ChatGPT "writing block" answers (document-style): keep the text, drop its title bar and follow-up suggestions.
  $('[data-testid="writing-block-header-sticky-container"], [data-testid="writing-block-suggested-followups"]').remove();
  // Web-search source pills ("Biography +1") that ChatGPT places inline.
  $('[data-testid="webpage-citation-pill"]').remove();

  // UI chrome that can leak from the ChatGPT DOM.
  $('button, svg, style, script, noscript, img, sup, [aria-hidden="true"], .sr-only').remove();

  // Code blocks: ChatGPT wraps HTML/Markdown output in fences when asked for "HTML".
  $('pre').each((_, pre) => {
    const code = $(pre).find('code').first();
    const text = (code.length ? code.text() : $(pre).text()).trim();
    if (!text) {
      $(pre).remove();
    } else if (looksLikeHtml(text)) {
      $(pre).replaceWith(text);
    } else {
      $(pre).replaceWith(markdownToHtml(text));
    }
  });

  // Inline <code> is never wanted inside article prose.
  $('code').each((_, el) => {
    $(el).replaceWith($(el).text());
  });

  // Flatten wrapper elements.
  for (let i = 0; i < 5; i++) {
    const wrappers = $('div, section, article, span, main, header, footer');
    if (!wrappers.length) break;
    wrappers.each((_, el) => {
      $(el).replaceWith($(el).contents());
    });
  }
  $('hr').remove();

  // Paragraphs that still contain raw Markdown headings.
  $('p').each((_, p) => {
    const text = $(p).text().trim();
    const m = /^(#{1,4})\s+(.+)$/.exec(text);
    if (m) {
      const level = m[1].length <= 2 ? 'h2' : 'h3';
      $(p).replaceWith(`<${level}>${cheerio.load(m[2], null, false).text()}</${level}>`);
    }
  });

  // Heading normalisation.
  const titleNorm = options.title ? normalizeForCompare(options.title) : null;
  $('h1').each((index, h) => {
    const text = normalizeForCompare($(h).text());
    if (index === 0 && (!titleNorm || text === titleNorm || titleNorm.includes(text) || text.includes(titleNorm))) {
      $(h).remove();
    } else {
      h.tagName = 'h2';
    }
  });
  if ($('h2').length === 0 && $('h3').length > 0) {
    $('h3').each((_, h) => {
      h.tagName = 'h2';
    });
    $('h4').each((_, h) => {
      h.tagName = 'h3';
    });
  }
  $('h5, h6').each((_, h) => {
    h.tagName = 'h4';
  });
  // Headings should be plain text (bold inside headings is noise).
  $('h2, h3, h4').each((_, h) => {
    $(h).text(normalizeWhitespace($(h).text()).replace(/^\*\*|\*\*$/g, ''));
  });
  // Remove a leading H2 or paragraph that just repeats the article title.
  const firstBlock = $.root().children().first();
  if (titleNorm && firstBlock.is('h2, p') && normalizeForCompare(firstBlock.text()) === titleNorm) {
    firstBlock.remove();
  }

  // Leading and trailing AI commentary.
  const top = () => $.root().children().first();
  for (let i = 0; i < 3; i++) {
    const el = top();
    if (el.length && el.is('p') && isCommentary(el.text(), 'leading')) el.remove();
    else break;
  }
  const bottom = () => $.root().children().last();
  for (let i = 0; i < 3; i++) {
    const el = bottom();
    if (el.length && el.is('p') && isCommentary(el.text(), 'trailing')) el.remove();
    else break;
  }
  $('p').each((_, p) => {
    if (AI_COMMENT_ANYWHERE.test(normalizeWhitespace($(p).text()))) $(p).remove();
  });

  return sanitizeArticleHtml($.html());
}
