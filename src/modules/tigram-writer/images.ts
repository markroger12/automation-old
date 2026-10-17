// Tigram Article Writer images: ChatGPT plans and creates a featured image and two body images; the WordPress draft
// uploads them to the media library, puts the body images in the article and sets the featured image.
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { imagesRoot } from '@/lib/paths';
import {
  IMAGE_SIZE,
  newPicture,
  finishArticleImages as sharedFinishArticleImages,
  storedImages as sharedStoredImages,
  uploadArticleImages as sharedUploadArticleImages,
  withArticleImages as sharedWithArticleImages,
  type StoredImage,
} from '@/automation/images/store';
import { contentLocale } from '@/lib/content-locale';
import { slugify, truncate } from '@/lib/utils';
import { parseImagePlan, type ImagePlanItem } from '@/content/article-images';
import { GenerationError, LoginRequiredError, TaskCancelledError, UsageLimitError } from '@/automation/errors';
import { renderTemplate, templateFor } from '@/automation/images/template';
import { articleTitle } from '@/automation/pipeline/common-stages';
import type { PipelineContext } from '@/automation/pipeline/context';
import type { PipelineStage } from '@/automation/pipeline/types';
import type { PostEditor } from '@/automation/wordpress/editor';
import { TIGRAM_STAGE_KEYS as K } from './manifest';
import { TIGRAM_PROMPT_KEYS as P } from './prompts';

const IMAGE_COUNT = 3;

export { IMAGE_SIZE, type StoredImage };

/** Short text for the featured image: the article title without its tail after ":" or "–", at most ~45 characters of whole words. */
export function featuredImageTitle(title: string): string {
  const head = title.split(/\s[:–—|-]\s|:\s/)[0].trim();
  const text = head.length >= 8 ? head : title.trim();
  if (text.length <= 45) return text;
  const words: string[] = [];
  for (const word of text.split(/\s+/)) {
    if ([...words, word].join(' ').length > 45) break;
    words.push(word);
  }
  // Never end on a small linking word ("… Software Cost in").
  while (words.length > 2 && /^(in|of|for|the|and|to|a|an|with|on|at|by|or|vs\.?|&|-|–)$/i.test(words[words.length - 1])) words.pop();
  return words.join(' ') || truncate(text, 45);
}

function defaultPlan(keyword: string, imageTitle: string): ImagePlanItem[] {
  const body = (topic: string) =>
    `A minimal flat illustration about ${topic}. Soft colours, plain light background, lots of empty space, only a few simple objects, no text, letters or numbers at all, no logos, no faces.`;
  return [
    {
      prompt: `A clean, modern blog header image about "${keyword}". Large bold title text in the middle, spelled exactly: "${imageTitle}". Empty space above and below the text, simple background that fits the topic, strong contrast, no logos, no watermark, no other words.`,
      alt: keyword,
    },
    { prompt: body(keyword), alt: `${keyword} illustration` },
    { prompt: body(`the main steps and tips of ${keyword}`), alt: `${keyword} guide illustration` },
  ];
}

/** The images of the task that still exist on disk. */
export const storedImages = (taskId: string) => sharedStoredImages(taskId, K.images);

const stopsTheArticle = (err: unknown) => err instanceof LoginRequiredError || err instanceof TaskCancelledError;

/** Step 4 — ChatGPT plans three images (with alt texts), then creates them one by one. */
export const imagesStage: PipelineStage = {
  key: K.images,
  label: 'Images',
  kind: 'chatgpt',
  status: 'OPTIMIZING',
  progress: 73,
  async run(ctx) {
    const t = ctx.task;
    if (!ctx.settings.articleImages) {
      return { outcome: 'completed', output: 'Skipped — article images are switched off in Settings.', data: { skipped: true } };
    }
    if (t.website && !t.website.tigramImages) {
      return { outcome: 'completed', output: `Skipped — images for Tigram articles are switched off for ${t.website.name}.`, data: { skipped: true } };
    }
    const log = ctx.log('CHATGPT');
    const imageTitle = featuredImageTitle(articleTitle(ctx));
    const fallback = defaultPlan(t.keyword, imageTitle);
    const problems: string[] = [];

    let planText = '';
    let prompt = '';
    let items: ImagePlanItem[] = fallback;
    try {
      const planned = await ctx.askChatGPT(K.images, P.imagePlan, { image_title: imageTitle });
      prompt = planned.prompt;
      planText = planned.answer.text;
      items = parseImagePlan(planText, IMAGE_COUNT).map((item, i) => item ?? fallback[i]);
    } catch (err) {
      if (stopsTheArticle(err)) throw err;
      problems.push(`Image plan: ${(err as Error).message}`);
      log.warn(`Image plan failed, using default image descriptions: ${(err as Error).message}`);
    }

    const locale = contentLocale(t.language ?? ctx.settings.defaultLanguage);
    const slug = t.slug || slugify(t.keyword, 75, locale);
    const folder = path.join(imagesRoot(), ctx.taskId);
    await fsp.mkdir(folder, { recursive: true });
    const template = templateFor(t.website);
    const images: StoredImage[] = [];
    const earlier = new Set<string>();

    for (const [i, item] of items.entries()) {
      const role: StoredImage['role'] = i === 0 ? 'featured' : 'body';
      try {
        const created = await newPicture(
          async (fresh) => {
            const { answer } = await ctx.askChatGPT(K.images, P.image, { image_prompt: item.prompt }, { images: { count: 1, ...IMAGE_SIZE }, fresh });
            const file = answer.files[0];
            if (!file) throw new GenerationError('ChatGPT answered without an image');
            return file;
          },
          earlier,
          (message) => log.warn(message),
        );
        // The file is named after the keyword: <slug>.jpg for the featured image, <slug>-1.jpg / -2.jpg in the text.
        const file = path.join(folder, i === 0 ? `${slug}.jpg` : `${slug}-${i}.jpg`);
        // Every picture of the article carries the website's logo, the same way the celebrity articles do.
        const stamped = Boolean(template.logo) || Boolean(template.designs?.body);
        if (stamped) {
          await renderTemplate([created.path], template, file);
          await fsp.rm(created.path, { force: true });
        } else {
          await fsp.rename(created.path, file).catch(() => fsp.copyFile(created.path, file));
        }
        images.push({
          role,
          file,
          alt: item.alt || fallback[i].alt,
          width: stamped ? IMAGE_SIZE.width : created.width,
          height: stamped ? IMAGE_SIZE.height : created.height,
        });
        log.info(`Image ${i + 1} of ${IMAGE_COUNT} created (${role === 'featured' ? 'featured image' : 'body image'})`, { file: path.basename(file), alt: item.alt });
      } catch (err) {
        if (stopsTheArticle(err)) throw err;
        problems.push(`Image ${i + 1}: ${(err as Error).message}`);
        log.warn(`Image ${i + 1} of ${IMAGE_COUNT} was not created: ${(err as Error).message}`);
        // The image limit is reached — the next ones would fail too.
        if (err instanceof UsageLimitError) break;
      }
    }
    log.info(`Images: ${images.length} of ${IMAGE_COUNT} created${images.length < IMAGE_COUNT ? ' — the article continues without the missing ones' : ''}`);
    return {
      outcome: 'completed',
      prompt,
      output: planText,
      data: { images, problems } as unknown as Prisma.InputJsonValue,
    };
  },
};

/** Placing the body images and the two WordPress hooks work the same for every writer. */
export const withArticleImages = (ctx: PipelineContext, html: string) => sharedWithArticleImages(ctx, html, K.images);
export const uploadArticleImages = (ctx: PipelineContext, html: string) => sharedUploadArticleImages(ctx, html, K.images);
export const finishArticleImages = (ctx: PipelineContext, editor: PostEditor) => sharedFinishArticleImages(ctx, editor, K.images, IMAGE_COUNT);
