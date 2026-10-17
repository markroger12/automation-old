// The images of one article: kept on disk, uploaded to the WordPress media library once, placed in the article and
// set as the featured image. Each writer module keeps its own images in its own pipeline stage.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { insertArticleImages } from '@/content/article-images';
import { GenerationError, LoginRequiredError } from '@/automation/errors';
import { contentLocale } from '@/lib/content-locale';
import { escapeHtml, truncate } from '@/lib/utils';
import type { PipelineContext } from '@/automation/pipeline/context';
import type { PostEditor } from '@/automation/wordpress/editor';
import { CANVAS } from './design';

export const IMAGE_SIZE = CANVAS;

export interface StoredImage {
  role: 'featured' | 'body';
  /** File on this computer (data/images/<task>/<slug>.jpg). */
  file: string;
  alt: string;
  width: number;
  height: number;
  /** Shown under the image in the article (photographer and licence for a photo of a real person). */
  caption?: string | null;
  /** Set once the image is in the WordPress media library. */
  mediaId?: number | null;
  url?: string | null;
}

export interface ImagesStageData {
  images?: StoredImage[];
  problems?: string[];
  /** Images are switched off for this kind of article on its website. */
  skipped?: boolean;
}

const digestOf = async (file: string) => createHash('sha1').update(await fsp.readFile(file)).digest('hex');

/**
 * Asks ChatGPT for one picture and makes sure it is a new one. For a prompt that started like the one before it, the
 * extension once took the earlier picture as this prompt's answer, so an article showed the same picture twice.
 * `earlier` holds the fingerprints of the pictures this article already got; a repeat is thrown away and the prompt
 * sent once more as a fresh one.
 */
export async function newPicture<T extends { path: string }>(
  ask: (fresh: boolean) => Promise<T>,
  earlier: Set<string>,
  warn: (message: string) => void,
): Promise<T> {
  for (let round = 1; ; round++) {
    const picture = await ask(round > 1);
    const digest = await digestOf(picture.path);
    if (!earlier.has(digest)) {
      earlier.add(digest);
      return picture;
    }
    await fsp.rm(picture.path, { force: true });
    if (round > 1) throw new GenerationError('ChatGPT handed back an earlier picture of this article again');
    warn('ChatGPT handed back an earlier picture of this article for a new prompt — sending the prompt again as a fresh one');
  }
}

export async function imagesStageData(taskId: string, stageKey: string): Promise<ImagesStageData> {
  const stage = await prisma.articleStage.findUnique({ where: { taskId_key: { taskId, key: stageKey } } });
  return ((stage?.data as ImagesStageData | null) ?? {}) as ImagesStageData;
}

/** The images of the task that still exist on disk. */
export async function storedImages(taskId: string, stageKey: string): Promise<StoredImage[]> {
  return ((await imagesStageData(taskId, stageKey)).images ?? []).filter((image) => fs.existsSync(image.file));
}

export async function saveStoredImages(taskId: string, stageKey: string, images: StoredImage[]): Promise<void> {
  const data = await imagesStageData(taskId, stageKey);
  await prisma.articleStage.update({
    where: { taskId_key: { taskId, key: stageKey } },
    data: { data: { ...data, images } as unknown as Prisma.InputJsonValue },
  });
}

/**
 * The body images (with their WordPress addresses) placed in the article HTML. A real photo in the featured image is
 * credited in a line at the end, as its licence asks — the featured image itself has no caption. Never opens a page.
 */
export async function withArticleImages(ctx: PipelineContext, html: string, stageKey: string): Promise<string> {
  const images = await storedImages(ctx.taskId, stageKey);
  const body = images
    .filter((image) => image.role === 'body' && image.url)
    .map((image) => ({ url: image.url!, alt: image.alt, id: image.mediaId ?? null, caption: image.caption ?? null }));
  const withBody = insertArticleImages(html, body);
  const featured = images.find((image) => image.role === 'featured' && image.url && image.caption);
  if (!featured?.caption) return withBody;
  const label = contentLocale(ctx.task.language ?? ctx.settings.defaultLanguage) === 'de' ? 'Beitragsbild' : 'Featured image';
  return `${withBody}\n<p><em>${label}: ${escapeHtml(featured.caption)}</em></p>`;
}

/** Before the editor opens: upload the images that are not in the media library yet, then place the body images. */
export async function uploadArticleImages(ctx: PipelineContext, html: string, stageKey: string): Promise<string> {
  if (!ctx.settings.articleImages) return html;
  const images = await storedImages(ctx.taskId, stageKey);
  if (!images.length) return html;
  const log = ctx.log('WORDPRESS');
  let uploaded = 0;
  try {
    const wp = await ctx.wordpress();
    for (const image of images) {
      if (image.mediaId && image.url) continue;
      const media = await wp.uploadMedia(image.file).catch(async (err: Error) => {
        // A server without WebP support refuses the file ("This image cannot be processed by the web server"):
        // the same picture goes up as a JPEG instead.
        if (!/\.webp$/i.test(image.file) || !/refused the image/i.test(err.message)) throw err;
        const jpeg = image.file.replace(/\.webp$/i, '.jpg');
        await sharp(await fsp.readFile(image.file)).jpeg({ quality: 92 }).toFile(jpeg);
        log.warn(`WordPress did not take the WebP image (${err.message.slice(0, 160)}) — uploading it as JPEG`);
        image.file = jpeg;
        return wp.uploadMedia(jpeg);
      });
      image.mediaId = media.id;
      image.url = media.url;
      uploaded++;
      await saveStoredImages(ctx.taskId, stageKey, images);
      if (image.alt && !(await wp.setMediaAlt(media.id, image.alt).catch(() => false))) {
        log.warn(`Alt text could not be saved in the media library for ${path.basename(image.file)} (it is still in the article)`);
      }
    }
  } catch (err) {
    if (err instanceof LoginRequiredError) throw err;
    log.warn(`Images could not be uploaded to WordPress: ${(err as Error).message}`);
  } finally {
    // The WordPress window moved to the media pages: the editor is opened again.
    if (uploaded) ctx.editor = null;
  }
  if (uploaded) log.info(`${uploaded} image(s) uploaded to the WordPress media library`);
  return withArticleImages(ctx, html, stageKey);
}

/** After the draft exists: set the featured image and report anything missing. */
export async function finishArticleImages(ctx: PipelineContext, editor: PostEditor, stageKey: string, expected: number): Promise<string[]> {
  if (!ctx.settings.articleImages) return [];
  // Switched off for this website: no images were meant to be there.
  if ((await imagesStageData(ctx.taskId, stageKey)).skipped) return [];
  const images = await storedImages(ctx.taskId, stageKey);
  const reasons: string[] = [];
  const featured = images.find((image) => image.role === 'featured' && image.mediaId);
  if (featured?.mediaId) {
    const set = editor.setFeaturedImage ? await editor.setFeaturedImage(featured.mediaId) : false;
    if (!set) reasons.push('The featured image could not be set automatically — choose it in WordPress (it is already in the media library).');
  }
  const ready = images.filter((image) => image.mediaId).length;
  if (ready < expected) {
    const { problems = [] } = await imagesStageData(ctx.taskId, stageKey);
    reasons.push(`${expected - ready} of ${expected} images are missing${problems.length ? ` (${truncate(problems.join(' | '), 240)})` : ''}.`);
  }
  return reasons;
}
