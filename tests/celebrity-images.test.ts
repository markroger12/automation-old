import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '@/automation/pipeline/context';
import type { ExtensionImageFile } from '@/lib/chatgpt-extension';

const mocks = vi.hoisted(() => ({
  root: '', saved: {} as Record<string, unknown>,
  update: vi.fn(), render: vi.fn(), enhance: vi.fn(), detect: vi.fn(),
}));
vi.mock('@/automation/images/enhance', () => ({ enhancePicture: mocks.enhance }));
vi.mock('@/automation/images/faces', async (original) => ({
  ...await original<typeof import('@/automation/images/faces')>(), detectFaces: mocks.detect,
}));
vi.mock('@/lib/db', () => ({ prisma: { articleStage: { update: mocks.update } } }));
vi.mock('@/lib/paths', () => ({ imagesRoot: () => mocks.root, templatesRoot: () => mocks.root }));
vi.mock('@/automation/images/store', () => ({
  IMAGE_SIZE: { width: 1920, height: 1080 }, imagesStageData: async () => mocks.saved,
  uploadArticleImages: vi.fn(), finishArticleImages: vi.fn(), withArticleImages: vi.fn(),
}));
vi.mock('@/automation/images/template', async (original) => ({
  ...await original<typeof import('@/automation/images/template')>(), renderTemplate: mocks.render,
}));

import { imagesStage } from '@/modules/celebrity-writer/images';
import { celebrityPipeline } from '@/modules/celebrity-writer/pipeline';
import { CELEBRITY_PROMPTS } from '@/modules/celebrity-writer/prompts';
import { ExtensionUpdateRequiredError, GenerationError, TaskCancelledError } from '@/automation/errors';

let files: ExtensionImageFile[];
beforeAll(async () => {
  mocks.root = await fs.mkdtemp(path.join(os.tmpdir(), 'bas-celebrity-images-'));
  // Small real pictures of different noise, so each has its own fingerprint (the sizes below are what the stage sees).
  files = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const file = path.join(mocks.root, `source-${index}.jpg`);
    let seed = index + 1;
    const noise = Buffer.from(Array.from({ length: 64 * 36 * 3 }, () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256));
    await sharp(noise, { raw: { width: 64, height: 36, channels: 3 } }).jpeg().toFile(file);
    return { path: file, mime: 'image/jpeg', width: 1600, height: 900, bytes: 15 };
  }));
});
afterAll(async () => { await fs.rm(mocks.root, { recursive: true, force: true }); });
beforeEach(() => {
  vi.clearAllMocks(); mocks.saved = {};
  mocks.render.mockResolvedValue({ accent: '#123456' });
  mocks.detect.mockResolvedValue(null);
  mocks.enhance.mockImplementation(async (photo: ExtensionImageFile) => `${photo.path}.enhanced.png`);
  mocks.update.mockImplementation(async ({ data }) => { mocks.saved = structuredClone(data.data); });
});

function context(website = {}): PipelineContext {
  return {
    taskId: 'test-article', mode: 'run', attempt: 1,
    task: { keyword: 'Tia Morita', slug: 'tia-morita', language: 'English', website: { celebrityImages: true, ...website } },
    settings: { articleImages: true, defaultLanguage: 'English' },
    askChatGPT: vi.fn().mockResolvedValue({ prompt: 'Search colours', answer: { text: '', files } }),
    isCancelRequested: vi.fn().mockResolvedValue(false),
    log: () => ({ info: vi.fn(), warn: vi.fn() }),
  } as unknown as PipelineContext;
}

async function runCompleted(ctx: PipelineContext) {
  const result = await imagesStage.run(ctx);
  if (result.outcome !== 'completed') throw new Error('Unexpected pause');
  return result;
}

describe('Celebrity images from ChatGPT search', () => {
  it('pauses an unsupported extension without completing Images or continuing to WordPress', async () => {
    const ctx = context();
    vi.mocked(ctx.askChatGPT).mockRejectedValue(new ExtensionUpdateRequiredError('Reload the extension'));
    expect(await imagesStage.run(ctx)).toEqual({ outcome: 'paused', status: 'NEEDS_REVIEW', message: 'Reload the extension' });
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('uses the video prompt and distinct pictures in the featured and body designs', async () => {
    expect(CELEBRITY_PROMPTS.find((p) => p.key === 'images')?.defaultContent).toBe(
      'Search On google and give me any random colors pic high quality 5 to 10 pic simple pic random color.',
    );
    const ctx = context();
    await runCompleted(ctx);
    expect(ctx.askChatGPT).toHaveBeenCalledWith('IMAGES', 'images', {}, {
      images: { source: 'search', count: 10, width: 1920, height: 1080 }, fresh: false,
    });
    expect(mocks.render.mock.calls.map((args) => args[3])).toEqual(['featured', 'body', 'body']);
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual(files.slice(0, 3).map((f) => [f.path]));
    expect(mocks.saved.images).toHaveLength(3);
  });

  it('fills both featured slots and uses different backgrounds for the body images', async () => {
    await runCompleted(context({ featuredStyle: 'split' }));
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([
      [files[0].path, files[1].path], [files[2].path], [files[3].path],
    ]);
  });

  it('honours global and celebrity-specific image switches', async () => {
    const siteOff = context({ celebrityImages: false });
    expect((await runCompleted(siteOff)).data).toEqual({ skipped: true });
    expect(siteOff.askChatGPT).not.toHaveBeenCalled();
    const globalOff = context(); globalOff.settings.articleImages = false;
    expect((await runCompleted(globalOff)).data).toEqual({ skipped: true });
    expect(globalOff.askChatGPT).not.toHaveBeenCalled();
  });

  it('does not count duplicate downloads as different pictures for a split template', async () => {
    const ctx = context({ featuredStyle: 'split' });
    vi.mocked(ctx.askChatGPT).mockResolvedValue({ prompt: 'Search', answer: { text: '', files: [files[0], files[0]] } } as never);
    const result = await imagesStage.run(ctx);
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([[files[0].path]]);
    expect(result).toMatchObject({ outcome: 'paused', status: 'NEEDS_REVIEW' });
    expect(mocks.saved).toMatchObject({ sources: [files[0]], images: [expect.objectContaining({ role: 'body' })], problems: [expect.any(String), expect.any(String)] });
  });

  it('never shows a picture twice: a small gallery leaves out the body images it cannot fill', async () => {
    // Seen live (peter buchignani): three pictures for a split featured image and two body images.
    const ctx = context({ featuredStyle: 'split' });
    vi.mocked(ctx.askChatGPT).mockResolvedValue({ prompt: 'Search', answer: { text: '', files: files.slice(0, 3) } } as never);
    const result = await runCompleted(ctx);
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([[files[0].path, files[1].path], [files[2].path]]);
    expect(result.data).toMatchObject({
      images: [expect.objectContaining({ role: 'featured' }), expect.objectContaining({ role: 'body' })],
      problems: ['Body image 2: left out — ChatGPT supplied 3 different pictures and none is used twice.'],
    });

    vi.clearAllMocks(); mocks.saved = {};
    const two = context({ featuredStyle: 'split' });
    vi.mocked(two.askChatGPT).mockResolvedValue({ prompt: 'Search', answer: { text: '', files: files.slice(0, 2) } } as never);
    expect((await runCompleted(two)).data).toMatchObject({ images: [expect.objectContaining({ role: 'featured' })], problems: [expect.any(String), expect.any(String)] });
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([[files[0].path, files[1].path]]);
  });

  it('renders enlarged copies when the enhancer is on, and puts the biggest pictures first', async () => {
    const small = { ...files[0], width: 455, height: 455 };
    const ctx = context({ featuredStyle: 'split' });
    Object.assign(ctx.settings, { enhanceCelebrityImages: true });
    vi.mocked(ctx.askChatGPT).mockResolvedValue({ prompt: 'Search', answer: { text: '', files: [small, ...files.slice(1, 4)] } } as never);
    await runCompleted(ctx);
    const enhanced = (file: { path: string }) => `${file.path}.enhanced.png`;
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([
      [enhanced(files[1]), enhanced(files[2])], [enhanced(files[3])], [enhanced(small)],
    ]);
    // Each picture is measured against the place it goes into.
    expect(mocks.enhance.mock.calls.map(([photo, place]) => [photo.width, place.width < 1920])).toEqual([
      [1600, true], [1600, true], [1600, false], [455, false],
    ]);

    vi.clearAllMocks(); mocks.saved = {};
    await runCompleted(context());
    expect(mocks.enhance).not.toHaveBeenCalled();
  });

  it('puts the picture with a face first and crops each design around its faces', async () => {
    const ctx = context({ featuredStyle: 'split' });
    const found = { x: 0.7, y: 0.2, width: 0.1, height: 0.2, score: 0.97 };
    mocks.detect.mockImplementation(async (paths: string[]) => paths.map((p) => (p === files[3].path ? [found] : [])));
    await runCompleted(ctx);
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([[files[3].path, files[0].path], [files[1].path], [files[2].path]]);
    expect(mocks.render.mock.calls[0][4]).toEqual([[found], []]);
    expect(mocks.render.mock.calls.map((args) => path.extname(args[2]))).toEqual(['.webp', '.webp', '.webp']);
  });

  it('checks the photos with ChatGPT: a watermarked photo goes last and the alt text says what each shows', async () => {
    const ctx = context();
    Object.assign(ctx.settings, { celebrityPhotoReview: true });
    const review = [
      '1: watermark=yes | alt=Man at a website launch',
      '2: watermark=no | alt=Couple at a garden wedding',
      '3: watermark=no | alt=Family on a beach',
      '4: watermark=no | alt=Man on a red carpet',
      '5: watermark=no | alt=Woman with a dog',
      '6: watermark=no | alt=Friends at a dinner',
    ].join('\n');
    vi.mocked(ctx.askChatGPT)
      .mockResolvedValueOnce({ prompt: 'Search', answer: { text: '', files } } as never)
      .mockResolvedValueOnce({ prompt: 'Check', answer: { text: review, files: [] } } as never);
    const result = await runCompleted(ctx);
    expect(vi.mocked(ctx.askChatGPT).mock.calls[1].slice(0, 3)).toEqual(['IMAGES', 'image_review', { photo_count: '6' }]);
    const attachments = (vi.mocked(ctx.askChatGPT).mock.calls[1][3] as { attachments: { name: string }[] }).attachments;
    expect(attachments.map((a) => a.name)).toEqual(['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg', 'photo-5.jpg', 'photo-6.jpg']);
    // Photo 1 had a watermark: it moved to the end, so the three designs use photos 2, 3 and 4.
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([[files[1].path], [files[2].path], [files[3].path]]);
    expect((result.data as { images: { alt: string }[] }).images.map((image) => image.alt)).toEqual([
      'Tia Morita – Couple at a garden wedding', 'Tia Morita – Family on a beach', 'Tia Morita – Man on a red carpet',
    ]);

    // A retry does not ask again: the check travels with the saved pictures.
    vi.mocked(ctx.askChatGPT).mockClear();
    Object.assign(ctx, { attempt: 2 });
    await runCompleted(ctx);
    expect(ctx.askChatGPT).not.toHaveBeenCalled();
  });

  it('asks once more in a new chat when the article chat shows no picture gallery', async () => {
    // Seen live (gary phillip spector): a regeneration in the long article chat got no gallery at all.
    const ctx = context();
    Object.assign(ctx, { mode: 'regenerate' });
    vi.mocked(ctx.askChatGPT)
      .mockRejectedValueOnce(new GenerationError('ChatGPT did not show an image-search gallery for this prompt (prompt confirmed)'))
      .mockResolvedValueOnce({ prompt: 'Search', answer: { text: '', files } } as never);
    await runCompleted(ctx);
    expect(vi.mocked(ctx.askChatGPT).mock.calls.map((call) => call[3])).toEqual([
      { images: { source: 'search', count: 10, width: 1920, height: 1080 }, fresh: true },
      { images: { source: 'search', count: 10, width: 1920, height: 1080 }, fresh: true, newChat: true },
    ]);
    expect(mocks.render).toHaveBeenCalledTimes(3);
  });

  it('never makes a body image from another site’s collage', async () => {
    // Seen live (gary phillip spector): two collages became the featured image and a body image.
    const ctx = context();
    Object.assign(ctx.settings, { celebrityPhotoReview: true });
    const review = [
      '1: watermark=no | collage=no | alt=Woman singing on a stage',
      '2: watermark=no | collage=yes | alt=Two family photos side by side',
      '3: watermark=no | alt=Black-and-white collage of children and adults',
      '4: watermark=no | collage=no | alt=Man at a piano',
      '5: watermark=no | collage=no | alt=Couple at a party',
      '6: watermark=no | collage=no | alt=Boy with a guitar',
    ].join('\n');
    vi.mocked(ctx.askChatGPT)
      .mockResolvedValueOnce({ prompt: 'Search', answer: { text: '', files } } as never)
      .mockResolvedValueOnce({ prompt: 'Check', answer: { text: review, files: [] } } as never);
    await runCompleted(ctx);
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([[files[0].path], [files[3].path], [files[4].path]]);

    // Only collages left for the body images: they are left out, not used.
    vi.clearAllMocks(); mocks.saved = {};
    const few = context();
    Object.assign(few.settings, { celebrityPhotoReview: true });
    vi.mocked(few.askChatGPT)
      .mockResolvedValueOnce({ prompt: 'Search', answer: { text: '', files: files.slice(0, 3) } } as never)
      .mockResolvedValueOnce({ prompt: 'Check', answer: { text: review, files: [] } } as never);
    const result = await runCompleted(few);
    expect(mocks.render.mock.calls.map((args) => args[0])).toEqual([[files[0].path]]);
    expect((result.data as { problems: string[] }).problems[0]).toMatch(/^Body image 1: left out — .* \(2 left are collages of other sites\)\.$/);
  });

  it('makes the images without the photo check when ChatGPT cannot do it', async () => {
    const ctx = context();
    Object.assign(ctx.settings, { celebrityPhotoReview: true });
    vi.mocked(ctx.askChatGPT)
      .mockResolvedValueOnce({ prompt: 'Search', answer: { text: '', files } } as never)
      .mockRejectedValueOnce(new Error('ChatGPT did not take the 6 attached photo(s)'));
    const result = await runCompleted(ctx);
    expect((result.data as { images: { alt: string }[] }).images.map((image) => image.alt)).toEqual([
      'Tia Morita – Featured image', 'Tia Morita – Article image 1', 'Tia Morita – Article image 2',
    ]);
  });

  it('pauses download failures instead of completing Images with zero pictures', async () => {
    const ctx = context();
    vi.mocked(ctx.askChatGPT).mockRejectedValue(new Error('The gallery returned only a small thumbnail'));
    expect(await imagesStage.run(ctx)).toMatchObject({ outcome: 'paused', status: 'NEEDS_REVIEW', message: expect.stringContaining('0/3') });
    expect(mocks.saved).toMatchObject({ images: [], problems: ['The gallery returned only a small thumbnail'] });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('reuses downloaded sources after a render failure and refreshes them for regeneration', async () => {
    mocks.render.mockRejectedValueOnce(new Error('Temporary renderer failure'));
    const ctx = context();
    expect(await imagesStage.run(ctx)).toMatchObject({ outcome: 'paused', status: 'NEEDS_REVIEW' });
    expect(mocks.saved).toMatchObject({ problems: ['Temporary renderer failure'] });
    vi.mocked(ctx.askChatGPT).mockClear();
    ctx.attempt = 2;
    await runCompleted(ctx);
    expect(ctx.askChatGPT).not.toHaveBeenCalled();
    const regenerate = context();
    Object.assign(regenerate, { mode: 'regenerate' });
    await runCompleted(regenerate);
    expect(regenerate.askChatGPT).toHaveBeenCalledWith('IMAGES', 'images', {}, expect.objectContaining({ fresh: true }));
  });

  it('preserves cancellation instead of continuing to WordPress', async () => {
    const ctx = context();
    vi.mocked(ctx.isCancelRequested).mockResolvedValue(true);
    await expect(imagesStage.run(ctx)).rejects.toBeInstanceOf(TaskCancelledError);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('can add images to an existing draft without regenerating its article', () => {
    expect(celebrityPipeline.regenerationPlan('IMAGES', { wpEditUrl: 'https://example.com/wp-admin/post.php?post=123' } as never))
      .toEqual(['IMAGES', 'WORDPRESS_DRAFT', 'RANKMATH']);
  });
});

