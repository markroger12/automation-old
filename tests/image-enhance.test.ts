// Small ChatGPT pictures are enlarged with Upscayl before a template stretches them. A stand-in script plays the
// tool here: it copies the picture and notes the arguments it was given.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { displayScale, enhancePicture, findEnhancer, type EnhancerTool } from '@/automation/images/enhance';

let root = '';
let calls = '';
let working: EnhancerTool;
let failing: EnhancerTool;
const messages: string[] = [];
const log = { info: (m: string) => messages.push(`info ${m}`), warn: (m: string) => messages.push(`warn ${m}`) };
const BODY = { width: 1920, height: 1080 };
const HALF = { width: 930, height: 1080 };

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-enhance-'));
  calls = path.join(root, 'calls.txt');
  const ok = path.join(root, 'ok.js');
  fs.writeFileSync(ok, `const fs = require('fs'); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(a) + '\\n');
fs.copyFileSync(a[a.indexOf('-i') + 1], a[a.indexOf('-o') + 1]);`);
  const bad = path.join(root, 'bad.js');
  fs.writeFileSync(bad, `process.stderr.write('[0 Intel(R) UHD Graphics 630]\\nvkCreateInstance failed -9\\n'); process.exit(1);`);
  working = { command: process.execPath, prefix: [ok], models: path.join(root, 'models') };
  failing = { command: process.execPath, prefix: [bad], models: path.join(root, 'models') };
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  messages.length = 0;
  fs.rmSync(calls, { force: true });
});

function picture(name: string, width: number, height: number) {
  const file = path.join(root, name);
  fs.writeFileSync(file, `picture ${name}`);
  return { path: file, width, height };
}
const toolCalls = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) : []);

describe('the photo enhancer', () => {
  it('measures the stretch the way the template shows the picture', () => {
    // peter buchignani's pictures: the upright one is shown whole, the square one fills its place.
    expect(displayScale({ width: 600, height: 900 }, BODY)).toBeCloseTo(1.2);
    expect(displayScale({ width: 455, height: 455 }, BODY)).toBeCloseTo(2.37, 2);
    expect(displayScale({ width: 600, height: 900 }, HALF)).toBeCloseTo(1.2);
    expect(displayScale({ width: 455, height: 455 }, HALF)).toBeCloseTo(2.37, 2);
    expect(displayScale({ width: 2048, height: 1365 }, BODY)).toBeLessThan(1);
  });

  it('leaves pictures that are big enough alone', async () => {
    const big = picture('big.jpg', 600, 900);
    expect(await enhancePicture(big, BODY, log, working)).toBe(big.path);
    expect(toolCalls()).toEqual([]);
    expect(messages).toEqual(['info Photo enhancer: big.jpg (600×900) left as it is — sharp, and stretched only 1.2×']);
  });

  it('sharpens a soft picture that is big enough, giving the tool a quarter of the size it is shown at', async () => {
    // Seen live (gary phillip spector): a 1960×1441 photo, far softer than the rest, stayed blurred.
    const file = path.join(root, 'soft.jpg');
    await sharp({ create: { width: 1960, height: 1441, channels: 3, background: '#777777' } }).jpeg().toFile(file);
    const out = await enhancePicture({ path: file, width: 1960, height: 1441 }, BODY, log, working, true);
    expect(out).toBe(path.join(root, 'soft.enhanced.png'));
    const [call] = toolCalls();
    expect(call[1]).toBe(path.join(root, 'soft.soft-input.png'));
    // Shown whole at 0.75× (1468×1080) in the body image: a quarter of that goes in, and is removed afterwards.
    expect(await sharp(fs.readFileSync(out)).metadata()).toMatchObject({ width: 367, height: 270 });
    expect(fs.existsSync(path.join(root, 'soft.soft-input.png'))).toBe(false);
    expect(messages).toEqual([expect.stringMatching(/^info Photo enhancer: soft\.jpg \(1960×1441\) was soft — sharpened with Upscayl \(remacri-4x\) in \d+s$/)]);
  });

  it('enlarges a small picture 4× with the remacri model and reuses the result on a retry', async () => {
    const small = picture('small.jpg', 455, 455);
    const out = await enhancePicture(small, BODY, log, working);
    expect(out).toBe(path.join(root, 'small.enhanced.png'));
    expect(fs.existsSync(out)).toBe(true);
    expect(toolCalls()).toEqual([
      ['-i', small.path, '-o', out, '-n', 'remacri-4x', '-s', '4', '-m', working.models, '-f', 'png'],
    ]);
    expect(messages).toEqual([expect.stringMatching(/^info Photo enhancer: small\.jpg \(455×455\) enlarged 4× with Upscayl \(remacri-4x\) in \d+s \(it was stretched 2\.4×\)$/)]);
    expect(await enhancePicture(small, BODY, log, working)).toBe(out);
    expect(toolCalls()).toHaveLength(1);
  });

  it('keeps the original and says why when the tool fails or is missing', async () => {
    const small = picture('other.jpg', 400, 400);
    expect(await enhancePicture(small, BODY, log, failing)).toBe(small.path);
    expect(fs.existsSync(path.join(root, 'other.enhanced.png'))).toBe(false);
    expect(await enhancePicture(small, BODY, log, null)).toBe(small.path);
    expect(messages).toEqual([
      'warn Photo enhancer: other.jpg (400×400) could not be enhanced ([0 Intel(R) UHD Graphics 630] vkCreateInstance failed -9) — original used',
      'warn Photo enhancer: other.jpg (400×400) is stretched 2.7× but Upscayl (remacri-4x) is not installed in data\\tools\\upscayl — original used',
    ]);
  });

  it('finds Upscayl where the zip was unpacked, only with the chosen model', () => {
    const tools = path.join(root, 'tools');
    const folder = path.join(tools, 'upscayl-bin-20251207-174704-windows');
    fs.mkdirSync(path.join(folder, 'models'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'upscayl-bin.exe'), '');
    fs.writeFileSync(path.join(folder, 'models', 'upscayl-standard-4x.bin'), '');
    expect(findEnhancer(tools)).toBeNull();
    fs.writeFileSync(path.join(folder, 'models', 'remacri-4x.bin'), '');
    expect(findEnhancer(tools)).toEqual({ command: path.join(folder, 'upscayl-bin.exe'), models: path.join(folder, 'models') });
    expect(findEnhancer(path.join(root, 'nothing-here'))).toBeNull();
  });
});
