// Blog Automation Studio - ChatGPT Worker (service worker)
// Talks to the app (fetch with the connection key), opens the worker ChatGPT windows, keeps per-tab status
// for the popup and alerts the user when a tab needs them (login or "Verify you are human").

const VERSION = chrome.runtime.getManifest().version;
// Chrome reads manifest.json fresh but can keep a cached copy of this file, so the extension would run old code with
// a new version number. This constant is part of the file: when it no longer matches, reload once to pick the new one.
const CODE_VERSION = '1.6.25';

/** True when Chrome runs an old copy of this file and a reload has not just been tried. */
function staleCode(manifestVersion, codeVersion, lastReloadAt, now) {
  return manifestVersion !== codeVersion && !(lastReloadAt && now - lastReloadAt < 60_000);
}

async function reloadWhenStale() {
  const { lastSelfReload } = await chrome.storage.local.get('lastSelfReload');
  if (!staleCode(VERSION, CODE_VERSION, lastSelfReload, Date.now())) return false;
  await chrome.storage.local.set({ lastSelfReload: Date.now() });
  chrome.runtime.reload();
  return true;
}
// layout: 'tabs' = one window with several ChatGPT tabs, 'windows' = separate windows side by side.
// paused: the user switched off the automatic start. area: screen area remembered from the popup.
const DEFAULTS = { appUrl: 'http://localhost:3000', key: '', layout: 'tabs', paused: false, area: null };
const AGENT_ACTIONS = new Set(['claim', 'progress', 'complete', 'fail']);

async function getConfig() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(['appUrl', 'key', 'layout', 'paused', 'area'])) };
}

async function sessionGet(key, fallback) {
  const value = (await chrome.storage.session.get(key))[key];
  return value === undefined ? fallback : value;
}

function sessionSet(key, value) {
  return chrome.storage.session.set({ [key]: value });
}

// Several tabs report at once; serialize read-modify-write so no update is lost.
let storageChain = Promise.resolve();
function sessionUpdate(key, fallback, change) {
  const run = storageChain.then(async () => {
    const value = await sessionGet(key, fallback);
    change(value);
    await sessionSet(key, value);
  });
  storageChain = run.catch(() => undefined);
  return run;
}

// ───────────────────────── which Chrome is this? ─────────────────────────
// The app opens its own "automation Chrome" (kept drawing behind other windows) with this page. An extension that
// has seen it remembers that it runs there and says so with every request; one in the normal Chrome then stays idle.
const AUTOMATION_PAGE = '/automation-chrome';

async function noticeAutomationPage(url) {
  let page;
  try {
    page = new URL(url || '');
  } catch {
    return;
  }
  if (page.pathname !== AUTOMATION_PAGE) return;
  const { appUrl } = await getConfig();
  let appOrigin = '';
  try {
    appOrigin = new URL(appUrl).origin;
  } catch {
    /* default below */
  }
  if (page.origin !== appOrigin && !['localhost', '127.0.0.1'].includes(page.hostname)) return;
  const { automationChrome } = await chrome.storage.local.get('automationChrome');
  if (!automationChrome) await chrome.storage.local.set({ automationChrome: true });
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  noticeAutomationPage(info.url || tab?.url).catch(() => undefined);
});
const checkOpenTabs = () =>
  chrome.tabs
    .query({})
    .then((tabs) => Promise.all(tabs.map((t) => noticeAutomationPage(t.url))))
    .catch(() => undefined);

/** Stable id of this installation (two Chromes with the extension must not share one). */
async function installId() {
  const { installId: id } = await chrome.storage.local.get('installId');
  if (id) return id;
  const created = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await chrome.storage.local.set({ installId: created });
  return created;
}

async function callApp(body) {
  const { appUrl, key } = await getConfig();
  const { automationChrome } = await chrome.storage.local.get('automationChrome');
  body = { ...body, automation: Boolean(automationChrome) };
  if (!key) {
    return { ok: false, error: 'No connection key yet. Open the extension, paste the key from the app (Settings → ChatGPT Chrome extension) and click Save.' };
  }
  let res;
  try {
    res = await fetch(new URL('/api/extension/agent', appUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: `Blog Automation Studio is not reachable at ${appUrl}. Is "npm run dev:all" running?` };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data.error || `The app answered with HTTP ${res.status}` };
  return { ok: true, data };
}

// ───────────────────────── worker tabs ─────────────────────────

async function getWorkers() {
  return sessionGet('workers', {});
}

function setTabStatus(tabId, state, detail) {
  return sessionUpdate('tabStatus', {}, (statuses) => {
    statuses[tabId] = { state, detail: detail || '', at: Date.now() };
  });
}

function setTabJob(tabId, job) {
  return sessionUpdate('tabJobs', {}, (jobs) => {
    if (job) jobs[tabId] = job;
    else delete jobs[tabId];
  });
}

async function notify(tabId, message) {
  const workers = await getWorkers();
  const worker = workers[tabId];
  if (!worker) return;
  const key = `${tabId}:${message}`;
  let recent = false;
  await sessionUpdate('notifiedAt', {}, (sent) => {
    recent = Boolean(sent[key] && Date.now() - sent[key] < 3 * 60_000);
    if (!recent) sent[key] = Date.now();
  });
  if (recent) return;
  chrome.notifications.create(`bas-tab-${tabId}`, {
    type: 'basic',
    iconUrl: 'icon128.png',
    title: `ChatGPT #${worker.index} needs you`,
    message,
    priority: 2,
    requireInteraction: true,
  });
  chrome.windows.update(worker.windowId, { drawAttention: true }).catch(() => undefined);
}

chrome.notifications.onClicked.addListener(async (id) => {
  const tabId = Number(id.replace('bas-tab-', ''));
  const worker = (await getWorkers())[tabId];
  if (!worker) return;
  await chrome.windows.update(worker.windowId, { focused: true }).catch(() => undefined);
  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  chrome.notifications.clear(id);
});

async function windowExists(windowId) {
  if (!windowId) return false;
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch {
    return false;
  }
}

/** Opens ChatGPT tabs until `count` worker tabs exist (one window with tabs, or separate windows). */
async function ensureWorkers(count, chatUrl) {
  const { layout, area } = await getConfig();
  await sessionSet('chatHost', new URL(chatUrl).host);

  const workers = await getWorkers();
  for (const id of Object.keys(workers)) {
    try {
      await chrome.tabs.get(Number(id));
    } catch {
      delete workers[id];
    }
  }

  const wanted = Math.min(5, Math.max(1, Number(count) || 1));
  const cols = wanted === 1 ? 1 : 2;
  const rows = Math.ceil(wanted / cols);
  const used = new Set(Object.values(workers).map((w) => w.index));
  const options = { url: chatUrl, type: 'normal', focused: false };
  // Chrome rejects bounds that do not fit the screen; then the window gets Chrome's default size.
  const createWindow = (bounds) =>
    (area && bounds ? chrome.windows.create({ ...options, ...bounds }) : Promise.reject(new Error('no bounds'))).catch(() => chrome.windows.create(options));
  let sharedWindowId = null;
  if (layout !== 'windows') {
    for (const w of Object.values(workers)) if (await windowExists(w.windowId)) sharedWindowId = w.windowId;
  }

  let opened = 0;
  // The app starts the automation Chrome with a ChatGPT tab: take that one over instead of opening a second window.
  if (layout !== 'windows' && !sharedWindowId && !used.has(1) && (await chrome.storage.local.get('automationChrome')).automationChrome) {
    const host = new URL(chatUrl).host;
    const findSpare = async () =>
      (await chrome.tabs.query({ windowType: 'normal' })).find((t) => {
        try {
          return !workers[t.id] && new URL(t.url || t.pendingUrl || '').host === host;
        } catch {
          return false;
        }
      });
    let spare = await findSpare();
    // Right after Chrome starts the extension runs before Chrome has opened the tab it was started with.
    while (!spare && Date.now() - globalThis.BAS_STARTED_AT < 8000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      spare = await findSpare();
    }
    if (spare) {
      workers[spare.id] = { index: 1, windowId: spare.windowId, openedAt: Date.now() };
      used.add(1);
      sharedWindowId = spare.windowId;
      opened++;
      await sessionUpdate('workers', {}, (stored) => {
        stored[spare.id] = workers[spare.id];
      });
      await chrome.tabs.update(spare.id, { autoDiscardable: false }).catch(() => undefined);
    }
  }
  for (let index = 1; index <= wanted && Object.keys(workers).length < wanted; index++) {
    if (used.has(index)) continue;
    let tab;
    if (layout !== 'windows' && sharedWindowId) {
      tab = await chrome.tabs.create({ windowId: sharedWindowId, url: chatUrl, active: false });
    } else if (layout !== 'windows') {
      const win = await createWindow(area && { left: area.left, top: area.top, width: area.width, height: area.height });
      sharedWindowId = win.id;
      tab = win.tabs[0];
    } else {
      const slot = index - 1;
      const width = area ? Math.floor(area.width / cols) : 0;
      const height = area ? Math.floor(area.height / rows) : 0;
      const win = await createWindow(area && { left: area.left + (slot % cols) * width, top: area.top + Math.floor(slot / cols) * height, width, height });
      tab = win.tabs[0];
    }
    workers[tab.id] = { index, windowId: tab.windowId, openedAt: Date.now() };
    opened++;
    await sessionUpdate('workers', {}, (stored) => {
      stored[tab.id] = workers[tab.id];
    });
    // Chrome must not unload a worker tab to save memory while it waits for prompts.
    await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
  }

  await sessionUpdate('workers', {}, (stored) => {
    for (const id of Object.keys(stored)) if (!workers[id]) delete stored[id];
  });
  await reviveDeadWorkers(Object.keys(workers));
  for (const id of Object.keys(workers)) chrome.tabs.sendMessage(Number(id), { type: 'wake' }).catch(() => undefined);
  return { ok: true, tabs: Object.keys(workers).length, opened };
}

/** Remembers why the extension reloads a tab; the tab reports it with its next answer. */
function markReload(tabId, reason) {
  return sessionUpdate('reloadedBy', {}, (reloads) => {
    reloads[tabId] = { reason, at: Date.now() };
  });
}

/**
 * A worker tab whose page script no longer answers is reloaded. That happens when the extension is reloaded or updated
 * while the tab stays open: the old script is cut off, the tab still looks like a worker, and no prompt is ever taken.
 * Careful, because a reload in the middle of an answer costs the answer: a tab that holds a prompt or is still loading
 * is never touched, it takes two failed checks at least 20 seconds apart, and one tab is reloaded at most once a minute.
 */
async function reviveDeadWorkers(tabIds) {
  const failedAt = await sessionGet('pingFailedAt', {});
  const revivedAt = await sessionGet('revivedAt', {});
  const jobs = await sessionGet('tabJobs', {});
  const now = Date.now();
  for (const id of tabIds) {
    const tab = await chrome.tabs.get(Number(id)).catch(() => null);
    if (!tab || tab.status !== 'complete' || jobs[id]) {
      delete failedAt[id];
      continue;
    }
    const alive = await chrome.tabs.sendMessage(Number(id), { type: 'ping' }).then(
      (answer) => Boolean(answer?.ok) && answer.version === CODE_VERSION,
      () => false,
    );
    if (alive) {
      delete failedAt[id];
      continue;
    }
    if (!failedAt[id]) {
      failedAt[id] = now;
      continue;
    }
    if (now - failedAt[id] < 20_000 || now - (revivedAt[id] ?? 0) < 60_000) continue;
    delete failedAt[id];
    revivedAt[id] = now;
    await markReload(id, 'its page script did not answer twice');
    await chrome.tabs.reload(Number(id)).catch(() => undefined);
  }
  await sessionSet('pingFailedAt', failedAt);
  await sessionSet('revivedAt', revivedAt);
}

/** Opens the ChatGPT tabs now (also used by tests). */
async function startWorkers(count, area) {
  if (area) await chrome.storage.local.set({ area });
  const hello = await callApp({ action: 'hello', clientId: `extension-popup-${await installId()}`, version: VERSION });
  if (!hello.ok) return hello;
  return ensureWorkers(count ?? hello.data.concurrency, hello.data.chatgptUrl);
}

// ───────────────────────── automatic start ─────────────────────────
// Every 30 seconds (and when Chrome starts) ask the app whether articles are queued. If so, open as many
// ChatGPT tabs as the app's Task Concurrency — no Start button needed.

let ticking = false;
async function autoTick() {
  if (ticking) return;
  ticking = true;
  try {
    const { paused, key } = await getConfig();
    if (paused || !key) return;
    const res = await callApp({ action: 'status', clientId: `extension-service-${await installId()}`, version: VERSION });
    await sessionSet('lastError', res.ok ? null : res.error);
    if (!res.ok) return;
    await sessionSet('concurrency', res.data.concurrency);
    const wanted = res.data.wantedTabs ?? (res.data.work ? res.data.concurrency : 0);
    if (wanted > 0) await ensureWorkers(wanted, res.data.chatgptUrl);
    await closeIdleWorkers(wanted);
  } catch (err) {
    await sessionSet('lastError', err?.message || String(err));
  } finally {
    ticking = false;
  }
}

// A tab counts as idle when it holds no prompt and has not worked for a while (so a tab between two steps
// of the same article stays open).
globalThis.BAS_IDLE_CLOSE_MS = 20_000;

function markBusy(tabId) {
  return sessionUpdate('tabBusyAt', {}, (busy) => {
    busy[tabId] = Date.now();
  });
}

/** Closes worker tabs beyond `keep` that are idle — e.g. after an article's ChatGPT steps are finished. */
async function closeIdleWorkers(keep) {
  // In the automation Chrome one ChatGPT tab stays open behind the other windows: the next article uses it instead of
  // opening a new window on top of the user's work, and Chrome does not quit with its last window.
  const { automationChrome } = await chrome.storage.local.get('automationChrome');
  if (automationChrome) keep = Math.max(keep, 1);
  const workers = await getWorkers();
  const ids = Object.keys(workers);
  if (ids.length <= keep) return;
  const jobs = await sessionGet('tabJobs', {});
  const busyAt = await sessionGet('tabBusyAt', {});
  const now = Date.now();
  const idle = ids
    .filter((id) => !jobs[id] && now - (busyAt[id] ?? workers[id].openedAt ?? 0) >= globalThis.BAS_IDLE_CLOSE_MS)
    .sort((a, b) => workers[b].index - workers[a].index);
  const toClose = idle.slice(0, ids.length - keep);
  if (!toClose.length) return;

  // Stop these tabs from taking a new prompt, then close the ones that still hold none.
  await sessionUpdate('closingTabs', {}, (closing) => {
    for (const id of toClose) closing[id] = now;
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const jobsNow = await sessionGet('tabJobs', {});
  const closable = toClose.map(Number).filter((id) => !jobsNow[id]);
  if (closable.length) await chrome.tabs.remove(closable).catch(() => undefined);
  await sessionUpdate('closingTabs', {}, (closing) => {
    for (const id of toClose) delete closing[id];
  });
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get('bas-auto'))) await chrome.alarms.create('bas-auto', { periodInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bas-auto') autoTick();
});
// When this Chrome started (0 = long ago); the tab reuse above waits for Chrome's first tab shortly after.
globalThis.BAS_STARTED_AT = 0;
chrome.runtime.onStartup.addListener(() => {
  globalThis.BAS_STARTED_AT = Date.now();
  ensureAlarm();
  checkOpenTabs();
  autoTick();
});
chrome.runtime.onInstalled.addListener(async () => {
  ensureAlarm();
  checkOpenTabs();
  // ChatGPT pages open in the automation Chrome keep the old, cut-off script after the extension was reloaded or
  // updated: load them again so they take prompts. The normal Chrome's tabs are left alone.
  if ((await chrome.storage.local.get('automationChrome')).automationChrome) {
    const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] }).catch(() => []);
    for (const tab of tabs) {
      await markReload(tab.id, 'the extension was reloaded or updated');
      await chrome.tabs.reload(tab.id).catch(() => undefined);
    }
  }
  autoTick();
});
reloadWhenStale();
checkOpenTabs();
ensureAlarm();

// Chrome slows down tabs that are not in front. A tab asks to be brought to the front while it enters a prompt
// and when its answer looks finished; one tab at a time, each keeps the front for holdMs.
let frontChain = Promise.resolve();
function bringTabToFront(tabId, holdMs) {
  return new Promise((shown) => {
    const run = frontChain.then(async () => {
      await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 400));
      shown();
      await new Promise((resolve) => setTimeout(resolve, Math.min(8000, Math.max(0, Number(holdMs) || 0))));
    });
    frontChain = run.catch(() => undefined);
  });
}

// A worker tab that leaves ChatGPT (e.g. to the login page on auth.openai.com) cannot finish its prompt.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const workers = await getWorkers();
  if (!workers[tabId]) return;
  let host = '';
  try {
    host = new URL(info.url).host;
  } catch {
    return;
  }
  const chatHost = await sessionGet('chatHost', 'chatgpt.com');
  if (!host || host === chatHost || info.url.startsWith('about:')) return;
  const message = 'ChatGPT asked this window to log in. Log in there — the article continues automatically.';
  const job = (await sessionGet('tabJobs', {}))[tabId];
  if (job) {
    await callApp({ action: 'fail', clientId: job.clientId, jobId: job.jobId, code: 'LOGIN', message });
    await setTabJob(tabId, null);
  }
  await setTabStatus(tabId, 'login', message);
  await notify(tabId, message);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const workers = await getWorkers();
  if (!workers[tabId]) return;
  const job = (await sessionGet('tabJobs', {}))[tabId];
  if (job) {
    await callApp({
      action: 'fail',
      clientId: job.clientId,
      jobId: job.jobId,
      code: 'ERROR',
      message: 'The ChatGPT window was closed before the answer was returned',
    });
    await setTabJob(tabId, null);
  }
  await sessionUpdate('workers', {}, (stored) => {
    delete stored[tabId];
  });
  await sessionUpdate('tabStatus', {}, (statuses) => {
    delete statuses[tabId];
  });
  await sessionUpdate('tabBusyAt', {}, (busy) => {
    delete busy[tabId];
  });
});

// ───────────────────────── messages ─────────────────────────

async function fromContentScript(msg, tabId) {
  switch (msg.type) {
    case 'sleep':
      // Timers in background tabs are slowed down by Chrome; the service worker's are not.
      await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(0, Number(msg.ms) || 0))));
      return { ok: true };

    case 'hello': {
      const workers = await getWorkers();
      // Why this tab was last reloaded by the extension (told once, so the tab can report it with its next answer).
      let reloadedBy = null;
      await sessionUpdate('reloadedBy', {}, (reloads) => {
        reloadedBy = reloads[tabId] || null;
        delete reloads[tabId];
      });
      return { worker: Boolean(workers[tabId]), running: !(await getConfig()).paused, reloadedBy };
    }

    case 'api': {
      const body = msg.body || {};
      if (!(await getWorkers())[tabId]) return { ok: false, error: 'This tab is not one of the extension’s ChatGPT windows' };
      if (!AGENT_ACTIONS.has(body.action)) return { ok: false, error: 'Unknown action' };
      if (body.action === 'claim' && (await getConfig()).paused) return { ok: true, data: { job: null } };
      if (body.action === 'claim' && (await sessionGet('closingTabs', {}))[tabId]) return { ok: true, data: { job: null } };
      const result = await callApp(body);
      if (body.action === 'claim' && result.ok && result.data.job) {
        await setTabJob(tabId, { jobId: result.data.job.id, clientId: body.clientId });
        await markBusy(tabId);
      } else if ((body.action === 'progress' && result.ok && !result.data.continue) || body.action === 'complete' || body.action === 'fail') {
        await setTabJob(tabId, null);
        await markBusy(tabId);
        // The article may be done with ChatGPT now: check soon whether this tab can close.
        setTimeout(() => autoTick(), globalThis.BAS_IDLE_CLOSE_MS + 2000);
      } else if (body.action === 'progress' && result.ok) {
        await setTabJob(tabId, { jobId: body.jobId, clientId: body.clientId });
        await markBusy(tabId);
      }
      return result;
    }

    case 'status':
      if ((await getWorkers())[tabId]) await setTabStatus(tabId, msg.state, msg.detail);
      return { ok: true };

    case 'fetch-image': {
      // Save the image served in ChatGPT's viewer, including Bing previews. Never fetch the publisher URL in alt.
      if (!(await getWorkers())[tabId]) return { ok: false, error: 'Not one of the extension’s ChatGPT windows' };
      const url = String(msg.url || '');
      const ownImage = /^https:\/\/([a-z0-9-]+\.)*(chatgpt\.com|openai\.com|oaiusercontent\.com)\//i.test(url);
      const searchImage = /^https:\/\/tse[0-9]\.mm\.bing\.net\//i.test(url);
      if (!ownImage && !searchImage) return { ok: false, error: 'This image host is not supported by the extension' };
      const res = await fetch(url, { credentials: ownImage ? 'include' : 'omit', redirect: ownImage ? 'follow' : 'error', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      if (!/^image\//i.test(res.headers.get('content-type') || '')) return { ok: false, error: 'The address did not return an image' };
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 12_000_000) return { ok: false, error: 'The source image is too large' };
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { ok: true, mime: res.headers.get('content-type') || 'image/png', data: btoa(binary) };
    }

    case 'attention':
      await notify(tabId, String(msg.message || 'This ChatGPT window needs you'));
      return { ok: true };

    case 'front':
      if ((await getWorkers())[tabId]) await bringTabToFront(tabId, msg.holdMs);
      return { ok: true };

    case 'focus-window': {
      // Only when the ChatGPT window is minimized or covered and an answer cannot finish appearing otherwise.
      const worker = (await getWorkers())[tabId];
      if (worker) {
        const win = await chrome.windows.get(worker.windowId).catch(() => null);
        await chrome.windows.update(worker.windowId, win?.state === 'minimized' ? { state: 'normal', focused: true } : { focused: true }).catch(() => undefined);
        await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown message' };
  }
}

async function fromPopup(msg) {
  switch (msg.type) {
    case 'popup:state': {
      const config = await getConfig();
      const workers = await getWorkers();
      const statuses = await sessionGet('tabStatus', {});
      return {
        appUrl: config.appUrl,
        automationChrome: Boolean((await chrome.storage.local.get('automationChrome')).automationChrome),
        hasKey: Boolean(config.key),
        layout: config.layout,
        paused: config.paused,
        concurrency: await sessionGet('concurrency', null),
        lastError: await sessionGet('lastError', null),
        workers: Object.entries(workers)
          .map(([tabId, w]) => ({ tabId: Number(tabId), index: w.index, ...(statuses[tabId] || { state: 'starting', detail: '', at: 0 }) }))
          .sort((a, b) => a.index - b.index),
      };
    }

    case 'popup:save': {
      const patch = {
        appUrl: String(msg.appUrl || DEFAULTS.appUrl).trim().replace(/\/+$/, ''),
        layout: msg.layout === 'windows' ? 'windows' : 'tabs',
      };
      if (typeof msg.key === 'string' && msg.key.trim()) patch.key = msg.key.trim();
      try {
        new URL(patch.appUrl);
      } catch {
        return { ok: false, error: 'The app address is not a valid URL (example: http://localhost:3000)' };
      }
      await chrome.storage.local.set(patch);
      const hello = await callApp({ action: 'hello', clientId: `extension-popup-${await installId()}`, version: VERSION });
      if (hello.ok) autoTick();
      return hello.ok ? { ok: true, concurrency: hello.data.concurrency } : hello;
    }

    case 'popup:area':
      await chrome.storage.local.set({ area: msg.area });
      return { ok: true };

    case 'popup:layout':
      await chrome.storage.local.set({ layout: msg.layout === 'windows' ? 'windows' : 'tabs' });
      return { ok: true };

    case 'popup:pause':
      await chrome.storage.local.set({ paused: Boolean(msg.paused) });
      if (!msg.paused) autoTick();
      for (const id of Object.keys(await getWorkers())) chrome.tabs.sendMessage(Number(id), { type: 'wake' }).catch(() => undefined);
      return { ok: true };

    case 'popup:open-now':
      await chrome.storage.local.set({ paused: false });
      return startWorkers(null, msg.area);

    case 'popup:focus': {
      const worker = (await getWorkers())[msg.tabId];
      if (worker) {
        await chrome.windows.update(worker.windowId, { focused: true }).catch(() => undefined);
        await chrome.tabs.update(msg.tabId, { active: true }).catch(() => undefined);
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: 'Unknown message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  const work = sender.tab
    ? fromContentScript(msg, sender.tab.id)
    : msg.type.startsWith('popup:')
      ? fromPopup(msg)
      : Promise.resolve({ ok: false, error: 'Unknown sender' });
  work.then(sendResponse, (err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true;
});
