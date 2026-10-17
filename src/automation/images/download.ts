// Gallery pictures that ChatGPT shows straight from the publisher's site (seen: www.yohanpost.com, www.marriedceleb.com)
// cannot be read in the ChatGPT page, and the extension's sites are limited. The extension hands over the address of
// the displayed file instead, and the worker downloads that same file here — without cookies, public https sites only.
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import net from 'node:net';
import sharp from 'sharp';
import type { ExtensionImageFile } from '@/lib/chatgpt-extension';

const MAX_BYTES = 12_000_000;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const SAVED_AS_IS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

export interface DownloadDeps {
  fetch: typeof globalThis.fetch;
  lookup: (host: string) => Promise<{ address: string }[]>;
}

const defaults: DownloadDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  lookup: (host) => dns.lookup(host, { all: true }),
};

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

async function checkAddress(url: URL, deps: DownloadDeps): Promise<void> {
  if (url.protocol !== 'https:') throw new Error('only https pictures are downloaded');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host.includes('.') || /\.(local|localhost|internal)$/i.test(host)) throw new Error(`${host} is not a public site`);
  const addresses = net.isIP(host) ? [{ address: host }] : await deps.lookup(host);
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error(`${host} is not a public site`);
}

async function readCapped(res: Response): Promise<Buffer> {
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('the picture is larger than 12 MB');
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('the picture is larger than 12 MB');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads one displayed gallery picture to `<fileBase>.<ext>`. JPEG, PNG and WebP are kept as they are; any other
 * picture format is saved as JPEG. Throws with a short reason when the address or the file is not usable.
 */
export async function downloadGalleryPicture(address: string, fileBase: string, deps: DownloadDeps = defaults): Promise<ExtensionImageFile> {
  let url = new URL(address);
  let res: Response | null = null;
  for (let hop = 0; ; hop++) {
    // Every address, including each redirect, must be a public https site.
    await checkAddress(url, deps);
    res = await deps.fetch(url, {
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!next) break;
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
    url = new URL(next, url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`the address did not return a picture (${type || 'no type'})`);
  const bytes = await readCapped(res);
  const meta = await sharp(bytes, { animated: false }).metadata().catch(() => null);
  if (!meta?.width || !meta.height || !meta.format) throw new Error('the file is not a readable picture');
  if (meta.width < 100 || meta.height < 70) throw new Error(`the picture is too small (${meta.width}×${meta.height})`);
  const kept = SAVED_AS_IS[meta.format];
  const data = kept ? bytes : await sharp(bytes, { animated: false }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
  const saved = kept ?? { mime: 'image/jpeg', ext: 'jpg' };
  const file = `${fileBase}.${saved.ext}`;
  await fs.writeFile(file, data);
  return { path: file, mime: saved.mime, width: meta.width, height: meta.height, bytes: data.length };
}
