import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Finds the real browser executable so login windows can be opened as a normal browser,
 * without any automation attached (sites that block automated browsers work normally there).
 */
export function findBrowserExecutable(channel: 'chrome' | 'msedge' | 'chromium', executablePath?: string): string | null {
  if (executablePath) return fs.existsSync(executablePath) ? executablePath : null;
  if (channel === 'chromium') {
    try {
      const bundled = chromium.executablePath();
      return fs.existsSync(bundled) ? bundled : null;
    } catch {
      return null;
    }
  }

  const localAppData = process.env.LOCALAPPDATA ?? '';
  const candidates: string[] =
    process.platform === 'win32'
      ? channel === 'msedge'
        ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
        : [
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            path.join(localAppData, 'Google/Chrome/Application/chrome.exe'),
          ]
      : process.platform === 'darwin'
        ? channel === 'msedge'
          ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
          : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : channel === 'msedge'
          ? ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
          : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];

  return candidates.find((c) => fs.existsSync(c)) ?? null;
}
