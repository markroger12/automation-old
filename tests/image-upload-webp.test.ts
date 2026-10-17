// Article images are made as WebP. A WordPress server without WebP support refuses such a file; the same picture then
// goes up as a JPEG. A stand-in WordPress and database play the parts here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PipelineContext } from '@/automation/pipeline/context';

const db = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('@/lib/db', () => ({
  prisma: {
    articleStage: {
      findUnique: async () => ({ data: db.data }),
      update: async ({ data }: { data: { data: Record<string, unknown> } }) => { db.data = data.data; },
    },
  },
}));

const { uploadArticleImages } = await import('@/automation/images/store');
const { AutomationError } = await import('@/automation/errors');

let root = '';
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-upload-webp-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

async function article(refuseWebp: boolean) {
  const file = path.join(root, `peter-${refuseWebp ? 'a' : 'b'}.webp`);
  await sharp({ create: { width: 64, height: 36, channels: 3, background: '#406080' } }).webp().toFile(file);
  db.data = { images: [{ role: 'featured', file, width: 1920, height: 1080, alt: 'Peter – Featured image' }] };
  const uploaded: string[] = [];
  const warnings: string[] = [];
  const wp = {
    uploadMedia: vi.fn(async (upload: string) => {
      uploaded.push(path.basename(upload));
      if (refuseWebp && upload.endsWith('.webp')) {
        throw new AutomationError('WordPress refused the image: This image cannot be processed by the web server. Convert it to JPEG or PNG before uploading.');
      }
      return { id: 77, url: `https://laraix.test/${path.basename(upload)}` };
    }),
    setMediaAlt: vi.fn(async () => true),
  };
  const ctx = {
    taskId: 'task', task: { language: 'English' }, settings: { articleImages: true, defaultLanguage: 'English' },
    wordpress: async () => wp, editor: null,
    log: () => ({ info: () => undefined, warn: (m: string) => warnings.push(m) }),
  } as unknown as PipelineContext;
  await uploadArticleImages(ctx, '<p>Text</p>', 'IMAGES');
  return { file, uploaded, warnings, saved: (db.data.images as { file: string; mediaId: number; url: string }[])[0] };
}

describe('uploading WebP article images', () => {
  it('uploads the WebP file when WordPress takes it', async () => {
    const { uploaded, warnings, saved, file } = await article(false);
    expect(uploaded).toEqual(['peter-b.webp']);
    expect(warnings).toEqual([]);
    expect(saved).toMatchObject({ file, mediaId: 77, url: 'https://laraix.test/peter-b.webp' });
  });

  it('sends the same picture as JPEG when the server cannot process WebP', async () => {
    const { uploaded, warnings, saved, file } = await article(true);
    expect(uploaded).toEqual(['peter-a.webp', 'peter-a.jpg']);
    expect(warnings).toEqual([expect.stringMatching(/^WordPress did not take the WebP image \(WordPress refused the image: This image cannot be processed.*\) — uploading it as JPEG$/)]);
    expect(saved).toMatchObject({ file: file.replace(/\.webp$/, '.jpg'), mediaId: 77, url: 'https://laraix.test/peter-a.jpg' });
    expect((await sharp(fs.readFileSync(saved.file)).metadata()).format).toBe('jpeg');
  });
});
