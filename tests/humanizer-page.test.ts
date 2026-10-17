// The Humanizer page and its report views render without errors, with a real result from a fake ChatGPT.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyseDocument } from '@/content/humanizer/analyse';
import { parseDocument, plainText } from '@/content/humanizer/blocks';
import { humanize } from '@/content/humanizer/humanize';
import { CheckedParagraphs, MetricsTable, Output, RepeatNotes, ResultParagraphs } from '@/components/humanizer/views';
import { ToastProvider } from '@/components/ui/toast';
import HumanizerPage from '@/app/(dashboard)/humanizer/page';

const ARTICLE =
  '<h2>Career</h2><p>Additionally, it is worth noting that Gary played a pivotal role at <a href="https://example.com/co">the company</a> in 2001. Furthermore, his meticulous work was a testament to his skill.</p><p>Gary opened his first shop in 1994 with his brother.</p>';

const render = (node: ReturnType<typeof createElement>) => renderToString(createElement(ToastProvider, null, node));

describe('the Humanizer page', () => {
  it('renders the empty page', () => {
    const html = render(createElement(HumanizerPage));
    expect(html).toContain('AI Humanizer (test)');
    expect(html).toContain('Humanize with ChatGPT');
  });

  it('renders the check and a whole result', async () => {
    const doc = parseDocument(ARTICLE);
    const report = analyseDocument(doc, 'Gary');
    const check = { format: doc.format, report, texts: report.paragraphReports.map((p) => plainText(doc.blocks[p.block].text)) };
    const checkHtml = render(createElement('div', null, createElement(MetricsTable, { before: report }), createElement(RepeatNotes, { report }), createElement(CheckedParagraphs, { check })));
    expect(checkHtml).toContain('<mark');
    expect(checkHtml).toContain('pivotal');

    const result = {
      ...(await humanize({
        input: ARTICLE,
        keyword: 'Gary',
        ask: async () => '[P1]\nGary had a big part at [the company](https://example.com/co) in 2001, and his careful work showed his skill.',
      })),
      conversationUrls: ['https://chatgpt.com/c/1'],
      durationMs: 42_000,
    };
    const resultHtml = render(
      createElement('div', null, createElement(MetricsTable, { before: result.before, after: result.after }), createElement(ResultParagraphs, { result }), createElement(Output, { result })),
    );
    expect(resultHtml).toContain('Rewritten');
    expect(resultHtml).toContain('Gary had a big part');
    expect(resultHtml).toContain('srcDoc');
  });
});
