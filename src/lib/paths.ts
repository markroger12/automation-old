import path from 'node:path';
import fs from 'node:fs/promises';
import { env } from './env';

export function dataRoot(): string {
  return path.resolve(process.cwd(), env().DATA_DIR);
}

export function profilesRoot(): string {
  return path.join(dataRoot(), 'profiles');
}

/** Images generated for articles (one folder per article). */
export function imagesRoot(): string {
  return path.join(dataRoot(), 'images');
}

export function screenshotsRoot(): string {
  return path.join(dataRoot(), 'screenshots');
}

/** Logos and colours of the website image templates (one set of files per website). */
export function templatesRoot(): string {
  return path.join(dataRoot(), 'templates');
}

const SAFE_SEGMENT = /^[a-zA-Z0-9_-]{1,120}$/;

/** Resolve a stored profile directory name to an absolute path, refusing traversal. */
export function resolveProfileDir(directory: string): string {
  if (!SAFE_SEGMENT.test(directory)) throw new Error(`Invalid profile directory name: ${directory}`);
  const root = profilesRoot();
  const resolved = path.resolve(root, directory);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Profile directory escapes the profiles root');
  return resolved;
}

/** Resolve a relative screenshot path (as stored in logs) to an absolute path inside the screenshots root. */
export function resolveScreenshotPath(relative: string): string | null {
  const root = screenshotsRoot();
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) return null;
  if (!resolved.toLowerCase().endsWith('.png')) return null;
  return resolved;
}

/** Create a directory that only the current OS user can read (best effort on Windows). */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await fs.chmod(dir, 0o700).catch(() => undefined);
  }
}

export function newProfileDirectoryName(prefix: string): string {
  const safePrefix = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profile';
  const rand = Math.random().toString(36).slice(2, 10);
  return `${safePrefix}-${Date.now().toString(36)}-${rand}`;
}
