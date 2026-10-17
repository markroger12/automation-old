// Gallery pictures shown straight from the publisher's site are downloaded by the worker. A stand-in fetch plays the
// sites here; only public https addresses may be fetched, redirects included.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadGalleryPicture, isPrivateAddress, type DownloadDeps } from '@/automation/images/download';

let root = '';
let jpeg: Buffer;
let avif: Buffer;
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bas-download-'));
  const picture = sharp({ create: { width: 880, height: 1100, channels: 3, background: '#3a6ea5' } });
  jpeg = await picture.clone().jpeg().toBuffer();
  avif = await picture.clone().avif().toBuffer();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const PUBLIC = '203.0.113.7';
function site(pages: Record<string, () => Response>, addresses: Record<string, string> = {}) {
  const requested: string[] = [];
  const deps: DownloadDeps = {
    lookup: async (host) => [{ address: addresses[host] ?? PUBLIC }],
    fetch: async (input) => {
      const url = String(input);
      requested.push(url);
      return (pages[url] ?? (() => new Response('missing', { status: 404 })))();
    },
  };
  return { deps, requested };
}
const image = (body: Buffer, type = 'image/jpeg') => () => new Response(new Uint8Array(body), { headers: { 'content-type': type } });
const base = (name: string) => path.join(root, name);

describe('downloading a gallery picture from the publisher', () => {
  it('saves the displayed JPEG as it is', async () => {
    const url = 'https://www.yohanpost.com/wp-content/uploads/peter.jpg';
    const { deps } = site({ [url]: image(jpeg) });
    const file = await downloadGalleryPicture(url, base('peter'), deps);
    expect(file).toEqual({ path: base('peter') + '.jpg', mime: 'image/jpeg', width: 880, height: 1100, bytes: jpeg.length });
    expect(fs.readFileSync(file.path).equals(jpeg)).toBe(true);
  });

  it('saves other formats (AVIF) as JPEG and follows a redirect to a public site', async () => {
    const start = 'https://www.marriedceleb.com/p/1';
    const cdn = 'https://cdn.marriedceleb.com/p/1.avif';
    const { deps, requested } = site({
      [start]: () => new Response(null, { status: 302, headers: { location: cdn } }),
      [cdn]: image(avif, 'image/avif'),
    });
    const file = await downloadGalleryPicture(start, base('married'), deps);
    expect(requested).toEqual([start, cdn]);
    expect(file).toMatchObject({ path: base('married') + '.jpg', mime: 'image/jpeg', width: 880, height: 1100 });
    expect([...fs.readFileSync(file.path).subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it('never fetches an address on this computer or the home network, not even through a redirect', async () => {
    const { deps, requested } = site(
      { 'https://evil.example.com/a.jpg': () => new Response(null, { status: 302, headers: { location: 'https://router.example.com/admin.jpg' } }) },
      { 'router.example.com': '192.168.1.1', 'inside.example.com': '10.0.0.5' },
    );
    await expect(downloadGalleryPicture('https://inside.example.com/a.jpg', base('x'), deps)).rejects.toThrow('inside.example.com is not a public site');
    await expect(downloadGalleryPicture('https://localhost/a.jpg', base('x'), deps)).rejects.toThrow('not a public site');
    await expect(downloadGalleryPicture('https://127.0.0.1/a.jpg', base('x'), deps)).rejects.toThrow('not a public site');
    await expect(downloadGalleryPicture('http://www.yohanpost.com/a.jpg', base('x'), deps)).rejects.toThrow('only https');
    await expect(downloadGalleryPicture('https://evil.example.com/a.jpg', base('x'), deps)).rejects.toThrow('router.example.com is not a public site');
    expect(requested).toEqual(['https://evil.example.com/a.jpg']);
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.9', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress(PUBLIC)).toBe(false);
  });

  it('says why a file is not used', async () => {
    const { deps } = site({
      'https://a.example.com/page': () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      'https://a.example.com/gone.jpg': () => new Response('', { status: 403 }),
      'https://a.example.com/huge.jpg': () => new Response('x', { headers: { 'content-type': 'image/jpeg', 'content-length': '20000000' } }),
      'https://a.example.com/broken.jpg': image(Buffer.from('not a picture')),
    });
    await expect(downloadGalleryPicture('https://a.example.com/page', base('x'), deps)).rejects.toThrow('did not return a picture (text/html)');
    await expect(downloadGalleryPicture('https://a.example.com/gone.jpg', base('x'), deps)).rejects.toThrow('HTTP 403');
    await expect(downloadGalleryPicture('https://a.example.com/huge.jpg', base('x'), deps)).rejects.toThrow('larger than 12 MB');
    await expect(downloadGalleryPicture('https://a.example.com/broken.jpg', base('x'), deps)).rejects.toThrow('not a readable picture');
  });
});
