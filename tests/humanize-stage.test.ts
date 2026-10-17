// The Humanizer stage every writer runs before the assembly (the user's rule, 27 September 2026): it edits the article
// body through the module's Humanizer Prompt, each part in a new chat, and never touches the internal link line.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ stageData: null as unknown }));
vi.mock('@/lib/db', () => ({
  prisma: { articleStage: { findUnique: vi.fn(async () => ({ data: db.stageData })) } },
}));
const articles = vi.hoisted(() => ({ assembleTaskContent: vi.fn(() => '<p>assembled</p>'), runInternalSeoCheck: vi.fn(async () => ({})) }));
vi.mock('@/lib/services/articles', () => articles);

const { humanizeStage } = await import('@/automation/pipeline/humanize-stage');

const INTERNAL_LINK = '<p><strong>Also read: <a href="https://site.test/previous/">The Previous Article</a></strong></p>';
const BODY = [
  '<p>Additionally, it is worth noting that Gary Spector played a pivotal role at <a href="https://en.wikipedia.org/wiki/Wednesday_(TV_series)" rel="noopener">the show</a> in 2001.</p>',
  '<h2>Early Life</h2>',
  '<p>Gary Spector was born in 1968 in Los Angeles and grew up with his twin brother in the city.</p>',
  INTERNAL_LINK,
].join('');

/** A ChatGPT that drops the filler words and keeps everything else. */
function editedAnswer(paragraphs: string): string {
  return paragraphs
    .replace(/Additionally, it is worth noting that /g, '')
    .replace(/a pivotal role/g, 'a big part')
    .replace(/and grew up/g, 'and was raised');
}

function context(task: { bodyHtml: string | null; contentHtml?: string | null }) {
  const logged: string[] = [];
  const ctx = {
    taskId: 'task-h',
    task: { keyword: 'Gary Spector', contentHtml: null, ...task },
    settings: {},
    askChatGPT: vi.fn(async (_stage: string, _key: string, extra: { paragraphs: string }) => ({ prompt: 'p', answer: { text: editedAnswer(extra.paragraphs) } })),
    update: vi.fn(async (data: Record<string, unknown>) => {
      ctx.task = { ...ctx.task, ...data };
      return ctx.task;
    }),
    reload: vi.fn(async () => ctx.task),
    log: () => ({ info: (m: string) => logged.push(m), warn: (m: string) => logged.push(`warn ${m}`) }),
  };
  return { ctx, logged };
}

beforeEach(() => {
  db.stageData = null;
  articles.assembleTaskContent.mockClear();
  articles.runInternalSeoCheck.mockClear();
});

describe('the Humanizer stage', () => {
  it('edits every paragraph through the module prompt in the article’s chat and keeps the internal link line', async () => {
    const { ctx, logged } = context({ bodyHtml: BODY });
    const result = await humanizeStage.run(ctx as never);

    expect(ctx.askChatGPT).toHaveBeenCalledTimes(1);
    const [stage, key, extra, options] = ctx.askChatGPT.mock.calls[0] as unknown as [string, string, { problems: string; paragraphs: string }, object | undefined];
    // The article's own chat: no new chat (the user's wish, 8 October 2026).
    expect([stage, key, options]).toEqual(['HUMANIZE', 'humanize', undefined]);
    // Links go as marks; the internal link line is not sent at all.
    expect(extra.paragraphs).toContain('{L1}the show{/L1}');
    expect(extra.paragraphs).not.toContain('wikipedia.org');
    expect(extra.paragraphs).not.toContain('Previous Article');
    expect(extra.problems).toMatch(/^P1: /m);

    const bodyHtml = ctx.task.bodyHtml!;
    expect(bodyHtml).toContain('<p>Gary Spector played a big part at <a href="https://en.wikipedia.org/wiki/Wednesday_(TV_series)" rel="noopener">the show</a> in 2001.</p>');
    expect(bodyHtml).toContain('born in 1968 in Los Angeles and was raised with his twin brother');
    expect(bodyHtml.endsWith(INTERNAL_LINK)).toBe(true);
    expect(result).toMatchObject({ outcome: 'completed', data: { original: BODY, output: bodyHtml, sent: 2, rewritten: 2, keptOriginal: 0 } });
    expect(logged[0]).toMatch(/^Humanizer: 2 of 2 paragraph\(s\) rewritten/);
    // Not assembled yet: the assembly stage comes next.
    expect(articles.assembleTaskContent).not.toHaveBeenCalled();
  });

  it('regenerated on an unchanged article, humanizes the article as it was before', async () => {
    const first = context({ bodyHtml: BODY });
    const done = await humanizeStage.run(first.ctx as never);
    db.stageData = (done as { data: unknown }).data;

    const again = context({ bodyHtml: first.ctx.task.bodyHtml });
    await humanizeStage.run(again.ctx as never);
    const [, , extra] = again.ctx.askChatGPT.mock.calls[0] as unknown as [string, string, { paragraphs: string }];
    expect(extra.paragraphs).toContain('Additionally, it is worth noting that');
  });

  it('re-assembles and re-checks an article that was already assembled, and skips a task without an article', async () => {
    const { ctx } = context({ bodyHtml: BODY, contentHtml: '<p>old</p>' });
    await humanizeStage.run(ctx as never);
    expect(articles.assembleTaskContent).toHaveBeenCalledTimes(1);
    expect(articles.runInternalSeoCheck).toHaveBeenCalledWith('task-h', {});
    expect(ctx.task.contentHtml).toBe('<p>assembled</p>');

    const empty = context({ bodyHtml: null });
    expect(await humanizeStage.run(empty.ctx as never)).toMatchObject({ outcome: 'completed', data: { skipped: true } });
    expect(empty.ctx.askChatGPT).not.toHaveBeenCalled();
  });
});
