import { HUMANIZE_PROMPT, HUMANIZE_PROMPT_KEY, HUMANIZE_STAGE_KEY, HUMANIZE_VARIABLES } from '@/content/humanizer/prompt';
import type { ModuleManifest } from '../types';
import { CELEBRITY_PROMPTS, CELEBRITY_PROMPT_KEYS, CELEBRITY_VARIABLES } from './prompts';

export const CELEBRITY_MODULE_KEY = 'celebrity-writer';

export const CELEBRITY_STAGE_KEYS = {
  titles: 'TITLES',
  titleApproval: 'TITLE_APPROVAL',
  research: 'RESEARCH',
  longArticle: 'LONG_ARTICLE',
  finalArticle: 'FINAL_ARTICLE',
  faqs: 'FAQS',
  quickBio: 'QUICK_BIO',
  externalLinks: 'EXTERNAL_LINKS',
  images: 'IMAGES',
  humanize: HUMANIZE_STAGE_KEY,
  assembly: 'ASSEMBLY',
  seoCheck: 'SEO_CHECK',
  articleApproval: 'ARTICLE_APPROVAL',
  wordpressDraft: 'WORDPRESS_DRAFT',
  rankMath: 'RANKMATH',
} as const;

export const celebrityWriterManifest: ModuleManifest = {
  key: CELEBRITY_MODULE_KEY,
  name: 'Celebrity Article Writer',
  description:
    'Researches a celebrity through ChatGPT (browser), writes an SEO-optimized biography with FAQs and a Quick Bio table, and saves it as a WordPress draft with Rank Math fields.',
  icon: 'star',
  href: '/modules/celebrity-writer',
  status: 'active',
  group: 'Writers',
  stages: [
    { key: CELEBRITY_STAGE_KEYS.titles, label: 'Generate Titles', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.titles },
    { key: CELEBRITY_STAGE_KEYS.titleApproval, label: 'Title Approval', kind: 'gate' },
    { key: CELEBRITY_STAGE_KEYS.research, label: 'Celebrity Research', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.research },
    { key: CELEBRITY_STAGE_KEYS.longArticle, label: 'Long Article', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.longArticle },
    { key: CELEBRITY_STAGE_KEYS.finalArticle, label: 'Final Article', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.finalArticle },
    { key: CELEBRITY_STAGE_KEYS.faqs, label: 'FAQs', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.faqs },
    { key: CELEBRITY_STAGE_KEYS.quickBio, label: 'Quick Bio Table', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.quickBio },
    { key: CELEBRITY_STAGE_KEYS.externalLinks, label: 'External Links', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.externalLinks },
    { key: CELEBRITY_STAGE_KEYS.images, label: 'Images', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY_PROMPT_KEYS.images },
    { key: CELEBRITY_STAGE_KEYS.humanize, label: 'Humanizer', kind: 'chatgpt', regenerable: true, promptKey: HUMANIZE_PROMPT_KEY },
    { key: CELEBRITY_STAGE_KEYS.assembly, label: 'Article Assembly', kind: 'local' },
    { key: CELEBRITY_STAGE_KEYS.seoCheck, label: 'SEO Check', kind: 'local' },
    { key: CELEBRITY_STAGE_KEYS.articleApproval, label: 'Article Approval', kind: 'gate' },
    { key: CELEBRITY_STAGE_KEYS.wordpressDraft, label: 'WordPress Draft', kind: 'wordpress' },
    { key: CELEBRITY_STAGE_KEYS.rankMath, label: 'Rank Math Check', kind: 'wordpress' },
  ],
  prompts: [...CELEBRITY_PROMPTS, HUMANIZE_PROMPT],
  variables: [...CELEBRITY_VARIABLES, ...HUMANIZE_VARIABLES],
};
