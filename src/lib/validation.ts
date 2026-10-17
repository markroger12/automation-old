import { z } from 'zod';
import { splitList } from './utils';
import { isTimeZone } from './workflow/time';

const id = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid id');
const optionalId = z
  .union([id, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const keywordList = z
  .union([z.string().max(2000), z.array(z.string().max(200)).max(50)])
  .optional()
  .nullable()
  .transform((v) => splitList(v ?? []));

const httpUrl = z
  .string()
  .trim()
  .url('Enter a valid URL including https://')
  .refine((u) => /^https?:\/\//i.test(u), 'URL must start with http:// or https://');

const taskFields = {
  moduleKey: z.string().trim().max(60).regex(/^[a-z0-9-]+$/).default('celebrity-writer'),
  exampleTitle: optionalText(300),
  websiteId: optionalId,
  categoryId: optionalId,
  /** Leave the category to the module (the Tigram writer asks ChatGPT to pick one of the website's categories). */
  autoCategory: z.boolean().optional(),
  secondaryKeywords: keywordList,
  targetCountry: optionalText(80),
  language: optionalText(60),
};

export const createTaskSchema = z.object({
  keyword: z.string().trim().min(2, 'Target keyword is required').max(200),
  ...taskFields,
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const bulkCreateSchema = z.object({
  keywords: z
    .array(z.string().trim().max(200))
    .transform((list) => Array.from(new Set(list.filter((k) => k.length >= 2))))
    .refine((list) => list.length > 0, 'Enter at least one keyword')
    .refine((list) => list.length <= 500, 'A maximum of 500 keywords can be queued at once'),
  ...taskFields,
});

/** Multiple keywords where every keyword carries its own secondary keywords. */
export const bulkItemsCreateSchema = z.object({
  items: z
    .array(z.object({ keyword: z.string().trim().max(200), secondaryKeywords: keywordList }))
    .transform((list) => {
      const seen = new Set<string>();
      return list.filter((item) => {
        const key = item.keyword.toLowerCase();
        if (item.keyword.length < 2 || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    })
    .refine((list) => list.length > 0, 'Enter at least one keyword')
    .refine((list) => list.length <= 500, 'A maximum of 500 keywords can be queued at once'),
  ...taskFields,
});

export const faqItemSchema = z.object({
  question: z.string().trim().min(3).max(500),
  answer: z.string().trim().min(1).max(3000),
});

export const bioRowSchema = z.object({
  attribute: z.string().trim().min(1).max(120),
  details: z.string().trim().min(1).max(1000),
});

export const updateTaskSchema = z.object({
  keyword: z.string().trim().min(2).max(200).optional(),
  selectedTitle: z.string().trim().min(3).max(300).optional(),
  bodyHtml: z.string().max(400_000).optional(),
  faqs: z.array(faqItemSchema).max(30).optional(),
  quickBio: z.array(bioRowSchema).max(40).optional(),
  seoTitle: z.string().trim().max(200).optional().nullable(),
  metaDescription: z.string().trim().max(400).optional().nullable(),
  slug: z
    .string()
    .trim()
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may only contain lowercase letters, numbers and hyphens')
    .optional()
    .nullable()
    .or(z.literal('')),
  focusKeyword: z.string().trim().max(200).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  websiteId: optionalId,
  categoryId: optionalId,
  secondaryKeywords: keywordList,
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('approve-title'), title: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal('approve-article') }),
  z.object({ action: z.literal('regenerate'), stage: z.string().trim().min(2).max(40) }),
  z.object({ action: z.literal('seo-check') }),
  z.object({ action: z.literal('send-to-wordpress') }),
]);
export type TaskActionInput = z.infer<typeof taskActionSchema>;

export const BULK_TASK_ACTIONS = ['send-to-wordpress', 'retry', 'seo-check', 'assign-website', 'cancel', 'delete'] as const;

/** One action applied to several articles (Article History bulk actions). */
export const bulkTaskActionSchema = z
  .object({
    ids: z.array(id).min(1, 'Select at least one article').max(200, 'Select at most 200 articles at once'),
    action: z.enum(BULK_TASK_ACTIONS),
    websiteId: optionalId,
    categoryId: optionalId,
  })
  .refine((v) => v.action !== 'assign-website' || v.websiteId, { message: 'Choose a website', path: ['websiteId'] });
export type BulkTaskActionInput = z.infer<typeof bulkTaskActionSchema>;

export const websiteSchema = z.object({
  name: z.string().trim().min(2).max(100),
  url: httpUrl,
  adminUrl: z.union([httpUrl, z.literal('')]).optional(),
  profileId: optionalId,
  createProfile: z.boolean().optional().default(true),
  defaultCategoryId: optionalId,
  defaultAuthor: optionalText(100),
  editorType: z.enum(['AUTO', 'GUTENBERG', 'CLASSIC']).default('AUTO'),
  isActive: z.boolean().default(true),
  /** Text before the link to the previous article, e.g. "Das könnte Ihnen gefallen:" (empty = no internal link). */
  internalLinkLine: z.string().trim().max(150).optional(),
  /** Off for websites that get their pictures elsewhere — those articles are written without images. Celebrity and
   *  Tigram articles are switched separately. */
  celebrityImages: z.boolean().default(true),
  tigramImages: z.boolean().default(true),
  /** Image template: the colour of the line between two photos and the corner the logo sits in. */
  accentColour: z
    .union([z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0179DE'), z.literal('')])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  logoPosition: z.enum(['bottom-right', 'bottom-left', 'bottom-center', 'top-right', 'top-left']).optional().nullable(),
  /** "split" puts two pictures with the line between them into the featured image, "single" uses one picture. */
  featuredStyle: z.enum(['split', 'single']).optional().nullable(),
  /** The design from the Image Template editor: { featured, body }. Unknown parts are dropped when it is used. */
  imageTemplate: z.unknown().optional().nullable(),
  /** On: a workflow of this website may schedule and publish posts. Off: the automation only ever saves drafts. */
  canPublish: z.boolean().default(false),
  /** The time zone WordPress itself runs in, so a scheduled post is entered at the right local time. */
  siteTimezone: z
    .union([z.string().trim().max(60), z.literal('')])
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || isTimeZone(v), { message: 'Use a time zone like Europe/Berlin or Asia/Karachi' }),
  /** The property in Google Search Console, e.g. "https://example.com/" or "sc-domain:example.com". */
  searchConsoleProperty: optionalText(200),
});
export const websiteUpdateSchema = websiteSchema.partial().omit({ createProfile: true });

/** The settings of one website's workflow (the times are Pakistan time, 24 hours). */
export const workflowSettingsSchema = z.object({
  isActive: z.boolean().optional(),
  publishTimes: z.array(z.string().trim().max(5)).max(24).optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** 0 = start writing as soon as the keyword is in the list. */
  writeAheadHours: z.number().int().min(0).max(72).optional(),
  /** null = follow the website's own image switches. */
  images: z.boolean().nullable().optional(),
  indexAfterPublish: z.boolean().optional(),
});
export type WorkflowSettingsInput = z.infer<typeof workflowSettingsSchema>;

export const categorySchema = z.object({
  names: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => splitList(v).filter((n) => n.length <= 100))
    .refine((v) => v.length > 0, 'Enter at least one category name'),
});

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(100),
  kind: z.enum(['CHATGPT', 'WORDPRESS', 'GENERIC']),
});

export const profileActionSchema = z.object({
  action: z.enum(['open-login', 'open-browser', 'test-session', 'refresh-session', 'reset-session', 'close-browser', 'sync-categories']),
  websiteId: optionalId,
});

export const promptUpdateSchema = z.object({
  content: z.string().min(10, 'Prompt is too short').max(50_000),
});

export const setupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
    name: z.string().trim().max(100).optional(),
    password: z.string().min(10, 'Use at least 10 characters for the password').max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: 'The passwords do not match', path: ['confirmPassword'] });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const logQuerySchema = z.object({
  taskId: z.string().max(64).optional(),
  level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  category: z.string().max(40).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
