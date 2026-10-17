import { describe, expect, it } from 'vitest';
import { assembleArticle, splitArticle } from '@/content/assembly';
import { cleanChatGPTHtml, stripChatGPTDirectives, stripChatGPTDirectivesHtml } from '@/content/cleanup';
import { parseFaqs } from '@/content/faqs';
import { parseQuickBio } from '@/content/quick-bio';
import { extractTitles } from '@/content/titles';

describe('extractTitles', () => {
  it('extracts options and the explicit recommendation', () => {
    const text = `Here are some title ideas:

1. "Sydney Sweeney: Age, Career, Family and Net Worth"
2. **Sydney Sweeney Biography: Early Life, Movies and Relationships**
3. Who Is Sydney Sweeney? Age, Height, Career and Latest News

The strongest option is the first one because it is concise.

Recommended Title: Sydney Sweeney: Age, Career, Family and Net Worth`;
    const { options, recommended } = extractTitles(text);
    expect(options).toHaveLength(3);
    expect(options[1]).toBe('Sydney Sweeney Biography: Early Life, Movies and Relationships');
    expect(recommended).toBe('Sydney Sweeney: Age, Career, Family and Net Worth');
  });

  it('handles a recommendation label on its own line', () => {
    const text = `1. Title One About Jenna Ortega Career
2. Jenna Ortega Age and Biography Explained

**Best title to use:**
"Jenna Ortega Age and Biography Explained"`;
    expect(extractTitles(text).recommended).toBe('Jenna Ortega Age and Biography Explained');
  });

  it('falls back to the first option', () => {
    expect(extractTitles('- Emma Myers Age, Career and Net Worth Guide\n- Another Emma Myers Title Here').recommended).toBe(
      'Emma Myers Age, Career and Net Worth Guide',
    );
  });
});

describe('parseFaqs', () => {
  it('parses numbered questions with answers on the next line', () => {
    const faqs = parseFaqs(`Frequently Asked Questions

1. How old is Sydney Sweeney?
Sydney Sweeney was born on September 12, 1997.

2. Where was Sydney Sweeney born?
She was born in Spokane, Washington.`);
    expect(faqs).toEqual([
      { question: 'How old is Sydney Sweeney?', answer: 'Sydney Sweeney was born on September 12, 1997.' },
      { question: 'Where was Sydney Sweeney born?', answer: 'She was born in Spokane, Washington.' },
    ]);
  });

  it('parses Q:/A: and bold same-line formats and respects the limit', () => {
    const faqs = parseFaqs(
      `**Q: Is she married?**\nA: She has not publicly confirmed a marriage.\n**What is her net worth?** Estimates suggest around $40 million.\n### Does she have siblings?\nYes, a younger brother.`,
      2,
    );
    expect(faqs).toHaveLength(2);
    expect(faqs[0]).toEqual({ question: 'Is she married?', answer: 'She has not publicly confirmed a marriage.' });
    expect(faqs[1]).toEqual({ question: 'What is her net worth?', answer: 'Estimates suggest around $40 million.' });
  });
});

describe('parseQuickBio', () => {
  it('reads a rendered HTML table', () => {
    const rows = parseQuickBio(
      '<table><thead><tr><th>Attribute</th><th>Details</th></tr></thead><tbody><tr><td>Full Name</td><td>Sydney Bernice Sweeney</td></tr><tr><td>Height</td><td>Not publicly confirmed</td></tr></tbody></table>',
      '',
    );
    expect(rows).toEqual([
      { attribute: 'Full Name', details: 'Sydney Bernice Sweeney' },
      { attribute: 'Height', details: 'Not publicly confirmed' },
    ]);
  });

  it('reads HTML inside a code block and Markdown tables', () => {
    const fromCode = parseQuickBio('<pre><code>&lt;table&gt;&lt;tr&gt;&lt;td&gt;Profession&lt;/td&gt;&lt;td&gt;Actress&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</code></pre>', '');
    expect(fromCode).toEqual([{ attribute: 'Profession', details: 'Actress' }]);
    const fromMd = parseQuickBio('', '| Attribute | Details |\n|---|---|\n| **Nationality** | American |\n| Known As | Syd |');
    expect(fromMd).toEqual([
      { attribute: 'Nationality', details: 'American' },
      { attribute: 'Known As', details: 'Syd' },
    ]);
  });
});

describe('cleanChatGPTHtml', () => {
  it('removes AI commentary, title H1, UI chrome and unwraps code fences', () => {
    const raw = `<p>Certainly! Here is your article:</p>
<h1>Sydney Sweeney Age and Career</h1>
<p>Sydney Sweeney is an American actress.</p>
<h2>Early Life</h2><p>She grew up in Spokane. <button>Copy</button></p>
<pre><div>markdown<button>Copy code</button></div><code>## Career\n\nHer breakout came with **Euphoria**.</code></pre>
<p>I hope this helps! Let me know if you want changes.</p>`;
    const html = cleanChatGPTHtml(raw, { title: 'Sydney Sweeney Age and Career' });
    expect(html).not.toMatch(/Certainly|hope this helps|<h1|button|Copy code|<pre/);
    expect(html).toContain('<h2>Early Life</h2>');
    expect(html).toContain('<h2>Career</h2>');
    expect(html).toContain('<strong>Euphoria</strong>');
    expect(html.startsWith('<p>Sydney Sweeney is an American actress.</p>')).toBe(true);
  });

  it('promotes H3-only articles and strips scripts', () => {
    const html = cleanChatGPTHtml('<p>Intro text here.</p><h3>Section</h3><p>Body<script>alert(1)</script></p>');
    expect(html).toContain('<h2>Section</h2>');
    expect(html).not.toContain('script');
  });
});

describe('cleanChatGPTHtml with ChatGPT writing blocks', () => {
  it('keeps the article text and drops the writing block title bar and follow-up chips', () => {
    const raw = `<div data-writing-block-fullscreen-fallback-target="inline"><div data-testid="writing-block-container" data-writing-block="true">
      <div data-testid="writing-block-header-sticky-container"><div><span>Who Is Melissa Esplana? All About Dusty Baker’s Wife</span></div><button aria-label="Copy">Copy</button></div>
      <div class="writing-block-editor"><div class="ProseMirror markdown" data-writing-block-fullscreen-editor-region="true" contenteditable="true">
        <p>Melissa Esplana is best known as the longtime wife of Dusty Baker.</p><h2>Early Life</h2><p>She keeps a private life.</p>
      </div></div></div></div>
      <div data-testid="writing-block-suggested-followups"><button>Make it shorter</button><span>Add a table</span></div>`;
    const html = cleanChatGPTHtml(raw, { title: 'Who Is Melissa Esplana? All About Dusty Baker’s Wife' });
    expect(html.startsWith('<p>Melissa Esplana is best known')).toBe(true);
    expect(html).toContain('<h2>Early Life</h2>');
    expect(html).not.toContain('All About Dusty Baker’s Wife');
    expect(html).not.toContain('Add a table');
  });

  it('removes a first paragraph that only repeats the title', () => {
    const html = cleanChatGPTHtml('<p>Sydney Sweeney Age and Career</p><p>Sydney Sweeney is an actress.</p>', { title: 'Sydney Sweeney Age and Career' });
    expect(html).toBe('<p>Sydney Sweeney is an actress.</p>');
  });
});

describe('ChatGPT writing-document marks (seen live on 26 September 2026)', () => {
  // As the conversation data brought the final article and the FAQs of justin biel.
  const article = [
    ':::writing{variant="document" id="68431" title="Who Is Justin Biel? All About Jessica Biel’s Brother"}',
    'Justin Biel is best known as the younger brother of actress Jessica Biel.',
    '',
    '## Conclusion',
    '',
    'His professional work shows a clear pattern of entrepreneurship.',
    ':::',
  ].join('\n');

  it('removes the opening and closing marks from the answer text and keeps the article', () => {
    expect(stripChatGPTDirectives(article)).toBe(
      'Justin Biel is best known as the younger brother of actress Jessica Biel.\n\n## Conclusion\n\nHis professional work shows a clear pattern of entrepreneurship.',
    );
    expect(stripChatGPTDirectives('Who is he?\nAn entrepreneur, including the Prophet & Poet wine project. :::')).toBe(
      'Who is he?\nAn entrepreneur, including the Prophet & Poet wine project.',
    );
    expect(stripChatGPTDirectives('Ratio 3:1 and a time of 10:30 stay.')).toBe('Ratio 3:1 and a time of 10:30 stay.');
  });

  it('turns such an answer into article HTML without the marks', () => {
    const html = cleanChatGPTHtml('', { fallbackText: article });
    expect(html).not.toContain(':::');
    expect(html).not.toContain('writing{');
    expect(html).toContain('<p>Justin Biel is best known as the younger brother of actress Jessica Biel.</p>');
  });

  it('cleans article HTML that already carries the marks, even with a link put into the mark’s title', () => {
    const stored =
      '<p>:::writing{variant="document" id="68431" title="Who Is Justin Biel? All About <a href="https://en.wikipedia.org/wiki/Jessica_Biel">Jessica Biel</a>’s Brother"}\nJustin Biel is best known as the younger brother.</p>' +
      '<p>He works in the wine business, including the Prophet &amp; Poet wine project. :::</p><p>:::</p><h2>Next</h2>';
    expect(stripChatGPTDirectivesHtml(stored)).toBe(
      '<p>Justin Biel is best known as the younger brother.</p><p>He works in the wine business, including the Prophet &amp; Poet wine project.</p><h2>Next</h2>',
    );
  });
});

describe('article assembly', () => {
  const body = `<p>Intro paragraph about Sydney Sweeney.</p>
<h2>Introduction</h2><p>A second intro paragraph.</p>
<h2>Career</h2><p>Career details.</p>
<h2>FAQs</h2><h3>Old question?</h3><p>Old answer.</p>
<h2>Conclusion</h2><p>Final thoughts.</p>`;

  it('splits intro, sections and conclusion', () => {
    const parts = splitArticle(body);
    expect(parts.introHtml).toContain('A second intro paragraph');
    expect(parts.sections.map((s) => s.heading)).toEqual(['Career', 'FAQs']);
    expect(parts.conclusion?.heading).toBe('Conclusion');
  });

  it('orders Intro → Quick Bio → Body → FAQs → Conclusion and replaces duplicate FAQ sections', () => {
    const { html, hasConclusion } = assembleArticle({
      bodyHtml: body,
      faqs: [{ question: 'How old is Sydney Sweeney?', answer: 'She was born in 1997.' }],
      quickBio: [{ attribute: 'Full Name', details: 'Sydney Bernice Sweeney' }],
      subjectName: 'Sydney Sweeney',
    });
    expect(hasConclusion).toBe(true);
    const order = ['Intro paragraph', 'Quick Bio of Sydney Sweeney', 'Career details', 'Frequently Asked Questions', 'Final thoughts'].map((s) =>
      html.indexOf(s),
    );
    expect(order.every((pos) => pos >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('Old question');
    expect(html.match(/<h2>Introduction<\/h2>/)).toBeNull();
    expect(html).toContain('<table class="quick-bio-table">');
  });

  it('removes duplicate paragraphs', () => {
    const repeated = '<p>This sentence is long enough to be considered a real paragraph of content.</p>';
    const { html } = assembleArticle({ bodyHtml: repeated + repeated, faqs: [], quickBio: [], subjectName: 'X' });
    expect(html.match(/real paragraph/g)).toHaveLength(1);
  });
});
