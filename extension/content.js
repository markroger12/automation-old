// Blog Automation Studio - ChatGPT Worker (runs inside ChatGPT tabs)
// In a window opened by the extension's Start button, this script asks the app for the next prompt, types it
// into ChatGPT like a paste, waits until the answer has completely finished and sends the answer back.
// It never tries to get around ChatGPT's checks: login and "Verify you are human" are left to the user.
(() => {
  if (window.__basChatGPTWorker) return;
  window.__basChatGPTWorker = true;

  const PENDING_KEY = 'bas-worker-pending-job';
  const SCRIPT_VERSION = '1.6.25';
  const CLIENT_KEY = 'bas-worker-client-id';
  const VERIFICATION_WAIT_MS = 10 * 60_000;
  const STABLE_MS = 2500;

  const SEL = {
    composer: ['#prompt-textarea', 'textarea[name="prompt-textarea"]', 'textarea', '[contenteditable="true"][role="textbox"]', 'div.ProseMirror[contenteditable="true"]'],
    sendButton: [
      'button[data-testid="send-button"]',
      'button[data-test-id="send-button"]',
      '#composer-submit-button',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
    ],
    stopButton: [
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop answer"]',
    ],
    loginButton: ['button[data-testid="login-button"]', 'a[data-testid="login-button"]'],
    challenge: ['#challenge-form', '#cf-challenge-running', 'iframe[src*="challenges.cloudflare.com"]'],
    errorMessage: ['[data-testid="error-message"]', '.text-token-text-error'],
    regenerate: ['button[data-testid="regenerate-thread-error-button"]'],
    dialogClose: ['div[role="dialog"] button[data-testid="close-button"]', 'div[role="dialog"] button[aria-label="Close"]'],
    copyButton: ['button[data-testid="copy-turn-action-button"]'],
    fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"]:not([accept])', 'input[type="file"]'],
  };
  const TEXT = {
    continue: /^continue generating$/i,
    regenerate: /^(regenerate|try again|retry)$/i,
    prefer: /prefer this response/i,
    dialogs: /^(reject non-essential|maybe later|okay, let.s go)$/i,
  };
  const USER = '[data-message-author-role="user"]';
  const ASSISTANT = '[data-message-author-role="assistant"]';

  class JobError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  class JobCancelled extends Error {}

  let clientId = sessionStorage.getItem(CLIENT_KEY);
  if (!clientId) {
    clientId = `tab-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    sessionStorage.setItem(CLIENT_KEY, clientId);
  }

  // ───────────────────────── messaging ─────────────────────────

  const contextGone = (err) => !chrome.runtime?.id || /context invalidated/i.test(String(err?.message || err));

  function bg(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const chunk = Math.min(5000, end - Date.now());
      try {
        await bg({ type: 'sleep', ms: chunk });
      } catch (err) {
        if (contextGone(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, chunk));
      }
    }
  }

  async function waitUntil(check, timeoutMs, intervalMs = 300) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() >= end) return null;
      await sleep(intervalMs);
    }
  }

  async function api(body) {
    const res = await bg({ type: 'api', body: { ...body, clientId } });
    if (!res || !res.ok) throw new Error(res?.error || 'The extension could not reach Blog Automation Studio');
    return res.data;
  }

  const report = (state, detail = '') => bg({ type: 'status', state, detail }).catch(() => undefined);

  let currentJobId = null;
  /** Why this page loaded again while a prompt was running; sent to the app with the answer. */
  let resumeNote = '';
  /** Extra progress report with page diagnostics at important steps (fire and forget). */
  const beat = (step) => {
    if (currentJobId) api({ action: 'progress', jobId: currentJobId, conversationUrl: currentConversation(), debug: snapshot(step) }).catch(() => undefined);
  };

  /** Tabs behind other tabs are slowed down by Chrome: come to the front for a moment (one tab at a time). */
  async function comeToFront(holdMs) {
    if (!document.hidden) return;
    await bg({ type: 'front', holdMs }).catch((err) => {
      if (contextGone(err)) throw err;
    });
  }

  let wake = null;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // The background asks whether this page still runs the current script (see reviveDeadWorkers).
    if (msg?.type === 'ping') {
      sendResponse({ ok: true, version: SCRIPT_VERSION });
      return false;
    }
    if (msg?.type === 'wake' && wake) {
      wake();
      wake = null;
    }
    return false;
  });
  const waitForWake = (ms) =>
    new Promise((resolve) => {
      wake = resolve;
      setTimeout(resolve, ms);
    });

  // ───────────────────────── page helpers ─────────────────────────

  const visible = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  function find(selectors) {
    if (selectors === SEL.composer) return findComposer();
    for (const selector of selectors) {
      try {
        for (const el of document.querySelectorAll(selector)) if (visible(el)) return el;
      } catch {
        /* selector not supported */
      }
    }
    return null;
  }

  const count = (selector) => document.querySelectorAll(selector).length;

  const DOCUMENT_EDITOR = '[data-testid*="writing-block"], [data-test-id*="writing-block"], [data-writing-block], [data-writing-block-fullscreen-editor-region], .writing-block-editor, [data-testid*="canvas"], [data-test-id*="canvas"], .monaco-editor';
  const buttonLabel = (button) => `${button.getAttribute('data-testid') || ''} ${button.getAttribute('data-test-id') || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.id || ''} ${button.textContent || ''}`;

  function findComposer() {
    for (const selector of SEL.composer) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || el.closest(DOCUMENT_EDITOR) || el.closest('[data-message-author-role], .markdown, .prose') || el.disabled || el.readOnly) continue;
        if (!(el instanceof HTMLTextAreaElement) && !el.isContentEditable) continue;
        if (el.id === 'prompt-textarea' || el.getAttribute('name') === 'prompt-textarea') return el;
        const label = [el.getAttribute('placeholder'), el.getAttribute('data-placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.getAttribute('data-test-id')].filter(Boolean).join(' ');
        if (/ask (?:anything|chatgpt)|message (?:chatgpt|chat)|send a message|prompt|composer/i.test(label)) return el;
        // A generic ProseMirror is often the article itself. Only accept an editor beside chat controls.
        let parent = el.parentElement;
        for (let depth = 0; parent && parent !== document.body && depth < 4; depth++, parent = parent.parentElement) {
          if ([...parent.querySelectorAll('button')].some((b) => visible(b) && !b.closest(DOCUMENT_EDITOR) && /send|submit|dictat|start voice/i.test(buttonLabel(b)))) return el;
          if (parent.tagName === 'MAIN') break;
        }
      }
    }
    return null;
  }

  function sendButton() {
    return find(SEL.sendButton) || composerButtons().find((b) => /^(send|send message|send prompt|submit)$/i.test((b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim())) || null;
  }

  function buttonWithText(pattern) {
    return [...document.querySelectorAll('button, [role="button"]')].find(
      (b) => visible(b) && pattern.test((b.innerText || b.getAttribute('aria-label') || '').trim()),
    );
  }

  function conversationKey(value) {
    try {
      const u = new URL(value);
      const match = u.pathname.match(/\/c\/[a-zA-Z0-9-]+/);
      // "/c/local-chatgpt:<id>" is the page's own placeholder while ChatGPT has not created the chat yet (or refused
      // to, HTTP 429): not a chat anyone can open again (8 October 2026: tasks kept trying to reopen one).
      if (!match || /^\/c\/local-/i.test(match[0])) return null;
      return `${u.origin}${match[0]}`;
    } catch {
      return null;
    }
  }

  const currentConversation = () => (conversationKey(location.href) ? location.href.split(/[?#]/)[0] : null);

  function isTarget(target) {
    const wanted = conversationKey(target);
    if (wanted) return conversationKey(location.href) === wanted;
    const path = (p) => p.replace(/\/+$/, '');
    return !conversationKey(location.href) && location.origin === new URL(target).origin && path(location.pathname) === path(new URL(target).pathname);
  }

  const normalize = (text) =>
    String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

  function promptsMatch(displayed, prompt) {
    const a = normalize(displayed);
    const b = normalize(prompt);
    if (!a || !b) return false;
    if (a === b) return true;
    // Beginning and end both: two prompts that only start alike (image prompts often do) are different prompts —
    // matching the beginning alone once handed an earlier picture back as the answer to a new image prompt.
    const edge = Math.min(160, b.length);
    return a.slice(0, edge) === b.slice(0, edge) && a.includes(b.slice(-edge)) && a.length >= b.length * 0.9;
  }

  /** Visible UI text outside answers and the user's own messages (an article about "an error" is not an error). */
  function uiTextMatches(pattern, selectors = []) {
    const skip = '.markdown, .prose, [data-message-author-role="user"], #prompt-textarea, textarea';
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) if (visible(el) && !el.closest(skip)) return true;
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent || parent.closest(skip) || parent.closest('script,style,noscript')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent || '';
      if (text.length > 8 && pattern.test(text) && visible(n.parentElement)) return true;
    }
    return false;
  }

  const lastTurnHasError = () =>
    uiTextMatches(
      /something went wrong|an error occurred|network error|error in message stream|there was an error generating|something seems to have gone wrong/i,
      SEL.errorMessage,
    );
  const usageLimitReached = () => uiTextMatches(/reached (?:our|your|the) (?:usage |message )?limit|usage cap|too many requests in (?:1|one) hour/i);

  function challengeShown() {
    if (/^(just a moment|attention required|verify you are human)/i.test(document.title.trim())) return true;
    return Boolean(find(SEL.challenge));
  }

  /** ready | document | login | verification | loading */
  function pageState() {
    if (/\/auth\/login|\/log-in/i.test(location.pathname)) return 'login';
    if (challengeShown()) return 'verification';
    if (find(SEL.loginButton)) return 'login';
    if (find(SEL.composer)) return 'ready';
    if ([...document.querySelectorAll(DOCUMENT_EDITOR)].some(visible)) return 'document';
    if (uiTextMatches(/verify you are human/i)) return 'verification';
    return 'loading';
  }

  async function waitForReady(timeoutMs, job) {
    const deadline = Date.now() + timeoutMs;
    let readySince = 0;
    let loginSince = 0;
    let verificationUntil = 0;
    for (;;) {
      const state = pageState();
      if (state === 'document' && currentConversation() && job && !job.editorRecovery) {
        savePending({ ...job, editorRecovery: true });
        location.assign(currentConversation());
        await new Promise(() => undefined);
      }
      readySince = state === 'ready' ? readySince || Date.now() : 0;
      loginSince = state === 'login' ? loginSince || Date.now() : 0;
      if (readySince && Date.now() - readySince > 1500) return 'ready';
      if (loginSince && Date.now() - loginSince > 3000) return 'login';
      if (state === 'verification') {
        if (!verificationUntil) {
          verificationUntil = Date.now() + VERIFICATION_WAIT_MS;
          const message = 'ChatGPT is asking "Verify you are human". Please complete it in this window — the article continues automatically.';
          await report('attention', message);
          await bg({ type: 'attention', message }).catch(() => undefined);
        }
        if (Date.now() > verificationUntil) return 'verification';
      } else if (verificationUntil) {
        verificationUntil = 0;
        await report('working', 'Verification completed');
      }
      if (!verificationUntil && Date.now() > deadline) return 'timeout';
      await sleep(500);
    }
  }

  async function dismissDialogs() {
    for (let i = 0; i < 3; i++) {
      const button = find(SEL.dialogClose) || buttonWithText(TEXT.dialogs);
      if (!button) return;
      button.click();
      await sleep(600);
    }
  }

  // ───────────────────────── prompt entry ─────────────────────────

  const composerText = (el) => (el instanceof HTMLTextAreaElement ? el.value : el.innerText || el.textContent || '');

  function composerHasPrompt(el, prompt) {
    const current = normalize(composerText(el));
    const wanted = normalize(prompt);
    if (!wanted) return false;
    return current === wanted;
  }

  function setTextareaValue(el, value) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function clearComposer(el) {
    if (el !== findComposer()) throw new JobError('ERROR', 'ChatGPT prompt box changed before typing; the document editor was left untouched');
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      setTextareaValue(el, '');
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete');
  }

  /** Prompts longer than this are typed, not pasted (see typePrompt). */
  const LONG_PROMPT_CHARS = 8000;

  /** The "Remove Pasted text…" buttons of the attachments ChatGPT made from a pasted text. */
  function pastedTextChips() {
    const form = find(SEL.composer)?.closest('form') || document;
    return [...form.querySelectorAll('button, [role="button"]')].filter((button) =>
      /^remove\s+pasted\s+text/i.test((button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim()));
  }

  function removePastedTextChips() {
    for (const button of pastedTextChips()) button.click();
  }

  async function typePrompt(prompt) {
    // While a chat is still opening ("New chat" turning into the conversation), ChatGPT can build its prompt box anew
    // between finding it and typing. The safety check in clearComposer then refuses the old box; find the new one and
    // start again instead of giving up.
    for (let round = 1; ; round++) {
      const composer = await waitUntil(() => find(SEL.composer), 30_000);
      if (!composer) throw new JobError('ERROR', 'ChatGPT prompt box was not found');

      // Paste keeps the prompt's line breaks, like a person pasting it.
      const paste = () => {
        const data = new DataTransfer();
        data.setData('text/plain', prompt);
        composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      };
      const insert = () => document.execCommand('insertText', false, prompt);
      // ChatGPT turns a long pasted text into an attachment ("Pasted text.txt") instead of putting it in the box, and
      // then does not send (seen live on 26 September 2026 with a 17,000-character prompt): long prompts are typed.
      const ways = [
        ...(prompt.length > LONG_PROMPT_CHARS ? [insert, paste] : [paste, insert]),
        () => composer instanceof HTMLTextAreaElement && setTextareaValue(composer, prompt),
      ];
      try {
        for (const way of ways) {
          removePastedTextChips();
          clearComposer(composer);
          way();
          if (await waitUntil(() => composerHasPrompt(composer, prompt), 3000, 250)) {
            removePastedTextChips();
            return;
          }
        }
      } catch (err) {
        if (!(err instanceof JobError) || !/prompt box changed/.test(err.message) || round >= 3) throw err;
        await sleep(1500);
        continue;
      }
      throw new JobError('ERROR', 'Could not enter the prompt into the ChatGPT prompt box');
    }
  }

  function pressEnter(el) {
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }

  // ───────────────────────── sending ─────────────────────────

  const lastUserNode = () => {
    const users = document.querySelectorAll(USER);
    return users[users.length - 1] || null;
  };

  /**
   * Remembers the last user message before sending, to recognise the new one (ChatGPT unmounts old turns in long chats),
   * and the pictures already on the page, so a picture from an earlier answer is never taken for a new one.
   */
  function userMarker() {
    const node = lastUserNode();
    const pictures = [...(document.querySelector('main') || document.body).querySelectorAll('img')];
    return {
      /** When the prompt was about to be sent: a user message ChatGPT created after this is ours. */
      at: Date.now(),
      node,
      id: node?.getAttribute('data-message-id') || null,
      imageNodes: new Set(pictures),
      imageSources: new Set(pictures.map((img) => img.currentSrc || img.src)),
      // The answer blocks already on the page, so a page-read answer (HTTP 429 fallback) is never an older one.
      answerBlocks: new Set(answerBlocks()),
      // The rows of buttons under finished turns: the user's turn gets one at once, the answer when ChatGPT is done.
      actionRows: document.querySelectorAll(ACTION_ROW).length,
    };
  }

  /**
   * ChatGPT's rendered answers (Markdown blocks), in page order; writing-block editors inside them are not separate.
   * The whole page is searched: on the live page of 30 September 2026 none were found inside <main> (the new app shell
   * may keep the thread elsewhere), and the class may be spelled as part of a longer name.
   */
  const ANSWER_BLOCK = '.markdown, .prose, [class*="markdown"]';
  /**
   * The app-shell page (live, 30 September 2026) has none of those: each turn is a [data-virtualized-turn-content]
   * element, the user's turns carry "user-message" classes, and nothing marks Markdown.
   */
  const TURN_CONTENT = '[data-virtualized-turn-content]';
  function answerBlocks() {
    const usable = (el) => !el.closest('form') && !el.closest('[contenteditable="true"]') && !el.closest('[data-bas-holder]');
    const blocks = [...document.querySelectorAll(ANSWER_BLOCK)].filter((el) => !el.parentElement?.closest(ANSWER_BLOCK) && usable(el));
    if (blocks.length) return blocks;
    const turns = [...document.querySelectorAll(TURN_CONTENT)].filter(
      (el) => !el.parentElement?.closest(TURN_CONTENT) && !el.matches('[class*="user-message"]') && !el.querySelector('[class*="user-message"]') && usable(el),
    );
    if (turns.length) return turns;
    // Live on 30 September 2026 not even that: the only mark is the row of buttons under each answer
    // ("turn-action-controls"). The answer is the nearest element above that row holding text but no user message.
    const answers = [];
    for (const row of document.querySelectorAll(ACTION_ROW)) {
      let el = row.parentElement;
      for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
        if (el.matches('[class*="user-message"]') || el.querySelector('[class*="user-message"]')) {
          el = null;
          break;
        }
        if ((el.innerText || '').length - (row.innerText || '').length > 20) break;
      }
      if (el && usable(el) && !answers.includes(el)) answers.push(el);
    }
    return answers;
  }
  const ACTION_ROW = '.turn-action-controls, [class*="turn-action-controls"]';

  /** What the page is built from, for the debug snapshot (finding the answer when ChatGPT changes its page). */
  function pageShape() {
    const count = (selector) => {
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return -1;
      }
    };
    const testIds = [...new Set([...document.querySelectorAll('[data-test-id]')].map((el) => el.getAttribute('data-test-id')))].slice(0, 15);
    const classes = new Set();
    for (const el of document.querySelectorAll('[class*="markdown"], [class*="prose"], [class*="message"], [class*="turn"]')) {
      for (const c of el.classList) if (/markdown|prose|message|turn/i.test(c)) classes.add(c);
      if (classes.size > 20) break;
    }
    return {
      main: count('main'),
      inMain: count('main .markdown'),
      markdown: count('.markdown'),
      prose: count('.prose'),
      articles: count('article'),
      roles: count('[data-message-author-role]'),
      messageIds: count('[data-message-id]'),
      turns: count('[data-turn]'),
      turnContent: count(TURN_CONTENT),
      actionRows: count(ACTION_ROW),
      lastAnswerBlock: (() => {
        const last = answerBlocks().pop();
        return last ? { tag: last.tagName, cls: String(last.className || '').slice(0, 80), chars: (last.innerText || '').length } : null;
      })(),
      testIds,
      classes: [...classes],
      bodyChars: (document.body.innerText || '').length,
    };
  }

  /** The newest answer block that appeared after `marker` was taken, read like any page answer (null: none yet). */
  function pageAnswerSince(marker) {
    if (!marker?.answerBlocks) return null;
    const fresh = answerBlocks().filter((el) => !marker.answerBlocks.has(el));
    const last = fresh[fresh.length - 1];
    if (!last) return null;
    const content = answerContent(last);
    return content.text.trim() ? content : null;
  }

  function isNewUserMessage(marker) {
    const node = lastUserNode();
    if (!node) return false;
    const id = node.getAttribute('data-message-id');
    return marker.id && id ? id !== marker.id : node !== marker.node;
  }

  /** The buttons around the prompt box (a <form> in older ChatGPT versions, a plain container in newer ones). */
  function composerButtons() {
    const composer = find(SEL.composer);
    if (!composer) return [...document.querySelectorAll('#composer-submit-button')];
    const form = composer.closest('form');
    if (form) return [...form.querySelectorAll('button')];
    let el = composer;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      const buttons = [...el.querySelectorAll('button')].filter(visible);
      if (buttons.some((b) => /send|submit|stop|voice|dictat/i.test(buttonLabel(b)))) {
        return buttons;
      }
    }
    return [];
  }

  /** ChatGPT is still answering: a Stop button next to the prompt box (whatever its exact name) or a streaming marker. */
  function isGenerating() {
    if (find(SEL.stopButton)) return true;
    if (composerButtons().some((b) => visible(b) && /\bstop/i.test(`${b.getAttribute('data-testid') || ''} ${b.getAttribute('aria-label') || ''}`))) {
      return true;
    }
    return answerNodesAfterLastUser().some((n) => n.querySelector('.result-streaming, [data-is-streaming="true"]'));
  }

  /** Pictures shown in the prompt box as attachments (their previews), for counting what was attached. */
  function attachmentPreviews() {
    const form = find(SEL.composer)?.closest('form') || document.querySelector('form');
    return form ? form.querySelectorAll('img').length : 0;
  }

  /**
   * Attaches photos to the prompt the way a person picks them with the paperclip: through ChatGPT's own file field.
   * The job carries them as base64 (the app resized them). Waits until ChatGPT shows a preview of each one.
   */
  /** ChatGPT's file field is hidden (the paperclip opens it), so find() — which wants visible elements — cannot be used. */
  function fileField() {
    const form = find(SEL.composer)?.closest('form');
    for (const selector of SEL.fileInput) {
      const input = form?.querySelector(selector) || document.querySelector(selector);
      if (input && !input.disabled) return input;
    }
    return null;
  }

  async function attachFiles(files, check) {
    const input = await waitUntil(fileField, 10_000, 250);
    if (!input) throw new JobError('ERROR', 'ChatGPT shows no place to attach photos');
    const transfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.mime }));
    }
    const before = attachmentPreviews();
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const shown = await waitUntil(() => { check(); return attachmentPreviews() - before >= files.length; }, 45_000, 300);
    if (!shown) throw new JobError('ERROR', `ChatGPT did not take the ${files.length} attached photo(s) (${attachmentPreviews() - before} shown)`);
  }

  async function submit(prompt, marker, userBefore, sendWaitMs = 10_000) {
    // A page without message markers (see conversationTurn) shows that it took the prompt by emptying the prompt box.
    const composerCleared = () => {
      const composer = find(SEL.composer);
      return Boolean(composer) && !normalize(composerText(composer));
    };
    const accepted = () =>
      waitUntil(
        () =>
          (isNewUserMessage(marker) && promptsMatch(lastUserNode().innerText, prompt)) ||
          count(USER) > userBefore ||
          isGenerating() ||
          (!pageHasMessages() && composerCleared()),
        20_000,
        300,
      );
    const send = await waitUntil(() => {
      const button = sendButton();
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
    }, sendWaitMs);
    if (send) send.click();
    else pressEnter(find(SEL.composer));
    if (await accepted()) return;

    const composer = find(SEL.composer);
    if (composer && normalize(composerText(composer))) {
      pressEnter(composer);
      if (await accepted()) return;
    }
    throw new JobError('ERROR', 'ChatGPT did not accept the prompt');
  }

  // ───────────────────────── answers ─────────────────────────

  function answerNodesAfterLastUser() {
    const nodes = [...document.querySelectorAll('[data-message-author-role]')];
    let lastUser = -1;
    nodes.forEach((n, i) => {
      if (n.getAttribute('data-message-author-role') === 'user') lastUser = i;
    });
    return nodes.slice(lastUser + 1).filter((n) => n.getAttribute('data-message-author-role') === 'assistant');
  }

  const lastAnswerLength = () => answerNodesAfterLastUser().reduce((sum, n) => sum + (n.textContent || '').trim().length, 0);

  /**
   * ChatGPT reveals an answer word by word with an animation that Chrome pauses in tabs that are not visible, so
   * the page can hold much less text than ChatGPT already sent. Each markdown block records its source length
   * (data-start / data-end); far less text in a long block — or a writing block with an empty document — means
   * the answer is not on the page yet.
   */
  function answerNotFullyShown() {
    for (const node of answerNodesAfterLastUser()) {
      for (const block of node.querySelectorAll('[data-testid="writing-block-container"]')) {
        const editor = block.querySelector('[data-writing-block-fullscreen-editor-region], .ProseMirror');
        if (!editor || !editor.textContent.trim()) return true;
      }
      const content = node.querySelector('.markdown, .prose');
      if (!content) continue;
      for (const block of content.querySelectorAll(':scope > [data-start][data-end]')) {
        const size = Number(block.getAttribute('data-end')) - Number(block.getAttribute('data-start'));
        if (!(size >= 150)) continue;
        let shown = block.textContent.length;
        block.querySelectorAll(CITATION_PILLS).forEach((pill) => {
          shown -= pill.textContent.length;
        });
        if (shown < size * 0.4) return true;
      }
    }
    return false;
  }

  /**
   * ChatGPT shows Copy / Good / Bad response buttons under an answer only once it is complete.
   * Buttons inside the answer itself (code-block "Copy code", writing-block toolbar) do not count.
   */
  function answerActionsShown() {
    const answers = answerNodesAfterLastUser();
    const last = answers[answers.length - 1];
    if (!last) return false;
    const turn = last.closest('article, [data-testid^="conversation-turn"]') || last.parentElement;
    if (!turn) return false;
    return [...turn.querySelectorAll('button')].some((b) => {
      if (answers.some((a) => a.contains(b))) return false;
      const name = `${b.getAttribute('data-testid') || ''} ${b.getAttribute('aria-label') || ''}`;
      return /copy|good.response|bad.response|thumbs|read.aloud/i.test(name);
    });
  }

  /** What the extension sees on the page (no answer text) — sent with progress reports to diagnose problems. */
  function snapshot(step) {
    const label = (b) => [b.getAttribute('data-testid'), b.getAttribute('aria-label'), b.id].filter(Boolean).join('|').slice(0, 60);
    const composer = find(SEL.composer);
    const buttons = composerButtons().filter(visible).map(label).filter(Boolean);
    return {
      step,
      hidden: document.hidden,
      path: location.pathname,
      title: document.title.slice(0, 60),
      composer: Boolean(composer),
      composerChars: composer ? composerText(composer).length : 0,
      send: Boolean(sendButton()),
      stop: Boolean(find(SEL.stopButton)),
      generating: isGenerating(),
      writingBlock: Boolean(document.querySelector('[data-testid="writing-block-container"]')),
      users: count(USER),
      assistants: count(ASSISTANT),
      turns: count('[data-testid^="conversation-turn"]'),
      answerChars: lastAnswerLength(),
      actions: answerActionsShown(),
      formButtons: [...new Set(buttons)].slice(0, 12),
      editors: [...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible).slice(0, 4).map((el) => ({
        tag: el.tagName, id: el.id, role: el.getAttribute('role'), placeholder: (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '').slice(0, 60),
        document: Boolean(el.closest(DOCUMENT_EDITOR)), selected: el === composer,
      })),
      images: imageDiagnostics(),
      read: pageHasMessages() ? 'page' : 'conversation',
      // Reading the conversation : the shared pressure level after HTTP 429s and what the last read said.
      answerBlocks: answerBlocks().length,
      page: pageShape(),
      conversationRead: {
        level: conversationPressure.level,
        nextReadInS: Math.max(0, Math.ceil((conversationPressure.nextAt - Date.now()) / 1000)),
        problem: conversationPressure.problem,
        lastRead: lastReadInfo,
      },
      ...(searchState ? { search: searchState } : {}),
      markers: pageMarkers(),
    };
  }

  /** The markers ChatGPT's page uses (names only, no text): when ChatGPT changes its page, the log shows the new ones. */
  function pageMarkers() {
    const scope = document.querySelector('main') || document.body;
    const testIds = new Set();
    const attributes = new Set();
    for (const el of scope.querySelectorAll('*')) {
      const id = el.getAttribute('data-testid');
      if (id) testIds.add(id.replace(/\d+/g, '#').slice(0, 40));
      for (const name of el.getAttributeNames()) if (name.startsWith('data-') && name !== 'data-testid') attributes.add(name.slice(0, 40));
      if (testIds.size >= 20 && attributes.size >= 20) break;
    }
    return { testIds: [...testIds].slice(0, 20), attributes: [...attributes].slice(0, 20) };
  }

  const CITATION_PILLS = '[data-testid="webpage-citation-pill"]';

  /**
   * Article HTML + text of one answer, taken from the page structure rather than what is currently painted:
   * writing blocks keep only their document text (no title bar / follow-up chips) and source pills are dropped.
   */
  function answerContent(node) {
    const content = node.querySelector('.markdown, .prose') || node;
    const clone = content.cloneNode(true);
    clone
      .querySelectorAll('[data-testid="writing-block-header-sticky-container"], [data-testid="writing-block-suggested-followups"], button, [role="button"], .turn-action-controls, [class*="turn-action"]')
      .forEach((el) => el.remove());
    clone.querySelectorAll(CITATION_PILLS).forEach((el) => el.remove());
    clone.querySelectorAll('[data-testid="writing-block-container"]').forEach((block) => {
      const editor = block.querySelector('[data-writing-block-fullscreen-editor-region], .writing-block-editor .ProseMirror, .ProseMirror');
      const outer = block.closest('[data-writing-block-fullscreen-fallback-target]') || block;
      if (editor) outer.replaceWith(...editor.cloneNode(true).childNodes);
    });
    // innerText gives the line structure the parsers expect; measure an off-screen copy with every part forced visible
    // (words still waiting for ChatGPT's reveal animation are otherwise left out).
    const holder = document.createElement('div');
    holder.setAttribute('data-bas-holder', '');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;';
    const style = document.createElement('style');
    style.textContent = '[data-bas-holder] * { visibility: visible !important; opacity: 1 !important; content-visibility: visible !important; }';
    holder.append(style, clone);
    document.body.appendChild(holder);
    const text = clone.innerText;
    holder.remove();
    return { html: clone.innerHTML, text };
  }

  function readLastAnswer() {
    const nodes = answerNodesAfterLastUser();
    // A page without message markers: the answer was read from the conversation itself.
    if (!nodes.length && conversationAnswer && !pageHasMessages()) {
      return { ...conversationAnswer, conversationUrl: currentConversation() || conversationAnswer.conversationUrl };
    }
    const html = [];
    const text = [];
    for (const node of nodes) {
      const part = answerContent(node);
      html.push(part.html);
      text.push(part.text);
    }
    return { html: html.join('\n'), text: text.join('\n\n').trim(), conversationUrl: currentConversation() };
  }

  /**
   * Done = not generating, answer text unchanged for a moment and ChatGPT's action buttons under the answer.
   * Without those buttons the text must stay unchanged for 30s in a visible tab. A tab behind other tabs
   * (Chrome pauses its rendering) is brought to the front before its answer is read.
   * marker: the last user message before sending (null when recovering an answer already on the page).
   * `options.prompt`: the prompt, to read the answer from the conversation when the page shows no message markers.
   */
  async function waitForCompletion(marker, timeoutMs, check, options = {}) {
    // A page that shows no message markers even a few seconds after the prompt is read from the conversation itself.
    if (options.prompt && !pageHasMessages() && !(await waitUntil(() => pageHasMessages(), 8000, 500))) {
      return waitForConversationAnswer(options.prompt, timeoutMs, check, marker);
    }
    const started = Date.now();
    let lastLength = -1;
    let stableSince = 0;
    let lastChangeAt = Date.now();
    let lastFrontAt = 0;
    let lastWindowFocusAt = 0;
    let frontRequests = 0;
    let revealShown = false;

    while (Date.now() - started < timeoutMs) {
      check();
      if (/\/auth\/login/i.test(location.pathname) || find(SEL.loginButton)) {
        throw new JobError('LOGIN', 'ChatGPT logged out while answering. Log in in the ChatGPT window — the article continues automatically.');
      }
      if (usageLimitReached()) {
        throw new JobError('USAGE_LIMIT', 'ChatGPT usage limit reached. Resume the task after the limit resets.');
      }
      const prefer = buttonWithText(TEXT.prefer);
      if (prefer) prefer.click();

      const generating = isGenerating();
      const ourTurn = !marker || isNewUserMessage(marker);
      const sawAnswer = ourTurn && answerNodesAfterLastUser().length > 0;

      if (!generating) {
        const more = buttonWithText(TEXT.continue);
        if (more) {
          more.click();
          stableSince = 0;
          await sleep(1000);
          continue;
        }
        if (sawAnswer && lastTurnHasError()) throw new JobError('ERROR', 'ChatGPT displayed an error while generating the response');
      }

      const now = Date.now();
      if (sawAnswer) {
        const length = lastAnswerLength();
        if (length !== lastLength) {
          lastChangeAt = now;
          stableSince = 0;
        }
        lastLength = length;
        if (!generating && length > 0) {
          stableSince = stableSince || now;
          const stableFor = now - stableSince;
          if (stableFor >= STABLE_MS) {
            const incomplete = answerNotFullyShown();
            const actions = answerActionsShown();
            if (!incomplete && actions && (!document.hidden || revealShown)) return;
            if (!incomplete && actions) {
              // In a hidden tab ChatGPT's word-by-word reveal stops, so even a finished short answer can be cut off on
              // the page ("CATEGORY: T" instead of "CATEGORY: Tech"). Show the tab once and read it after that.
              revealShown = true;
              await comeToFront(3000);
              stableSince = 0;
              continue;
            }
            if (document.hidden) {
              // Let Chrome paint the rest: first bring the tab to the front, then (if the window itself is covered or minimized) the window.
              if (now - lastFrontAt > 12_000) {
                lastFrontAt = now;
                frontRequests++;
                await comeToFront(8000);
                if (document.hidden && frontRequests >= 2 && now - lastWindowFocusAt > 60_000) {
                  lastWindowFocusAt = now;
                  await bg({ type: 'focus-window' }).catch(() => undefined);
                }
              }
            } else if (stableFor >= 60_000 || (!incomplete && stableFor >= 30_000)) {
              // Visible and unchanged for a long time: nothing more is coming.
              return;
            }
          }
        } else {
          stableSince = 0;
        }
      } else if (!generating && marker && !ourTurn && now - started > 180_000) {
        throw new JobError('ERROR', 'The prompt did not appear in the ChatGPT conversation');
      }

      // Nothing moving for a while in a background tab: give it the front for a moment. If the tab stays hidden,
      // the whole window is minimised or covered (e.g. by the WordPress browser) — then raise the window itself.
      if (document.hidden && now - Math.max(lastChangeAt, lastFrontAt) > 30_000) {
        lastFrontAt = now;
        frontRequests++;
        await comeToFront(3000);
        if (document.hidden && frontRequests >= 2 && now - lastWindowFocusAt > 60_000) {
          lastWindowFocusAt = now;
          await bg({ type: 'focus-window' }).catch(() => undefined);
        }
      }
      await sleep(750);
    }
    if (document.hidden) {
      // Chrome does not draw pages while the screen is locked or the window is minimized/covered.
      throw new JobError(
        'ERROR',
        'ChatGPT could not show the answer because its window was hidden (screen locked, minimized or fully covered). Keep the screen unlocked while articles are written.',
      );
    }
    throw new JobError('ERROR', `ChatGPT response did not complete within ${Math.round(timeoutMs / 1000)}s`);
  }

  // ───────────────────────── the conversation itself ─────────────────────────
  // ChatGPT changes its page now and then: in September 2026 its messages lost the data-message-author-role and
  // conversation-turn markers everything above looks for. The conversation data the page is drawn from stays the same,
  // so when the page shows no messages, the prompt, the answer and whether it is finished are read from there.

  const pageHasMessages = () => count('[data-message-author-role]') > 0;

  /** The answer read from the conversation for the current prompt (readLastAnswer returns it). */
  let conversationAnswer = null;

  /** Where the image search of the current prompt stands (shown in the page diagnostics). */
  let searchState = null;

  /** Gallery pictures of the current prompt that could not be saved, and why (sent back with the answer). */
  let imageNote = '';

  /** Gallery pictures of the current prompt that the app downloads itself: { url, width, height } (see take()). */
  let imageLinks = [];

  /** The picture hosts the extension itself may read (same list as the manifest's host_permissions and background.js). */
  const EXTENSION_IMAGE_HOST = /^https:\/\/(([a-z0-9-]+\.)*(chatgpt\.com|openai\.com|oaiusercontent\.com)|tse[0-9]\.mm\.bing\.net)\//i;

  let session = { token: null, at: 0 };
  async function accessToken() {
    if (session.token && Date.now() - session.at < 5 * 60_000) return session.token;
    const data = await fetch('/api/auth/session', { credentials: 'include' }).then((res) => (res.ok ? res.json() : null));
    session = { token: data?.accessToken || null, at: Date.now() };
    return session.token;
  }

  /**
   * Reading the conversation is rationed. Seen live on 30 September 2026: three tabs reading it every 2.5–4 s made
   * ChatGPT answer HTTP 429, and then ChatGPT's own page could not load its chats either — answers were never seen
   * ("did not complete within 600s"), saved chats "could not be opened" and articles restarted in new chats.
   * So: at most one read per CONVERSATION_READ_MS in a tab (a newer call gets the last result), and after a 429 every
   * tab waits (shared through chrome.storage) for as long as ChatGPT asks, or 20 s doubling up to 2 minutes.
   */
  const CONVERSATION_READ_MS = 5000;
  /**
   * All ChatGPT tabs share one "read slot" (chrome.storage): the next moment any tab may read a conversation, and a
   * pressure level. Seen live on 30 September 2026 with 1.6.12: after each cooldown the three tabs read at once and got
   * 429 again. Now one tab reads per gap; each 429 raises the level (30 s, 1, 2, 4, 5 minutes), each success lowers it.
   */
  const SLOT_KEY = 'basConversationSlot';
  const GAPS_MS = [4000, 30_000, 60_000, 120_000, 240_000, 300_000];
  let lastConversationRead = { at: 0, id: '', result: null };
  /** For the debug snapshot: what the last real read of the conversation showed. */
  let lastReadInfo = null;
  /** For the debug snapshot: the slot as this tab last saw it. */
  let conversationPressure = { level: 0, nextAt: 0, problem: '' };

  async function readSlot() {
    try {
      const slot = (await chrome.storage.local.get(SLOT_KEY))[SLOT_KEY];
      return { nextAt: Number(slot?.nextAt) || 0, level: Math.min(GAPS_MS.length - 1, Math.max(0, Number(slot?.level) || 0)) };
    } catch {
      return { nextAt: 0, level: 0 };
    }
  }

  async function writeSlot(slot) {
    conversationPressure = { ...conversationPressure, ...slot };
    try {
      await chrome.storage.local.set({ [SLOT_KEY]: slot });
    } catch {
      /* storage unavailable: this tab still paces itself through lastConversationRead */
    }
  }

  /** The conversation open in this tab, as ChatGPT stores it. `at` is when it was actually read. */
  async function fetchConversation() {
    const id = /\/c\/([a-z0-9-]+)/i.exec(location.pathname)?.[1];
    if (!id) return { data: null, problem: 'No conversation address on the page' };
    const now = Date.now();
    if (lastConversationRead.result && lastConversationRead.id === id && now - lastConversationRead.at < CONVERSATION_READ_MS) {
      return lastConversationRead.result;
    }
    const slot = await readSlot();
    const waitUntil = Math.max(slot.nextAt, lastConversationRead.cooldownUntil || 0);
    if (now < waitUntil) {
      // Another tab has the slot, or ChatGPT asked to slow down: wait without reading.
      const problem = slot.level
        ? `ChatGPT asked to slow down (HTTP 429) — next read in ${Math.ceil((waitUntil - now) / 1000)}s`
        : 'waiting for another ChatGPT tab to read first';
      conversationPressure = { ...slot, problem };
      return { data: null, problem, rateLimited: true };
    }
    // Take the slot before reading, so the other tabs wait for this read.
    await writeSlot({ nextAt: now + GAPS_MS[slot.level], level: slot.level });
    const token = await accessToken();
    if (!token) return { data: null, problem: 'The ChatGPT session gave no access key' };
    const res = await fetch(`/backend-api/conversation/${id}`, { credentials: 'include', headers: { authorization: `Bearer ${token}` } });
    let result;
    if (res.status === 429) {
      const level = Math.min(GAPS_MS.length - 1, slot.level + 1);
      const asked = Number(res.headers.get('retry-after')) * 1000;
      const wait = asked > 0 ? Math.min(Math.max(asked, 1000), 5 * 60_000) : GAPS_MS[level];
      const cooldownUntil = Date.now() + wait;
      await writeSlot({ nextAt: cooldownUntil, level });
      conversationPressure.problem = `ChatGPT asked to slow down (HTTP 429) — next read in ${Math.ceil(wait / 1000)}s`;
      lastConversationRead = { at: Date.now(), id, result: null, cooldownUntil };
      return { data: null, problem: conversationPressure.problem, rateLimited: true };
    }
    if (slot.level) await writeSlot({ nextAt: Date.now() + GAPS_MS[slot.level - 1], level: slot.level - 1 });
    conversationPressure.problem = '';
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) session = { token: null, at: 0 };
      result = { data: null, problem: `The conversation could not be read (HTTP ${res.status})` };
    } else {
      result = { data: await res.json(), problem: '', at: Date.now(), pressured: slot.level > 0 };
    }
    lastConversationRead = { at: Date.now(), id, result };
    return result;
  }

  /** The messages in the order the page shows them: the branch that ends at the conversation's current message. */
  function conversationChain(data) {
    const mapping = data?.mapping || {};
    const chain = [];
    const seen = new Set();
    for (let id = data?.current_node; id && mapping[id] && !seen.has(id); id = mapping[id].parent) {
      seen.add(id);
      if (mapping[id].message) chain.push(mapping[id].message);
    }
    return chain.reverse();
  }

  /** "user", "assistant", or null for what the page does not show (system notes, tool calls, web searches). */
  function shownRole(message) {
    const role = message?.author?.role;
    if (role !== 'user' && role !== 'assistant') return null;
    if (message.metadata?.is_visually_hidden_from_conversation) return null;
    if (role === 'assistant' && message.recipient && message.recipient !== 'all') return null;
    return role;
  }

  const partsText = (message) => (message?.content?.parts || []).filter((part) => typeof part === 'string').join('\n').trim();
  const isAnswerText = (message) => shownRole(message) === 'assistant' && ['text', 'multimodal_text'].includes(message.content?.content_type);

  /** ChatGPT's own markers inside the text: sources and picture groups are dropped, a named person or thing keeps its name. */
  function cleanAnswerText(text) {
    return String(text || '')
      .replace(/(\w+)([\s\S]*?)/g, (_, kind, body) => {
        if (kind !== 'entity') return '';
        try {
          const value = JSON.parse(body);
          const name = Array.isArray(value) ? (value.find((v, i) => i > 0 && typeof v === 'string') ?? value[0]) : '';
          return typeof name === 'string' ? name : '';
        } catch {
          return '';
        }
      })
      .replace(/[-]/g, '')
      .replace(/【[^】]*】/g, '')
      .replace(/[ \t]+([.,;:!?])/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  /** The last prompt of the conversation and ChatGPT's answer to it, as the conversation data holds them. */
  async function conversationTurn() {
    const { data, problem, rateLimited, at, pressured } = await fetchConversation();
    if (!data) return { ok: false, problem, rateLimited: Boolean(rateLimited) };
    const chain = conversationChain(data);
    let lastUser = -1;
    chain.forEach((message, index) => {
      if (shownRole(message) === 'user') lastUser = index;
    });
    // A tool call (web search, memory…) splits the answer. What ChatGPT writes before a search is only its plan
    // ("I'm verifying Tommy Gooding's exact identity…", seen live on 27 September 2026 at the top of an article): the
    // answer is the last part with text after a tool.
    const parts = [[]];
    for (const message of chain.slice(lastUser + 1)) {
      const role = message?.author?.role;
      if (role === 'tool' || (role === 'assistant' && message.recipient && message.recipient !== 'all')) parts.push([]);
      else if (isAnswerText(message)) parts[parts.length - 1].push(message);
    }
    const answers = parts.filter((part) => part.some((message) => partsText(message))).pop() || [];
    const last = chain[chain.length - 1];
    const afterUser = chain.slice(lastUser + 1);
    const lastShown = afterUser.filter(isAnswerText).pop() || null;
    const done =
      lastUser >= 0 &&
      Boolean(lastShown) &&
      lastShown.status === 'finished_successfully' &&
      lastShown.end_turn !== false &&
      !afterUser.some((message) => message.status === 'in_progress');
    lastReadInfo = {
      at: new Date().toISOString().slice(11, 19),
      messages: chain.length,
      lastRole: last?.author?.role || null,
      lastType: last?.content?.content_type || null,
      lastStatus: last?.status || null,
      endTurn: last?.end_turn ?? null,
      recipient: last?.recipient || null,
      lastHidden: Boolean(last?.metadata?.is_visually_hidden_from_conversation),
      finished: done,
      answerChars: answers.map(partsText).join('').length,
      user: lastUser >= 0
        ? {
            type: chain[lastUser].content?.content_type || null,
            parts: (chain[lastUser].content?.parts || []).map((part) => (typeof part === 'string' ? part.length : typeof part)),
            head: partsText(chain[lastUser]).slice(0, 60),
            tail: partsText(chain[lastUser]).slice(-40),
          }
        : null,
    };
    return {
      ok: true,
      problem: '',
      /** When the data was read from ChatGPT (a rationed call can hand back the same read again). */
      at,
      /** Read while ChatGPT was asking to slow down. */
      pressured: Boolean(pressured),
      messages: chain.filter(shownRole).length,
      userText: lastUser >= 0 ? partsText(chain[lastUser]) : '',
      /** When ChatGPT created the last user message (ms). */
      userCreated: lastUser >= 0 && chain[lastUser].create_time ? Math.round(chain[lastUser].create_time * 1000) : 0,
      text: cleanAnswerText(answers.map(partsText).filter(Boolean).join('\n\n')),
      // Judged by the last answer the page shows, not the very last message: seen live on 8 October 2026, a finished
      // answer (end_turn true, 17,733 characters, our prompt) was never taken because of what came after it.
      finished: done,
      /** ChatGPT marked the turn as ended itself (end_turn: true): no second read is needed to trust the text. */
      turnEnded: done && (lastShown.end_turn === true || last.end_turn === true),
    };
  }

  /** Is `prompt` the last prompt in this tab's conversation (on the page, or in the conversation data)? */
  async function lastPromptIs(prompt) {
    if (pageHasMessages()) return Boolean(lastUserNode() && promptsMatch(lastUserNode().innerText || '', prompt));
    const turn = await conversationTurn().catch(() => null);
    return Boolean(turn?.ok && promptsMatch(turn.userText, prompt));
  }

  /** The saved conversation is open: its messages are on the page, or (without message markers) in its data. */
  async function conversationLoaded(timeoutMs) {
    let end = Date.now() + timeoutMs;
    const latest = Date.now() + timeoutMs + 5 * 60_000;
    lastLoadRateLimited = false;
    for (let round = 1; ; round++) {
      if (conversationKey(location.href)) {
        if (pageHasMessages()) return true;
        // The app-shell page (30 September 2026) marks the user's turns with "user-message" classes: a saved chat that
        // shows one is open, without asking ChatGPT for its data (which it kept refusing, sending every stage to a new
        // chat without its context).
        if (document.querySelector('[class*="user-message"]')) return true;
        if (round % 4 === 0) {
          const turn = await conversationTurn().catch(() => null);
          if (turn?.ok && turn.messages > 0) return true;
          // "Slow down" is not "lost": wait for ChatGPT (up to five more minutes) instead of giving the chat up.
          if (turn?.rateLimited) {
            // Refused for a long time already (level 2+): the chat cannot be read now, go on in a new one.
            if (conversationPressure.level >= 2) {
              lastLoadRateLimited = 'persistent';
              return false;
            }
            lastLoadRateLimited = 'brief';
            end = Math.min(Math.max(end, Date.now() + 30_000), latest);
          }
        }
      }
      if (Date.now() >= end) return false;
      await sleep(500);
    }
  }
  /** The last conversationLoaded() ran into ChatGPT's HTTP 429: false, 'brief' or 'persistent'. */
  let lastLoadRateLimited = false;

  /**
   * waitForCompletion for a page without message markers: done = the conversation's last message is ChatGPT's answer
   * to `prompt`, marked finished, ChatGPT is not answering any more and the text stayed the same between two reads.
   * The text comes from ChatGPT itself, so a tab behind other windows does not cut it off.
   */
  async function waitForConversationAnswer(prompt, timeoutMs, check, marker = null) {
    const started = Date.now();
    let seen = false;
    let lastText = null;
    let lastReadAt = 0;
    let stableSince = 0;
    let errorSince = 0;
    let problem = '';
    let lastAsked = 0;
    let pageText = '';
    let pageSince = 0;
    // Time ChatGPT made us wait (HTTP 429) does not count against the answer (at most 15 minutes of it).
    let waited = 0;
    let limitedSince = 0;
    const elapsed = () => Date.now() - started - Math.min(waited + (limitedSince ? Date.now() - limitedSince : 0), 15 * 60_000);
    while (elapsed() < timeoutMs) {
      check();
      if (/\/auth\/login/i.test(location.pathname) || find(SEL.loginButton)) {
        throw new JobError('LOGIN', 'ChatGPT logged out while answering. Log in in the ChatGPT window — the article continues automatically.');
      }
      if (usageLimitReached()) throw new JobError('USAGE_LIMIT', 'ChatGPT usage limit reached. Resume the task after the limit resets.');
      const prefer = buttonWithText(TEXT.prefer);
      if (prefer) prefer.click();
      const generating = isGenerating();
      const more = generating ? null : buttonWithText(TEXT.continue);
      if (more) {
        more.click();
        await sleep(1000);
        continue;
      }

      // While ChatGPT is writing (its Stop button shows) there is nothing to read yet: ask only now and then, to
      // notice our prompt, instead of every few seconds.
      if (generating && Date.now() - lastAsked < (seen ? 60_000 : 20_000)) {
        await sleep(4000);
        continue;
      }
      // The app-shell page shows a row of buttons under a finished answer. Until the row for our answer is there
      // (the user's row plus the answer's), read only every 45 s as a safety net. Seen live on 8 October 2026: five
      // tabs reading every few seconds kept ChatGPT at HTTP 429, and nothing was read at all.
      const rowsNow = document.querySelectorAll(ACTION_ROW).length;
      const rowsKnown = marker && (marker.actionRows > 0 || rowsNow > 0);
      if (rowsKnown && rowsNow < marker.actionRows + 2 && Date.now() - lastAsked < 45_000) {
        await sleep(2500);
        continue;
      }
      lastAsked = Date.now();
      let turn = null;
      try {
        turn = await conversationTurn();
        problem = turn.problem;
      } catch (err) {
        problem = String(err?.message || err);
      }
      if (turn?.rateLimited) limitedSince = limitedSince || Date.now();
      else if (limitedSince) {
        waited += Date.now() - limitedSince;
        limitedSince = 0;
      }
      // Ours = the prompt as sent, or a user message ChatGPT created after this tab sent its prompt (8 October 2026: a
      // finished answer with end_turn was ignored for minutes because the saved prompt no longer matched as typed).
      const ours = Boolean(turn?.ok && (promptsMatch(turn.userText, prompt) || (marker?.at && turn.userCreated >= marker.at - 10_000)));
      if (turn?.ok && lastReadInfo) lastReadInfo.ours = ours;
      seen = seen || ours;
      const now = Date.now();
      // ChatGPT will not hand over the conversation (HTTP 429, seen for hours on 30 September 2026), but its page shows
      // the answer: a new answer block that stays the same for 8 s after ChatGPT stopped writing is the answer.
      if (!generating && turn && !turn.ok) {
        const onPage = pageAnswerSince(marker);
        if (onPage && onPage.text !== pageText) {
          pageText = onPage.text;
          pageSince = now;
        } else if (onPage && now - pageSince >= 8000) {
          conversationAnswer = { html: onPage.html, text: onPage.text, conversationUrl: currentConversation() };
          return conversationAnswer;
        }
      }
      if (ours && turn.finished && !generating && turn.text) {
        errorSince = 0;
        // While ChatGPT asks to slow down, its own "finished" mark is enough: a second read may be minutes away. The same
        // when it ended the turn itself — with five tabs sharing the read slot (8 October 2026) a second read is slow.
        if (turn.pressured || turn.turnEnded) {
          conversationAnswer = { html: '', text: turn.text, conversationUrl: currentConversation() };
          return conversationAnswer;
        }
        // Stable = the same text in two separate reads (a rationed call may hand back the same read).
        if (turn.text !== lastText) {
          lastText = turn.text;
          lastReadAt = turn.at || now;
          stableSince = now;
        } else if ((turn.at || now) !== lastReadAt && now - stableSince >= STABLE_MS) {
          conversationAnswer = { html: '', text: turn.text, conversationUrl: currentConversation() };
          return conversationAnswer;
        }
      } else {
        // Waiting for the read slot (another tab reads) or a 429 says nothing about the answer. Seen live on 8 October
        // 2026: with five tabs this reset came between every two reads, so no answer ever counted as stable and every
        // stage hung although ChatGPT had finished.
        if (!turn?.rateLimited) lastText = null;
        // An error ChatGPT shows under the prompt, with no finished answer coming.
        errorSince = ours && !generating && lastTurnHasError() ? errorSince || now : 0;
        if (errorSince && now - errorSince > 30_000) throw new JobError('ERROR', 'ChatGPT displayed an error while generating the response');
      }
      if (!seen && !generating && !turn?.rateLimited && elapsed() > 180_000) {
        throw new JobError('ERROR', `The prompt did not appear in the ChatGPT conversation${problem ? ` (${problem})` : ''}`);
      }
      await sleep(generating ? 4000 : 2500);
    }
    throw new JobError('ERROR', `ChatGPT response did not complete within ${Math.round(timeoutMs / 1000)}s${problem ? ` (${problem})` : ''}`);
  }

  /** recoverExistingAnswer for a page without message markers. */
  async function recoverFromConversation(job, check) {
    // Another tab holding the read slot (or a 429) is not "no answer yet": wait for a real read (up to 90 s). Before
    // 8 October 2026 a retry after a restart sent the whole prompt again whenever another tab was reading.
    let turn = await conversationTurn().catch(() => null);
    for (const end = Date.now() + 90_000; turn?.rateLimited && Date.now() < end; ) {
      check();
      await sleep(3000);
      turn = await conversationTurn().catch(() => null);
    }
    if (!turn?.ok || !promptsMatch(turn.userText, job.prompt)) return null;
    if (turn.finished && turn.text && !isGenerating()) {
      conversationAnswer = { html: '', text: turn.text, conversationUrl: currentConversation() };
      return conversationAnswer;
    }
    try {
      return await waitForConversationAnswer(job.prompt, job.generationTimeoutMs || 600_000, check);
    } catch (err) {
      if (err instanceof JobCancelled || (err instanceof JobError && err.code !== 'ERROR')) throw err;
      return null;
    }
  }

  // ───────────────────────── generated images ─────────────────────────

  /**
   * Pictures ChatGPT created after the last prompt (anything much smaller is an icon, avatar or preview). `before`: the
   * marker taken before sending — pictures already on the page then belong to earlier answers.
   */
  function generatedImages(minWidth = 700, before = null) {
    const lastUser = lastUserNode();
    const scope = document.querySelector('main') || document.body;
    const found = new Map();
    for (const img of scope.querySelectorAll('img')) {
      if (lastUser && !(lastUser.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (img.closest('form, [data-message-author-role="user"]')) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:image/svg')) continue;
      if (before?.imageNodes?.has(img) || before?.imageSources?.has(src)) continue;
      if (!img.complete || img.naturalWidth < minWidth || img.naturalHeight < minWidth * 0.5) continue;
      // The same picture can be shown twice (blurred background + sharp copy): keep one per address.
      const seen = found.get(src);
      if (!seen || img.naturalWidth > seen.width) found.set(src, { src, width: img.naturalWidth, height: img.naturalHeight });
    }
    return [...found.values()];
  }

  /** Short description of the pictures after the last prompt, for the task log (no image data). */
  function imageDiagnostics() {
    const lastUser = lastUserNode();
    const scope = document.querySelector('main') || document.body;
    return [...scope.querySelectorAll('img')]
      .filter((img) => !lastUser || lastUser.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING)
      .slice(-6)
      .map((img) => {
        let host = '';
        try {
          host = new URL(img.currentSrc || img.src).host || 'blob';
        } catch {
          host = (img.src || '').slice(0, 12);
        }
        return `${img.naturalWidth}x${img.naturalHeight}${img.complete ? '' : ' loading'} ${host} ${(img.alt || '').slice(0, 30)}`;
      });
  }

  const creatingImage = () => uiTextMatches(/creating image|generating image|bild wird erstellt|image is being (created|generated)/i);

  /** Waits until ChatGPT has finished creating `expected` images for the last prompt. */
  async function waitForImages(marker, expected, timeoutMs, check, prompt) {
    const started = Date.now();
    let lastKey = '';
    let stableSince = 0;
    let lastFrontAt = 0;
    let lastWindowFocusAt = 0;
    let frontRequests = 0;
    let textOnlySince = 0;
    // A page without message markers: whether the prompt was sent and what ChatGPT said come from the conversation data.
    let promptSeen = false;
    let lastRead = 0;
    let saidInConversation = '';
    while (Date.now() - started < timeoutMs) {
      check();
      if (/\/auth\/login/i.test(location.pathname) || find(SEL.loginButton)) {
        throw new JobError('LOGIN', 'ChatGPT logged out while creating the images. Log in in the ChatGPT window — the article continues automatically.');
      }
      if (usageLimitReached()) throw new JobError('USAGE_LIMIT', 'ChatGPT usage limit reached while creating images.');

      const now = Date.now();
      const fromConversation = prompt && !pageHasMessages();
      if (fromConversation && now - lastRead > 5000) {
        lastRead = now;
        const turn = await conversationTurn().catch(() => null);
        if (turn?.ok && promptsMatch(turn.userText, prompt)) {
          promptSeen = true;
          saidInConversation = turn.finished ? turn.text : '';
        }
      }
      const ourTurn = !marker || isNewUserMessage(marker) || (fromConversation && promptSeen);
      const generating = isGenerating() || creatingImage();
      const images = ourTurn ? generatedImages(700, marker) : [];
      const key = images.map((i) => `${i.src}|${i.width}`).join(' ');
      if (key !== lastKey) {
        lastKey = key;
        stableSince = now;
      }
      if (!generating && images.length >= expected && now - stableSince >= 6000) return images.slice(0, expected);

      // ChatGPT answered with text only (refused, image limit, asked a question): report its words.
      const saidOnPage = !fromConversation && answerNodesAfterLastUser().length && lastAnswerLength() > 0;
      if (ourTurn && !generating && !images.length && (saidOnPage || saidInConversation)) {
        textOnlySince = textOnlySince || now;
        if (now - textOnlySince > 45_000) {
          const said = (fromConversation ? saidInConversation : readLastAnswer().text).replace(/\s+/g, ' ').slice(0, 300);
          throw new JobError('ERROR', `ChatGPT did not create an image: ${said || 'no image in the answer'}`);
        }
      } else {
        textOnlySince = 0;
      }

      // A picture is only drawn while the tab is visible.
      if (document.hidden && now - lastFrontAt > 20_000) {
        lastFrontAt = now;
        frontRequests++;
        await comeToFront(8000);
        if (document.hidden && frontRequests >= 2 && now - lastWindowFocusAt > 60_000) {
          lastWindowFocusAt = now;
          await bg({ type: 'focus-window' }).catch(() => undefined);
        }
      }
      await sleep(1000);
    }
    if (document.hidden) {
      throw new JobError('ERROR', 'ChatGPT could not show the image because its window was hidden (screen locked, minimized or fully covered).');
    }
    throw new JobError('ERROR', `ChatGPT did not finish the image within ${Math.round(timeoutMs / 1000)}s`);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** The picture's bytes: from the page first, else through the extension (for pictures on another address). */
  async function imageBlob(src) {
    try {
      const ownImage = /^https:\/\/([a-z0-9-]+\.)*(chatgpt\.com|openai\.com|oaiusercontent\.com)\//i.test(src);
      const res = await fetch(src, { credentials: ownImage ? 'include' : 'omit', signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.blob();
    } catch {
      /* not readable from the page — ask the extension */
    }
    const viaExtension = await bg({ type: 'fetch-image', url: src }).catch(() => null);
    if (viaExtension?.data) {
      const bytes = Uint8Array.from(atob(viaExtension.data), (c) => c.charCodeAt(0));
      return new Blob([bytes], { type: viaExtension.mime || 'image/png' });
    }
    throw new JobError('ERROR', `The image shown in ChatGPT could not be downloaded (${new URL(src, location.href).hostname}${viaExtension?.error ? `: ${viaExtension.error}` : ''})`);
  }

  /** Crops the picture to the wanted size (centre, like "cover") and returns it as a JPEG. */
  async function toJpeg(src, width, height, sourceBlob) {
    const bitmap = await createImageBitmap(sourceBlob || await imageBlob(src));
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return { mime: 'image/jpeg', data: await blobToBase64(jpeg), width, height };
  }

  // ───────────────────────── image-search galleries ─────────────────────────

  async function saveDisplayedImage(img) {
    // Same file as Chrome's "Save image as": the displayed src, not a publisher URL in alt text.
    const src = img.currentSrc || img.src;
    const blob = await imageBlob(src);
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    bitmap.close();
    if (width < 100 || height < 70) throw new JobError('ERROR', 'The displayed image is too small to be a gallery picture');
    const mime = blob.type.split(';')[0].toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      return { mime, data: await blobToBase64(blob), width, height };
    }
    // Convert formats WordPress may not accept, at their actual size (no cropping or upscaling).
    return toJpeg(src, width, height, blob);
  }

  function searchThumbnails(marker) {
    const lastUser = lastUserNode();
    const scope = document.querySelector('main') || document.body;
    // On a recovered turn without role markers, restrict inspection to the last rendered turn when available.
    const turns = scope.querySelectorAll('article, [data-testid^="conversation-turn-"]');
    const boundary = !lastUser && !marker && turns.length ? turns[turns.length - 1] : scope;
    return [...boundary.querySelectorAll('img')].filter((img) => {
      if (lastUser && !(lastUser.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
      if (img.closest('form, [data-message-author-role="user"]')) return false;
      if (marker?.imageNodes.has(img) || marker?.imageSources.has(img.currentSrc || img.src)) return false;
      const box = img.getBoundingClientRect();
      return img.complete && img.naturalWidth >= 100 && img.naturalHeight >= 70 && box.width >= 70 && box.height >= 50;
    });
  }

  function galleryRoot(before) {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    const dialog = dialogs.reverse().find((el) => visible(el) && el.querySelector('img'));
    if (dialog) return dialog;
    // Some ChatGPT viewers use a fixed fullscreen layer without dialog semantics.
    for (const img of document.images) {
      if (before.has(img) || !visible(img)) continue;
      for (let parent = img.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const rect = parent.getBoundingClientRect();
        if (getComputedStyle(parent).position === 'fixed' && rect.width > innerWidth * 0.75 && rect.height > innerHeight * 0.65) return parent;
      }
    }
    return null;
  }

  function galleryPicture(root) {
    const pictures = [...root.querySelectorAll('img')].filter((img) => {
      const rect = img.getBoundingClientRect();
      return img.complete && img.naturalWidth >= 100 && img.naturalHeight >= 70 && rect.width > 200 && rect.height > 150 && visible(img);
    });
    // The viewer can show the adjacent slides too. Use the picture nearest the middle of the viewport.
    return pictures.sort((a, b) => {
      const distance = (img) => { const r = img.getBoundingClientRect(); return Math.abs(r.x + r.width / 2 - innerWidth / 2); };
      return distance(a) - distance(b);
    })[0] || null;
  }

  async function collectSearchImages(job, marker, check) {
    const started = Date.now();
    const timeout = job.generationTimeoutMs || 600_000;
    let thumbnails = [];
    let stableSince = 0;
    let lastKey = '';
    let confirmed = !marker;
    let checkedPromptAt = 0;
    let sawGeneration = false;
    let answeredAt = 0;
    searchState = { phase: 'waiting for pictures', confirmed, thumbnails: 0 };
    while (Date.now() - started < timeout) {
      check();
      if (usageLimitReached()) throw new JobError('USAGE_LIMIT', 'ChatGPT usage limit reached during image search');
      if (find(SEL.loginButton)) throw new JobError('LOGIN', 'Log in to ChatGPT to finish the image search');
      if (!confirmed && isNewUserMessage(marker)) confirmed = true;
      if (!confirmed && !pageHasMessages() && Date.now() - checkedPromptAt > 5000) {
        checkedPromptAt = Date.now();
        const turn = await conversationTurn().catch((err) => ({ ok: false, problem: String(err?.message || err) }));
        confirmed = Boolean(turn?.ok && promptsMatch(turn.userText, job.prompt));
        searchState.chat = turn?.ok ? `last prompt in the chat: ${normalize(turn.userText).slice(0, 50)}` : turn?.problem || 'not readable';
      }
      // Without message markers the conversation data may not show the prompt (yet). Pictures that appeared after this
      // tab sent the prompt belong to its answer anyway: everything on the page before sending is in the marker.
      if (!confirmed && marker && !pageHasMessages() && Date.now() - started > 15_000 && searchThumbnails(marker).length) {
        confirmed = true;
        searchState.chat = `${searchState.chat || ''} — taken from the pictures that appeared after sending`.trim();
      }
      thumbnails = confirmed ? searchThumbnails(marker) : [];
      searchState.confirmed = confirmed;
      searchState.thumbnails = thumbnails.length;
      const key = thumbnails.map((img) => img.currentSrc || img.src).join('|');
      if (key !== lastKey || isGenerating()) { lastKey = key; stableSince = Date.now(); }
      if (thumbnails.length && !isGenerating() && Date.now() - stableSince >= 3000) break;
      // ChatGPT sometimes answers the search with text and links only (seen on gary phillip spector, 27 September 2026):
      // once its answer has ended without pictures, there is no need to wait the full ten minutes.
      if (isGenerating()) answeredAt = 0;
      else if (!answeredAt && sawGeneration) answeredAt = Date.now();
      sawGeneration = sawGeneration || isGenerating();
      if (!thumbnails.length && confirmed && answeredAt && Date.now() - answeredAt > (job.images.noGalleryAfterMs || 90_000)) {
        searchState.chat = `${searchState.chat || ''} — its answer ended without pictures`.trim();
        break;
      }
      if (document.hidden) await comeToFront(5000);
      await sleep(500);
    }
    if (!thumbnails.length) throw new JobError('ERROR', `ChatGPT did not show an image-search gallery for this prompt (${searchState.confirmed ? 'prompt confirmed' : 'prompt not confirmed'}${searchState.chat ? `; ${searchState.chat}` : ''})`);
    searchState.phase = 'saving pictures';
    const images = [];
    const urls = new Set();
    const savedUrls = new Set();
    const fingerprints = new Set();
    const errors = [];
    const enough = () => images.length + imageLinks.length >= job.images.count;
    const take = async (img) => {
      const src = img.currentSrc || img.src;
      if (savedUrls.has(src)) return true;
      if (!src || urls.has(src)) return false;
      urls.add(src);
      try {
        const image = await saveDisplayedImage(img);
        const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
        if (!fingerprints.has(hash)) { fingerprints.add(hash); images.push(image); }
        savedUrls.add(src);
        return true;
      } catch (err) {
        // A picture shown straight from the publisher's site (seen: www.yohanpost.com) cannot be read by the page (no
        // CORS) or by the extension (its sites are limited): the app downloads that same displayed file instead.
        if (/^https:\/\//i.test(src) && !EXTENSION_IMAGE_HOST.test(src)) {
          imageLinks.push({ url: src, width: img.naturalWidth, height: img.naturalHeight });
          savedUrls.add(src);
          return true;
        }
        errors.push(String(err.message || err));
      }
      return false;
    };
    for (const thumbnail of thumbnails) {
      check();
      if (enough()) break;
      const before = new Set(document.images);
      // Opening a thumbnail stays inside ChatGPT; never follow a source-site link.
      const trigger = thumbnail.closest('button, [role="button"]');
      if (trigger || !thumbnail.closest('a[href]')) {
        (trigger || thumbnail).click();
        await waitUntil(() => galleryRoot(before), 3000, 150);
      }
      const root = galleryRoot(before);
      if (!root) { await take(thumbnail); continue; }
      let viewerSaved = false;
      try {
        const visited = new Set();
        for (let slide = 0; slide < 12 && !enough(); slide++) {
          check();
          await waitUntil(() => galleryPicture(root), 5000, 150);
          const picture = galleryPicture(root);
          const current = picture && (picture.currentSrc || picture.src);
          if (current && visited.has(current)) break;
          if (current) { visited.add(current); viewerSaved = (await take(picture)) || viewerSaved; }
          const next = [...root.querySelectorAll('button, [role="button"]')].find((button) =>
            /^(next|next image|next slide|next picture|weiter|nächstes bild)$/i.test((button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim()));
          if (next?.disabled || next?.getAttribute('aria-disabled') === 'true') break;
          if (next) next.click();
          else root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
          const changed = await waitUntil(() => {
            const image = galleryPicture(root);
            return image && (image.currentSrc || image.src) !== current;
          }, 4000, 150);
          if (!changed) break;
        }
      } finally {
        const close = [...root.querySelectorAll('button, [role="button"]')].find((button) =>
          /^(close|close image|close gallery|close dialog|schließen)$/i.test((button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim()));
        if (close) close.click();
        else root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await waitUntil(() => !root.isConnected || !visible(root), 2000, 100);
      }
      if (!viewerSaved && !enough()) await take(thumbnail);
    }
    if (!images.length && !imageLinks.length) throw new JobError('ERROR', `No images could be saved from ChatGPT's gallery. ${errors[0] || 'No displayed gallery picture was available.'}`);
    if (errors.length) imageNote = `${errors.length} gallery picture(s) could not be saved — ${[...new Set(errors)].slice(0, 3).join(' | ')}`;
    beat('search-images-ready');
    searchState = null;
    return images;
  }

  async function collectImages(job, marker, check) {
    if (job.images.source === 'search') return collectSearchImages(job, marker, check);
    const request = job.images;
    const found = await waitForImages(marker, request.count, job.generationTimeoutMs || 600_000, check, job.prompt);
    beat('images-ready');
    const images = [];
    for (const image of found) images.push(await toJpeg(image.src, request.width, request.height));
    return images;
  }

  /** Retry safety: the prompt is already the last message → return (or regenerate) its answer instead of sending it twice. */
  async function recoverExistingAnswer(job, check) {
    if (!pageHasMessages()) return recoverFromConversation(job, check);
    const lastUser = lastUserNode();
    if (!lastUser || !promptsMatch(lastUser.innerText, job.prompt)) return null;
    const regenerate = () => find(SEL.regenerate) || buttonWithText(TEXT.regenerate);

    if (isGenerating()) {
      await waitForCompletion(null, job.generationTimeoutMs, check);
    } else if (lastTurnHasError()) {
      const button = regenerate();
      if (!button) return null;
      button.click();
      await sleep(2000);
      await waitForCompletion(null, job.generationTimeoutMs, check);
    } else if (answerNodesAfterLastUser().length) {
      // Make sure an answer that was cut off (reload, background tab) is really complete.
      await comeToFront(3000);
      await waitForCompletion(null, job.generationTimeoutMs, check);
    }
    let answer = readLastAnswer();
    if (answer.text) return answer;

    const button = regenerate();
    if (button) {
      button.click();
      await sleep(2000);
      await waitForCompletion(null, job.generationTimeoutMs, check);
      answer = readLastAnswer();
      if (answer.text) return answer;
    }
    return null;
  }

  // ───────────────────────── jobs ─────────────────────────

  const readPending = () => {
    try {
      return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    } catch {
      return null;
    }
  };
  const savePending = (job) => sessionStorage.setItem(PENDING_KEY, JSON.stringify(job));
  const clearPending = () => sessionStorage.removeItem(PENDING_KEY);

  async function answerJob(job, isCancelled) {
    const check = () => {
      if (isCancelled()) throw new JobCancelled();
    };
    // ChatGPT can switch into its full-screen writing app after generating the article. Reopen the
    // canonical conversation once rather than pasting the next instruction into that document.
    const state = await waitForReady(job.navigationTimeoutMs || 60_000, job);
    if (state === 'login') {
      throw new JobError('LOGIN', 'ChatGPT is not logged in in the extension’s window. Log in there — the article continues automatically.');
    }
    if (state === 'verification') {
      throw new JobError('VERIFICATION', 'ChatGPT’s "Verify you are human" check was not completed in time. Complete it in the ChatGPT window — the article continues automatically.');
    }
    if (state === 'timeout') {
      // A saved chat ChatGPT will not even draw while it keeps answering HTTP 429 (Anna Adamyan's FAQs, 30 September
      // 2026, three times): go on in a new chat with the earlier results instead of retrying the same chat.
      if (job.conversationUrl && currentConversation() && (await readSlot()).level >= 1) {
        throw new JobError('CONVERSATION_LOST', 'ChatGPT could not load the saved chat while asking to slow down (HTTP 429) — continuing in a new chat with the earlier results');
      }
      throw new JobError('ERROR', 'ChatGPT did not finish loading in time');
    }
    check();
    await dismissDialogs();
    conversationAnswer = null;
    searchState = null;
    imageNote = '';
    imageLinks = [];

    if (job.conversationUrl) {
      if (!(await conversationLoaded(30_000))) {
        // A chat ChatGPT would not show because it asked us to slow down is not lost: the task retries it later in
        // the same chat instead of starting a new one without its context.
        if (lastLoadRateLimited === 'brief') throw new JobError('ERROR', 'ChatGPT asked to slow down (HTTP 429) while opening the saved chat — trying again shortly');
        if (lastLoadRateLimited === 'persistent') {
          throw new JobError('CONVERSATION_LOST', 'ChatGPT keeps refusing to open saved chats (HTTP 429) — continuing in a new chat with the earlier results');
        }
        throw new JobError('CONVERSATION_LOST', 'The saved ChatGPT conversation could not be opened');
      }
      if (job.allowReuse || job.sent) {
        if (job.images && (await lastPromptIs(job.prompt))) {
          // The image prompt was already sent (tab reloaded): wait for its pictures instead of sending it again.
          const images = await collectImages(job, null, check);
          return { ...readLastAnswer(), images, reusedExisting: true };
        }
        const recovered = job.images ? null : await recoverExistingAnswer(job, check);
        if (recovered) return { ...recovered, reusedExisting: true };
      }
    }

    check();
    // Entering text and clicking Send is only reliable in the tab that is in front.
    await comeToFront(5000);
    const marker = userMarker();
    const userBefore = count(USER);
    if (job.attachments?.length) {
      await attachFiles(job.attachments, check);
      beat('attached');
    }
    await typePrompt(job.prompt);
    beat('typed');
    check();
    // Send stays greyed out until ChatGPT has uploaded the attached photos.
    await submit(job.prompt, marker, userBefore, job.attachments?.length ? 120_000 : 10_000);
    savePending({ ...job, sent: true });
    beat('sent');
    // Remember the new conversation address at once: if the tab reloads, the answer is recovered there.
    if (await waitUntil(() => currentConversation(), 15_000, 500)) savePending({ ...job, sent: true, conversationUrl: currentConversation() });

    if (job.images) {
      const images = await collectImages(job, marker, check);
      return { ...readLastAnswer(), images, reusedExisting: false };
    }
    await waitForCompletion(marker, job.generationTimeoutMs || 600_000, check, { prompt: job.prompt });
    const answer = readLastAnswer();
    if (!answer.text) throw new JobError('ERROR', 'ChatGPT returned an empty response');
    return { ...answer, reusedExisting: false };
  }

  async function runJob(job) {
    const target = job.conversationUrl || job.chatgptUrl;
    await report('working', `${job.keyword} — ${job.stageKey}`);

    // Still ours? (A reloaded tab resumes its prompt; the task may have been cancelled meanwhile.)
    const first = await api({ action: 'progress', jobId: job.id, conversationUrl: currentConversation(), debug: snapshot('picked-up') });
    if (!first.continue) {
      clearPending();
      return;
    }

    if (!isTarget(target)) {
      if (job.navigated) {
        clearPending();
        const code = job.conversationUrl ? 'CONVERSATION_LOST' : 'ERROR';
        await api({ action: 'fail', jobId: job.id, code, message: `ChatGPT did not open ${target}` }).catch(() => undefined);
        return;
      }
      savePending({ ...job, navigated: true });
      location.assign(target);
      await new Promise(() => undefined); // the page unloads; the new page resumes this prompt
    }
    savePending(job);
    currentJobId = job.id;

    let cancelled = false;
    let finished = false;
    (async () => {
      while (!finished) {
        await sleep(15_000);
        if (finished) return;
        try {
          const res = await api({ action: 'progress', jobId: job.id, conversationUrl: currentConversation(), debug: snapshot('waiting') });
          if (!res.continue) cancelled = true;
        } catch (err) {
          if (contextGone(err)) return;
        }
      }
    })().catch(() => undefined);

    try {
      const answer = await answerJob(job, () => cancelled);
      finished = true;
      currentJobId = null;
      clearPending();
      const note = [resumeNote, imageNote].filter(Boolean).join(' — ');
      await api({
        action: 'complete', jobId: job.id, ...answer,
        ...(note ? { note: note.slice(0, 1900) } : {}),
        ...(imageLinks.length ? { imageLinks: imageLinks.slice(0, 10) } : {}),
      });
      resumeNote = '';
      await report('idle', `Finished ${job.keyword} — ${job.stageKey}`);
    } catch (err) {
      finished = true;
      currentJobId = null;
      clearPending();
      if (err instanceof JobCancelled) {
        await report('idle', 'The task was cancelled');
        return;
      }
      if (contextGone(err)) throw err;
      const code = err instanceof JobError ? err.code : 'ERROR';
      const message = String(err?.message || err).slice(0, 1900);
      await api({ action: 'fail', jobId: job.id, code, message, debug: snapshot('failed') }).catch(() => undefined);
      await report(code === 'LOGIN' || code === 'VERIFICATION' ? 'attention' : 'error', message);
      if (code === 'LOGIN') await bg({ type: 'attention', message }).catch(() => undefined);
    }
  }

  /** Since when this idle tab has stood on a chat page that never became usable. */
  let stuckOnChatSince = 0;

  async function idleStep() {
    const state = pageState();
    // A tab left on a saved chat that ChatGPT will not draw (HTTP 429, 8 October 2026) stays "loading" for ever and so
    // never asks for a prompt — both tabs sat like that while four prompts waited. After 30 s go back to the start
    // page, which needs no chat data.
    if (state === 'loading' && conversationKey(location.href)) {
      stuckOnChatSince = stuckOnChatSince || Date.now();
      if (Date.now() - stuckOnChatSince > 30_000) {
        stuckOnChatSince = 0;
        await report('loading', 'This chat did not load — going back to the ChatGPT start page');
        location.assign(new URL('/', location.origin).toString());
        await sleep(10_000);
        return;
      }
    } else {
      stuckOnChatSince = 0;
    }
    const attention =
      state === 'login'
        ? 'Log in to ChatGPT in this window'
        : state === 'verification'
          ? 'ChatGPT is asking "Verify you are human" — please complete it in this window'
          : null;
    if (attention) await bg({ type: 'attention', message: attention }).catch(() => undefined);

    const res = await api({ action: 'claim', version: SCRIPT_VERSION, imageSearch: true, currentUrl: location.href, pageReady: state === 'ready' || state === 'document', attention });
    if (res.job) {
      await runJob(res.job);
      return;
    }
    if (attention) await report('attention', attention);
    else if (res.idleReason) await report('paused', res.idleReason);
    else await report(state === 'ready' ? 'idle' : 'loading', state === 'ready' ? 'Waiting for the next prompt' : 'ChatGPT is loading');
    await sleep(state === 'ready' ? 3000 : 5000);
  }

  async function main() {
    for (;;) {
      let hello;
      try {
        hello = await bg({ type: 'hello' });
      } catch (err) {
        if (contextGone(err)) return; // extension reloaded or removed
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      // The page loaded again after a prompt had been sent (not the planned move to its conversation before sending):
      // remember why, for the app's log.
      if (hello?.reloadedBy || (readPending()?.sent && !resumeNote)) {
        const navigation = performance.getEntriesByType('navigation')[0];
        resumeNote =
          `The ChatGPT page loaded again after the prompt was sent — ` +
          `${hello?.reloadedBy ? `reloaded by the extension (${hello.reloadedBy.reason}, ${Math.round((Date.now() - hello.reloadedBy.at) / 1000)} s ago)` : 'not by the extension'}; ` +
          `page load: ${navigation?.type || '?'}; address: ${location.href}; came from: ${document.referrer || '-'}`;
      }
      if (!hello?.worker || !hello.running) {
        if (hello?.worker) await report('stopped', 'Paused — switch the automatic start on in the extension');
        await waitForWake(hello?.worker ? 15_000 : 60_000);
        continue;
      }
      try {
        const pending = readPending();
        if (pending) await runJob(pending);
        else await idleStep();
      } catch (err) {
        if (contextGone(err)) return;
        await report('error', String(err?.message || err));
        await sleep(10_000);
      }
    }
  }

  main();
})();
