import { HUMANIZE_PROMPT, HUMANIZE_PROMPT_KEY, HUMANIZE_STAGE_KEY, HUMANIZE_VARIABLES } from '@/content/humanizer/prompt';
import type { ModuleManifest } from '../types';
import { TIGRAM_PROMPTS, TIGRAM_PROMPT_KEYS, TIGRAM_VARIABLES } from './prompts';

export const TIGRAM_MODULE_KEY = 'tigram-writer';

export const TIGRAM_STAGE_KEYS = {
  article: 'ARTICLE',
  category: 'CATEGORY',
  externalLinks: 'EXTERNAL_LINKS',
  images: 'IMAGES',
  humanize: HUMANIZE_STAGE_KEY,
  assembly: 'ASSEMBLY',
  seoCheck: 'SEO_CHECK',
  articleApproval: 'ARTICLE_APPROVAL',
  wordpressDraft: 'WORDPRESS_DRAFT',
  rankMath: 'RANKMATH',
} as const;

export const tigramWriterManifest: ModuleManifest = {
  key: TIGRAM_MODULE_KEY,
  name: 'Tigram Article Writer',
  description:
    'Writes a complete SEO article for any keyword (software, deals, products, how-to, local searches) with a featured snippet paragraph, a step-by-step section, a comparison table, 7 FAQs, images and Rank Math fields.',
  icon: 'pen',
  href: '/modules/tigram-writer',
  status: 'active',
  group: 'Writers',
  stages: [
    { key: TIGRAM_STAGE_KEYS.article, label: 'Article', kind: 'chatgpt', regenerable: true, promptKey: TIGRAM_PROMPT_KEYS.article },
    { key: TIGRAM_STAGE_KEYS.category, label: 'Category', kind: 'chatgpt', regenerable: true, promptKey: TIGRAM_PROMPT_KEYS.category },
    { key: TIGRAM_STAGE_KEYS.externalLinks, label: 'External Links', kind: 'chatgpt', regenerable: true, promptKey: TIGRAM_PROMPT_KEYS.externalLinks },
    { key: TIGRAM_STAGE_KEYS.images, label: 'Images', kind: 'chatgpt', regenerable: true, promptKey: TIGRAM_PROMPT_KEYS.imagePlan },
    { key: TIGRAM_STAGE_KEYS.humanize, label: 'Humanizer', kind: 'chatgpt', regenerable: true, promptKey: HUMANIZE_PROMPT_KEY },
    { key: TIGRAM_STAGE_KEYS.assembly, label: 'Article Assembly', kind: 'local' },
    { key: TIGRAM_STAGE_KEYS.seoCheck, label: 'SEO Check', kind: 'local' },
    { key: TIGRAM_STAGE_KEYS.articleApproval, label: 'Article Approval', kind: 'gate' },
    { key: TIGRAM_STAGE_KEYS.wordpressDraft, label: 'WordPress Draft', kind: 'wordpress' },
    { key: TIGRAM_STAGE_KEYS.rankMath, label: 'Rank Math Check', kind: 'wordpress' },
  ],
  prompts: [...TIGRAM_PROMPTS, HUMANIZE_PROMPT],
  variables: [...TIGRAM_VARIABLES, ...HUMANIZE_VARIABLES],
};
