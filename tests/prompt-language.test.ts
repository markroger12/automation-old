// Every prompt gets the article-language line after it — except a prompt that asks ChatGPT for pictures (the user did
// not want it under the image search prompt, 27 September 2026).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('@/lib/services/prompts', () => ({
  getPromptContent: async (_module: string, key: string) =>
    key === 'images' ? 'Search On google and give me high quality 5 to 10 pictures of {{keyword}}.' : 'Write the FAQs about {{keyword}}.',
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    articleStage: { update: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
    chatGPTResponse: { create: vi.fn(async () => ({})) },
    articleTask: { update: vi.fn(async () => ({})) },
    log: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock('@/automation/chatgpt/extension-bridge', () => ({
  askChatGPTViaExtension: vi.fn(async (options: { prompt: string }) => {
    sent.prompts.push(options.prompt);
    return { text: 'ok', html: '', conversationUrl: 'https://chatgpt.com/c/1', reusedExisting: false, durationMs: 1, files: [] };
  }),
}));

const { PipelineContext } = await import('@/automation/pipeline/context');

function context() {
  const ctx = new PipelineContext(
    'task-1',
    'run',
    {} as never,
    { defaultLanguage: 'English', targetCountry: 'United States', chatgptUrl: 'https://chatgpt.com/', browserTimeoutSec: 60, generationTimeoutSec: 600 } as never,
    { variables: async () => ({ keyword: 'Isis Rae Boykin' }) } as never,
  );
  ctx.task = { id: 'task-1', keyword: 'Isis Rae Boykin', language: 'English', targetCountry: 'United States', chatgptConversationUrl: 'https://chatgpt.com/c/1' } as never;
  return ctx;
}

beforeEach(() => {
  sent.prompts.length = 0;
});

describe('the article-language line', () => {
  it('is not put under a prompt that asks for pictures', async () => {
    await context().askChatGPT('IMAGES', 'images', {}, { images: { source: 'search', count: 10, width: 1920, height: 1080 } });
    expect(sent.prompts).toEqual(['Search On google and give me high quality 5 to 10 pictures of Isis Rae Boykin.']);
  });

  it('is still put under every other prompt', async () => {
    await context().askChatGPT('FAQS', 'faqs');
    expect(sent.prompts[0]).toMatch(/^Write the FAQs about Isis Rae Boykin\.\n\nLanguage: write your entire answer in English for readers in United States/);
  });
});
