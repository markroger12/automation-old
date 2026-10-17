// Client-safe module registry. Add new modules here (see docs/ADDING_MODULES.md).
import type { ModuleManifest } from './types';
import { celebrityWriterManifest } from './celebrity-writer/manifest';
import { celebrityWriter2Manifest } from './celebrity-writer-2/manifest';
import { tigramWriterManifest } from './tigram-writer/manifest';

const comingSoon = (
  key: string,
  name: string,
  description: string,
  icon: ModuleManifest['icon'],
  group: ModuleManifest['group'],
): ModuleManifest => ({
  key,
  name,
  description,
  icon,
  href: `/modules/${key}`,
  status: 'coming-soon',
  group,
  stages: [],
  prompts: [],
  variables: [],
});

export const MODULES: ModuleManifest[] = [
  celebrityWriterManifest,
  celebrityWriter2Manifest,
  tigramWriterManifest,
  comingSoon('guest-post-writer', 'General Guest Post Writer', 'Long-form guest posts for any niche.', 'pen', 'Writers'),
  comingSoon('local-seo-writer', 'Local SEO Writer', 'Location-targeted service pages and posts.', 'map-pin', 'Writers'),
  comingSoon('product-review-writer', 'Product Review Writer', 'Structured product reviews with pros and cons.', 'package', 'Writers'),
  comingSoon('news-writer', 'News Writer', 'Timely news articles from current sources.', 'newspaper', 'Writers'),
  comingSoon('keyword-research', 'Keyword Research', 'Discover and cluster keyword opportunities.', 'search', 'SEO Tools'),
  comingSoon('internal-linking', 'Internal Linking', 'Suggest and insert internal links in drafts.', 'link', 'SEO Tools'),
  comingSoon('seo-audit', 'SEO Audit', 'Audit existing posts for on-page issues.', 'shield', 'SEO Tools'),
  comingSoon('bulk-content', 'Bulk Content Generator', 'Generate large batches of articles from templates.', 'layers', 'Writers'),
];

export function getModule(key: string): ModuleManifest | undefined {
  return MODULES.find((m) => m.key === key);
}

export function activeModules(): ModuleManifest[] {
  return MODULES.filter((m) => m.status === 'active');
}
