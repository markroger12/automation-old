// Images inside an article: reading ChatGPT's image plan and placing the body images in the HTML.
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { escapeHtml, normalizeWhitespace } from '@/lib/utils';

export interface ImagePlanItem {
  prompt: string;
  alt: string;
}

/**
 * Reads "IMAGE 1 PROMPT: … / IMAGE 1 ALT: …" lines (bold labels and bullets allowed). Missing entries are null so
 * the caller can fall back to a default description.
 */
export function parseImagePlan(text: string, count = 3): (ImagePlanItem | null)[] {
  const prompts: Record<number, string> = {};
  const alts: Record<number, string> = {};
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\*\*|__|`/g, '').replace(/^\s*[-*•]\s*/, '').trim();
    const match = /^image\s*(\d)\s*(prompt|alt(?:\s*text)?)\s*[:\-–]\s*(.+)$/i.exec(line);
    if (!match) continue;
    const index = Number(match[1]);
    // Only quotes that wrap the whole value are removed ("…text "Alo Discount Code"" keeps its own quotes).
    const value = normalizeWhitespace(match[3]).replace(/^["“„'](.*)["“”']$/s, '$1');
    if (!value) continue;
    if (/^prompt/i.test(match[2])) prompts[index] ??= value;
    else alts[index] ??= value.slice(0, 125);
  }
  return Array.from({ length: count }, (_, i) => (prompts[i + 1] ? { prompt: prompts[i + 1], alt: alts[i + 1] ?? '' } : null));
}

export interface ArticleImage {
  url: string;
  alt: string;
  /** WordPress media id — lets the block editor link the image block to the media library item. */
  id?: number | null;
  /** Shown under the image, e.g. the photographer and licence of a photo of a real person. */
  caption?: string | null;
}

export function renderImageFigure(image: ArticleImage): string {
  const idClass = image.id ? ` class="wp-image-${image.id}"` : '';
  const caption = image.caption ? `<figcaption class="wp-element-caption">${escapeHtml(image.caption)}</figcaption>` : '';
  return `<figure class="wp-block-image size-large"><img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt)}"${idClass}/>${caption}</figure>`;
}

const FAQ_HEADING = /^(frequently asked questions|faqs?|häufig gestellte fragen|häufige fragen)\b/iu;
const CONCLUSION_HEADING = /^(conclusion|final thoughts|fazit|schlussfolgerung)\b/iu;
const QUICK_BIO_HEADING = /^(quick bio|kurzbiografie|kurzbio|steckbrief)\b/iu;

/**
 * Body image 1 goes right above the article's second H2 — above the third when the section just above the second is
 * the Quick Bio (the user's rule, 27 September 2026: after the second paragraph it sat too high, above the Quick Bio).
 * It never goes above the FAQs or the conclusion; an article without such a heading keeps it after the second paragraph.
 */
function firstImageHeading($: cheerio.CheerioAPI, nodes: Element[]): Element | null {
  const headings = nodes.filter((el) => el.tagName === 'h2');
  const text = (el: Element) => normalizeWhitespace($(el).text());
  const sectionOf = (heading: Element) => {
    const start = nodes.indexOf(heading);
    const end = nodes.findIndex((el, i) => i > start && el.tagName === 'h2');
    return nodes.slice(start + 1, end < 0 ? nodes.length : end);
  };
  const isQuickBio = (heading: Element) =>
    QUICK_BIO_HEADING.test(text(heading)) || sectionOf(heading).some((el) => $(el).is('table.quick-bio-table') || $(el).find('table.quick-bio-table').length > 0);
  const target = headings[headings[0] && isQuickBio(headings[0]) ? 2 : 1];
  if (!target || FAQ_HEADING.test(text(target)) || CONCLUSION_HEADING.test(text(target))) return null;
  return target;
}

/**
 * Body image 1: see firstImageHeading. Body image 2 goes one paragraph before the FAQs (before the last paragraph
 * above the FAQ heading). Without an FAQ section the conclusion heading is used instead.
 */
export function insertArticleImages(html: string, images: ArticleImage[]): string {
  if (!images.length) return html;
  const $ = cheerio.load(html ?? '', null, false);
  const top = () => $.root().children().toArray() as Element[];

  const [first, second] = images;
  if (first) {
    const heading = firstImageHeading($, top());
    const paragraphs = top().filter((el) => el.tagName === 'p');
    const anchor = paragraphs[1] ?? paragraphs[0];
    if (heading) $(heading).before(renderImageFigure(first));
    else if (anchor) $(anchor).after(renderImageFigure(first));
    else $.root().prepend(renderImageFigure(first));
  }
  if (second) {
    const nodes = top();
    const heading = (pattern: RegExp) => nodes.findIndex((el) => el.tagName === 'h2' && pattern.test(normalizeWhitespace($(el).text())));
    let stop = heading(FAQ_HEADING);
    if (stop < 0) stop = heading(CONCLUSION_HEADING);
    if (stop < 0) stop = nodes.length;
    let target = -1;
    for (let i = stop - 1; i >= 0; i--) {
      if (nodes[i].tagName === 'p') {
        target = i;
        break;
      }
    }
    if (target >= 0) $(nodes[target]).before(renderImageFigure(second));
    else if (stop < nodes.length) $(nodes[stop]).before(renderImageFigure(second));
    else $.root().append(renderImageFigure(second));
  }
  return $.html();
}
