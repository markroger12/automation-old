// Tigram Article Writer: one ChatGPT answer carries the SEO fields, the article and the FAQ section.
import { describe, expect, it } from 'vitest';
import { assembleArticle } from '@/content/assembly';
import { parseStructuredArticle } from '@/content/structured-article';
import { TIGRAM_PROMPTS, TIGRAM_VARIABLES } from '@/modules/tigram-writer/prompts';
import { tigramWriterManifest } from '@/modules/tigram-writer/manifest';

const answer = `<p><strong>SEO TITLE:</strong> Alo Discount Code: 7 Ways to Save in 2026</p>
<p><strong>META DESCRIPTION:</strong> Looking for an Alo discount code that works? Compare every current offer and save on your next order today.</p>
<p><strong>URL SLUG:</strong> alo-discount-code</p>
<p>Finding an <strong>alo discount code</strong> that actually works is harder than it looks.</p>
<p>An Alo discount code is a promotional code you enter at checkout to lower the price of your order.</p>
<h2>Where to Find a Working Alo Discount Code</h2>
<p>Start with the official newsletter.</p>
<h3>Student and Military Offers</h3>
<p>Verification takes a minute.</p>
<h2>How to Apply the Code Step by Step</h2>
<ol><li>Add items to your bag.</li><li>Open the checkout page.</li></ol>
<h2>Frequently Asked Questions</h2>
<h3>Does Alo have a student discount?</h3>
<p>Yes. Alo offers a student discount through a verification partner, and the code is applied automatically at checkout once you are verified.</p>
<h3>Can I stack two Alo codes?</h3>
<p>No. Alo allows one promotional code per order, so pick the offer that saves the most on your basket.</p>
<h3>Do Alo codes work on sale items?</h3>
<p>Usually not. Most Alo promotional codes exclude items that are already reduced, outlet products and gift cards.</p>
<h2>Conclusion</h2>
<p>A working alo discount code is usually one newsletter away.</p>`;

describe('parseStructuredArticle', () => {
  const parsed = parseStructuredArticle(answer);

  it('reads the labelled SEO title, meta description and slug and removes those lines from the article', () => {
    expect(parsed.title).toBe('Alo Discount Code: 7 Ways to Save in 2026');
    expect(parsed.metaDescription).toBe('Looking for an Alo discount code that works? Compare every current offer and save on your next order today.');
    expect(parsed.slug).toBe('alo-discount-code');
    expect(parsed.bodyHtml).not.toContain('SEO TITLE');
    expect(parsed.bodyHtml).not.toContain('META DESCRIPTION');
    expect(parsed.bodyHtml.startsWith('<p>Finding an')).toBe(true);
  });

  it('takes the FAQ section out of the article and keeps the conclusion', () => {
    expect(parsed.faqs).toHaveLength(3);
    expect(parsed.faqs[0]).toEqual({
      question: 'Does Alo have a student discount?',
      answer: 'Yes. Alo offers a student discount through a verification partner, and the code is applied automatically at checkout once you are verified.',
    });
    expect(parsed.bodyHtml).not.toContain('Frequently Asked Questions');
    expect(parsed.bodyHtml).not.toContain('Can I stack two Alo codes?');
    expect(parsed.bodyHtml).toContain('<h2>Conclusion</h2>');
  });

  it('puts the FAQs back before the conclusion when the article is assembled', () => {
    const { html } = assembleArticle({ bodyHtml: parsed.bodyHtml, faqs: parsed.faqs, quickBio: [], subjectName: 'Alo' });
    const faqHeading = html.indexOf('Frequently Asked Questions');
    expect(faqHeading).toBeGreaterThan(html.indexOf('How to Apply the Code'));
    expect(faqHeading).toBeLessThan(html.indexOf('Conclusion'));
    expect(html).toContain('Does Alo have a student discount?');
  });

  it('also reads labels written as headings, and a slug pasted as a full URL', () => {
    const parsedHeadings = parseStructuredArticle(
      `<h3>SEO Title</h3><p>Software rcsdassk Explained</p><h3>Meta Description</h3><p>What software rcsdassk is, where it comes from and whether it is safe to install.</p>` +
        `<h3>URL Slug</h3><p>https://example.com/software-rcsdassk/</p><h2>Software rcsdassk Explained</h2><p>Intro.</p>`,
    );
    expect(parsedHeadings.title).toBe('Software rcsdassk Explained');
    expect(parsedHeadings.slug).toBe('software-rcsdassk');
    // The repeated title heading is dropped; the body starts with the real content.
    expect(parsedHeadings.bodyHtml).toBe('<p>Intro.</p>');
  });

  // Found in the first live article: ChatGPT put all three labels in one block separated by <br>.
  it('splits the three labels when they share one block', () => {
    const out = parseStructuredArticle(
      '<p><strong>SEO TITLE:</strong> Alo Discount Code: Save Up to 25%<br><strong>META DESCRIPTION:</strong> Find an Alo discount code and save today.<br>' +
        '<strong>URL SLUG:</strong> alo-discount-code</p><p>Intro paragraph.</p>',
    );
    expect(out.title).toBe('Alo Discount Code: Save Up to 25%');
    expect(out.metaDescription).toBe('Find an Alo discount code and save today.');
    expect(out.slug).toBe('alo-discount-code');
    expect(out.bodyHtml).toBe('<p>Intro paragraph.</p>');

    // Same, but written as one sentence without line breaks.
    const oneLine = parseStructuredArticle('<p>SEO TITLE: Software rcsdassk Explained META DESCRIPTION: What it is. URL SLUG: software-rcsdassk</p><p>Text.</p>');
    expect(oneLine.title).toBe('Software rcsdassk Explained');
    expect(oneLine.metaDescription).toBe('What it is.');
    expect(oneLine.slug).toBe('software-rcsdassk');
  });

  it('keeps the article unchanged when the answer has no labels or FAQ section', () => {
    const plain = '<p>Just an article.</p><h2>Section</h2><p>Text.</p>';
    const out = parseStructuredArticle(plain);
    expect(out).toMatchObject({ title: null, metaDescription: null, slug: null, faqs: [] });
    expect(out.bodyHtml.split('\n').join('')).toBe(plain);
  });
});

describe('Tigram module', () => {
  it('has a prompt for every ChatGPT stage and documents the variables the prompts use', () => {
    const promptKeys = new Set(tigramWriterManifest.prompts.map((p) => p.key));
    for (const stage of tigramWriterManifest.stages) {
      if (stage.kind === 'chatgpt') expect(promptKeys.has(stage.promptKey ?? ''), `${stage.key} has a prompt`).toBe(true);
    }
    const documented = new Set(tigramWriterManifest.variables.map((v) => v.name));
    for (const prompt of tigramWriterManifest.prompts) {
      for (const [, name] of prompt.defaultContent.matchAll(/\{\{\s*#?if\s+([a-z_]+)\s*\}\}|\{\{\s*([a-z_]+)\s*\}\}/g)) {
        if (name) expect(documented.has(name), `${prompt.key} uses {{${name}}}`).toBe(true);
      }
    }
  });
});
