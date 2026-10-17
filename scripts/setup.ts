// One-command setup:  npm run setup
// Creates .env (with a random session secret), the private data folder and the SQLite database,
// then loads the default settings and prompts. Safe to run again at any time (e.g. after an update).
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');
const DEFAULT_DB_URL = 'file:../data/app.db';

function step(message: string) {
  console.log(`\n▶ ${message}`);
}

function run(command: string) {
  execSync(command, { stdio: 'inherit', cwd: root, env: process.env });
}

function newSecret(): string {
  return randomBytes(48).toString('base64url');
}

function ensureEnvFile(): void {
  step('Checking .env');
  if (!fs.existsSync(envPath)) {
    const content = `# Created by "npm run setup". You normally don't need to change anything here.

# Database file (SQLite). Path is relative to the prisma/ folder.
DATABASE_URL="${DEFAULT_DB_URL}"

# Secret used to sign dashboard sign-in cookies. Keep it private.
SESSION_SECRET="${newSecret()}"

# Private folder for saved browser logins (cookies) and failure screenshots.
DATA_DIR="./data"

# Browser used for automation: chrome (installed Google Chrome), msedge, or chromium.
BROWSER_CHANNEL="chrome"
BROWSER_EXECUTABLE_PATH=""

# Set to "true" only when the dashboard is served over HTTPS.
COOKIE_SECURE="false"
`;
    fs.writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
    console.log('  ✓ Created .env with a new random SESSION_SECRET');
    return;
  }

  let content = fs.readFileSync(envPath, 'utf8');
  let changed = false;
  const get = (key: string) => new RegExp(`^${key}\\s*=\\s*"?([^"\\r\\n]*)"?`, 'm').exec(content)?.[1];
  const set = (key: string, value: string) => {
    const line = `${key}="${value}"`;
    content = new RegExp(`^${key}\\s*=.*$`, 'm').test(content) ? content.replace(new RegExp(`^${key}\\s*=.*$`, 'm'), line) : `${content.trimEnd()}\n${line}\n`;
    changed = true;
  };

  const dbUrl = get('DATABASE_URL');
  if (!dbUrl || !dbUrl.startsWith('file:')) {
    set('DATABASE_URL', DEFAULT_DB_URL);
    console.log('  ✓ DATABASE_URL now points to the local SQLite database file');
  }
  const secret = get('SESSION_SECRET');
  if (!secret || secret.length < 32 || /replace|change-me/i.test(secret)) {
    set('SESSION_SECRET', newSecret());
    console.log('  ✓ Generated a new SESSION_SECRET');
  }
  if (/^REDIS_URL\s*=/m.test(content)) {
    content = content.replace(/^REDIS_URL\s*=.*\r?\n?/m, '');
    changed = true;
    console.log('  ✓ Removed REDIS_URL (no longer needed)');
  }
  if (changed) fs.writeFileSync(envPath, content, 'utf8');
  else console.log('  ✓ .env is already configured');
}

function loadEnv(): void {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function checkBrowser(): void {
  step('Checking browser');
  const channel = process.env.BROWSER_CHANNEL || 'chrome';
  if (process.env.BROWSER_EXECUTABLE_PATH) {
    console.log(`  ✓ Using ${process.env.BROWSER_EXECUTABLE_PATH}`);
    return;
  }
  if (channel === 'chromium') {
    console.log('  ℹ Using Playwright Chromium — installing it if needed');
    run('npx playwright install chromium');
    return;
  }
  const candidates =
    process.platform === 'win32'
      ? channel === 'msedge'
        ? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
        : [
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
            path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
          ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  if (candidates.some((c) => fs.existsSync(c))) console.log(`  ✓ ${channel === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'} found`);
  else console.log(`  ⚠ ${channel} was not found. Install Google Chrome, or set BROWSER_CHANNEL="chromium" in .env and run setup again.`);
}

function main(): void {
  console.log('Blog Automation Studio — setup');
  ensureEnvFile();
  loadEnv();

  step('Creating the private data folder');
  const dataDir = path.resolve(root, process.env.DATA_DIR || './data');
  fs.mkdirSync(path.join(dataDir, 'profiles'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dataDir, 'screenshots'), { recursive: true, mode: 0o700 });
  console.log(`  ✓ ${dataDir}`);

  step('Preparing the database');
  try {
    run('npx prisma generate');
  } catch {
    console.error('\n✗ Could not update the database client. If the app is running, stop it (Ctrl+C) and run "npm run setup" again.');
    process.exit(1);
  }
  run('npx prisma migrate deploy');

  step('Loading default settings and prompts');
  run('npx tsx prisma/seed.ts');

  checkBrowser();

  console.log(`
✓ Setup complete.

Next:
  1. Start the app:   npm run dev:all
  2. Open:            http://localhost:3000
  3. Create your dashboard admin account on the first screen.
  4. Go to Websites → connect ChatGPT and your WordPress site (you log in yourself in the Chrome window that opens).
`);
}

main();
