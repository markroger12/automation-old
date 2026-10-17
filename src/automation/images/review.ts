// The photo check: the chosen gallery pictures are attached to one ChatGPT prompt, which answers per photo whether a
// watermark or site name is laid over it, whether it is a collage of several photos, and gives a short description
// for the alt text.
import fs from 'node:fs/promises';
import sharp from 'sharp';
import type { ExtensionAttachment } from '@/lib/chatgpt-extension';

export interface PhotoReview {
  /** A watermark, site name or address, logo or big text laid over the photo. */
  watermark: boolean;
  /**
   * Not one photo but several put together (side by side, split by a line, framed, a designed thumbnail): another
   * site's collage. Seen on gary phillip spector (27 September 2026), where two such collages became the featured
   * image and a body image. Missing in checks saved before the question was asked.
   */
  collage?: boolean;
  /** What is visible, for the alt text (the article name is added in front). */
  alt: string;
}

/** ChatGPT takes at most 10 files per message; 8 leaves room and covers the pictures an article can use. */
export const MAX_REVIEWED = 8;

/** Each photo at most 1024 px as JPEG: enough to see a watermark, and quick to upload. */
export async function reviewAttachments(files: string[]): Promise<ExtensionAttachment[]> {
  return Promise.all(
    files.map(async (file, index) => {
      const data = await sharp(await fs.readFile(file))
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82 })
        .toBuffer();
      return { name: `photo-${index + 1}.jpg`, mime: 'image/jpeg' as const, data: data.toString('base64') };
    }),
  );
}

/**
 * Reads lines like "2: watermark=yes | alt=Couple holding a baby at a church christening". Markdown bold, "Photo 2"
 * and German yes/no are accepted; a photo without a line of its own gets null.
 */
export function parseReview(text: string, count: number): (PhotoReview | null)[] {
  const reviews: (PhotoReview | null)[] = Array.from({ length: count }, () => null);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[*_`]/g, '').trim();
    const match = /^(?:photo|foto|bild)?\s*#?(\d{1,2})\s*[:.)\-–]\s*(.+)$/i.exec(line);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= count || reviews[index]) continue;
    const watermark = /(?:watermark|wasserzeichen)\s*[=:]\s*(yes|ja|true)\b/i.test(match[2]);
    const alt = (/\balt\s*[=:]\s*(.+)$/i.exec(match[2])?.[1] ?? '')
      .replace(/^["'“”„]+|["'“”]+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.。]+$/, '')
      .trim()
      .slice(0, 110);
    // "collage=yes", or a description that calls it a collage even when the answer has no collage field.
    const collage = /(?:collage|kollage)\s*[=:]\s*(yes|ja|true)\b/i.test(match[2]) || isCollageAlt(alt);
    reviews[index] = { watermark, collage, alt };
  }
  return reviews;
}

/** A description that says the picture is several photos put together. */
export function isCollageAlt(alt: string | undefined): boolean {
  return /\b(collage|kollage|side[-\s]by[-\s]side|split[-\s]screen|montage|photo grid)\b/i.test(alt ?? '');
}

/** Another site's collage — from the photo check, also for checks saved before collages were asked about. */
export const isCollage = (review: PhotoReview | undefined): boolean => Boolean(review && (review.collage || isCollageAlt(review.alt)));

/** The alt text of a rendered image: the article name, then what its (first) photo shows. */
export function altText(name: string, review: PhotoReview | undefined, fallback: string): string {
  const described = review?.alt?.trim();
  // A keyword typed all in small letters ("justin biel") is a name: it is written "Justin Biel". The description is
  // kept as written (German nouns start with a capital letter).
  const proper = name === name.toLowerCase() ? name.replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase()) : name;
  return described ? `${proper} – ${described}`.slice(0, 125) : fallback;
}
