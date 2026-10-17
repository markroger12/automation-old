// Pictures displayed in ChatGPT's search gallery are saved, then rendered in the website designs.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { imagesRoot } from '@/lib/paths';
import { contentLocale } from '@/lib/content-locale';
import { slugify } from '@/lib/utils';
import { ExtensionUpdateRequiredError, GenerationError, LoginRequiredError, TaskCancelledError } from '@/automation/errors';
import { picturesFor, renderTemplate, templateFor } from '@/automation/images/template';
import { choosePictures, putFlaggedLast, type Candidate } from '@/automation/images/choose';
import { altText, isCollage, MAX_REVIEWED, parseReview, reviewAttachments } from '@/automation/images/review';
import { enhancePicture } from '@/automation/images/enhance';
import {
  IMAGE_SIZE, imagesStageData,
  uploadArticleImages as upload, finishArticleImages as finish, withArticleImages as withImages,
  type StoredImage,
} from '@/automation/images/store';
import type { PipelineContext } from '@/automation/pipeline/context';
import type { PipelineStage } from '@/automation/pipeline/types';
import type { PostEditor } from '@/automation/wordpress/editor';
import { CELEBRITY_STAGE_KEYS as K } from './manifest';
import { CELEBRITY_PROMPT_KEYS as P } from './prompts';

const IMAGE_COUNT = 3;

export const imagesStage: PipelineStage = {
  key: K.images, label: 'Images', kind: 'chatgpt', status: 'OPTIMIZING', progress: 78,
  async run(ctx) {
    const t = ctx.task;
    if (!ctx.settings.articleImages || (t.website && !t.website.celebrityImages)) {
      return { outcome: 'completed', output: 'Skipped — celebrity article images are switched off.', data: { skipped: true } };
    }
    const log = ctx.log('CHATGPT');
    const template = templateFor(t.website);
    const roles = ['featured', 'body', 'body'] as const;
    const places = roles.map((role) => picturesFor(template, role));
    const slots = places.map((list) => list.length);
    const saved = await imagesStageData(ctx.taskId, K.images) as { sources?: Candidate[]; prompt?: string; output?: string };
    let sources = saved.sources ?? [];
    // Retry a render using the downloaded pictures. An explicit regeneration asks ChatGPT again.
    if (ctx.mode === 'regenerate' && ctx.attempt === 1) sources = [];
    sources = (await Promise.all(sources.map(async (file) => (await fs.access(file.path).then(() => true, () => false)) ? file : null)))
      .filter((file): file is Candidate => file !== null);
    let prompt = saved.prompt ?? '';
    let output = saved.output ?? '';
    const problems: string[] = [];
    const images: StoredImage[] = [];
    let leftOut = 0;
    const folder = path.join(imagesRoot(), ctx.taskId);
    await fs.mkdir(folder, { recursive: true });
    const checkpoint = async () => {
      await prisma.articleStage.update({
        where: { taskId_key: { taskId: ctx.taskId, key: K.images } },
        data: { data: { sources, prompt, output, images, problems } as unknown as Prisma.InputJsonValue },
      });
    };
    try {
      if (!sources.length && slots.some(Boolean)) {
        const search = { source: 'search' as const, count: 10, ...IMAGE_SIZE };
        const response = await ctx.askChatGPT(K.images, P.images, {}, { images: search, fresh: ctx.mode === 'regenerate' }).catch(async (err: unknown) => {
          // In a long article chat ChatGPT sometimes answers without a picture gallery (seen on gary phillip spector,
          // 27 September 2026). The search needs no context: it is asked once more in a new chat.
          if (!(err instanceof GenerationError) || !/did not show an image-search gallery/i.test(err.message)) throw err;
          log.warn(`${err.message} — asking once more in a new chat`);
          return ctx.askChatGPT(K.images, P.images, {}, { images: search, fresh: true, newChat: true });
        });
        prompt = response.prompt;
        output = response.answer.text;
        sources = response.answer.files;
        await checkpoint();
      }
      // Two gallery entries can point to the same picture through different URLs.
      const seen = new Set<string>();
      const unique: Candidate[] = [];
      for (const source of sources) {
        const hash = createHash('sha256').update(await fs.readFile(source.path)).digest('hex');
        if (seen.has(hash)) continue;
        seen.add(hash);
        unique.push(source);
      }
      // Copies of one photo count once; pictures with a clear face first (the featured image takes the first ones),
      // soft pictures last. What was measured is saved with the sources, so a retry measures nothing again.
      sources = await choosePictures(unique, log);
      // The photo check (ChatGPT, photos attached): watermarked photos and collages go last, each photo gets its alt text.
      if (ctx.settings.celebrityPhotoReview) sources = await checkPhotos(ctx, sources, log);
      await checkpoint();
      const slug = t.slug || slugify(t.keyword, 75, contentLocale(t.language ?? ctx.settings.defaultLanguage));
      // Each picture goes into one design only: the featured image and the body images never show the same picture.
      // A small gallery leaves out the body images it cannot fill instead of repeating a picture. Another site's
      // collage never becomes a body image; the featured image takes one only when nothing else is left.
      const remaining = [...sources];
      for (const [index, role] of roles.entries()) {
        if (await ctx.isCancelRequested()) throw new TaskCancelledError();
        const needed = slots[index];
        const usable = role === 'featured' ? remaining : remaining.filter((photo) => !isCollage(photo.review));
        const photos = usable.slice(0, needed);
        if (photos.length < needed) {
          const collages = remaining.length - usable.length;
          if (role === 'featured') {
            problems.push(`Featured image: the template needs ${needed} different pictures; ChatGPT supplied ${sources.length}.`);
          } else {
            leftOut++;
            problems.push(
              `Body image ${index}: left out — ChatGPT supplied ${sources.length} different pictures and none is used twice` +
                (collages ? ` (${collages} left ${collages === 1 ? 'is a collage' : 'are collages'} of other sites).` : '.'),
            );
          }
          continue;
        }
        for (const photo of photos) remaining.splice(remaining.indexOf(photo), 1);
        // WebP: about a third smaller than JPEG at the same look (a server that refuses it gets a JPEG, see store.ts).
        const file = path.join(folder, index === 0 ? `${slug}.webp` : `${slug}-${index}.webp`);
        // A picture the template would stretch, or a soft one, is enhanced first (Upscayl remacri-4x, when installed and on).
        const files: string[] = [];
        for (const [slot, photo] of photos.entries()) {
          files.push(ctx.settings.enhanceCelebrityImages ? await enhancePicture(photo, places[index][slot], log, undefined, photo.soft) : photo.path);
        }
        // Explicit kind is essential: a single-slot featured design still uses the featured template.
        // A photo cropped to fill its place is cropped around its faces.
        await renderTemplate(files, template, file, role, photos.map((photo) => photo.faces));
        const german = contentLocale(t.language ?? ctx.settings.defaultLanguage) === 'de';
        const plainAlt = german ? `${t.keyword} – ${role === 'featured' ? 'Beitragsbild' : `Artikelbild ${index}`}` : `${t.keyword} – ${role === 'featured' ? 'Featured image' : `Article image ${index}`}`;
        images.push({ role, file, ...IMAGE_SIZE, alt: altText(t.keyword, photos[0]?.review, plainAlt) });
        await checkpoint();
        log.info(`Celebrity ${role === 'featured' ? 'featured image' : `body image ${index}`} rendered with the website template`);
      }
    } catch (err) {
      if (err instanceof ExtensionUpdateRequiredError) {
        return { outcome: 'paused', status: 'NEEDS_REVIEW', message: err.message };
      }
      if (err instanceof LoginRequiredError || err instanceof TaskCancelledError) throw err;
      problems.push((err as Error).message);
      log.warn(`Celebrity images: ${(err as Error).message}`);
    }
    log.info(`Celebrity images: ${images.length} of ${IMAGE_COUNT} ready from ChatGPT search results`);
    if (leftOut) log.warn(`Celebrity images: ${leftOut} body image(s) left out — ChatGPT supplied only ${sources.length} different pictures, and no picture is repeated`);
    await checkpoint();
    // Body images left out for want of different pictures do not hold the article back; anything else does.
    const complete = images.some((image) => image.role === 'featured') && images.length + leftOut === IMAGE_COUNT;
    if (!complete) {
      return {
        outcome: 'paused', status: 'NEEDS_REVIEW',
        message: `Images incomplete (${images.length}/${IMAGE_COUNT}). ${problems.join(' ') || 'ChatGPT did not supply enough usable originals.'} Retry Images to continue.`,
      };
    }
    return { outcome: 'completed', prompt, output, data: { images, sources, problems, prompt, output } as unknown as Prisma.InputJsonValue };
  },
};

/**
 * Asks ChatGPT about the photos not checked yet, with the photos attached. Never stops the stage: without an answer
 * the images are made as before (plain alt text, no watermark check).
 */
async function checkPhotos(ctx: PipelineContext, pictures: Candidate[], log: ReturnType<PipelineContext['log']>): Promise<Candidate[]> {
  const unchecked = pictures.slice(0, MAX_REVIEWED).filter((picture) => !picture.review);
  if (unchecked.length) {
    try {
      const attachments = await reviewAttachments(unchecked.map((picture) => picture.path));
      const { answer } = await ctx.askChatGPT(K.images, P.imageReview, { photo_count: String(unchecked.length) }, { attachments });
      const reviews = parseReview(answer.text, unchecked.length);
      unchecked.forEach((picture, index) => { if (reviews[index]) picture.review = reviews[index]!; });
      const answered = reviews.filter(Boolean).length;
      const marked = reviews.filter((review) => review?.watermark).length;
      const collages = reviews.filter((review) => isCollage(review ?? undefined)).length;
      log.info(
        `Photo check by ChatGPT: ${answered} of ${unchecked.length} photo(s) described` +
          (marked ? `, ${marked} with a watermark or site name (used last)` : ', no watermarks') +
          (collages ? `, ${collages} collage(s) of other sites (never a body image)` : ', no collages'),
      );
    } catch (err) {
      if (err instanceof LoginRequiredError || err instanceof TaskCancelledError) throw err;
      log.warn(`Photo check skipped (${(err as Error).message}) — the images are made without it`);
    }
  }
  return putFlaggedLast(pictures);
}

export const withArticleImages =(ctx: PipelineContext, html: string) => withImages(ctx, html, K.images);
export const uploadArticleImages = (ctx: PipelineContext, html: string) => upload(ctx, html, K.images);
export const finishArticleImages = (ctx: PipelineContext, editor: PostEditor) => finish(ctx, editor, K.images, IMAGE_COUNT);
