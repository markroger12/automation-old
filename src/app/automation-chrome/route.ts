// Welcome page shown in the separate automation Chrome. The ChatGPT extension recognises "its" Chrome by this page
// (see AUTOMATION_CHROME_PAGE); it contains only setup steps, no data from the app.
import path from 'node:path';

export const dynamic = 'force-dynamic';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function GET() {
  const folder = escape(path.join(process.cwd(), 'extension'));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Automation Chrome — Blog Automation Studio</title>
<style>
  :root { color-scheme: light; --ink: #0f172a; --muted: #475569; --accent: #4f46e5; --ok: #047857; --paper: #f8fafc; --line: #e2e8f0; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 20px 56px; }
  .badge { display: inline-block; background: var(--accent); color: #fff; font-weight: 600; font-size: 13px; padding: 4px 10px; border-radius: 999px; }
  h1 { font-size: 28px; margin: 14px 0 6px; }
  p.lead { color: var(--muted); margin: 0 0 24px; }
  ol { padding-left: 22px; margin: 0; }
  li { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 0 0 10px; }
  code { background: #eef2ff; padding: 1px 6px; border-radius: 6px; font-size: 14px; word-break: break-all; }
  .note { margin-top: 22px; border-left: 4px solid var(--ok); background: #ecfdf5; padding: 12px 14px; border-radius: 6px; }
</style>
</head>
<body>
<main>
  <span class="badge">Automation Chrome</span>
  <h1>This is the Automation Chrome for ChatGPT</h1>
  <p class="lead">Blog Automation Studio writes articles in this Chrome. It keeps working while this window is behind other windows, so it never has to jump to the front. Set it up once:</p>
  <ol>
    <li>Open a new tab here and go to <code>chrome://extensions</code>. Turn on <b>Developer mode</b> (top right), click <b>Load unpacked</b> and choose this folder:<br /><code>${folder}</code></li>
    <li>Come back to <b>this tab</b> and reload it once (F5) — the extension then knows it is in the Automation Chrome.</li>
    <li>Open <code>https://chatgpt.com</code> in this Chrome and log in yourself.</li>
    <li>In the app: <b>Settings → ChatGPT Chrome extension → Create new connection key</b> → Copy. Here: click the puzzle icon → <b>Blog Automation Studio</b>, paste the key and click <b>Save &amp; test</b>. The popup then shows <b>Automation Chrome ✓</b>.</li>
  </ol>
  <div class="note">After that you can close this tab. Put this window behind other windows if you like, but do not minimize it, and keep the computer unlocked. If the extension is still installed in your normal Chrome, remove it there.</div>
</main>
</body>
</html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
