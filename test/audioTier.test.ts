/**
 * The console build plays the 1998 audio originals, because its WebView2 cannot decode
 * AAC (src/audio/audioTier.ts). These pin the URL choice per build, and that every
 * original the console will fetch is a file tools/stage-xbox-wwwroot.mjs can ship.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { voiceUrl } from '../src/audio/ffs2.js';
import { musicNames, musicUrl } from '../src/audio/music.js';
import { voicePackages } from '../tools/stage-voices.js';

/** `/data/...` or `/restored/...` -> the file under public/ it is served from. */
const publicPath = (url: string): string => join('public', ...url.split('/').filter(Boolean));

describe('audio tier per build', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('the web build fetches the AAC-staged tier', () => {
    expect(voiceUrl('003')).toBe('/data/Sound/003.ffs2');
    expect(voiceUrl('restored', '/restored')).toBe('/restored/restored.ffs2');
    expect(musicUrl('menu')).toBe('/data/Music/menu.m4a');
  });

  it('the xbox build fetches the originals, x00 unchanged', () => {
    vi.stubEnv('VITE_TARGET', 'xbox');
    expect(voiceUrl('003')).toBe('/data/Sound/003.ffs');
    expect(voiceUrl('x00')).toBe('/data/Sound/x00.ffs');
    expect(voiceUrl('restored', '/restored')).toBe('/restored/restored.ffs');
    expect(musicUrl('menu')).toBe('/data/Music/menu.wav');
  });

  it('every original the xbox build fetches exists in public/', () => {
    vi.stubEnv('VITE_TARGET', 'xbox');
    const urls = [
      ...voicePackages().map((p) => (p.id === 'restored' ? voiceUrl(p.id, '/restored') : voiceUrl(p.id))),
      voiceUrl('x00'),
      ...musicNames().map(musicUrl),
    ];
    expect(urls.length).toBeGreaterThan(90);
    expect(urls.filter((u) => !existsSync(publicPath(u)))).toEqual([]);
  });
});
