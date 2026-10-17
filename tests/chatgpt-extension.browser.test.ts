// End-to-end test of the ChatGPT Worker Chrome extension: Playwright's Chromium with the extension loaded,
// a simulated ChatGPT page, the real /api/extension/agent route on a throwaway SQLite database and the
// worker-side bridge the pipeline uses. Skipped when Chromium or the database cannot be prepared.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import type { AutomationLogger } from '@/lib/logger';

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-extension-test-'));
// Prisma's Windows schema engine needs the SQLite file to exist before migrate deploy.
fs.writeFileSync(path.join(tmp, 'test.db'), '');
// Must be set before anything imports the Prisma client (all app modules are imported dynamically below).
process.env.DATABASE_URL = `file:${path.join(tmp, 'test.db').replace(/\\/g, '/')}`;
// Images the extension sends back are written below DATA_DIR.
process.env.DATA_DIR = path.join(tmp, 'data');

/** A plain-colour PNG (like the pictures ChatGPT creates, 3:2) served by the fake ChatGPT. */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body) >>> 0, 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const GENERATED_PNG = solidPng(1536, 1024, [40, 120, 200]);
const PREVIEW_PNG = solidPng(300, 200, [200, 200, 200]);
const SEARCH_PNGS = Array.from({ length: 6 }, (_, i) => solidPng(1400 + i * 20, 800, [30 + i * 30, 100, 210 - i * 20]));
const DISPLAYED_PNGS = Array.from({ length: 6 }, (_, i) => solidPng(500 + i, 548, [30 + i * 30, 100, 210 - i * 20]));

const silent: AutomationLogger = { debug() {}, info() {}, warn() {}, error() {} };

// Only used inside worker.evaluate(), where the extension APIs exist.
declare const chrome: {
  storage: {
    local: { set(v: object): Promise<void>; get(key: string): Promise<Record<string, unknown>>; remove(key: string): Promise<void> };
    session: { set(v: object): Promise<void>; get(key: string): Promise<Record<string, unknown>> };
  };
};

// Test-only additions that make the fake page behave like today's ChatGPT: conversations survive page loads,
// the Stop button has no "stop-button" test id, a finished answer gets its action buttons, "[pause]" prompts
// stall mid-answer (with Stop still shown) and "[writing-block]" answers arrive as a document-style writing block.
const PAGE_EXTRAS = `<script>
(() => {
  const thread = document.getElementById('thread');
  const saved = sessionStorage.getItem('fake-thread:' + location.pathname);
  if (location.pathname.startsWith('/c/') && saved) thread.innerHTML = saved;
  const save = () => {
    if (location.pathname.startsWith('/c/')) sessionStorage.setItem('fake-thread:' + location.pathname, thread.innerHTML);
  };
  new MutationObserver(save).observe(thread, { childList: true, subtree: true, characterData: true });

  let lastPrompt = '';
  // Like ChatGPT (seen live on 26 September 2026): a long pasted text is not put into the prompt box but becomes an
  // attachment chip, "Pasted text.txt".
  document.addEventListener('paste', (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (!text || text.length < 12000) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.setAttribute('aria-label', 'Remove Pasted text.txt');
    chip.textContent = 'Pasted text.txt';
    chip.onclick = () => chip.remove();
    document.querySelector('form').appendChild(chip);
  }, true);
  // The paperclip: a hidden file field in the prompt form; picked photos show as previews in the form.
  let attached = [];
  const fileField = document.createElement('input');
  fileField.type = 'file';
  fileField.multiple = true;
  fileField.accept = 'image/*';
  fileField.style.display = 'none';
  fileField.addEventListener('change', () => {
    attached = [...fileField.files];
    for (const file of attached) {
      const preview = document.createElement('img');
      preview.src = URL.createObjectURL(file);
      preview.style.cssText = 'width:40px;height:40px';
      fileField.form.appendChild(preview);
    }
  });
  document.querySelector('form').appendChild(fileField);
  window.openFakeGallery = (index) => {
    const viewer = document.createElement('div');
    viewer.setAttribute('role', 'dialog');
    viewer.style.cssText = 'position:fixed;inset:0;background:black;z-index:9999;display:flex;align-items:center;justify-content:center';
    viewer.innerHTML = '<button aria-label="Close">Close</button><img style="width:70vw;height:auto"><button aria-label="Next image">Next</button>';
    const image = viewer.querySelector('img');
    const next = viewer.querySelector('[aria-label="Next image"]');
    const show = () => {
      image.src = window.smallGallery ? 'https://tse4.mm.bing.net/test-gallery-' + index + '.png'
        : window.publisherPicture && index === 2 ? 'https://www.yohanpost.com/wp-content/uploads/test-gallery-2.png'
        : '/img/search-' + index + '.png';
      image.alt = 'https://www.washingtonblade.com/publisher-image-' + index + '.jpg';
      next.disabled = index >= 5;
    };
    next.onclick = () => { index++; show(); };
    viewer.querySelector('[aria-label="Close"]').onclick = () => viewer.remove();
    document.body.appendChild(viewer); show();
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-testid="send-button"], [data-test-id="send-button"]')) return;
    lastPrompt = (document.querySelector('[data-fake-composer]') || document.getElementById('prompt-textarea')).innerText;
    if (lastPrompt.includes('[search-gallery]')) {
      window.smallGallery = lastPrompt.includes('[displayed-file]');
      window.publisherPicture = lastPrompt.includes('[publisher-file]');
      window.__nextAnswer = ' ';
      setTimeout(() => {
        const turn = [...thread.querySelectorAll('article')].pop();
        const gallery = document.createElement('div');
        // Only three small previews are inline; the viewer exposes all six original pictures, like the video.
        gallery.innerHTML = [0, 1, 2].map(i => '<button onclick="window.openFakeGallery(' + i + ')"><img src="/img/preview.png?slide=' + i + '" style="width:180px;height:120px"></button>').join('');
        turn.appendChild(gallery);
      }, 400);
    }
    if (lastPrompt.includes('[image]')) {
      window.__nextAnswer = ' ';
      setTimeout(() => {
        const turn = [...thread.querySelectorAll('article')].pop();
        const box = document.createElement('div');
        box.innerHTML = '<p>Creating image</p><img alt="" src="/img/preview.png" style="filter:blur(8px)">';
        turn.appendChild(box);
        const stop = document.createElement('button');
        stop.setAttribute('aria-label', 'Stop answering');
        stop.textContent = 'Stop';
        document.querySelector('[data-testid="send-button"]').after(stop);
        setTimeout(() => {
          box.innerHTML = '<img alt="Generated image" src="/img/generated.png">';
          stop.remove();
        }, 3000);
      }, 400);
    }
    if (lastPrompt.includes('[canvas]')) {
      // A writing-document answer as the conversation data carries it (justin biel, 26 September 2026).
      window.__nextAnswer = ':::writing{variant="document" id="68431" title="Who Is Justin Biel?"}\\nCanvas article text.\\n\\n## Conclusion\\n\\nLast line of the article.\\n:::';
    }
    if (lastPrompt.includes('[review-photos]')) {
      window.__nextAnswer = attached.map((file, i) => (i + 1) + ': watermark=' + (i === 1 ? 'yes' : 'no') + ' | alt=' + file.name + ' ' + file.size + ' bytes').join('\\n\\n');
    }
    if (lastPrompt.includes('[slow-reveal]')) {
      window.__nextAnswer = 'Slow reveal answer. ' + 'Every sentence of this long answer arrives on the page only after a delay. '.repeat(8) + 'THE END.';
    }
    if (lastPrompt.includes('[shell-page]')) shellPage = true;
    if (lastPrompt.includes('[no-markers]')) {
      noMarkers = true;
      // "[chat-b]": a second marker-less chat of its own, for tabs answering at the same time.
      history.replaceState(null, '', lastPrompt.includes('[chat-b]') ? NO_MARKERS_PATH + '-b' : NO_MARKERS_PATH);
    }
  }, true);

  // "[no-markers]": like ChatGPT's page since September 2026 — the messages carry no data-message-author-role or
  // conversation-turn markers. The conversation data the page is drawn from is handed to the test server instead.
  const NO_MARKERS_PATH = '/c/test-conversation-nomarkers';
  let noMarkers = location.pathname.startsWith(NO_MARKERS_PATH);
  // "[shell-page]": ChatGPT's app-shell page of 30 September 2026 — no Markdown classes and no turn marks; the user's
  // turns carry "user-message" classes and a finished answer has a "turn-action-controls" row of buttons.
  let shellPage = false;
  let postTimer;
  const postConversation = () => {
    // "[stale-chat]": the conversation data does not show the new prompt (yet), as seen live on 25 September 2026.
    if (lastPrompt.includes('[stale-chat]')) return;
    clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      const answering = Boolean(document.querySelector('[aria-label="Stop answering"], [data-testid="stop-button"]'));
      const messages = [...thread.querySelectorAll('[data-x-role], [data-message-author-role]')].map((el) => ({
        role: el.getAttribute('data-x-role') || el.getAttribute('data-message-author-role'),
        text: el.innerText.trim(),
      }));
      fetch('/test/conversation-state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: location.pathname.slice(3), answering, messages }) });
    }, 200);
  };
  new MutationObserver(() => {
    if (!noMarkers) return;
    for (const el of thread.querySelectorAll('[data-message-author-role]')) {
      el.setAttribute('data-x-role', el.getAttribute('data-message-author-role'));
      el.removeAttribute('data-message-author-role');
    }
    for (const el of thread.querySelectorAll('[data-testid^="conversation-turn"]')) {
      el.removeAttribute('data-testid');
    }
    if (shellPage) {
      for (const el of thread.querySelectorAll('.markdown')) el.classList.remove('markdown', 'prose');
      for (const el of thread.querySelectorAll('[data-x-role="user"]')) {
        if (!el.classList.contains('bg-user-message')) el.classList.add('bg-user-message');
        // The live page gives the user's turn its own row of buttons at once.
        if (!el.querySelector('.turn-action-controls')) {
          const userRow = document.createElement('div');
          userRow.className = 'turn-action-controls';
          userRow.innerHTML = '<button aria-label="Edit message">Edit</button>';
          el.appendChild(userRow);
        }
      }
      // The row of buttons ChatGPT puts under a finished answer — the only mark the live page had left.
      const answering = document.querySelector('[data-testid="stop-button"]');
      for (const el of thread.querySelectorAll('[data-x-role="assistant"]')) {
        if (answering || el.querySelector('.turn-action-controls') || !el.innerText.trim()) continue;
        const row = document.createElement('div');
        row.className = 'turn-action-controls flex';
        row.innerHTML = '<button aria-label="Copy">Copy</button><button aria-label="Good response">Good</button>';
        el.appendChild(row);
      }
    }
    postConversation();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  const revealed = new WeakSet();
  const realSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms) => {
    const pause = lastPrompt.includes('[pause]');
    let ticks = 0;
    let pausedUntil = 0;
    return realSetInterval(() => {
      if (pause && ++ticks === 4) pausedUntil = Date.now() + 12000;
      if (Date.now() < pausedUntil) return;
      fn();
    }, ms);
  };

  new MutationObserver(() => {
    const oldStop = document.querySelector('[data-testid="stop-button"]');
    if (oldStop) {
      oldStop.removeAttribute('data-testid');
      oldStop.setAttribute('data-testid', 'composer-action');
      oldStop.setAttribute('aria-label', 'Stop answering');
    }
    if (document.querySelector('[aria-label="Stop answering"]')) return;
    const answers = thread.querySelectorAll('[data-message-author-role="assistant"]');
    const last = answers[answers.length - 1];
    const turn = last?.closest('article');
    if (!turn || turn.querySelector('[data-testid="copy-turn-action-button"]')) return;
    const md = last.querySelector('.markdown');
    if (md && lastPrompt.includes('[writing-block]') && !md.querySelector('[data-testid="writing-block-container"]')) {
      md.innerHTML = '<div data-writing-block-fullscreen-fallback-target="inline"><div data-testid="writing-block-container" data-writing-block="true">'
        + '<div data-testid="writing-block-header-sticky-container"><span>WRITING BLOCK TITLE</span><button aria-label="Copy">Copy</button></div>'
        + '<div class="writing-block-editor"><div class="ProseMirror markdown" data-writing-block-fullscreen-editor-region="true" contenteditable="true">'
        + md.innerHTML + '</div></div></div></div>'
        + '<div data-testid="writing-block-suggested-followups"><button>Make it shorter</button><span>Add a table</span></div>';
    }
    if (md && lastPrompt.includes('[slow-reveal]') && !revealed.has(md)) {
      // Like ChatGPT in a background tab: ChatGPT has finished (buttons shown) but the words appear on the page later.
      revealed.add(md);
      const full = md.textContent;
      md.innerHTML = '<p data-start="0" data-end="' + full.length + '">' + full.slice(0, 20) + '</p>';
      setTimeout(() => {
        md.innerHTML = '<p data-start="0" data-end="' + full.length + '">' + full + '</p>';
      }, 6000);
    }
    const copy = document.createElement('button');
    copy.setAttribute('data-testid', 'copy-turn-action-button');
    copy.setAttribute('aria-label', 'Copy');
    turn.appendChild(copy);
  }).observe(document.body, { childList: true, subtree: true, attributes: true });
})();
</script>`;

/** What the fake page reported for its "[no-markers]" conversation. */
const conversations = new Map<string, { answering: boolean; messages: { role: string; text: string }[] }>();
/** Reads of each conversation's data, and how many of them got HTTP 429. */
const conversationReads = new Map<string, number>();
const rateLimitedReads = new Map<string, number>();

/**
 * The conversation as ChatGPT's /backend-api/conversation/<id> returns it: a hidden system message, and before every
 * answer a web search (a tool call and its result) that the page never shows. Answers carry ChatGPT's own markers for a
 * source and for a named person.
 */
function conversationData(state: { answering: boolean; messages: { role: string; text: string }[] }) {
  const mapping: Record<string, { id: string; parent: string | null; children: string[]; message: Record<string, unknown> | null }> = {};
  let parent: string | null = null;
  const add = (message: Record<string, unknown> | null) => {
    const id = `node-${Object.keys(mapping).length}`;
    mapping[id] = { id, parent, children: [], message: message && { id, ...message } };
    if (parent) mapping[parent].children.push(id);
    parent = id;
  };
  add(null);
  add({ author: { role: 'system' }, content: { content_type: 'text', parts: [''] }, metadata: { is_visually_hidden_from_conversation: true } });
  state.messages.forEach((message, index) => {
    if (message.role === 'user') {
      add({ author: { role: 'user' }, content: { content_type: 'text', parts: [message.text] }, status: 'finished_successfully', recipient: 'all' });
      return;
    }
    const streaming = state.answering && index === state.messages.length - 1;
    // "[preamble]": ChatGPT first says what it will look up, then searches (seen live on 27 September 2026).
    if (state.messages[index - 1]?.text.includes('[preamble]')) {
      add({
        author: { role: 'assistant' },
        recipient: 'all',
        content: { content_type: 'text', parts: ['I’m verifying the exact identity and the claims biography sites repeat. I’ll also compare the main competing pages.'] },
        status: 'finished_successfully',
        end_turn: false,
      });
    }
    add({ author: { role: 'assistant' }, recipient: 'web.run', content: { content_type: 'code', text: 'search("web.run query")' }, status: 'finished_successfully', end_turn: false });
    add({ author: { role: 'tool', name: 'web.run' }, content: { content_type: 'text', parts: ['web.run results'] }, status: 'finished_successfully' });
    add({
      author: { role: 'assistant' },
      recipient: 'all',
      content: { content_type: 'text', parts: [`${message.text}\n\nSource line.citeturn0search1 Played by entity["people","Tia Morita","actress"].`] },
      status: streaming ? 'in_progress' : 'finished_successfully',
      end_turn: streaming ? null : true,
    });
  });
  return { mapping, current_node: parent };
}

type Bridge = typeof import('@/automation/chatgpt/extension-bridge');
type Errors = typeof import('@/automation/errors');

let skipReason: string | null = null;
let server: http.Server | null = null;
let context: BrowserContext | null = null;
let worker: Worker | null = null;
let base = '';
let key = '';
let bridge: Bridge;
let errors: Errors;
let prisma: typeof import('@/lib/db').prisma;

/** The ChatGPT tab (with `path`: the tab showing that address — two tabs may be open). */
async function workerPage(path = ''): Promise<Page> {
  for (let i = 0; i < 100; i++) {
    const page = context!.pages().find((p) => p.url().startsWith(base) && p.url().includes(path));
    if (page) return page;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('The extension did not open a ChatGPT window');
}

function startTabs(count: number) {
  return worker!.evaluate(
    // startWorkers is a top-level function of background.js
    ({ n, area }) =>
      (globalThis as unknown as { startWorkers: (n: number, a: unknown) => Promise<{ ok: boolean; error?: string }> }).startWorkers(n, area),
    { n: count, area: { left: 0, top: 0, width: 1200, height: 900 } },
  );
}

function ask(prompt: string, overrides: Partial<Parameters<Bridge['askChatGPTViaExtension']>[0]> = {}) {
  return bridge.askChatGPTViaExtension({
    taskId: 'task-1',
    stageKey: 'TITLES',
    keyword: 'Sydney Sweeney',
    prompt,
    conversationUrl: null,
    allowReuse: true,
    chatgptUrl: base,
    navigationTimeoutMs: 15_000,
    generationTimeoutMs: 30_000,
    logger: silent,
    shouldAbort: async () => false,
    pollIntervalMs: 250,
    ...overrides,
  });
}

beforeAll(async () => {
  try {
    execSync('npx prisma migrate deploy', { cwd: root, env: process.env, stdio: 'pipe' });
  } catch (err) {
    skipReason = `database could not be created: ${(err as Error).message.split('\n')[0]}`;
    return;
  }

  ({ prisma } = await import('@/lib/db'));
  bridge = await import('@/automation/chatgpt/extension-bridge');
  errors = await import('@/automation/errors');
  const { generateExtensionKey } = await import('@/lib/services/chatgpt-extension');
  const { POST } = await import('@/app/api/extension/agent/route');
  const { NextRequest } = await import('next/server');

  const page = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'fake-chatgpt.html'), 'utf8').replace('</body>', `${PAGE_EXTRAS}</body>`);
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    if (url.pathname === '/api/extension/agent') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
      const response = await POST(new NextRequest(url, { method: req.method, headers, body: Buffer.concat(chunks) }));
      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(await response.text());
    } else if (url.pathname === '/test/conversation-state' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const state = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      conversations.set(state.id, state);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    } else if (url.pathname === '/api/auth/session') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accessToken: 'test-access-token' }));
    } else if (url.pathname.startsWith('/backend-api/conversation/')) {
      const id = url.pathname.split('/').pop() ?? '';
      const state = conversations.get(id);
      conversationReads.set(id, (conversationReads.get(id) ?? 0) + 1);
      // "[rate-limit]": ChatGPT's HTTP 429 for the first reads of the chat (seen live on 30 September 2026);
      // "[rate-limit-hard]": for every read, as it went on for hours that day.
      const hard = state?.messages.some((m) => m.role === 'user' && m.text.includes('[rate-limit-hard]'));
      if (hard || (state?.messages.some((m) => m.role === 'user' && m.text.includes('[rate-limit]')) && (rateLimitedReads.get(id) ?? 0) < 2)) {
        rateLimitedReads.set(id, (rateLimitedReads.get(id) ?? 0) + 1);
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' });
        res.end('{"detail":"Too many requests"}');
        return;
      }
      const status = req.headers.authorization !== 'Bearer test-access-token' ? 401 : state ? 200 : 404;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? JSON.stringify(conversationData(state!)) : '{}');
    } else if (url.pathname === '/automation-chrome') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Automation Chrome</title><h1>This is the Automation Chrome</h1>');
    } else if (/^\/img\/search-[0-5]\.png$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(SEARCH_PNGS[Number(url.pathname.match(/search-(\d)/)![1])]);
    } else if (/^\/img\/displayed-[0-5]\.png$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(DISPLAYED_PNGS[Number(url.pathname.match(/displayed-(\d)/)![1])]);
    } else if (url.pathname === '/img/generated.png' || url.pathname === '/img/preview.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(url.pathname.endsWith('generated.png') ? GENERATED_PNG : PREVIEW_PNG);
    } else if (url.pathname === '/' || url.pathname.startsWith('/c/')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

  await prisma.setting.upsert({ where: { key: 'chatgptUrl' }, create: { key: 'chatgptUrl', value: base }, update: { value: base } });
  key = await generateExtensionKey();

  // The shipped extension only runs on chatgpt.com; the test copy also runs on the fake page.
  const extensionDir = path.join(tmp, 'extension');
  fs.cpSync(path.join(root, 'extension'), extensionDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
  fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify(manifest));

  // Branded Chrome ignores --load-extension, so this needs Playwright's Chromium (any installed build).
  const args = [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`];
  const launch = (executablePath?: string, channel = 'chromium') =>
    chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...(executablePath ? { executablePath } : { channel }),
      headless: true,
      args,
    });
  try {
    try {
      context = await launch();
    } catch (err) {
      const store = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.cache'), 'ms-playwright');
      const builds = fs.existsSync(store) ? fs.readdirSync(store).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
      const exe = builds
        .map((d) => path.join(store, d, process.platform === 'win32' ? 'chrome-win64/chrome.exe' : 'chrome-linux/chrome'))
        .find((p) => fs.existsSync(p));
      // No Playwright Chromium on this computer (its folder was cleared on 30 September 2026): Microsoft Edge still
      // loads an unpacked extension from the command line, unlike branded Chrome.
      context = exe ? await launch(exe) : await launch(undefined, 'msedge').catch(() => Promise.reject(err));
    }
    const started = context!;
    worker = started.serviceWorkers()[0] ?? (await started.waitForEvent('serviceworker', { timeout: 15_000 }));
  } catch (err) {
    skipReason = `Chromium with extensions could not start: ${(err as Error).message.split('\n')[0]}`;
    return;
  }

  await worker.evaluate(({ appUrl, connectionKey }) => chrome.storage.local.set({ appUrl, key: connectionKey }), {
    appUrl: base.replace(/\/$/, ''),
    connectionKey: key,
  });
  // Tests control when idle tabs close (the extension's own 30-second check would otherwise close them between tests).
  await worker.evaluate(() => {
    (globalThis as unknown as { BAS_IDLE_CLOSE_MS: number }).BAS_IDLE_CLOSE_MS = 60 * 60_000;
  });
  const started = await startTabs(1);
  if (!started.ok) skipReason = `extension could not start: ${started.error}`;
}, 120_000);

afterAll(async () => {
  await context?.close().catch(() => undefined);
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  await prisma?.$disconnect().catch(() => undefined);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

describe('ChatGPT Worker extension (browser)', () => {
  it('prepares the environment', () => {
    if (skipReason) console.warn(`Extension tests skipped: ${skipReason}`);
    expect(true).toBe(true);
  });

  it('rejects requests without the right connection key', async () => {
    if (skipReason) return;
    const res = await fetch(new URL('/api/extension/agent', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-key' },
      body: JSON.stringify({ action: 'hello', clientId: 'test-client-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('answers prompts in one conversation, recovers instead of re-sending, and reopens the conversation', async () => {
    if (skipReason) return;
    const prompt1 = 'Generate some best titles for my blog post.\n\nTarget keyword:\n"Sydney Sweeney"';
    const first = await ask(prompt1);
    expect(first.reusedExisting).toBe(false);
    expect(first.text).toContain('Answer to: Generate some best titles');
    expect(first.html).toContain('<h2>Result</h2>');
    expect(first.conversationUrl).toBe(`${base}c/test-conversation-1`);

    const page = await workerPage();
    const users = page.locator('[data-message-author-role="user"]');
    expect(await users.count()).toBe(1);
    expect(await users.first().innerText()).toContain('Target keyword:');

    const prompt2 = 'Now write the research notes.';
    const second = await ask(prompt2, { stageKey: 'RESEARCH', conversationUrl: first.conversationUrl });
    expect(second.text).toContain('Answer to: Now write the research notes');
    expect(await users.count()).toBe(2);

    // A retry of the same prompt returns the existing answer instead of sending it twice.
    const retry = await ask(prompt2, { stageKey: 'RESEARCH', conversationUrl: first.conversationUrl });
    expect(retry.reusedExisting).toBe(true);
    expect(await users.count()).toBe(2);

    // The tab moved away: the extension opens the saved conversation again and continues there.
    await page.goto(base);
    const third = await ask('Write the long article.', { stageKey: 'LONG_ARTICLE', conversationUrl: first.conversationUrl });
    expect(third.text).toContain('Answer to: Write the long article.');
    const reopened = await workerPage();
    expect(reopened.url()).toBe(`${base}c/test-conversation-1`);
    expect(await reopened.locator('[data-message-author-role="user"]').count()).toBe(3);

    // A new prompt that only starts like the one before it (the first 160 characters and more are the same, as with
    // two image prompts) is sent — it is not answered with the earlier answer.
    const shared =
      'Create this image now, landscape (wide) format: Create a landscape body image as a simple minimal flat ' +
      'illustration with soft colours and a plain light background. Show another key part of the article: ';
    const bodyOne = await ask(`${shared}a person reading technology news on a laptop.`, { stageKey: 'IMAGES', conversationUrl: first.conversationUrl });
    expect(bodyOne.reusedExisting).toBe(false);
    const bodyTwo = await ask(`${shared}a checklist next to a browser window comparing two sources.`, {
      stageKey: 'IMAGES',
      conversationUrl: first.conversationUrl,
    });
    expect(bodyTwo.reusedExisting).toBe(false);
    expect(await reopened.locator('[data-message-author-role="user"]').count()).toBe(5);
  }, 120_000);

  it('waits for a created image and returns it cropped to 1920×1080 as a JPEG file', async () => {
    if (skipReason) return;
    const answer = await ask('[image] Create this image now, landscape (wide) format: a minimal flat illustration', {
      stageKey: 'IMAGES',
      images: { count: 1, width: 1920, height: 1080 },
    });
    expect(answer.files).toHaveLength(1);
    const [file] = answer.files;
    expect(file).toMatchObject({ mime: 'image/jpeg', width: 1920, height: 1080 });
    expect(file.path.startsWith(path.join(tmp, 'data', 'images'))).toBe(true);
    const bytes = fs.readFileSync(file.path);
    // A JPEG (not the blurred preview and not the original PNG).
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(file.bytes).toBe(bytes.length);
  }, 90_000);

  it('opens search thumbnails, collects the six gallery originals and reuses the answer on retry', async () => {
    if (skipReason) return;
    const earlier = await ask('[image] Create a landscape illustration before the gallery.', {
      stageKey: 'IMAGES', images: { count: 1, width: 1920, height: 1080 },
    });
    const prompt = '[search-gallery] Search On google and give me any random colors pic high quality 5 to 10 pic simple pic random color.';
    const options = { stageKey: 'IMAGES', conversationUrl: earlier.conversationUrl, images: { source: 'search' as const, count: 10, width: 1920, height: 1080 } };
    const answer = await ask(prompt, options);
    expect(answer.files).toHaveLength(6);
    expect(answer.files.map((file) => file.width)).toEqual([1400, 1420, 1440, 1460, 1480, 1500]);
    expect(answer.files.every((file) => file.height === 800)).toBe(true);
    const page = await workerPage();
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    const users = await page.locator('[data-message-author-role="user"]').count();
    const retry = await ask(prompt, { ...options, conversationUrl: answer.conversationUrl });
    expect(retry.reusedExisting).toBe(true);
    expect(retry.files).toHaveLength(6);
    expect(await page.locator('[data-message-author-role="user"]').count()).toBe(users);
  }, 120_000);

  it('collects a search gallery when ChatGPT omits message-role markers', async () => {
    if (skipReason) return;
    const answer = await ask('[search-gallery] [no-markers] Find simple colour backgrounds', {
      taskId: 'task-search-no-markers', stageKey: 'IMAGES',
      images: { source: 'search', count: 10, width: 1920, height: 1080 },
    });
    expect(answer.files).toHaveLength(6);
    expect(answer.files.map((file) => file.width)).toEqual([1400, 1420, 1440, 1460, 1480, 1500]);
  }, 120_000);

  it('still collects the gallery when the conversation data does not show the new prompt', async () => {
    if (skipReason) return;
    // Seen live (peter buchignani): the pictures were on the page, but the prompt never showed up in the chat's data,
    // so the extension waited until its time ran out. Pictures that appeared after sending are this answer's.
    const answer = await ask('[search-gallery] [no-markers] [stale-chat] Find article pictures', {
      taskId: 'task-search-stale-chat', stageKey: 'IMAGES',
      images: { source: 'search', count: 10, width: 1920, height: 1080 },
    });
    expect(answer.files).toHaveLength(6);
  }, 120_000);

  it('stops waiting for a picture gallery soon after ChatGPT answered the search with text only', async () => {
    if (skipReason) return;
    // Seen live (gary phillip spector): the answer was text and links, and the extension waited the full ten minutes.
    const started = Date.now();
    await expect(
      ask('Search photos of a private person [text only]', {
        taskId: 'task-no-gallery', stageKey: 'IMAGES', images: { source: 'search', count: 10, width: 1920, height: 1080, noGalleryAfterMs: 2000 },
      }),
    ).rejects.toThrow(/did not show an image-search gallery .*its answer ended without pictures/);
    expect(Date.now() - started).toBeLessThan(25_000);
  }, 60_000);

  it('types a very long prompt instead of pasting it, so ChatGPT does not turn it into a "Pasted text" file', async () => {
    if (skipReason) return;
    // Seen live (gary phillip spector): the External Links prompt carries the whole 2,300-word article.
    const prompt = 'Suggest links [long prompt] for this article. ' + 'The article is repeated here in full. '.repeat(460);
    expect(prompt.length).toBeGreaterThan(17000);
    const answer = await ask(prompt, { taskId: 'task-long-prompt', stageKey: 'EXTERNAL_LINKS' });
    expect(answer.text).toContain('Answer to: Suggest links [long prompt]');
    const page = await workerPage(new URL(answer.conversationUrl!).pathname);
    expect(await page.locator('[aria-label="Remove Pasted text.txt"]').count()).toBe(0);
    expect((await page.locator('[data-message-author-role="user"]').last().innerText()).length).toBeGreaterThan(17000);
  }, 120_000);

  it('hands over a writing-document answer without ChatGPT\'s ":::writing" marks', async () => {
    if (skipReason) return;
    const answer = await ask('[canvas] Rewrite the article into its final version.', { taskId: 'task-canvas', stageKey: 'FINAL_ARTICLE' });
    expect(answer.text).toContain('Canvas article text.');
    expect(answer.text).toContain('Last line of the article.');
    expect(answer.text).not.toContain(':::');
    expect(answer.text).not.toContain('writing{');
  }, 120_000);

  it('attaches photos to the prompt through ChatGPT\'s own file field and waits for their previews', async () => {
    if (skipReason) return;
    const photos = DISPLAYED_PNGS.slice(0, 2).map((png, i) => ({ name: `photo-${i + 1}.png`, mime: 'image/png' as const, data: png.toString('base64') }));
    const answer = await ask('[review-photos] Check these photos', { taskId: 'task-review', stageKey: 'IMAGES', attachments: photos });
    expect(answer.text).toContain(`1: watermark=no | alt=photo-1.png ${DISPLAYED_PNGS[0].length} bytes`);
    expect(answer.text).toContain(`2: watermark=yes | alt=photo-2.png ${DISPLAYED_PNGS[1].length} bytes`);
    // The photos were only needed to send the prompt: the queue does not keep them.
    const job = await prisma.queueJob.findFirst({ where: { taskId: 'task-review' }, orderBy: { createdAt: 'desc' } });
    expect(job?.data).not.toHaveProperty('attachments');
  }, 120_000);

  it('hands a picture shown straight from the publisher\'s site to the worker, which downloads that same file', async () => {
    if (skipReason) return;
    // Seen live (peter buchignani): 4 of 6 gallery pictures came from the publishers' sites (www.yohanpost.com,
    // www.marriedceleb.com). Neither the page (no CORS) nor the extension (limited sites) can read them.
    await context!.route('https://www.yohanpost.com/**', (route) =>
      route.request().resourceType() === 'image' ? route.fulfill({ contentType: 'image/png', body: DISPLAYED_PNGS[2] }) : route.abort());
    const warnings: string[] = [];
    const downloads: string[] = [];
    try {
      const answer = await ask('[search-gallery] [publisher-file] Find article pictures', {
        taskId: 'task-publisher-file', stageKey: 'IMAGES', images: { source: 'search', count: 10, width: 1920, height: 1080 },
        logger: { ...silent, warn: (message: string) => { warnings.push(message); } },
        downloadPicture: async (url, fileBase) => {
          downloads.push(url);
          fs.writeFileSync(`${fileBase}.png`, DISPLAYED_PNGS[2]);
          return { path: `${fileBase}.png`, mime: 'image/png', width: 502, height: 548, bytes: DISPLAYED_PNGS[2].length };
        },
      });
      expect(downloads).toEqual(['https://www.yohanpost.com/wp-content/uploads/test-gallery-2.png']);
      expect(answer.files).toHaveLength(6);
      expect(fs.readFileSync(answer.files[5].path).equals(DISPLAYED_PNGS[2])).toBe(true);
      expect(warnings).toEqual([]);
    } finally {
      await context!.unroute('https://www.yohanpost.com/**');
    }
  }, 120_000);

  it('saves the displayed 500px gallery files unchanged without fetching publisher URLs from alt text', async () => {
    if (skipReason) return;
    // Image elements can display cross-origin files while page fetch is blocked by CORS.
    const publisherRequests: string[] = [];
    await context!.route('https://www.washingtonblade.com/**', (route) => { publisherRequests.push(route.request().url()); return route.abort(); });
    await context!.route('https://tse4.mm.bing.net/**', (route) => {
      if (route.request().resourceType() !== 'image') return route.abort();
      const index = Number(route.request().url().match(/test-gallery-(\d)/)![1]);
      return route.fulfill({ contentType: 'image/png', body: DISPLAYED_PNGS[index] });
    });
    await worker!.evaluate((fixtureBase) => {
      const originalFetch = globalThis.fetch;
      Object.assign(globalThis, { testOriginalFetch: originalFetch, testImageRequests: [] });
      globalThis.fetch = async (input, init) => {
        const match = String(input).match(/^https:\/\/tse4\.mm\.bing\.net\/test-gallery-(\d)\.png$/);
        if (match) {
          (globalThis as unknown as { testImageRequests: unknown[] }).testImageRequests.push(init?.credentials);
          return originalFetch(fixtureBase + 'img/displayed-' + match[1] + '.png', init);
        }
        return originalFetch(input, init);
      };
    }, base);
    try {
      const answer = await ask('[search-gallery] [displayed-file] Find article pictures', {
        taskId: 'task-displayed-file', stageKey: 'IMAGES', images: { source: 'search', count: 10, width: 1920, height: 1080 },
      });
      expect(answer.files.map((file) => file.width)).toEqual([500, 501, 502, 503, 504, 505]);
      for (const [index, file] of answer.files.entries()) {
        expect(file).toMatchObject({ mime: 'image/png', height: 548 });
        expect(fs.readFileSync(file.path).equals(DISPLAYED_PNGS[index])).toBe(true);
      }
      expect(await worker!.evaluate(() => (globalThis as unknown as { testImageRequests: unknown[] }).testImageRequests)).toEqual(Array(6).fill('omit'));
      expect(publisherRequests).toEqual([]);
      expect((await workerPage()).url()).toContain(base);
      expect(context!.pages().some((page) => page.url().startsWith('https://example.com'))).toBe(false);
    } finally {
      await worker!.evaluate(() => { globalThis.fetch = (globalThis as unknown as { testOriginalFetch: typeof fetch }).testOriginalFetch; });
      await context!.unroute('https://tse4.mm.bing.net/**');
      await context!.unroute('https://www.washingtonblade.com/**');
    }
  }, 120_000);

  it('writes two articles at the same time in two tabs of one window', async () => {
    if (skipReason) return;
    expect((await startTabs(2)).ok).toBe(true);
    const [a, b] = await Promise.all([
      ask('Titles for article A.', { taskId: 'task-a' }),
      ask('Titles for article B.', { taskId: 'task-b' }),
    ]);
    expect(a.text).toContain('Answer to: Titles for article A.');
    expect(b.text).toContain('Answer to: Titles for article B.');

    const jobs = await prisma.queueJob.findMany({ where: { queue: 'chatgpt', taskId: { in: ['task-a', 'task-b'] } } });
    expect(new Set(jobs.map((j) => j.lockedBy)).size).toBe(2); // answered by two different tabs
    const workers = (await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers as Record<string, { windowId: number }>;
    expect(Object.keys(workers)).toHaveLength(2);
    expect(new Set(Object.values(workers).map((w) => w.windowId)).size).toBe(1);
    // Back to one tab for the tests after this one. Both tabs show the same fake conversation address, so the
    // writing-document tests below could change one tab while the other one answered (they failed now and then).
    await worker!.evaluate(async () => {
      const g = globalThis as unknown as { BAS_IDLE_CLOSE_MS: number; closeIdleWorkers: (keep: number) => Promise<void> };
      g.BAS_IDLE_CLOSE_MS = 0;
      await g.closeIdleWorkers(1);
      g.BAS_IDLE_CLOSE_MS = 60 * 60_000;
    });
    for (let i = 0; i < 50 && context!.pages().filter((p) => p.url().startsWith(base)).length > 1; i++) await new Promise((r) => setTimeout(r, 100));
  }, 120_000);

  it('waits through a pause in the answer while ChatGPT still shows its Stop button', async () => {
    if (skipReason) return;
    const answer = await ask('Write the article [pause]', { taskId: 'task-pause' });
    expect(answer.text).toContain('Answer to: Write the article [pause]');
    expect(answer.text).toContain('as part of the article.');
  }, 120_000);

  it('waits until the whole answer is on the page even when ChatGPT already shows its buttons', async () => {
    if (skipReason) return;
    const answer = await ask('Write it [slow-reveal]', { taskId: 'task-slow' });
    expect(answer.text).toContain('THE END.');
  }, 120_000);

  it('reads a writing-block answer without its title bar and follow-up suggestions', async () => {
    if (skipReason) return;
    const answer = await ask('Write the final article [writing-block]', { taskId: 'task-writing-block' });
    expect(answer.text).toContain('Answer to: Write the final article');
    expect(answer.html).toContain('<h2>Result</h2>');
    expect(answer.text).not.toContain('WRITING BLOCK TITLE');
    expect(answer.html).not.toContain('Make it shorter');
  }, 120_000);

  it('sends the next prompt to the chat composer without editing a writing document', async () => {
    if (skipReason) return;
    const first = await ask('Write an article before final editing.');
    // The tab that has this conversation open (an earlier test can leave a second ChatGPT tab).
    const page = await workerPage(new URL(first.conversationUrl!).pathname);
    await page.evaluate(() => {
      const doc = document.createElement('section');
      doc.setAttribute('data-test-id', 'chatgpt-writing-block');
      doc.innerHTML = '<div class="ProseMirror" contenteditable="true" id="article-document">Original article: do not overwrite.</div>';
      document.body.prepend(doc);
      const composer = document.getElementById('prompt-textarea')!;
      composer.id = 'new-chat-composer';
      composer.setAttribute('data-fake-composer', 'true');
      composer.setAttribute('role', 'textbox');
      composer.setAttribute('data-placeholder', 'Ask anything');
      const button = document.querySelector('[data-testid="send-button"]')!;
      button.removeAttribute('data-testid');
      button.setAttribute('data-test-id', 'send-button');
    });
    const prompt = 'Rewrite the previous article into its final version.';
    const final = await ask(prompt, { stageKey: 'FINAL_ARTICLE', conversationUrl: first.conversationUrl });
    expect(final.text).toContain('Answer to: Rewrite the previous article');
    expect(await page.locator('#article-document').innerText()).toBe('Original article: do not overwrite.');
    expect(await page.locator('[data-message-author-role="user"]').last().innerText()).toBe(prompt);
    const retry = await ask(prompt, { stageKey: 'FINAL_ARTICLE', conversationUrl: first.conversationUrl });
    expect(retry.reusedExisting).toBe(true);
    expect(await page.locator('[data-message-author-role="user"]').count()).toBe(2);
  }, 120_000);

  it('reopens the conversation when only a full-screen document editor is visible', async () => {
    if (skipReason) return;
    const first = await ask('Write an article before opening the writing app.');
    const page = await workerPage(new URL(first.conversationUrl!).pathname);
    await page.evaluate(() => {
      document.querySelector('form')!.remove();
      const doc = document.createElement('section');
      doc.setAttribute('data-test-id', 'chatgpt-writing-block');
      doc.innerHTML = '<div class="ProseMirror" contenteditable="true">Full-screen document.</div>';
      document.body.prepend(doc);
    });
    const final = await ask('Finish the article after closing the writing app.', { stageKey: 'FINAL_ARTICLE', conversationUrl: first.conversationUrl });
    expect(final.text).toContain('Answer to: Finish the article after closing');
    expect(await page.locator('#prompt-textarea').count()).toBe(1);
  }, 120_000);

  it('reads the prompt and the answer from the conversation when the page has no message markers (ChatGPT, September 2026)', async () => {
    if (skipReason) return;
    const prompt = 'Generate some best titles [no-markers] for Tia Morita';
    const answer = await ask(prompt, { taskId: 'task-no-markers' });
    expect(answer.reusedExisting).toBe(false);
    expect(answer.text).toContain('Answer to: Generate some best titles');
    // ChatGPT's source marker is dropped, a named person keeps the name; the web search is not part of the answer.
    expect(answer.text).toContain('Source line. Played by Tia Morita.');
    expect(answer.text).not.toMatch(/turn0search|web\.run||/);
    expect(answer.conversationUrl).toBe(`${base}c/test-conversation-nomarkers`);
    const page = await workerPage('test-conversation-nomarkers');
    expect(await page.locator('[data-message-author-role]').count()).toBe(0);
    expect(await page.locator('[data-x-role="user"]').count()).toBe(1);

    // Retried: the saved conversation opens and its answer is returned instead of sending the prompt again.
    const retry = await ask(prompt, { taskId: 'task-no-markers', conversationUrl: answer.conversationUrl });
    expect(retry.reusedExisting).toBe(true);
    expect(retry.text).toContain('Played by Tia Morita.');
    expect(await (await workerPage('test-conversation-nomarkers')).locator('[data-x-role="user"]').count()).toBe(1);

    // The next prompt in that conversation is sent and answered the same way.
    const next = await ask('Now write the research notes.', { taskId: 'task-no-markers', stageKey: 'RESEARCH', conversationUrl: answer.conversationUrl });
    expect(next.reusedExisting).toBe(false);
    expect(next.text).toContain('Answer to: Now write the research notes.');
    expect(await (await workerPage('test-conversation-nomarkers')).locator('[data-x-role="user"]').count()).toBe(2);

    // What ChatGPT says before its web search is its plan, not the answer: it must not open the article.
    const article = await ask('Write the article [preamble] now.', { taskId: 'task-no-markers', stageKey: 'ARTICLE', conversationUrl: answer.conversationUrl });
    expect(article.text).toContain('Answer to: Write the article [preamble] now.');
    expect(article.text).not.toContain('I’m verifying');
    expect(article.text.startsWith('Result\n\nAnswer to:')).toBe(true);
  }, 120_000);

  it('waits as long as ChatGPT asks after HTTP 429 and still reads the answer, reading the chat sparingly (30 September 2026)', async () => {
    if (skipReason) return;
    const id = 'test-conversation-nomarkers';
    rateLimitedReads.delete(id);
    const before = conversationReads.get(id) ?? 0;
    const started = Date.now();
    const answer = await ask('Write the FAQs [no-markers] [rate-limit] for Tia Morita', { taskId: 'task-rate-limit', stageKey: 'FAQS' });
    expect(answer.text).toContain('Answer to: Write the FAQs [no-markers] [rate-limit]');
    // Both 429s were waited out (retry-after 3 s each), not taken for "the prompt did not appear".
    expect(rateLimitedReads.get(id)).toBe(2);
    expect(Date.now() - started).toBeGreaterThan(6000);
    // At most one read per 5 s: far fewer than the old one every 2.5 s.
    const reads = (conversationReads.get(id) ?? 0) - before;
    expect(reads).toBeLessThanOrEqual(Math.ceil((Date.now() - started) / 5000) + 2);
    // The shared read slot remembers the pressure for every tab (1.6.13); cleared so later tests read at full speed.
    const slot = (await worker!.evaluate(() => chrome.storage.local.get('basConversationSlot'))).basConversationSlot as { level: number };
    expect(slot.level).toBeGreaterThanOrEqual(1);
    await worker!.evaluate(() => chrome.storage.local.remove('basConversationSlot'));
  }, 150_000);

  it('reads the answer from the page when ChatGPT refuses every read of the conversation (HTTP 429 for hours)', async () => {
    if (skipReason) return;
    const answer = await ask('Write the research [no-markers] [rate-limit-hard] for Katharina John', { taskId: 'task-rate-limit-hard', stageKey: 'RESEARCH' });
    expect(answer.text).toContain('Answer to: Write the research [no-markers]');
    // The page's own Markdown: the heading and paragraphs as HTML for the article stages.
    expect(answer.html).toContain('<h2>Result</h2>');
    expect(rateLimitedReads.get('test-conversation-nomarkers')).toBeGreaterThanOrEqual(1);
    await worker!.evaluate(() => chrome.storage.local.remove('basConversationSlot'));
  }, 150_000);

  it('reads the answer from the app-shell page (no Markdown classes) when ChatGPT refuses every read (30 September 2026)', async () => {
    if (skipReason) return;
    const answer = await ask('Write the article [no-markers] [shell-page] [rate-limit-hard] for Cheyassin Secka', { taskId: 'task-shell-page', stageKey: 'LONG_ARTICLE' });
    expect(answer.text).toContain('Answer to: Write the article [no-markers]');
    expect(answer.text).not.toContain('Write the article [no-markers] [shell-page] [rate-limit-hard] for Cheyassin Secka');
    expect(answer.html).toContain('<h2>Result</h2>');
    // The action row is not part of the answer.
    expect(answer.text).not.toContain('Copy');
    await worker!.evaluate(() => chrome.storage.local.remove('basConversationSlot'));
  }, 150_000);

  it('answers two marker-less chats at the same time, sharing the read slot (8 October 2026: five tabs hung)', async () => {
    if (skipReason) return;
    await worker!.evaluate(() => chrome.storage.local.remove('basConversationSlot'));
    const started = Date.now();
    const [a, b] = await Promise.all([
      ask('Write titles [no-markers] for Saul Consuelos', { taskId: 'task-parallel-a' }),
      ask('Write titles [no-markers] [chat-b] for Michael Consuelos', { taskId: 'task-parallel-b' }),
    ]);
    expect(a.text).toContain('Answer to: Write titles [no-markers] for Saul');
    expect(b.text).toContain('Answer to: Write titles [no-markers] [chat-b]');
    expect(b.conversationUrl).toContain('test-conversation-nomarkers-b');
    expect(Date.now() - started).toBeLessThan(90_000);
  }, 150_000);

  it('opens ChatGPT tabs by itself when a prompt is waiting and closes them when ChatGPT is no longer needed', async () => {
    if (skipReason) return;
    const keepOpen = await context!.newPage(); // keeps the browser alive while the worker tabs are closed
    await worker!.evaluate(async () => {
      const g = globalThis as unknown as { chrome: { tabs: { remove(ids: number[]): Promise<void> } } };
      const workers = ((await chrome.storage.session.get('workers')).workers ?? {}) as Record<string, unknown>;
      await g.chrome.tabs.remove(Object.keys(workers).map(Number));
    });
    await expect.poll(async () => Object.keys(((await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers ?? {}) as object).length).toBe(0);
    await prisma.setting.upsert({ where: { key: 'taskConcurrency' }, create: { key: 'taskConcurrency', value: 3 }, update: { value: 3 } });

    // Two articles need ChatGPT → two tabs (Task Concurrency 3 is only the upper limit).
    const answers = Promise.all([
      ask('Titles for automatic article A.', { taskId: 'task-auto-a' }),
      ask('Titles for automatic article B.', { taskId: 'task-auto-b' }),
    ]);
    await new Promise((r) => setTimeout(r, 1000));
    // The same function the 30-second alarm runs.
    await worker!.evaluate(() => (globalThis as unknown as { autoTick: () => Promise<void> }).autoTick());
    const [a, b] = await answers;
    expect(a.text).toContain('Answer to: Titles for automatic article A.');
    expect(b.text).toContain('Answer to: Titles for automatic article B.');
    const workers = (await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers as Record<string, { windowId: number }>;
    expect(Object.keys(workers)).toHaveLength(2);

    // Nothing needs ChatGPT any more: the idle tabs close by themselves.
    await worker!.evaluate(async () => {
      const g = globalThis as unknown as { BAS_IDLE_CLOSE_MS: number; autoTick: () => Promise<void> };
      g.BAS_IDLE_CLOSE_MS = 0;
      await g.autoTick();
      g.BAS_IDLE_CLOSE_MS = 60 * 60_000;
    });
    await expect
      .poll(async () => Object.keys(((await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers ?? {}) as object).length)
      .toBe(0);

    expect((await startTabs(1)).ok).toBe(true);
    await workerPage();
    await keepOpen.close();
  }, 120_000);

  it('reports a conversation that cannot be opened', async () => {
    if (skipReason) return;
    await expect(ask('Continue please.', { conversationUrl: `${base}c/missing-conversation` })).rejects.toBeInstanceOf(errors.ConversationLostError);
  }, 120_000);

  it('cancels a prompt when the task is cancelled', async () => {
    if (skipReason) return;
    const started = Date.now();
    await expect(ask('This one gets cancelled.', { shouldAbort: async () => Date.now() - started > 500 })).rejects.toBeInstanceOf(
      errors.TaskCancelledError,
    );
    const job = await prisma.queueJob.findFirst({ where: { queue: 'chatgpt' }, orderBy: { createdAt: 'desc' } });
    expect(job?.status).toBe('FAILED');
  }, 60_000);

  it('pauses the task as "login required" when no extension window picks the prompt up', async () => {
    if (skipReason) return;
    await worker!.evaluate(() => chrome.storage.local.set({ paused: true }));
    await expect(ask('Nobody answers this.', { pickupTimeoutMs: 3000 })).rejects.toBeInstanceOf(errors.LoginRequiredError);
  }, 60_000);

  // Last: from here on this test Chrome counts as the Automation Chrome.
  it('knows it runs in the Automation Chrome once it has seen its setup page, keeps an extension in the normal Chrome idle, and there reuses the start tab and keeps one tab open', async () => {
    if (skipReason) return;
    const readFlag = () => worker!.evaluate(() => chrome.storage.local.get('automationChrome'));
    expect((await readFlag()).automationChrome).toBeUndefined();
    const setup = await context!.newPage();
    await setup.goto(new URL('/automation-chrome', base).toString());
    await expect.poll(async () => (await readFlag()).automationChrome, { timeout: 10_000 }).toBe(true);
    await setup.close();

    // The extension now says so with every request; an extension without the flag (normal Chrome) gets no work.
    const agent = (body: Record<string, unknown>) =>
      fetch(new URL('/api/extension/agent', base), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      }).then((r) => r.json() as Promise<Record<string, unknown>>);
    await agent({ action: 'status', clientId: 'extension-service-automation1', automation: true });
    const status = await agent({ action: 'status', clientId: 'extension-service-normal001', automation: false });
    expect(status).toMatchObject({ wantedTabs: 0, work: false });
    expect(String(status.standby)).toMatch(/automation Chrome/);
    const claim = await agent({ action: 'claim', clientId: 'tab-normal-chrome-0001', automation: false, pageReady: true, currentUrl: base });
    expect(claim).toMatchObject({ job: null });
    expect(String(claim.idleReason)).toMatch(/automation Chrome/);
    const { getExtensionStatus } = await import('@/lib/services/chatgpt-extension');
    expect(await getExtensionStatus()).toMatchObject({ automationConnected: true, normalChromeConnected: true });

    // The app starts the Automation Chrome with a ChatGPT tab: the extension takes that tab over instead of opening
    // a second window.
    await worker!.evaluate(() => chrome.storage.local.set({ paused: false }));
    const launchTab = await context!.newPage();
    await launchTab.goto(base);
    await worker!.evaluate(async () => {
      const g = globalThis as unknown as { chrome: { tabs: { remove(ids: number[]): Promise<void> } } };
      const workers = ((await chrome.storage.session.get('workers')).workers ?? {}) as Record<string, unknown>;
      await g.chrome.tabs.remove(Object.keys(workers).map(Number));
    });
    await expect.poll(async () => Object.keys(((await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers ?? {}) as object).length).toBe(0);
    const tabIds = () =>
      worker!.evaluate(async () => {
        const g = globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<{ id: number }[]> } } };
        return (await g.chrome.tabs.query({})).map((t) => t.id).sort();
      });
    const before = await tabIds();
    expect((await startTabs(1)).ok).toBe(true);
    expect(await tabIds()).toEqual(before);
    expect(Object.keys(((await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers ?? {}) as object)).toHaveLength(1);
    expect((await ask('Titles for the Automation Chrome tab.')).text).toContain('Answer to: Titles for the Automation Chrome tab.');

    // Here one idle ChatGPT tab stays open, so the next article does not open a new window on top of the user's work.
    const workersLeft = await worker!.evaluate(async () => {
      const g = globalThis as unknown as { BAS_IDLE_CLOSE_MS: number; closeIdleWorkers: (keep: number) => Promise<void> };
      g.BAS_IDLE_CLOSE_MS = 0;
      await g.closeIdleWorkers(0);
      g.BAS_IDLE_CLOSE_MS = 60 * 60_000;
      return Object.keys(((await chrome.storage.session.get('workers')).workers ?? {}) as object).length;
    });
    expect(workersLeft).toBe(1);

    // Right after Chrome starts, the tab it was started with appears a moment after the extension wakes up.
    await worker!.evaluate(async () => {
      const g = globalThis as unknown as { chrome: { tabs: { remove(ids: number[]): Promise<void> } } };
      const workers = ((await chrome.storage.session.get('workers')).workers ?? {}) as Record<string, unknown>;
      await g.chrome.tabs.remove(Object.keys(workers).map(Number));
    });
    await expect.poll(async () => Object.keys(((await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers ?? {}) as object).length).toBe(0);
    const chatTabs = () =>
      worker!.evaluate(async (url) => {
        const g = globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<{ url?: string }[]> } } };
        return (await g.chrome.tabs.query({})).filter((t) => (t.url ?? '').startsWith(url)).length;
      }, base);
    expect(await chatTabs()).toBe(0);
    await worker!.evaluate(() => {
      (globalThis as unknown as { BAS_STARTED_AT: number }).BAS_STARTED_AT = Date.now();
    });
    const starting = startTabs(1);
    await new Promise((r) => setTimeout(r, 1500));
    const startTab = await context!.newPage();
    await startTab.goto(base);
    expect((await starting).ok).toBe(true);
    await worker!.evaluate(() => {
      (globalThis as unknown as { BAS_STARTED_AT: number }).BAS_STARTED_AT = 0;
    });
    expect(await chatTabs()).toBe(1);
    expect(Object.keys(((await worker!.evaluate(() => chrome.storage.session.get('workers'))).workers ?? {}) as object)).toHaveLength(1);
  }, 60_000);

  it('notices when Chrome kept an old copy of background.js and reloads itself once', async () => {
    if (skipReason) return;
    const stale = (manifest: string, code: string, lastReloadAt: number | null, now: number) =>
      worker!.evaluate(
        (args) =>
          (globalThis as unknown as { staleCode: (a: string, b: string, c: number | null, d: number) => boolean }).staleCode(
            args.manifest,
            args.code,
            args.lastReloadAt,
            args.now,
          ),
        { manifest, code, lastReloadAt, now },
      );
    expect(await stale('1.4.5', '1.4.5', null, 1_000_000)).toBe(false);
    expect(await stale('1.4.6', '1.4.5', null, 1_000_000)).toBe(true);
    // A reload that just happened must not start a reload loop.
    expect(await stale('1.4.6', '1.4.5', 999_000, 1_000_000)).toBe(false);
    expect(await stale('1.4.6', '1.4.5', 900_000, 1_000_000)).toBe(true);
    // The shipped files must agree, or every start reloads once.
    const manifestVersion = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')).version;
    expect(fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8')).toContain(`const CODE_VERSION = '${manifestVersion}'`);
    // The tabs report this one when they ask for work; the app decides by it what a tab can do (photo attachments).
    expect(fs.readFileSync(path.join(root, 'extension', 'content.js'), 'utf8')).toContain(`const SCRIPT_VERSION = '${manifestVersion}'`);
  }, 30_000);
});
