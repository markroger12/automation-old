// Where the faces are in a gallery picture, so a template crops around them and pictures with a clear face come first.
// MediaPipe's face detector (BlazeFace, short range) runs in a headless Chrome from data/tools/mediapipe: the
// tasks-vision package in tasks-vision/ and the model blaze_face_short_range.tflite. Only where faces are is found,
// never whose face it is.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { findBrowserExecutable } from '@/automation/browser/system-browser';
import { dataRoot } from '@/lib/paths';

/** A face, as fractions (0–1) of the picture's width and height. */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

const ORIGIN = 'https://faces.test';
const MODEL = 'blaze_face_short_range.tflite';
const NEEDED = ['tasks-vision/vision_bundle.mjs', 'tasks-vision/wasm/vision_wasm_internal.wasm', MODEL];
const TYPES: Record<string, string> = {
  '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};

export function findFaceDetector(root = path.join(dataRoot(), 'tools', 'mediapipe')): string | null {
  return NEEDED.every((file) => fs.existsSync(path.join(root, file))) ? root : null;
}

/**
 * The faces in each picture (same order as `files`), or null when the detector is not installed. The whole picture is
 * searched and then overlapping tiles of it, because the model only sees faces that fill a good part of what it looks
 * at — people photographed full length have small faces.
 */
export async function detectFaces(files: string[], root = findFaceDetector()): Promise<FaceBox[][] | null> {
  if (!root || !files.length) return null;
  const executablePath = findBrowserExecutable('chrome') ?? findBrowserExecutable('chromium') ?? undefined;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage();
    // tsx/esbuild name the inner functions of findFacesInPage with a helper the page does not have.
    await page.addInitScript({ content: 'window.__name = (fn) => fn;' });
    // The detector's files and the pictures are served under one made-up https address, so the page may load them.
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      // The page loads the detector itself (a module script), so nothing in this file is rewritten by a bundler.
      if (url.pathname === '/') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><body><script type="module">import * as vision from '/tasks-vision/vision_bundle.mjs'; window.faceVision = vision;</script></body></html>`,
        });
      }
      const photo = /^\/photo\/(\d+)$/.exec(url.pathname);
      let file = photo ? files[Number(photo[1])] : path.join(root, path.normalize(decodeURIComponent(url.pathname.slice(1))));
      if (!photo && !file.startsWith(path.resolve(root) + path.sep)) file = '';
      if (!file || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', body: await fs.promises.readFile(file) });
    });
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction(() => 'faceVision' in window, undefined, { timeout: 30_000 });
    return await page.evaluate(findFacesInPage, { origin: ORIGIN, model: MODEL, count: files.length });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Runs in the page: loads the detector, then searches each picture whole and in 2×2 and 3×3 overlapping tiles. */
async function findFacesInPage({ origin, model, count }: { origin: string; model: string; count: number }): Promise<FaceBox[][]> {
  type Detection = { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { score: number }[] };
  const vision = (window as unknown as { faceVision: unknown }).faceVision as {
    FilesetResolver: { forVisionTasks(path: string): Promise<unknown> };
    FaceDetector: { createFromOptions(files: unknown, options: unknown): Promise<{ detect(image: HTMLCanvasElement): { detections: Detection[] } }> };
  };
  const files = await vision.FilesetResolver.forVisionTasks(`${origin}/tasks-vision/wasm`);
  const detector = await vision.FaceDetector.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${origin}/${model}`, delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.6,
  });
  const overlap = (a: FaceBox, b: FaceBox) => {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / (a.width * a.height + b.width * b.height - w * h);
  };
  const all: FaceBox[][] = [];
  for (let index = 0; index < count; index++) {
    const image = new Image();
    image.src = `${origin}/photo/${index}`;
    try {
      await image.decode();
    } catch {
      all.push([]);
      continue;
    }
    const W = image.naturalWidth;
    const H = image.naturalHeight;
    const found: FaceBox[] = [];
    const search = (sx: number, sy: number, sw: number, sh: number) => {
      // Each area is looked at on a canvas of at most 640 px, the model's input being far smaller anyway.
      const scale = Math.min(1, 640 / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      canvas.getContext('2d')!.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      for (const detection of detector.detect(canvas).detections) {
        const box = detection.boundingBox;
        if (!box) continue;
        found.push({
          x: (sx + box.originX / scale) / W,
          y: (sy + box.originY / scale) / H,
          width: box.width / scale / W,
          height: box.height / scale / H,
          score: detection.categories[0]?.score ?? 0,
        });
      }
    };
    search(0, 0, W, H);
    for (const grid of [2, 3]) {
      const tw = Math.min(W, (W / grid) * 1.5);
      const th = Math.min(H, (H / grid) * 1.5);
      for (let row = 0; row < grid; row++) {
        for (let column = 0; column < grid; column++) {
          search(((W - tw) / (grid - 1)) * column, ((H - th) / (grid - 1)) * row, tw, th);
        }
      }
    }
    // The same face is found in several tiles: the most certain one of each group stays.
    const kept: FaceBox[] = [];
    for (const face of found.sort((a, b) => b.score - a.score)) {
      if (!kept.some((other) => overlap(face, other) > 0.3)) kept.push(face);
    }
    all.push(kept);
  }
  return all;
}

/** The faces that matter: at least half as tall as the biggest one (not people in the background). */
export function mainFaces(faces: FaceBox[]): FaceBox[] {
  if (!faces.length) return [];
  const biggest = Math.max(...faces.map((face) => face.height));
  return faces.filter((face) => face.height >= biggest * 0.5);
}

/** The area around the main faces, as fractions of the picture, or null without faces. */
export function mainFaceArea(faces: FaceBox[]): { left: number; right: number; top: number; bottom: number } | null {
  const main = mainFaces(faces);
  if (!main.length) return null;
  return {
    left: Math.min(...main.map((face) => face.x)),
    right: Math.max(...main.map((face) => face.x + face.width)),
    top: Math.min(...main.map((face) => face.y)),
    bottom: Math.max(...main.map((face) => face.y + face.height)),
  };
}

/**
 * Where to put a picture that fills its place by cropping ("cover"), as CSS object-position percentages, so its main
 * faces are inside: centred across, and a little above the middle with room over the heads. Faces less than half as
 * tall as the biggest one (people in the background) are not considered.
 */
export function faceFocus(
  picture: { width: number; height: number },
  place: { width: number; height: number },
  faces: FaceBox[],
): { x: number; y: number } | null {
  if (!faces.length || !picture.width || !picture.height) return null;
  const { left, right, top, bottom } = mainFaceArea(faces)!;
  const scale = Math.max(place.width / picture.width, place.height / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  const spareX = width - place.width;
  const spareY = height - place.height;
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const shiftX = clamp(((left + right) / 2) * width - place.width / 2, spareX);
  const shiftY = clamp(Math.min(((top + bottom) / 2) * height - place.height * 0.4, top * height - place.height * 0.08), spareY);
  const percent = (shift: number, spare: number) => (spare > 0.5 ? Math.round((shift / spare) * 1000) / 10 : 50);
  return { x: percent(shiftX, spareX), y: percent(shiftY, spareY) };
}
