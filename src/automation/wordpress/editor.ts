import type { Page } from 'playwright';
import type { RankMathPanel } from './rankmath';

export interface CategoryResult {
  selected: boolean;
  created: boolean;
  message: string;
}

export interface TagResult {
  added: boolean;
  existingTerm: boolean;
  message: string;
}

export interface SaveResult {
  editUrl: string;
  postId: string | null;
}

/** Operations the pipeline needs from a WordPress post editor (block or classic). */
export interface PostEditor {
  readonly kind: 'gutenberg' | 'classic';
  readonly page: Page;
  prepare(): Promise<void>;
  /** Throws PublishBlockedError if the post is already published/scheduled. */
  assertDraft(): Promise<void>;
  setTitle(title: string): Promise<void>;
  /** Replaces the whole post content with the given HTML. */
  setContent(html: string, expectedHeadings: number): Promise<void>;
  selectCategory(name: string, options: { createIfMissing: boolean }): Promise<CategoryResult>;
  addTag(tag: string): Promise<TagResult>;
  setSlug(slug: string): Promise<boolean>;
  saveDraft(): Promise<SaveResult>;
  rankMath(): Promise<RankMathPanel | null>;
  /** Sets the featured image to a media library item; false when this editor cannot do it. */
  setFeaturedImage?(mediaId: number): Promise<boolean>;
}

export function postIdFromUrl(url: string): string | null {
  const m = /[?&]post=(\d+)/.exec(url);
  return m ? m[1] : null;
}
