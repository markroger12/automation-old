import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestIndexing } from '@/automation/google/search-console';

let browser: Browser;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-indexing-test-'));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
beforeAll(async () => {
  const store = path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
  const executablePath = fs.readdirSync(store).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()
    .map((name) => path.join(store, name, 'chrome-win64/chrome.exe')).find(fs.existsSync);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
afterAll(async () => { await browser?.close(); fs.rmSync(folder, { recursive: true, force: true }); });

async function fixture(mode: 'success' | 'quota' | 'indexed' | 'timeout'): Promise<Page> {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: `
    <input role="combobox" aria-label="Inspect any URL">
    <div id="inspection" hidden><p>https://example.com/old-article/</p>
      <h1>${mode === 'indexed' ? 'URL is on Google' : 'URL is not on Google'}</h1>
      <button id="request">Request indexing</button>
    </div>
    <div hidden>Indexing requested</div><div hidden>Quota exceeded</div>
    <script>
      window.clicks=0;
      document.querySelector('input').onkeydown=e=>{if(e.key==='Enter')document.querySelector('#inspection').hidden=false};
      document.querySelector('#request').onclick=()=>{
        window.clicks++;
        const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='Testing if live URL can be indexed';document.body.appendChild(dialog);
        setTimeout(()=>{dialog.innerHTML=${JSON.stringify(mode === 'success' ? '<h2>Indexing requested</h2><p>URL was added to a priority crawl queue.</p><button>Dismiss</button>' : mode === 'quota' ? '<h2>Quota exceeded</h2><p>You have exceeded your quota.</p>' : 'Testing if live URL can be indexed')};},150);
      };
    </script>` }));
  return page;
}

describe('Search Console confirmation', () => {
  it('finds visible success after hidden duplicate dialogs and captures the popup', async () => {
    const page = await fixture('success');
    try {
      const screenshotPath = path.join(folder, 'success.png');
      expect(await requestIndexing(page, { property: 'sc-domain:example.com', url: 'https://example.com/old-article/', logger, timeoutMs: 1800, screenshotPath }))
        .toMatchObject({ ok: true, outcome: 'requested', screenshotPath });
      expect(fs.statSync(screenshotPath).size).toBeGreaterThan(1000);
      expect(await page.getByRole('dialog').innerText()).toContain('Indexing requested');
    } finally { await page.close(); }
  });
  it('records a real visible quota message without treating hidden success as confirmation', async () => {
    const page = await fixture('quota');
    try { expect(await requestIndexing(page, { property: 'sc-domain:example.com', url: 'https://example.com/old-article/', logger, timeoutMs: 1800 })).toMatchObject({ ok: false, quotaReached: true }); }
    finally { await page.close(); }
  });
  it('records already-indexed status without submitting another indexing request', async () => {
    const page = await fixture('indexed');
    try {
      expect(await requestIndexing(page, { property: 'sc-domain:example.com', url: 'https://example.com/old-article/', logger, timeoutMs: 1800 })).toMatchObject({ ok: true, outcome: 'already-indexed' });
      expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
    } finally { await page.close(); }
  });
  it('captures an unconfirmed attempt without claiming success or a quota', async () => {
    const page = await fixture('timeout');
    try {
      const result = await requestIndexing(page, { property: 'sc-domain:example.com', url: 'https://example.com/old-article/', logger, timeoutMs: 700, screenshotPath: path.join(folder, 'timeout.png') });
      expect(result).toMatchObject({ ok: false, screenshotPath: expect.any(String) });
      expect(result.quotaReached).toBeUndefined();
    } finally { await page.close(); }
  });
});
