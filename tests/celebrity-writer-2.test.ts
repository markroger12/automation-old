// Celebrity Writer 2.0: one ChatGPT answer holds the whole article plus labelled extras. The app takes it apart —
// title, article (Quick Bio and FAQs read out for the website's own layout), meta description, slug, tags — and
// never publishes the research notes.
import { describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '@/automation/pipeline/context';
import { parseWriter2Answer } from '@/modules/celebrity-writer-2/parse';
import { celebrityWriter2Pipeline } from '@/modules/celebrity-writer-2/pipeline';
import { celebrityWriter2Manifest } from '@/modules/celebrity-writer-2/manifest';
import { MODULES } from '@/modules/registry';
import { PIPELINES } from '@/modules/pipelines.server';
import { assembleArticle } from '@/content/assembly';

const paragraph = (topic: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${topic} detail ${i + 1} from public records, told plainly so the reader learns something new about the family in Fresno.`).join(' ');

/** The answer in the prompt's own OUTPUT FORMAT: numbered labels in bold, items 7–11 after the article. */
const ANSWER = `**1. H1 / Article Title**

# Who Is John Paul Sarkisian? All About Cher's Father

**2. Introduction**

John Paul Sarkisian is best known as the father of Cher. ${paragraph('Identity', 4)}

**3. Main article with H2/H3 headings**

## Who Is John Paul Sarkisian?

${paragraph('Background', 6)}

## Early Life and Family Background

${paragraph('Early life', 8)}

## Career and Professional Life

${paragraph('Career', 8)}

**4. Quick Bio table with approximately 10–13 relevant verified fields**

| Attribute | Details |
| --- | --- |
| Full Name | John Paul Sarkisian |
| Known For | Father of Cher |
| Nationality | American |
| Ethnicity | Armenian American |
| Children | Cher |

**5. Five FAQs**

### Who was John Paul Sarkisian?

He was the father of Cher.

### Was he Armenian American?

Yes, he was of Armenian descent.

### Where did he live?

He lived in California.

### Did he have other children?

Public records do not confirm other children.

### Is his birth date known?

It has not been publicly confirmed.

**6. Final Thoughts**

${paragraph('Summary', 3)}

**7. Meta Description**

Who was John Paul Sarkisian? Learn about Cher's father, his Armenian American roots, family and life in California.

**8. Suggested URL Slug**

/who-is-john-paul-sarkisian/

**9. 8–12 relevant tags separated by commas**

John Paul Sarkisian, Cher, Cher father, Armenian American, Georgia Holt

**10. Suggested internal-link anchor opportunities**

- Cher biography
- Georgia Holt
- Chaz Bono

**11. Research Notes**

- **Important facts that could not be verified:** His exact date of birth could not be verified.
- Sources differ on the year he and Georgia Holt divorced.`;

describe('reading the Celebrity Writer 2.0 answer', () => {
  it('takes the title, article and labelled extras apart', () => {
    const parsed = parseWriter2Answer(ANSWER);
    expect(parsed.title).toBe("Who Is John Paul Sarkisian? All About Cher's Father");
    expect(parsed.article.startsWith('John Paul Sarkisian is best known as the father of Cher.')).toBe(true);
    expect(parsed.article.endsWith('family in Fresno.')).toBe(true);
    expect(parsed.metaDescription).toMatch(/^Who was John Paul Sarkisian\? Learn about Cher's father/);
    expect(parsed.slug).toBe('who-is-john-paul-sarkisian');
    expect(parsed.tags).toEqual(['John Paul Sarkisian', 'Cher', 'Cher father', 'Armenian American', 'Georgia Holt']);
    expect(parsed.internalLinks).toEqual(['Cher biography', 'Georgia Holt', 'Chaz Bono']);
    expect(parsed.researchNotes).toEqual(['Important facts that could not be verified: His exact date of birth could not be verified.', 'Sources differ on the year he and Georgia Holt divorced.']);
  });

  it('drops the numbered scaffolding labels and makes the sections proper headings', () => {
    const { article } = parseWriter2Answer(ANSWER);
    for (const label of ['H1 / Article Title', 'Introduction', 'Main article', 'Five FAQs', 'relevant verified fields']) expect(article).not.toContain(label);
    expect(article).toContain('## Quick Bio\n');
    expect(article).toContain('## Frequently Asked Questions\n');
    expect(article).toContain('## Final Thoughts\n');
  });

  it('also reads labels with the value on the same line', () => {
    const parsed = parseWriter2Answer(
      '# Who Is Ann Lee?\n\nText of the article.\n\n---\n\n**Meta Description (148 characters):** A short description.\n**URL Slug:** title-slug\n**Tags:** a, b\n**Internal Links:** x; y\n**Research Notes:**\n- One note',
    );
    expect(parsed).toMatchObject({ title: 'Who Is Ann Lee?', article: 'Text of the article.', metaDescription: 'A short description.', slug: 'title-slug', tags: ['a', 'b'], internalLinks: ['x', 'y'], researchNotes: ['One note'] });
  });

  it('drops ChatGPT’s plan written before the title (Tommy Gooding, 27 September 2026)', () => {
    const parsed = parseWriter2Answer(
      'I’m verifying Tommy Gooding’s exact identity, family relationship, career, and the claims that biography sites repeat without solid sourcing. I’ll also compare the main competing pages so the finished article can correct weak or conflicting details rather than recycle them.\n\n# Who Is Tommy Gooding? All About Cuba Gooding Jr.’s Musician Brother\n\nTommy Gooding, who also uses the name Thomas Gooding professionally, is a bassist.\n\n## Early Life\nText.',
    );
    expect(parsed.title).toBe('Who Is Tommy Gooding? All About Cuba Gooding Jr.’s Musician Brother');
    expect(parsed.article.startsWith('Tommy Gooding, who also uses the name Thomas Gooding')).toBe(true);
    expect(parsed.article).not.toContain('verifying');
    // The same with a labelled title.
    expect(parseWriter2Answer('Let me check the sources first.\n\n**1. H1 / Article Title**\nWho Is Ann Lee?\n\n**2. Introduction**\nAnn Lee is a singer.').article).toBe('Ann Lee is a singer.');
  });

  it('also reads the labels written as headings', () => {
    const parsed = parseWriter2Answer('# Who Is Ann Lee?\n\nText of the article.\n\n## Meta Description\nA short description.\n\n## URL Slug\ntitle-slug\n\n## Tags\na, b\n\n## Research Notes\n- One note');
    expect(parsed).toMatchObject({ title: 'Who Is Ann Lee?', article: 'Text of the article.', metaDescription: 'A short description.', slug: 'title-slug', tags: ['a', 'b'], researchNotes: ['One note'] });
  });
});

function context(answer: { text: string; html: string }) {
  const update = vi.fn();
  const logged: string[] = [];
  const ctx = {
    taskId: 'task-2', mode: 'run', attempt: 1,
    task: { keyword: 'John Paul Sarkisian', exampleTitle: null, language: 'English', titleApprovedAt: null, secondaryKeywords: [] },
    settings: { defaultLanguage: 'English', targetCountry: 'United States', maxArticleWordCount: 1300 },
    askChatGPT: vi.fn().mockResolvedValue({ prompt: 'Article prompt', answer: { ...answer, conversationUrl: null, reusedExisting: false, durationMs: 1, files: [] } }),
    update,
    log: () => ({ info: (m: string) => logged.push(m), warn: (m: string) => logged.push(`warn ${m}`) }),
  } as unknown as PipelineContext;
  return { ctx, update, logged };
}

describe('the Research & Article stage', () => {
  const stage = celebrityWriter2Pipeline.stages[0];

  it('saves the article without its title, labels or research notes, and reads the Quick Bio and FAQs', async () => {
    const { ctx, update, logged } = context({ text: ANSWER, html: '' });
    const result = await stage.run(ctx);
    expect(ctx.askChatGPT).toHaveBeenCalledWith('ARTICLE', 'article');
    const data = update.mock.calls[0][0];
    expect(data).toMatchObject({
      selectedTitle: "Who Is John Paul Sarkisian? All About Cher's Father",
      seoTitle: null,
      slug: 'who-is-john-paul-sarkisian',
      tags: ['John Paul Sarkisian', 'Cher', 'Cher father', 'Armenian American', 'Georgia Holt'],
    });
    expect(data.metaDescription).toMatch(/^Who was John Paul Sarkisian\?/);
    expect(data.quickBio).toEqual(expect.arrayContaining([expect.objectContaining({ attribute: 'Full Name', details: 'John Paul Sarkisian' })]));
    expect(data.faqs).toHaveLength(5);
    expect(data.faqs[0]).toMatchObject({ question: 'Who was John Paul Sarkisian?', answer: 'He was the father of Cher.' });
    for (const hidden of ['META DESCRIPTION', 'URL SLUG', 'RESEARCH NOTES', 'could not be verified', 'Cher biography', '<h1']) expect(data.bodyHtml).not.toContain(hidden);
    expect(data.bodyHtml).toContain('<h2>Final Thoughts</h2>');
    expect(result).toMatchObject({ outcome: 'completed', data: { researchNotes: expect.arrayContaining(['Sources differ on the year he and Georgia Holt divorced.']) } });
    expect(logged.some((m) => m.startsWith('Research notes from ChatGPT (not published)'))).toBe(true);

    // Assembled the website's way: one Quick Bio table after the introduction, one FAQ section, Final Thoughts last.
    const { html } = assembleArticle({ locale: 'en', bodyHtml: data.bodyHtml, quickBio: data.quickBio, faqs: data.faqs, subjectName: 'John Paul Sarkisian' });
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html.match(/Frequently Asked Questions/g)).toHaveLength(1);
    expect(html.indexOf('<table')).toBeLessThan(html.indexOf('Early Life and Family Background'));
    expect(html.lastIndexOf('<h2')).toBe(html.indexOf('<h2>Final Thoughts</h2>'));
  });

  it('reads an answer that came as a rendered page the same way', async () => {
    const html = `<h1>Who Is John Paul Sarkisian? All About Cher's Father</h1><p>John Paul Sarkisian is best known as the father of Cher. ${paragraph('Identity', 30)}</p>` +
      `<h2>Final Thoughts</h2><p>${paragraph('Summary', 3)}</p><p><strong>META DESCRIPTION:</strong> A description.</p><p><strong>URL SLUG:</strong> who-is-john-paul-sarkisian</p><p><strong>RESEARCH NOTES:</strong></p><ul><li>A note.</li></ul>`;
    const { ctx, update } = context({ text: 'plain text of the page', html });
    await stage.run(ctx);
    const data = update.mock.calls[0][0];
    expect(data).toMatchObject({ selectedTitle: "Who Is John Paul Sarkisian? All About Cher's Father", metaDescription: 'A description.', slug: 'who-is-john-paul-sarkisian' });
    expect(data.bodyHtml).not.toContain('A note.');
    expect(data.bodyHtml).not.toContain('META DESCRIPTION');
  });

  it('asks again when the answer is too short to be the article', async () => {
    const { ctx } = context({ text: '# Title\n\nToo short.\n\nMETA DESCRIPTION: x', html: '' });
    await expect(stage.run(ctx)).rejects.toThrow(/only \d+ words/);
  });
});

describe('the module', () => {
  it('is listed, has its pipeline and shares the later prompts with Celebrity Writer 1.0', () => {
    expect(MODULES.find((m) => m.key === 'celebrity-writer-2')).toMatchObject({ name: 'Celebrity Writer 2.0', status: 'active' });
    expect(PIPELINES['celebrity-writer-2']).toBe(celebrityWriter2Pipeline);
    expect(celebrityWriter2Manifest.prompts.map((p) => p.key)).toEqual(['article', 'external_links', 'images', 'image_review', 'seo_correction', 'humanize']);
    expect(celebrityWriter2Pipeline.stages.map((s) => s.key)).toEqual(celebrityWriter2Manifest.stages.map((s) => s.key));
    expect(celebrityWriter2Pipeline.regenerationPlan('ARTICLE', {} as never)).toEqual(['ARTICLE', 'EXTERNAL_LINKS', 'HUMANIZE', 'ASSEMBLY', 'SEO_CHECK']);
  });
});
