import path from 'node:path';
import type { Page } from 'playwright';
import { ensurePrivateDir, screenshotsRoot } from '@/lib/paths';

/**
 * Saves a viewport screenshot for debugging a failed automation stage.
 * Returns the path relative to the screenshots root (as stored in logs), or null.
 */
export async function captureScreenshot(page: Page | null | undefined, taskId: string | null, label: string): Promise<string | null> {
  if (!page || page.isClosed()) return null;
  try {
    const folder = path.join(screenshotsRoot(), (taskId ?? 'system').replace(/[^a-zA-Z0-9_-]/g, ''));
    await ensurePrivateDir(folder);
    const file = `${new Date().toISOString().replace(/[:.]/g, '-')}-${label.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}.png`;
    const full = path.join(folder, file);
    await page.screenshot({ path: full, fullPage: false, timeout: 15_000, animations: 'disabled' });
    return path.relative(screenshotsRoot(), full).split(path.sep).join('/');
  } catch {
    return null;
  }
}
