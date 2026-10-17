import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ keyword: vi.fn(), updateKeyword: vi.fn(), job: vi.fn(), updateJob: vi.fn(), enqueue: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { workflowKeyword: { findFirst: mocks.keyword, update: mocks.updateKeyword }, queueJob: { findFirst: mocks.job, update: mocks.updateJob } } }));
vi.mock('@/lib/queue', () => ({ WORKFLOW_QUEUE: 'workflow', enqueueWorkflowJob: mocks.enqueue }));
import { requestWorkflowIndexing } from '@/lib/services/workflow';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keyword.mockResolvedValue({ state: 'DONE', publishedUrl: 'https://example.com/old-article/', workflow: { website: { searchConsoleProperty: 'sc-domain:example.com' } } });
  mocks.job.mockResolvedValue(null);
  mocks.enqueue.mockResolvedValue(true);
});

describe('retrying workflow indexing', () => {
  it('queues only indexing for an old published failure and resets its error', async () => {
    await requestWorkflowIndexing('workflow-1', 'keyword-1');
    expect(mocks.enqueue).toHaveBeenCalledWith({ action: 'request-indexing', keywordId: 'keyword-1' });
    expect(mocks.updateKeyword).toHaveBeenCalledWith({ where: { id: 'keyword-1' }, data: { state: 'PUBLISHED', lastError: null, attempts: 0 } });
  });
  it('brings an existing delayed retry forward without making a duplicate', async () => {
    mocks.job.mockResolvedValue({ id: 'delayed-job', status: 'WAITING' });
    await requestWorkflowIndexing('workflow-1', 'keyword-1');
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith({ where: { id: 'delayed-job' }, data: { runAt: expect.any(Date) } });
  });
  it('does not repeat an already-confirmed or active request', async () => {
    mocks.keyword.mockResolvedValueOnce({ state: 'INDEXED', publishedUrl: 'https://example.com/old-article/', workflow: { website: { searchConsoleProperty: 'sc-domain:example.com' } } });
    await requestWorkflowIndexing('workflow-1', 'keyword-1');
    mocks.job.mockResolvedValue({ id: 'active-job', status: 'ACTIVE' });
    await requestWorkflowIndexing('workflow-1', 'keyword-1');
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.updateKeyword).not.toHaveBeenCalled();
  });
  it('refuses unpublished articles', async () => {
    mocks.keyword.mockResolvedValue({ state: 'WRITING', publishedUrl: null });
    await expect(requestWorkflowIndexing('workflow-1', 'keyword-1')).rejects.toThrow('must already be published');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
