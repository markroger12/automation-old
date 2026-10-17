import * as cheerio from 'cheerio';
import { marked } from 'marked';

/** Converts Markdown (as ChatGPT sometimes returns inside code blocks) to HTML. */
export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown ?? '', { async: false, gfm: true, breaks: false }) as string;
}

export function looksLikeHtml(text: string): boolean {
  return /<\s*(p|h[1-6]|table|tr|td|th|ul|ol|li|strong|em|div|section|article)\b[^>]*>/i.test(text);
}

export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s{0,3}(#{1,6}\s|\|.+\|)|\*\*[^*\n]+\*\*/.test(text);
}

const BLOCK_TAGS = 'p,h1,h2,h3,h4,h5,h6,li,tr,blockquote,div,section,article,table,thead,tbody,ul,ol';

/** HTML -> readable plain text with paragraph breaks preserved. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html ?? '', null, false);
  $('script,style').remove();
  $('br').replaceWith('\n');
  $('td,th').each((_, el) => {
    $(el).append(' ');
  });
  $(BLOCK_TAGS).each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  return $.root()
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * HTML -> compact Markdown. Used when article text must be sent back to ChatGPT
 * (context primers, SEO correction prompts) so headings survive the round trip.
 */
export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html ?? '', null, false);
  const lines: string[] = [];
  const inline = (el: Parameters<typeof $>[0]) => {
    const clone = $(el).clone();
    clone.find('strong,b').each((_, s) => {
      $(s).replaceWith(`**${$(s).text()}**`);
    });
    clone.find('em,i').each((_, s) => {
      $(s).replaceWith(`*${$(s).text()}*`);
    });
    clone.find('br').replaceWith(' ');
    return clone.text().replace(/\s+/g, ' ').trim();
  };
  $.root()
    .children()
    .each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase();
      if (!tag) return;
      if (tag === 'h1' || tag === 'h2') lines.push(`## ${$(el).text().trim()}`);
      else if (tag === 'h3') lines.push(`### ${$(el).text().trim()}`);
      else if (tag === 'h4') lines.push(`#### ${$(el).text().trim()}`);
      else if (tag === 'table') {
        $(el)
          .find('tr')
          .each((i, tr) => {
            const cells = $(tr)
              .find('th,td')
              .map((__, c) => $(c).text().trim().replace(/\|/g, '/'))
              .get();
            lines.push(`| ${cells.join(' | ')} |`);
            if (i === 0) lines.push(`|${cells.map(() => ' --- ').join('|')}|`);
          });
      } else if (tag === 'ul' || tag === 'ol') {
        $(el)
          .children('li')
          .each((i, li) => {
            lines.push(`${tag === 'ol' ? `${i + 1}.` : '-'} ${inline(li)}`);
          });
      } else {
        const text = inline(el);
        if (text) lines.push(text);
      }
      lines.push('');
    });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
