// Two measures of a gallery picture. A fingerprint finds the same photo saved by another site in another size or
// quality. Sharpness finds pictures that are soft (blurred, heavily compressed, enlarged from a thumbnail).
// Files are read into memory first: on Windows sharp keeps a file it opened by path, which blocks deleting it.
import fs from 'node:fs/promises';
import sharp, { type Sharp } from 'sharp';

/** Fingerprints this many bits apart (of 64) or fewer are the same photo. */
export const SAME_PICTURE_BITS = 10;

/**
 * A 64-bit difference hash as 16 hex digits: the picture shrunk to 9×8 grey pixels, one bit per neighbour pair
 * (is the left one brighter?). Resizing, recompressing and small colour changes keep it; another photo does not.
 */
export async function pictureFingerprint(file: string): Promise<string> {
  return differenceHash(sharp(await fs.readFile(file)).rotate());
}

/**
 * The same fingerprint of only the area around the main faces. A cropped copy of a photo (one site shows three people
 * whole, another only down to their waists) has another fingerprint as a whole, but this area stays as it was.
 * Measured on 2026-09-26: copies 7 and 8 bits apart, different photos with as many faces 19 or more.
 */
export async function faceFingerprint(file: string, area: { left: number; right: number; top: number; bottom: number }): Promise<string> {
  // Turned upright first, as the browser showed it to the face detector (the sizes are then the upright ones).
  const upright = await sharp(await fs.readFile(file)).rotate().toBuffer();
  const { width = 0, height = 0 } = await sharp(upright).metadata();
  const left = Math.max(0, Math.round(area.left * width));
  const top = Math.max(0, Math.round(area.top * height));
  return differenceHash(sharp(upright).extract({
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round((area.right - area.left) * width))),
    height: Math.max(1, Math.min(height - top, Math.round((area.bottom - area.top) * height))),
  }));
}

/** Copies of one photo: face areas at most this many bits apart — stricter with one face, as faces look alike. */
export const SAME_FACES_BITS = { one: 6, several: 12 };

async function differenceHash(image: Sharp): Promise<string> {
  const pixels = await image.greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? '1' : '0';
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export function fingerprintDistance(a: string, b: string): number {
  let rest = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (rest) {
    count += Number(rest & 1n);
    rest >>= 1n;
  }
  return count;
}

/**
 * How sharp the picture looks at up to 512 px: the variance of its Laplacian (edges). Only comparable between the
 * pictures of one gallery — a soft picture scores far below the others.
 */
export async function pictureSharpness(file: string): Promise<number> {
  const { data, info } = await sharp(await fs.readFile(file))
    .rotate()
    .greyscale()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x;
      const edge = 4 * data[at] - data[at - 1] - data[at + 1] - data[at - width] - data[at + width];
      sum += edge;
      squares += edge * edge;
      count++;
    }
  }
  return count ? Math.round(squares / count - (sum / count) ** 2) : 0;
}
