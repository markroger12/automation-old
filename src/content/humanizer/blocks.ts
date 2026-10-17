// Splits an article into headings, paragraphs and everything else, so only paragraph prose is ever edited. Paragraphs are
// handled as light markdown — links as [anchor](address), bold as **text** — because ChatGPT keeps that form reliably,
// and are turned back into the original HTML afterwards (a link keeps its own rel/target attributes).
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export type BlockKind = 'heading' | 'paragraph' | 'other';

export interface Block {
  kind: BlockKind;
  /** The block exactly as it came in (HTML or text). */
  source: string;
  /** Paragraphs: the prose as light markdown. Headings: their text. */
  text: string;
  /** Paragraphs from HTML: the opening <a …> tag of every link, by address. */
  links?: Record<string, string>;
}

export interface ArticleDocument {
  format: 'html' | 'text';
  blocks: Block[];
}

const HTML_HINT = /<\/?(?:p|h[1-6]|div|ul|ol|li|table|figure|img|br|strong|em|a)\b[^>]*>/i;

export function parseDocument(input: string): ArticleDocument {
  return HTML_HINT.test(input) ? parseHtml(input) : parseText(input);
}

function parseText(input: string): ArticleDocument {
  const blocks: Block[] = [];
  for (const chunk of input.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const source = chunk.trim();
    if (!source) continue;
    if (/^#{1,6}\s/.test(source)) blocks.push({ kind: 'heading', source, text: source.replace(/^#+\s*/, '') });
    else if (/^(?:[-*+]\s|\d+[.)]\s|\||>|!\[|```)/.test(source)) blocks.push({ kind: 'other', source, text: '' });
    else blocks.push({ kind: 'paragraph', source, text: source.replace(/\s*\n\s*/g, ' ') });
  }
  return { format: 'text', blocks };
}

function parseHtml(input: string): ArticleDocument {
  const $ = cheerio.load(input, null, false);
  const blocks: Block[] = [];
  for (const node of $.root().contents().toArray()) {
    const source = $.html(node) ?? '';
    if (node.type === 'text') {
      // Whitespace between blocks is kept as it is, so the rebuilt article looks the same.
      blocks.push({ kind: 'other', source, text: '' });
      continue;
    }
    if (node.type !== 'tag') {
      blocks.push({ kind: 'other', source, text: '' });
      continue;
    }
    const tag = node.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ kind: 'heading', source, text: $(node).text().trim() });
    } else if (tag === 'p' && $(node).text().trim() && !$(node).find('img, figure, iframe, video, table, ul, ol').length) {
      const links: Record<string, string> = {};
      const text = inlineMarkdown($, node, links).replace(/\s+/g, ' ').trim();
      blocks.push({ kind: 'paragraph', source, text, links });
    } else {
      blocks.push({ kind: 'other', source, text: '' });
    }
  }
  return { format: 'html', blocks };
}

function inlineMarkdown($: cheerio.CheerioAPI, parent: AnyNode, links: Record<string, string>): string {
  let out = '';
  for (const node of (parent as Element).children ?? []) {
    if (node.type === 'text') {
      out += node.data;
      continue;
    }
    if (node.type !== 'tag') continue;
    const tag = node.tagName.toLowerCase();
    const inner = inlineMarkdown($, node, links);
    if (tag === 'a' && node.attribs.href) {
      const outer = $.html(node) ?? '';
      links[node.attribs.href] = outer.slice(0, outer.indexOf('>') + 1);
      out += `[${inner}](${node.attribs.href})`;
    } else if (tag === 'strong' || tag === 'b') out += inner.trim() ? `**${inner}**` : inner;
    else if (tag === 'em' || tag === 'i') out += inner.trim() ? `*${inner}*` : inner;
    else if (tag === 'br') out += ' ';
    else out += inner;
  }
  return out;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (text: string) => escapeHtml(text).replace(/"/g, '&quot;');

function emphasis(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
}

/** [anchor](address); an address may hold one level of brackets, as Wikipedia's "Wednesday_(TV_series)" does. */
export const MARKDOWN_LINK = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/** Light markdown back to inline HTML; links the paragraph had keep their original opening tag. */
export function markdownToInlineHtml(markdown: string, links: Record<string, string> = {}): string {
  let out = '';
  let last = 0;
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    out += emphasis(escapeHtml(markdown.slice(last, match.index)));
    const [, anchor, href] = match;
    out += `${links[href] ?? `<a href="${escapeAttr(href)}">`}${emphasis(escapeHtml(anchor))}</a>`;
    last = match.index + match[0].length;
  }
  return out + emphasis(escapeHtml(markdown.slice(last)));
}

/**
 * What ChatGPT gets instead of markdown. Seen live on 27 September 2026: ChatGPT answered in a writing block (canvas),
 * which showed "[anchor](address)" as plain text and gave it back as "[anchor]\([address](address))", and "*x*" as
 * "\*x\*". Plain marks — {L1}anchor{/L1}, {b}bold{/b}, {i}italic{/i} — survive that, and the addresses never leave.
 */
export function toPromptMarks(markdown: string): { text: string; links: string[] } {
  const links: string[] = [];
  const text = markdown
    .replace(MARKDOWN_LINK, (_, anchor: string, href: string) => {
      links.push(href);
      return `{L${links.length}}${anchor}{/L${links.length}}`;
    })
    .replace(/\*\*(.+?)\*\*/g, '{b}$1{/b}')
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1{i}$2{/i}');
  return { text, links };
}

/** Marks that are still in a paragraph after turning ChatGPT's marks back (an invented or broken one). */
export const LEFTOVER_MARK = /\{\/?(?:L\d+|b|i)\}/;

/** ChatGPT's paragraph back to markdown: the canvas's backslash escapes go, marks become links and emphasis again. */
export function fromPromptMarks(text: string, links: string[]): string {
  return text
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
    .replace(/\{L(\d+)\}([\s\S]*?)\{\/L\1\}/g, (whole, n: string, anchor: string) => (links[Number(n) - 1] ? `[${anchor}](${links[Number(n) - 1]})` : whole))
    .replace(/\{b\}([\s\S]*?)\{\/b\}/g, '**$1**')
    .replace(/\{i\}([\s\S]*?)\{\/i\}/g, '*$1*');
}

/** The prose a reader sees: links become their anchor text, emphasis marks go. */
export function plainText(markdown: string): string {
  return markdown
    .replace(MARKDOWN_LINK, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/(^|\s)\*(\S)/g, '$1$2')
    .replace(/(\S)\*(?=\s|$|[.,;:!?])/g, '$1');
}

/** The article again, with the given paragraphs (by block index) replaced by new markdown. */
export function buildDocument(doc: ArticleDocument, replacements: Map<number, string>): string {
  if (doc.format === 'text') {
    return doc.blocks.map((block, index) => replacements.get(index) ?? block.source).join('\n\n');
  }
  return doc.blocks
    .map((block, index) => {
      const replacement = replacements.get(index);
      if (replacement === undefined) return block.source;
      const opening = block.source.slice(0, block.source.indexOf('>') + 1);
      return `${opening}${markdownToInlineHtml(replacement, block.links)}</p>`;
    })
    .join('');
}
