import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: {
  queueJob: mocks, workerStatus: { upsert: vi.fn().mockResolvedValue({}) }, setting: { upsert: vi.fn().mockResolvedValue({}) },
} }));
vi.mock('@/lib/settings', () => ({ getSettings: async () => ({ chatgptChromeMode: 'separate', chatgptUrl: 'https://chatgpt.com/' }) }));
vi.mock('@/lib/services/tasks', () => ({ resumeTasksWaitingForLogin: vi.fn() }));
import { handleAgentRequest } from '@/lib/services/chatgpt-extension';
import { IMAGE_SEARCH_UPDATE_MESSAGE, agentRequestSchema } from '@/lib/chatgpt-extension';
import { askChatGPTViaExtension } from '@/automation/chatgpt/extension-bridge';
import { ExtensionUpdateRequiredError } from '@/automation/errors';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findMany.mockResolvedValue([{ id: 'image-job', createdAt: new Date(), data: { images: { source: 'search' } } }]);
});

describe('ChatGPT gallery compatibility', () => {
  it('rejects a search job before an old content script can claim it', async () => {
    const result = await handleAgentRequest({ action: 'claim', clientId: 'legacy-test-tab', pageReady: true });
    expect(result).toEqual({ job: null, idleReason: IMAGE_SEARCH_UPDATE_MESSAGE });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'image-job', status: 'WAITING' },
      data: expect.objectContaining({ status: 'FAILED', result: { code: 'UPDATE_REQUIRED' } }),
    }));
  });

  it('preserves the actual page capability through request validation and claims a supported job', async () => {
    const body = agentRequestSchema.parse({ action: 'claim', clientId: 'current-test-tab', pageReady: true, version: '1.6.3', imageSearch: true });
    expect(await handleAgentRequest(body)).toMatchObject({ job: { id: 'image-job', images: { source: 'search' } } });
  });

  it('rejects the original-only 1.6.2 script even though it advertises gallery support', async () => {
    const body = agentRequestSchema.parse({ action: 'claim', clientId: 'preview-test-tab', pageReady: true, version: '1.6.2', imageSearch: true });
    expect(await handleAgentRequest(body)).toEqual({ job: null, idleReason: IMAGE_SEARCH_UPDATE_MESSAGE });
  });

  it('still allows old extensions to process text prompts', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'text-job', createdAt: new Date(), data: { prompt: 'Write an article' } }]);
    expect(await handleAgentRequest({ action: 'claim', clientId: 'legacy-text-tab', pageReady: true })).toMatchObject({ job: { id: 'text-job' } });
  });

  it('delivers update-required as a non-retryable configuration error to the image stage', async () => {
    mocks.create.mockResolvedValue({ id: 'image-job' });
    mocks.findUnique.mockResolvedValue({ status: 'FAILED', error: IMAGE_SEARCH_UPDATE_MESSAGE, result: { code: 'UPDATE_REQUIRED' } });
    await expect(askChatGPTViaExtension({
      taskId: 'article', stageKey: 'IMAGES', keyword: 'test', prompt: 'Find colours', conversationUrl: null,
      allowReuse: true, chatgptUrl: 'https://chatgpt.com/', navigationTimeoutMs: 100, generationTimeoutMs: 100,
      shouldAbort: async () => false, logger: { debug() {}, info() {}, warn() {}, error() {} },
      images: { source: 'search', count: 10, width: 1920, height: 1080 },
    })).rejects.toBeInstanceOf(ExtensionUpdateRequiredError);
  });
});
