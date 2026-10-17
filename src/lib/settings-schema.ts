// Shared settings schema (client + server). Defaults live here so the UI and worker agree.
import { z } from 'zod';

export const BROWSER_MODES = ['headless', 'background', 'visible'] as const;
export type BrowserMode = (typeof BROWSER_MODES)[number];

export const settingsSchema = z.object({
  // Browser
  browserMode: z.enum(BROWSER_MODES).default('headless'),
  browserTimeoutSec: z.coerce.number().int().min(10).max(600).default(60),
  generationTimeoutSec: z.coerce.number().int().min(60).max(3600).default(600),
  captureScreenshots: z.boolean().default(true),
  chatgptUrl: z.string().url().default('https://chatgpt.com/'),
  /** Name of the Chrome profile that has the ChatGPT Worker extension; the worker opens it when articles are waiting. */
  /**
   * 'separate': a Chrome of its own (data/chatgpt-chrome) started so that ChatGPT keeps working while its window is
   * behind other windows — it never has to jump to the front. 'profile': a profile of the normal Chrome.
   */
  chatgptChromeMode: z.enum(['separate', 'profile']).default('separate'),
  chatgptChromeProfile: z.string().trim().max(100).default('automation'),

  // Workflow
  manualTitleApproval: z.boolean().default(false),
  /** Which writer the Workflows use for celebrity keywords. */
  workflowCelebrityWriter: z.enum(['celebrity-writer', 'celebrity-writer-2']).default('celebrity-writer'),
  manualArticleApproval: z.boolean().default(false),
  autoSendToWordPress: z.boolean().default(true),
  createMissingCategory: z.boolean().default(false),
  taskConcurrency: z.coerce.number().int().min(1).max(5).default(1),
  retryAttempts: z.coerce.number().int().min(0).max(5).default(2),

  // Content
  maxArticleWordCount: z.coerce.number().int().min(300).max(5000).default(1300),
  minKeywordOccurrences: z.coerce.number().int().min(1).max(100).default(15),
  maxKeywordOccurrences: z.coerce.number().int().min(1).max(150).default(18),
  faqCount: z.coerce.number().int().min(1).max(15).default(5),
  quickBioRows: z.coerce.number().int().min(5).max(25).default(12),
  defaultLanguage: z.string().min(2).max(60).default('English'),
  targetCountry: z.string().min(2).max(60).default('United States'),

  // SEO
  seoReviewThreshold: z.coerce.number().int().min(0).max(100).default(70),
  rankMathTargetScore: z.coerce.number().int().min(0).max(100).default(75),
  maxRankMathAttempts: z.coerce.number().int().min(0).max(10).default(3),
  /** ChatGPT suggests links to Wikipedia / IMDb / official sites; each one is checked before it is added. */
  externalLinks: z.boolean().default(true),
  /** Featured + body images for both article writers. */
  articleImages: z.boolean().default(true),
  /** Celebrity articles: small gallery pictures are enlarged with Upscayl (data/tools/upscayl, remacri-4x) before rendering. */
  enhanceCelebrityImages: z.boolean().default(true),
  /** Celebrity articles: the chosen photos are attached to one ChatGPT prompt for watermarks and alt descriptions. */
  celebrityPhotoReview: z.boolean().default(true),
  maxExternalLinks: z.coerce.number().int().min(1).max(8).default(5),

  // Advanced: extra CSS/Playwright selectors tried BEFORE the built-in ones, e.g.
  // { "chatgpt": { "composer": ["#my-selector"] }, "wordpress": { "saveDraft": ["..."] } }
  selectorOverrides: z.record(z.string(), z.record(z.string(), z.array(z.string()))).default({}),
});

export type AppSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({});

export const settingsUpdateSchema = settingsSchema.partial().superRefine((value, ctx) => {
  if (
    value.minKeywordOccurrences !== undefined &&
    value.maxKeywordOccurrences !== undefined &&
    value.minKeywordOccurrences > value.maxKeywordOccurrences
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['minKeywordOccurrences'],
      message: 'Minimum keyword occurrences cannot exceed the maximum',
    });
  }
});
