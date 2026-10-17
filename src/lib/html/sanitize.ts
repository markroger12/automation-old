import sanitizeHtml from 'sanitize-html';

/** Allow-list sanitizer for article HTML that will be shown in the dashboard and sent to WordPress. */
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html ?? '', {
    allowedTags: [
      'h2',
      'h3',
      'h4',
      'p',
      'br',
      'strong',
      'em',
      'u',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      th: ['scope', 'colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
      table: ['class'],
    },
    allowedClasses: { table: ['quick-bio-table'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      h1: 'h2',
      h5: 'h4',
      h6: 'h4',
      b: 'strong',
      i: 'em',
      a: (tagName, attribs) => {
        const out: Record<string, string> = { href: attribs.href ?? '' };
        if (attribs.title) out.title = attribs.title;
        if (attribs.target === '_blank') {
          out.target = '_blank';
          out.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: out };
      },
    },
    exclusiveFilter: (frame) =>
      ['p', 'h2', 'h3', 'h4', 'strong', 'em'].includes(frame.tag) && !frame.text.trim() && !frame.mediaChildren?.length,
  }).trim();
}

/** Strips all markup; used for plain-text fields such as titles and FAQ answers. */
export function stripAllHtml(html: string): string {
  return sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
