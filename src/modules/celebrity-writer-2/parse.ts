// Takes Celebrity Writer 2.0's one-answer article apart, in the prompt's own OUTPUT FORMAT:
//   1. H1 / Article Title   2. Introduction   3. Main article   4. Quick Bio table   5. Five FAQs   6. Final Thoughts
//   7. Meta Description   8. Suggested URL Slug   9. 8–12 relevant tags   10. Internal-link anchors   11. Research Notes
// ChatGPT writes these labels as headings, in bold, numbered or not, sometimes with the value on the same line.
// Items 1–6 become the article (the scaffolding labels are dropped); 7–11 are read out and never published.

export interface Writer2Answer {
  title: string | null;
  /** The article in Markdown, without its title, the scaffolding labels and items 7–11. */
  article: string;
  metaDescription: string | null;
  slug: string | null;
  tags: string[];
  internalLinks: string[];
  researchNotes: string[];
}

type Extra = 'meta' | 'slug' | 'tags' | 'links' | 'notes';

const EXTRAS: [Extra, RegExp][] = [
  ['meta', /^meta(?:\s+description)?$/i],
  ['slug', /^(?:suggested\s+)?(?:url\s+)?slug$/i],
  ['tags', /^(?:\d+\s*[–-]\s*\d+\s+)?(?:relevant\s+)?tags(?:\s+separated\s+by\s+commas)?$/i],
  ['links', /^(?:suggested\s+)?internal[\s-]*links?(?:\s+anchors?)?(?:\s+opportunit(?:y|ies))?$/i],
  ['notes', /^research\s+notes$/i],
];
const TITLE_LABEL = /^(?:h1(?:\s*\/\s*(?:article\s+)?title)?|(?:article\s+)?title)$/i;
/** Labels that only announce the next part; the part itself stays in the article. */
const SCAFFOLD = /^(?:introduction|main\s+article(?:\s+with\s+h2\s*\/\s*h3\s+headings)?)$/i;
/** Labels of parts that are article sections: they become proper ## headings. */
const SECTIONS: [RegExp, string][] = [
  [/^quick\s+bio(?:\s+table)?(?:\s+with\b.*)?$/i, 'Quick Bio'],
  [/^(?:five\s+)?(?:faqs?|frequently\s+asked\s+questions)$/i, 'Frequently Asked Questions'],
  [/^final\s+thoughts$/i, 'Final Thoughts'],
];

/** The words of a line without Markdown, numbering or a note in brackets, split at its first colon. */
function plain(line: string): { head: string; rest: string } {
  const text = line
    .replace(/[*_`]/g, '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*(?:step\s+)?\d{1,2}\s*[.):]\s*/i, '')
    .trim();
  const colon = text.indexOf(':');
  const head = (colon > 0 ? text.slice(0, colon) : text).replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return { head, rest: colon > 0 ? text.slice(colon + 1).trim() : '' };
}

/** Without quotes around it, Markdown bold or a heading mark ("**Important facts:** …" in the research notes). */
const clean = (value: string) => value.replace(/\*\*|__/g, '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/^#+\s*/, '').trim();

export function parseWriter2Answer(text: string): Writer2Answer {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const body: string[] = [];
  const extras: Record<Extra, string[]> = { meta: [], slug: [], tags: [], links: [], notes: [] };
  let extra: Extra | null = null;
  let title: string | null = null;
  let titleNext = false;
  /** How many article lines came before the title. */
  let titleAt = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    // Short lines only: a label is never a sentence of the article.
    const { head, rest } = trimmed && trimmed.length <= 160 && !trimmed.startsWith('|') ? plain(trimmed) : { head: '', rest: '' };
    const found = head ? EXTRAS.find(([, pattern]) => pattern.test(head))?.[0] : undefined;
    if (found) {
      extra = found;
      if (rest) extras[found].push(rest);
      continue;
    }
    if (extra) {
      if (trimmed && !/^(?:-{3,}|\*{3,})$/.test(trimmed)) extras[extra].push(trimmed);
      continue;
    }
    if (titleNext && trimmed) {
      title = clean(trimmed);
      titleNext = false;
      continue;
    }
    if (head && TITLE_LABEL.test(head)) {
      if (titleAt < 0) titleAt = body.length;
      if (rest) title = clean(rest);
      else titleNext = true;
      continue;
    }
    if (head && SCAFFOLD.test(head) && !rest) continue;
    const section = head && !rest ? SECTIONS.find(([pattern]) => pattern.test(head)) : undefined;
    if (section) {
      body.push(`## ${section[1]}`);
      continue;
    }
    // The article's own H1 is the title (when no labelled title came first).
    if (!title && /^#\s+\S/.test(trimmed) && !body.some((l) => /^##\s/.test(l.trim()))) {
      title = clean(trimmed);
      if (titleAt < 0) titleAt = body.length;
      continue;
    }
    body.push(line);
  }
  // A "---" left between the article and items 7–11.
  while (body.length && /^\s*(?:-{3,}|\*{3,})?\s*$/.test(body[body.length - 1])) body.pop();

  // Prose before the title is ChatGPT's plan, not the article ("I'm verifying Tommy Gooding's exact identity…", seen
  // live on 27 September 2026 as the article's first paragraph).
  if (title && titleAt > 0 && !body.slice(0, titleAt).some((l) => /^#{1,6}\s/.test(l.trim()))) body.splice(0, titleAt);

  const one = (key: Extra) => (extras[key].length ? clean(extras[key].join(' ')) : null);
  const list = (key: Extra, separator: RegExp) =>
    extras[key]
      .flatMap((entry) => entry.split(separator))
      .map((entry) => clean(entry.replace(/^[-*•]\s*|^\d+[.)]\s*/, '')))
      .filter(Boolean);
  const slug = one('slug');
  return {
    title,
    article: body.join('\n').trim(),
    metaDescription: one('meta'),
    slug: slug ? slug.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+|\/+$/g, '').toLowerCase() || null : null,
    tags: list('tags', /,/),
    internalLinks: list('links', /;|\n/),
    researchNotes: extras.notes.map((note) => clean(note.replace(/^[-*•]\s+/, ''))).filter(Boolean),
  };
}
