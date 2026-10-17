import { HUMANIZE_PROMPT, HUMANIZE_PROMPT_KEY, HUMANIZE_VARIABLES } from '@/content/humanizer/prompt';
import type { ModuleManifest } from '../types';
import { CELEBRITY_STAGE_KEYS } from '../celebrity-writer/manifest';
import { CELEBRITY2_PROMPTS, CELEBRITY2_PROMPT_KEYS, CELEBRITY2_VARIABLES } from './prompts';

export const CELEBRITY2_MODULE_KEY = 'celebrity-writer-2';

/** The article is written in one ChatGPT answer; the later stages are the ones Celebrity Writer 1.0 uses. */
export const CELEBRITY2_STAGE_KEYS = {
  article: 'ARTICLE',
  externalLinks: CELEBRITY_STAGE_KEYS.externalLinks,
  images: CELEBRITY_STAGE_KEYS.images,
  humanize: CELEBRITY_STAGE_KEYS.humanize,
  assembly: CELEBRITY_STAGE_KEYS.assembly,
  seoCheck: CELEBRITY_STAGE_KEYS.seoCheck,
  articleApproval: CELEBRITY_STAGE_KEYS.articleApproval,
  wordpressDraft: CELEBRITY_STAGE_KEYS.wordpressDraft,
  rankMath: CELEBRITY_STAGE_KEYS.rankMath,
} as const;

/** Celebrity Writer 2.0 articles may be longer than the Settings maximum (the prompt asks for 1,400–2,000 words). */
export const CELEBRITY2_MAX_WORDS = 2000;

export const celebrityWriter2Manifest: ModuleManifest = {
  key: CELEBRITY2_MODULE_KEY,
  name: 'Celebrity Writer 2.0',
  description:
    'Verifies the person first, then researches and writes the whole biography in one ChatGPT answer (Quick Bio, FAQs, meta description, slug, tags and research notes), and saves it as a WordPress draft.',
  icon: 'star',
  href: '/modules/celebrity-writer-2',
  status: 'active',
  group: 'Writers',
  stages: [
    { key: CELEBRITY2_STAGE_KEYS.article, label: 'Research & Article', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY2_PROMPT_KEYS.article },
    { key: CELEBRITY2_STAGE_KEYS.externalLinks, label: 'External Links', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY2_PROMPT_KEYS.externalLinks },
    { key: CELEBRITY2_STAGE_KEYS.images, label: 'Images', kind: 'chatgpt', regenerable: true, promptKey: CELEBRITY2_PROMPT_KEYS.images },
    { key: CELEBRITY2_STAGE_KEYS.humanize, label: 'Humanizer', kind: 'chatgpt', regenerable: true, promptKey: HUMANIZE_PROMPT_KEY },
    { key: CELEBRITY2_STAGE_KEYS.assembly, label: 'Article Assembly', kind: 'local' },
    { key: CELEBRITY2_STAGE_KEYS.seoCheck, label: 'SEO Check', kind: 'local' },
    { key: CELEBRITY2_STAGE_KEYS.articleApproval, label: 'Article Approval', kind: 'gate' },
    { key: CELEBRITY2_STAGE_KEYS.wordpressDraft, label: 'WordPress Draft', kind: 'wordpress' },
    { key: CELEBRITY2_STAGE_KEYS.rankMath, label: 'Rank Math Check', kind: 'wordpress' },
  ],
  prompts: [...CELEBRITY2_PROMPTS, HUMANIZE_PROMPT],
  variables: [...CELEBRITY2_VARIABLES, ...HUMANIZE_VARIABLES],
};
