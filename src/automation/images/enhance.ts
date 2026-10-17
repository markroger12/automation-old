// Low-quality pictures (small ones a template has to stretch) are enlarged on this computer before they are rendered,
// with Upscayl's command-line tool (the Real-ESRGAN engine) in data/tools/upscayl. Without it the original is used.
// remacri-4x was chosen on 25 September 2026: of the models compared on a real gallery photo, it changed faces least.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { dataRoot } from '@/lib/paths';

/**
 * Pictures stretched by more than this in their place are enlarged first. 2×, not less: the time grows with the
 * picture's size (a 1200×628 picture stretched 1.7× took 231 s on the Intel UHD 630), and below 2× it barely shows.
 */
export const ENHANCE_ABOVE_SCALE = 2;
const TIMEOUT_MS = 5 * 60_000;
const EXE = 'upscayl-bin.exe';
const MODEL = 'remacri-4x';

export interface EnhancerTool {
  command: string;
  /** Put before the tool's own arguments (a test runs a script through node). */
  prefix?: string[];
  models: string;
}

interface Picture {
  path: string;
  width: number;
  height: number;
}

/**
 * How much the picture is stretched in its place. Same rule as the renderer: a picture much taller than a place that
 * crops ("cover") is shown whole on a blurred copy of itself instead ("contain").
 */
export function displayScale(picture: { width: number; height: number }, place: { width: number; height: number }): number {
  const tall = picture.width / picture.height < (place.width / place.height) * 0.8;
  const x = place.width / picture.width;
  const y = place.height / picture.height;
  return tall ? Math.min(x, y) : Math.max(x, y);
}

/** Upscayl in data/tools/upscayl (or one folder below, as the zip unpacks), with the model in its models folder. */
export function findEnhancer(root = path.join(dataRoot(), 'tools', 'upscayl')): EnhancerTool | null {
  const folders = [root];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) folders.push(path.join(root, entry.name));
  } catch {
    return null;
  }
  for (const folder of folders) {
    const command = path.join(folder, EXE);
    const models = path.join(folder, 'models');
    if (fs.existsSync(command) && fs.existsSync(path.join(models, `${MODEL}.bin`))) return { command, models };
  }
  return null;
}

// The graphics chip handles one picture at a time.
let queue: Promise<unknown> = Promise.resolve();

function run(tool: EnhancerTool, input: string, output: string): Promise<void> {
  const args = [...(tool.prefix ?? []), '-i', input, '-o', output, '-n', MODEL, '-s', '4', '-m', tool.models, '-f', 'png'];
  const job = queue.then(
    () =>
      new Promise<void>((resolve, reject) => {
        execFile(tool.command, args, { timeout: TIMEOUT_MS, windowsHide: true, cwd: path.dirname(tool.command) }, (err, _stdout, stderr) => {
          if (err) {
            const detail = String(stderr || '').trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ');
            reject(new Error(err.killed ? `took longer than ${TIMEOUT_MS / 60_000} minutes` : detail || err.message));
          } else resolve();
        });
      }),
  );
  queue = job.catch(() => undefined);
  return job;
}

/**
 * The file to render for this picture in this place: an enlarged copy when the place would stretch it, else the
 * picture itself. Never fails — a missing or failing tool leaves the original, and says why.
 */
export async function enhancePicture(
  picture: Picture,
  place: { width: number; height: number },
  log: { info(message: string): void; warn(message: string): void },
  tool: EnhancerTool | null = findEnhancer(),
  /** Much softer than the rest of the gallery (see choosePictures): sharpened even when it is big enough. */
  soft = false,
): Promise<string> {
  const scale = displayScale(picture, place);
  const name = `${path.basename(picture.path)} (${picture.width}×${picture.height})`;
  const stretched = scale > ENHANCE_ABOVE_SCALE;
  if (!stretched && !soft) {
    log.info(`Photo enhancer: ${name} left as it is — sharp, and stretched only ${scale.toFixed(1)}×`);
    return picture.path;
  }
  const why = stretched ? `stretched ${scale.toFixed(1)}×` : 'soft';
  if (!tool) {
    log.warn(`Photo enhancer: ${name} is ${why} but Upscayl (${MODEL}) is not installed in data\\tools\\upscayl — original used`);
    return picture.path;
  }
  const stem = picture.path.replace(/\.[a-z0-9]+$/i, '');
  const output = `${stem}.enhanced.png`;
  if (fs.existsSync(output)) return output;
  const started = Date.now();
  // A soft picture that is big enough goes in at a quarter of the size it is shown at: enlarged 4× again, the model
  // draws the lost edges anew (seen on gary phillip spector, 27 September 2026: a 1960×1441 photo, sharpness 75 against
  // 888–1630 for the others, stayed blurred). The quarter also keeps it quick.
  let input = picture.path;
  if (!stretched) {
    const width = Math.max(160, Math.round((picture.width * scale) / 4));
    const height = Math.max(90, Math.round((picture.height * scale) / 4));
    input = `${stem}.soft-input.png`;
    await sharp(await fs.promises.readFile(picture.path)).rotate().resize(width, height, { fit: 'fill' }).png().toFile(input);
  }
  try {
    await run(tool, input, output);
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('it wrote no picture');
  } catch (err) {
    fs.rmSync(output, { force: true });
    log.warn(`Photo enhancer: ${name} could not be enhanced (${(err as Error).message}) — original used`);
    return picture.path;
  } finally {
    if (input !== picture.path) fs.rmSync(input, { force: true });
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  log.info(
    stretched
      ? `Photo enhancer: ${name} enlarged 4× with Upscayl (${MODEL}) in ${seconds}s (it was stretched ${scale.toFixed(1)}×)`
      : `Photo enhancer: ${name} was soft — sharpened with Upscayl (${MODEL}) in ${seconds}s`,
  );
  return output;
}
