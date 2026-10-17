// Which gallery pictures go into the article, and in what order. Copies of one photo (another site, another size,
// another crop) count once, keeping the biggest copy. Pictures with a clear face come first — the featured image takes the first
// ones — and soft pictures go to the back.
import path from 'node:path';
import type { ExtensionImageFile } from '@/lib/chatgpt-extension';
import { detectFaces, mainFaceArea, mainFaces, type FaceBox } from './faces';
import { isCollage, type PhotoReview } from './review';
import { faceFingerprint, fingerprintDistance, pictureFingerprint, pictureSharpness, SAME_FACES_BITS, SAME_PICTURE_BITS } from './similar';

/** A gallery picture with what was measured about it (kept in the Images stage data, so a retry measures nothing). */
export interface Candidate extends ExtensionImageFile {
  fingerprint?: string;
  sharpness?: number;
  /** Missing until the face detector has looked at the picture. */
  faces?: FaceBox[];
  /** Fingerprint of the area around the main faces (see faceFingerprint). */
  faceprint?: string;
  /** ChatGPT's photo check: watermark, collage, and what the photo shows (for the alt text). */
  review?: PhotoReview;
  /** Much softer than the other pictures of the gallery (the photo enhancer sharpens it). */
  soft?: boolean;
}

/** A picture is soft when its sharpness is below this share of the gallery's middle one. */
export const SOFT_SHARE = 0.4;

type Log = { info(message: string): void; warn(message: string): void };

export async function choosePictures(sources: Candidate[], log: Log, detect = detectFaces): Promise<Candidate[]> {
  const measured: Candidate[] = [];
  for (const source of sources) {
    try {
      measured.push({
        ...source,
        fingerprint: source.fingerprint ?? (await pictureFingerprint(source.path)),
        sharpness: source.sharpness ?? (await pictureSharpness(source.path)),
      });
    } catch (err) {
      log.warn(`Picture ${path.basename(source.path)} could not be read (${(err as Error).message}) — left out`);
    }
  }

  // Biggest first, so of two copies of one photo the bigger one stays.
  const unique: Candidate[] = [];
  let copies = 0;
  for (const picture of measured.sort((a, b) => b.width * b.height - a.width * a.height)) {
    if (unique.some((kept) => fingerprintDistance(kept.fingerprint!, picture.fingerprint!) <= SAME_PICTURE_BITS)) copies++;
    else unique.push(picture);
  }
  if (copies) log.info(`${copies} gallery picture(s) left out as copies of another one (same photo from another site or in another size)`);

  const unknown = unique.filter((picture) => !picture.faces);
  if (unknown.length) {
    try {
      const found = await detect(unknown.map((picture) => picture.path));
      if (found) unknown.forEach((picture, index) => { picture.faces = found[index] ?? []; });
      else log.warn('Face detection is not installed in data\\tools\\mediapipe — pictures are ordered and cropped without it');
    } catch (err) {
      log.warn(`Face detection failed (${(err as Error).message}) — pictures are ordered and cropped without it`);
    }
  }

  // A cropped copy (same people, same moment, another frame) is found by the area around the faces alone.
  const distinct: Candidate[] = [];
  let crops = 0;
  for (const picture of unique) {
    const area = picture.faces ? mainFaceArea(picture.faces) : null;
    if (area && !picture.faceprint) picture.faceprint = await faceFingerprint(picture.path, area).catch(() => undefined);
    const count = picture.faces ? mainFaces(picture.faces).length : 0;
    const limit = count >= 2 ? SAME_FACES_BITS.several : SAME_FACES_BITS.one;
    const twin = picture.faceprint && distinct.some((kept) =>
      kept.faceprint && mainFaces(kept.faces ?? []).length === count && fingerprintDistance(kept.faceprint, picture.faceprint!) <= limit);
    if (twin) crops++;
    else distinct.push(picture);
  }
  if (crops) log.info(`${crops} gallery picture(s) left out as cropped copies of another one (the same faces in the same moment)`);
  unique.splice(0, unique.length, ...distinct);

  const levels = unique.map((picture) => picture.sharpness ?? 0).sort((a, b) => a - b);
  const middle = levels[Math.floor(levels.length / 2)] ?? 0;
  const soft = (picture: Candidate) => unique.length >= 3 && (picture.sharpness ?? 0) < middle * SOFT_SHARE;
  // With a face first (sharp ones before soft ones), then the rest (sharp before soft).
  const rank = (picture: Candidate) => (picture.faces?.length ? 0 : 2) + (soft(picture) ? 1 : 0);
  const facePixels = (picture: Candidate) => (picture.faces?.length ? Math.max(...picture.faces.map((face) => face.height)) * picture.height : 0);
  const ordered = [...unique].sort(
    (a, b) => rank(a) - rank(b) || facePixels(b) - facePixels(a) || b.width * b.height - a.width * a.height,
  );
  for (const picture of ordered) picture.soft = soft(picture);
  const withFaces = ordered.filter((picture) => picture.faces?.length).length;
  const softCount = ordered.filter(soft).length;
  log.info(
    `Gallery pictures ordered: ${ordered.length} different` +
      (ordered.some((picture) => picture.faces) ? `, ${withFaces} with a face` : '') +
      (softCount ? `, ${softCount} soft (used last)` : ''),
  );
  return ordered;
}

/**
 * After the photo check: clean photos first, then photos with a watermark or site name, then other sites' collages
 * (each group keeps its order). The images stage never puts a collage into a body image.
 */
export function putFlaggedLast(pictures: Candidate[]): Candidate[] {
  const rank = (picture: Candidate) => (isCollage(picture.review) ? 2 : picture.review?.watermark ? 1 : 0);
  return [...pictures].sort((a, b) => rank(a) - rank(b));
}
