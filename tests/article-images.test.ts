// Tigram images: ChatGPT's image plan, where the body images go, and the short featured-image title.
import { describe, expect, it } from 'vitest';
import { insertArticleImages, parseImagePlan, renderImageFigure } from '@/content/article-images';
import { featuredImageTitle } from '@/modules/tigram-writer/images';

describe('parseImagePlan', () => {
  it('reads prompts and alt texts in the formats ChatGPT uses', () => {
    const plan = parseImagePlan(
      [
        '**IMAGE 1 PROMPT:** A bold blog header with the text "Alo Discount Code"',
        '**IMAGE 1 ALT:** Alo discount code blog header',
        '- IMAGE 2 PROMPT: A minimal flat illustration of a shopping bag',
        'Image 2 alt text: Shopping bag illustration',
        'IMAGE 3 PROMPT – A flat illustration of a checkout screen',
      ].join('\n'),
    );
    expect(plan).toEqual([
      { prompt: 'A bold blog header with the text "Alo Discount Code"', alt: 'Alo discount code blog header' },
      { prompt: 'A minimal flat illustration of a shopping bag', alt: 'Shopping bag illustration' },
      { prompt: 'A flat illustration of a checkout screen', alt: '' },
    ]);
    expect(parseImagePlan('no plan here')).toEqual([null, null, null]);
  });
});

describe('insertArticleImages', () => {
  const article = [
    '<p>Intro one.</p>',
    '<p>Intro two.</p>',
    '<h2>Section</h2>',
    '<p>Body.</p>',
    '<h2>Frequently Asked Questions</h2>',
    '<h3>Question?</h3>',
    '<p>Answer.</p>',
    '<h2>Conclusion</h2>',
    '<p>End.</p>',
  ].join('');
  const images = [
    { url: 'https://site.test/wp-content/uploads/alo-discount-code-1.jpg', alt: 'Shopping bag', id: 11 },
    { url: 'https://site.test/wp-content/uploads/alo-discount-code-2.jpg', alt: 'Checkout "screen"', id: 12 },
  ];

  it('puts the first image after the second paragraph and the second one paragraph before the FAQs', () => {
    const html = insertArticleImages(article, images);
    const order = ['Intro two.', 'alo-discount-code-1.jpg', '<h2>Section</h2>', 'alo-discount-code-2.jpg', '<p>Body.</p>', 'Frequently Asked Questions'].map((part) =>
      html.indexOf(part),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<img src="https://site.test/wp-content/uploads/alo-discount-code-1.jpg" alt="Shopping bag" class="wp-image-11">');
    expect(html).toContain('alt="Checkout &quot;screen&quot;"');
  });

  // The user's rule of 27 September 2026 (Tommy Gooding: the first image sat above the Quick Bio, far too high).
  it('puts the first image above the second heading — the third when the Quick Bio is just above the second', () => {
    const withBio = [
      '<p>Intro one.</p>',
      '<p>Intro two.</p>',
      '<h2>Quick Bio of Thomas Gooding</h2>',
      '<table class="quick-bio-table"><tr><td>Name</td></tr></table>',
      '<h2>Early Life</h2>',
      '<p>Early one.</p>',
      '<p>Early two.</p>',
      '<h2>Music Career</h2>',
      '<p>Music.</p>',
      '<h2>Frequently Asked Questions</h2>',
      '<h3>Q?</h3>',
      '<p>A.</p>',
    ].join('');
    const html = insertArticleImages(withBio, images);
    expect(html).toContain('<p>Early two.</p><figure class="wp-block-image size-large"><img src="https://site.test/wp-content/uploads/alo-discount-code-1.jpg"');
    expect(html).toContain('alo-discount-code-1.jpg" alt="Shopping bag" class="wp-image-11"></figure><h2>Music Career</h2>');

    // Without a Quick Bio (a German one is recognised too): above the second heading.
    const plain = '<p>A.</p><p>B.</p><h2>One</h2><p>C.</p><h2>Two</h2><p>D.</p><h2>Fazit</h2><p>E.</p>';
    expect(insertArticleImages(plain, [images[0]])).toContain('<p>C.</p><figure');
    const german = '<p>A.</p><h2>Kurzbiografie von Jan</h2><p>Tabelle.</p><h2>Leben</h2><p>C.</p><h2>Karriere</h2><p>D.</p>';
    expect(insertArticleImages(german, [images[0]])).toContain('<p>C.</p><figure');
  });

  it('uses the conclusion when there is no FAQ section, and does nothing without images', () => {
    const noFaq = '<p>A.</p><p>B.</p><h2>Part</h2><p>C.</p><p>D.</p><h2>Conclusion</h2><p>E.</p>';
    const html = insertArticleImages(noFaq, images);
    expect(html.indexOf('alo-discount-code-2.jpg')).toBeLessThan(html.indexOf('<p>D.</p>'));
    expect(html.indexOf('alo-discount-code-2.jpg')).toBeGreaterThan(html.indexOf('<p>C.</p>'));
    expect(insertArticleImages(noFaq, [])).toBe(noFaq);
  });

  it('renders a block-editor image figure', () => {
    expect(renderImageFigure({ url: 'https://x.test/a.jpg', alt: 'A', id: null })).toBe('<figure class="wp-block-image size-large"><img src="https://x.test/a.jpg" alt="A"/></figure>');
  });
});

describe('featuredImageTitle', () => {
  it('keeps the short head of the article title', () => {
    expect(featuredImageTitle('Alo Discount Code: Save Up to 25% in September 2026')).toBe('Alo Discount Code');
    // Long titles are cut at a whole word, never with "…" on the picture.
    expect(featuredImageTitle('How Much Does the 493xds5.0 Software Cost in 2026')).toBe('How Much Does the 493xds5.0 Software Cost');
  });
});
