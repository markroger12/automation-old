// Shows what a website's article images will look like: the real renderer is used, so the preview and the published
// image come out of the same code. Sample pictures stand in for the ones ChatGPT creates.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { findBrowserExecutable } from '@/automation/browser/system-browser';
import { IMAGE_SIZE } from '@/automation/images/store';
import { DIVIDER_WIDTH, picturesFor, renderTemplate, templateFor, type TemplateWebsite, type WebsiteTemplate } from '@/automation/images/template';
import { templatesRoot } from '@/lib/paths';

const SAMPLES = path.join('samples');

interface Sample {
  file: string;
  width: number;
  height: number;
  colours: [string, string];
}

const halfSize = { width: (IMAGE_SIZE.width - DIVIDER_WIDTH) / 2, height: IMAGE_SIZE.height };

function samples(): { half: Sample[]; wide: Sample } {
  const dir = path.join(templatesRoot(), SAMPLES);
  return {
    half: [
      { file: path.join(dir, 'half-1.jpg'), ...halfSize, colours: ['#6b7f99', '#d9c7a8'] },
      { file: path.join(dir, 'half-2.jpg'), ...halfSize, colours: ['#8a6f8e', '#cfd8dc'] },
    ],
    wide: { file: path.join(dir, 'wide.jpg'), ...IMAGE_SIZE, colours: ['#5c7a89', '#e0d6c3'] },
  };
}

/** Draws the stand-in pictures once; they only need to show where a picture sits, not what is in it. */
async function ensureSamples(): Promise<void> {
  const all = [...samples().half, samples().wide];
  if (all.every((sample) => fs.existsSync(sample.file))) return;
  await fsp.mkdir(path.dirname(all[0].file), { recursive: true });
  const executablePath = findBrowserExecutable('chrome') ?? findBrowserExecutable('chromium') ?? undefined;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    for (const sample of all) {
      if (fs.existsSync(sample.file)) continue;
      const page = await browser.newPage({ viewport: { width: sample.width, height: sample.height } });
      await page.setContent(
        `<html><body style="margin:0"><div style="width:${sample.width}px;height:${sample.height}px;
          background:linear-gradient(135deg,${sample.colours[0]},${sample.colours[1]});"></div></body></html>`,
      );
      await page.screenshot({ path: sample.file, type: 'jpeg', quality: 80 });
      await page.close();
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export interface PreviewSettings {
  accentColour?: string | null;
  logoPosition?: string | null;
  featuredStyle?: string | null;
  /** The design being edited — not saved yet. */
  design?: { featured?: unknown; body?: unknown } | null;
}

export interface TemplatePreview {
  /** JPEG data URLs, ready for an <img> tag. */
  featured: string;
  body: string;
  /** The colour the line really got (it can come from the logo). */
  accent: string;
  logo: boolean;
}

const dataUrl = async (file: string) => `data:image/jpeg;base64,${(await fsp.readFile(file)).toString('base64')}`;

/** Builds the two preview images for one website, using settings that are not saved yet. */
export async function templatePreview(website: TemplateWebsite, settings: PreviewSettings = {}): Promise<TemplatePreview> {
  await ensureSamples();
  const template: WebsiteTemplate = templateFor({
    ...website,
    accentColour: settings.accentColour ?? website.accentColour ?? null,
    logoPosition: settings.logoPosition ?? website.logoPosition ?? null,
    featuredStyle: settings.featuredStyle ?? website.featuredStyle ?? null,
    imageTemplate: settings.design ?? website.imageTemplate ?? null,
  });
  const sample = samples();
  const work = await fsp.mkdtemp(path.join(templatesRoot(), 'preview-'));
  try {
    const featuredFile = path.join(work, 'featured.jpg');
    const bodyFile = path.join(work, 'body.jpg');
    // One stand-in picture per place in the design; upright places get the upright sample.
    const pictures = picturesFor(template, 'featured').map((place, index) =>
      place.width < place.height ? sample.half[index % sample.half.length].file : sample.wide.file,
    );
    const bodyPictures = picturesFor(template, 'body').map((place, index) =>
      place.width < place.height ? sample.half[index % sample.half.length].file : sample.wide.file,
    );
    const { accent } = await renderTemplate(pictures, template, featuredFile, 'featured');
    await renderTemplate(bodyPictures, template, bodyFile, 'body');
    return { featured: await dataUrl(featuredFile), body: await dataUrl(bodyFile), accent, logo: Boolean(template.logo) };
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
