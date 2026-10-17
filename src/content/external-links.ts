import * as cheerio from 'cheerio';
import { Element, Text, type AnyNode } from 'domhandler';
import { append, replaceElement } from 'domutils';
import { normalizeWhitespace } from '@/lib/utils';

export interface LinkSuggestion {
  /** Words in the article that become the link text. */
  phrase: string;
  url: string;
}

export interface InsertedLink extends LinkSuggestion {
  /** The text that was actually linked (the phrase as spelled in the article). */
  anchor: string;
}

/** Removes tracking parameters ChatGPT adds (utm_source=chatgpt.com) and stray punctuation around a URL. */
export function cleanLinkUrl(raw: string): string | null {
  let trimmed = raw.trim().replace(/^<|>$/g, '');
  // Drop punctuation that follows the URL in a sentence, but keep a closing bracket that belongs to it
  // (".../The_Handmaid's_Tale_(TV_series)").
  for (;;) {
    const last = trimmed.slice(-1);
    const unbalanced = (open: string, close: string) => trimmed.split(close).length > trimmed.split(open).length;
    if ('.,;:!?"\'»”'.includes(last) || (last === ')' && unbalanced('(', ')')) || (last === ']' && unbalanced('[', ']'))) {
      trimmed = trimmed.slice(0, -1);
    } else {
      break;
    }
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}

/**
 * Reads "LINK: phrase | https://…" lines from ChatGPT's answer. Also accepts Markdown links, bullets and bold labels
 * ("- **LINK:** [phrase](url)"), because ChatGPT does not always keep the exact format.
 */
export function parseLinkSuggestions(text: string): LinkSuggestion[] {
  const out: LinkSuggestion[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\*\*|__/g, '').trim();
    if (!/^(?:[-*•]\s*|\d+[.)]\s*)?link\s*\d*\s*:/i.test(line)) continue;
    const body = line.replace(/^(?:[-*•]\s*|\d+[.)]\s*)?link\s*\d*\s*:\s*/i, '');

    let phrase = '';
    let url: string | null = null;
    const markdown = /^\[([^\]]+)\]\((\S+?)\)\s*[.,;]?\s*$/.exec(body);
    if (markdown) {
      phrase = markdown[1];
      url = cleanLinkUrl(markdown[2]);
    } else {
      const parts = body.split(/\s+\|\s+|\s*\|\s*(?=https?:\/\/|<https?:\/\/|\[)/);
      if (parts.length < 2) continue;
      phrase = parts[0];
      const target = parts.slice(1).join(' ').trim();
      const inner = /\((https?:\/\/[^)\s]+)\)/.exec(target)?.[1] ?? /(https?:\/\/\S+)/.exec(target)?.[1];
      url = inner ? cleanLinkUrl(inner) : null;
    }
    phrase = normalizeWhitespace(phrase.replace(/^["“„'‚]+|["“”'‘’]+$/g, ''));
    if (!url || phrase.length < 2 || phrase.length > 80) continue;
    const key = `${phrase.toLowerCase()}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ phrase, url });
  }
  return out;
}

const SKIP_INSIDE = new Set(['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'code', 'pre']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** At most this many external links in one paragraph (or list item), counting links already there. */
export const MAX_LINKS_PER_PARAGRAPH = 2;

const BLOCKS = new Set(['p', 'li', 'td', 'blockquote', 'dd', 'figcaption']);

export const isWikipediaUrl = (url: string) => {
  try {
    return /(^|\.)wikipedia\.org$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

export interface InsertOptions {
  /** External links allowed in one paragraph (default MAX_LINKS_PER_PARAGRAPH). */
  perParagraph?: number;
  /** Wikipedia links allowed in the whole article, so the links are not Wikipedia only. */
  wikipediaMax?: number;
}

/**
 * Links the first place in the article body where each phrase appears (paragraphs and lists, never headings or
 * existing links), in a paragraph that has room for another link. Each URL and each phrase is linked once; the
 * links that could not be placed come back in `skipped`, with the reason.
 */
export function insertExternalLinks(
  html: string,
  links: LinkSuggestion[],
  max = 5,
  options: InsertOptions = {},
): { html: string; inserted: InsertedLink[]; skipped: { link: LinkSuggestion; reason: string }[] } {
  const $ = cheerio.load(html ?? '', null, false);
  const inserted: InsertedLink[] = [];
  const skipped: { link: LinkSuggestion; reason: string }[] = [];
  const usedUrls = new Set<string>();
  const usedPhrases = new Set<string>();
  const perParagraph = options.perParagraph ?? MAX_LINKS_PER_PARAGRAPH;
  // The paragraph (or list item) around a text, and how many external links it holds.
  const blockOf = (node: AnyNode): Element | null => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type === 'tag' && BLOCKS.has((parent as Element).tagName.toLowerCase())) return parent as Element;
    }
    return null;
  };
  const linksIn = (block: Element) => $(block).find('a[href^="http"]').length;

  const textNodes = (): Text[] => {
    const nodes: Text[] = [];
    const walk = (node: AnyNode, blocked: boolean) => {
      if (node.type === 'text') {
        if (!blocked) nodes.push(node as Text);
        return;
      }
      if (node.type !== 'tag') return;
      const el = node as Element;
      const nowBlocked = blocked || SKIP_INSIDE.has(el.tagName.toLowerCase());
      for (const child of el.children) walk(child, nowBlocked);
    };
    for (const node of $.root().contents().toArray()) walk(node, false);
    return nodes;
  };

  for (const link of links) {
    if (inserted.length >= max) {
      skipped.push({ link, reason: `the article already has the most external links allowed (${max})` });
      continue;
    }
    if (usedUrls.has(link.url) || usedPhrases.has(link.phrase.toLowerCase())) continue;
    if (options.wikipediaMax !== undefined && isWikipediaUrl(link.url) && inserted.filter((l) => isWikipediaUrl(l.url)).length >= options.wikipediaMax) {
      skipped.push({ link, reason: `at most ${options.wikipediaMax} Wikipedia links per article, so the links are not Wikipedia only` });
      continue;
    }
    // Any apostrophe or dash in the phrase matches any other one in the text (’ ' ‘, - – —).
    const words = escapeRegExp(link.phrase).replace(/\s+/g, '\\s+').replace(/['’‘]/g, "['’‘]").replace(/[-–—]/g, '[-–—]');
    // Exact spelling first, then any capitalisation; never inside a longer word.
    const patterns = [new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'u'), new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'iu')];

    let done = false;
    let crowded = false;
    for (const pattern of patterns) {
      for (const node of textNodes()) {
        const match = pattern.exec(node.data);
        if (!match) continue;
        const block = blockOf(node);
        if (block && linksIn(block) >= perParagraph) {
          crowded = true;
          continue;
        }
        const before = node.data.slice(0, match.index);
        const after = node.data.slice(match.index + match[0].length);
        // Replace the text node with: text before, the link, text after.
        const anchor = new Element('a', { href: link.url, target: '_blank', rel: 'noopener noreferrer' }, [new Text(match[0])]);
        const parts: (Text | Element)[] = [...(before ? [new Text(before)] : []), anchor, ...(after ? [new Text(after)] : [])];
        replaceElement(node, parts[0]);
        for (let i = 1; i < parts.length; i++) append(parts[i - 1], parts[i]);
        inserted.push({ ...link, anchor: match[0] });
        usedUrls.add(link.url);
        usedPhrases.add(link.phrase.toLowerCase());
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) {
      skipped.push({
        link,
        reason: crowded ? `every paragraph with these words already has ${perParagraph} links` : 'the words were not found in the article text',
      });
    }
  }
  return { html: $.html(), inserted, skipped };
}
