/**
 * The link-preview and icon metadata in `index.html`, against the files it points at.
 *
 * These tags have a failure mode nothing else here would catch: a wrong one looks exactly
 * like a right one in the page source, and only misbehaves inside somebody else's scraper
 * — a relative `og:image` that Facebook and Slack silently drop, a declared size that no
 * longer matches the card, a `<link rel=icon>` to a path that 404s. Nobody sees any of it
 * until the link has already been posted, which is the one moment that cannot be redone.
 *
 * So the oracle is the FILES, not the markup: the sizes are read out of the JPEG's own
 * SOF header and the ICO's own directory, so re-running `tools/build-share-assets.py`
 * with a different geometry fails here rather than in a Discord message.
 *
 * What this cannot reach is whether a given scraper likes the result — that needs the
 * live URL and a real crawler, and is a manual step after deploy.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync('index.html', 'utf8');
const SITE = 'https://ff4e.github.io/';

/** All `<meta>` tags in document order, by `property` or `name`. */
const metas = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    const key = /\b(?:property|name)="([^"]+)"/.exec(tag)?.[1];
    const content = /\bcontent="([^"]*)"/.exec(tag)?.[1];
    if (key && content !== undefined) out.set(key, content);
  }
  return out;
};

/** `rel` -> `href` for every `<link>`. */
const links = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    const rel = /\brel="([^"]+)"/.exec(tag)?.[1];
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (rel && href !== undefined) out.set(rel, href);
  }
  return out;
};

/** A site-absolute URL back to the file that serves it. `public/*` is staged into `dist/`. */
const served = (url: string): string => join('public', new URL(url).pathname.replace(/^\//, ''));

/** Width/height out of a JPEG's first SOF marker — the only bytes that decide the real size. */
const jpegSize = (file: string): { w: number; h: number } => {
  const buf = readFileSync(file);
  let i = 2; // skip SOI
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error(`not a JPEG marker at ${i}`);
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, minus the DHT/JPG/DAC holes that share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error('no SOF marker');
};

/** The sizes an .ico actually contains, from its directory. A 0 byte means 256. */
const icoSizes = (file: string): string[] => {
  const buf = readFileSync(file);
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, n) => {
    const e = 6 + n * 16;
    return `${buf[e] || 256}x${buf[e + 1] || 256}`;
  });
};

describe('the link preview', () => {
  it('gives the scrapers absolute URLs', () => {
    // The whole point of the failure this guards: a relative og:image resolves fine in a
    // browser and is dropped by most crawlers, so the preview silently loses its picture.
    for (const key of ['og:image', 'og:url', 'twitter:image']) {
      const value = metas().get(key);
      expect(value, key).toBeDefined();
      expect(new URL(value!).origin, key).toBe('https://ff4e.github.io');
    }
    expect(links().get('canonical')).toBe(SITE);
    expect(metas().get('og:url')).toBe(SITE);
  });

  it('declares the size the card actually is', () => {
    const m = metas();
    const card = served(m.get('og:image')!);
    expect(existsSync(card), card).toBe(true);
    const { w, h } = jpegSize(card);
    expect(`${w}x${h}`).toBe(`${m.get('og:image:width')}x${m.get('og:image:height')}`);
    // 1.91:1 is what Facebook, Slack, Discord and Mastodon all crop towards; a card that
    // has drifted off it gets its edges taken off by whoever renders it.
    expect(Math.abs(w / h - 1.91)).toBeLessThan(0.02);
  });

  it('says enough to be worth previewing', () => {
    const m = metas();
    expect(m.get('twitter:card')).toBe('summary_large_image');
    expect(m.get('og:type')).toBe('website');
    for (const key of ['og:title', 'og:description', 'og:image:alt', 'description']) {
      expect(m.get(key)?.length ?? 0, key).toBeGreaterThan(20);
    }
    // Facebook and LinkedIn truncate around 300; past that the tail is written for nobody.
    expect(m.get('og:description')!.length).toBeLessThan(300);
  });
});

describe('the browser icons', () => {
  it('point at files that exist', () => {
    for (const rel of ['icon', 'apple-touch-icon']) {
      const href = links().get(rel);
      expect(href, rel).toBeDefined();
      expect(existsSync(served(new URL(href!, SITE).href)), href).toBe(true);
    }
  });

  it('contain the sizes the markup promises', () => {
    const declared = /<link\b[^>]*\brel="icon"[^>]*>/.exec(html)![0];
    const sizes = /\bsizes="([^"]+)"/.exec(declared)![1].split(/\s+/);
    expect(icoSizes(join('public', 'favicon.ico')).sort()).toEqual(sizes.sort());
  });
});
