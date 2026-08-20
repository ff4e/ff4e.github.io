/**
 * The enhanced tier's object loader: what a frame that did not arrive does to the frame
 * that gets DRAWN.
 *
 * This is the half of the tier-desync bug that had nothing to do with caching. A sprite
 * that failed to load was turned into `null` and then filtered out —
 *
 *     const valid = frames.filter((f) => f !== null);
 *     return valid.length > 0 ? { item: e.item, frames: valid } : null;
 *
 * — which compacts the array, while the renderer indexes it by the item's animation phase
 * (`obj.frames[frameIndex(item.afaze, obj.frames.length)]`). So one missing file did not
 * cost one picture; it shifted every phase after the gap by one, for as long as the room
 * was open, with no 404 the player could see and no exception.
 *
 * The tests below assert on the sprite ACTUALLY DRAWN for a given afaze, through the real
 * renderer, because that is the only statement of the bug that cannot be satisfied by
 * accident: "the object loaded" and "the room rendered" were both true the whole time.
 *
 * The loader was split out of main.ts to make this testable at all — the decode step is
 * injected here (the browser's createImageBitmap has no counterpart under vitest), and
 * everything else is the production path.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadEnhancedObjects } from '../src/render/enhancedObjects.js';
import { MissingAssetError, TransientAssetError } from '../src/render/assetFetch.js';
import { EnhancedArtSource, type EnhancedSprite } from '../src/render/enhancedArtSource.js';
import { RgbaScreen } from '../src/render/rgbaScreen.js';
import { ClassicArtSource } from '../src/render/classicArtSource.js';
import { rgbaAt } from './rgbaAt.js';
import type { FfrPaletteEntry } from '../src/data/ffr.js';
import type { Room, Item } from '../src/core/room.js';

const FSIZE = 15;
const ITEM = 8; // SCHODY's snail, the 44-frame object this was found on
const FRAMES = 44;
const DIR = '/enhanced/SCHODY/';
const frameFile = (n: number) => `snek_${String(n).padStart(2, '0')}.png`;

const palette = (): FfrPaletteEntry[] =>
  Array.from({ length: 256 }, (_, i) => ({ r: i, g: (i * 2) & 255, b: (i * 3) & 255 }));

/** An item with NO classic bitmap, so the classic fallback draws nothing and a black
 *  pixel means exactly "no enhanced sprite was drawn here". */
const room = { gspec: 0, bitmaps: [] } as unknown as Room;
const item = (afaze: number): Item =>
  ({ x: 2, y: 3, afaze, dir: 0, spec: 0, visible: true, kind: 1, bmp: 1 }) as unknown as Item;

/** A 2×2 sprite whose RED channel is the frame number it was decoded from. */
function marker(n: number): EnhancedSprite {
  const rgba = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i++) {
    rgba[i * 4] = n;
    rgba[i * 4 + 3] = 255;
  }
  return { w: 2, h: 2, rgba };
}

/** The frame number the renderer drew at (item.x, item.y), or null when it drew nothing. */
function drawnFrame(objects: readonly { item: number; frames: readonly EnhancedSprite[] }[], afaze: number): number | null {
  const src = new EnhancedArtSource(palette(), null, objects, null);
  const s = new RgbaScreen(60, 60, new ClassicArtSource(palette()));
  src.drawItem(s, room, item(afaze), ITEM, 0, 0);
  const px = rgbaAt(s, 2 * FSIZE, 3 * FSIZE);
  return px.r === 0 && px.g === 0 && px.b === 0 ? null : px.r;
}

/**
 * A server that has the manifest and every frame except `missing`, which 404s.
 * `transient` instead makes that frame's request fail at the transport level.
 */
function serve(missing: number[] = [], transient: number[] = []) {
  return vi.fn(async (url: string): Promise<Response> => {
    if (url === `${DIR}objects.json`) {
      const objects = [{ item: ITEM, frames: Array.from({ length: FRAMES }, (_, i) => frameFile(i)) }];
      return new Response(JSON.stringify({ objects }), { headers: { 'content-type': 'application/json' } });
    }
    const m = /snek_(\d+)\.png$/.exec(url);
    if (!m) return new Response('no', { status: 404, headers: { 'content-type': 'text/plain' } });
    const n = Number(m[1]);
    if (transient.includes(n)) throw new TypeError('Failed to fetch');
    if (missing.includes(n)) return new Response('no', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(String(n), { headers: { 'content-type': 'image/png' } });
  });
}

const decodePng = async (res: Response): Promise<EnhancedSprite> => marker(Number(await res.text()));
const load = () => loadEnhancedObjects('/', 'SCHODY', decodePng);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadEnhancedObjects', () => {
  it('draws the frame the manifest binds to an afaze when every frame arrives', async () => {
    vi.stubGlobal('fetch', serve());
    const objects = await load();
    expect(objects).toHaveLength(1);
    expect(objects[0]!.frames).toHaveLength(FRAMES);
    expect(drawnFrame(objects, 11)).toBe(11);
    expect(drawnFrame(objects, 43)).toBe(43);
  });

  it('never draws a LATER frame in place of one that did not arrive', async () => {
    // The bug, stated as the player would see it: with frame 10 of 44 gone, phase 11 used
    // to draw frame 12 — and 12 drew 13, and so on to the end of the animation.
    //
    // It is now impossible one step earlier: there is no partial result to index into,
    // because a frame the manifest listed and the server does not have rejects the whole
    // load. The array that could be short is never built.
    vi.stubGlobal('fetch', serve([10]));
    await expect(load()).rejects.toBeInstanceOf(MissingAssetError);
  });

  it('ends the session on a manifest-listed sprite that is not there', async () => {
    // It used to drop the object and let the item render as a 1998 bitmap inside a
    // truecolor room — the same outcome as an item ABSENT from the manifest, which is a
    // design gap and correct. Conflating the two is what let a broken build ship: the
    // 21 legitimately-unstaged sprites look exactly like a deploy that lost a file.
    //
    // A manifest entry is a promise the build made. Breaking it is not a gap, so it is
    // not silent (see loadingUi.ts, and the all-or-nothing rule).
    vi.stubGlobal('fetch', serve([10]));
    const err = await load().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingAssetError);
    expect((err as MissingAssetError).url).toContain(frameFile(10));
  });

  it('is what makes the shift impossible — a short list would still be indexed directly', async () => {
    // Not a test of the loader but of WHY it may not return a short list: this is exactly
    // the array the old `frames.filter(...)` produced, and this is what it drew.
    const compacted = [{ item: ITEM, frames: Array.from({ length: FRAMES }, (_, i) => i).filter((i) => i !== 10).map(marker) }];
    expect(drawnFrame(compacted, 11)).toBe(12);
    expect(drawnFrame(compacted, 30)).toBe(31);
  });

  it('names the room, so the failure screen can say which art is incomplete', async () => {
    vi.stubGlobal('fetch', serve([10]));
    const err = await load().catch((e: unknown) => e);
    expect((err as MissingAssetError).what).toContain('SCHODY');
  });

  it('rejects rather than dropping the object when the failure was only transient', async () => {
    // A blip says nothing about whether the sprite exists, so it must not be answered
    // with "this object has no enhanced art" — the caller needs the rejection to know
    // not to cache the room (ensureEnhancedArt).
    vi.stubGlobal('fetch', serve([], [10]));
    await expect(load()).rejects.toBeInstanceOf(TransientAssetError);
  });

  it('does not let an intact object mask a broken one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string): Promise<Response> => {
      if (url === `${DIR}objects.json`) {
        return new Response(
          JSON.stringify({ objects: [{ item: 1, frames: ['a.png'] }, { item: ITEM, frames: [frameFile(0), frameFile(1)] }] }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('a.png')) return new Response('no', { status: 404, headers: { 'content-type': 'text/plain' } });
      return new Response(String(Number(/snek_(\d+)/.exec(url)![1])), { headers: { 'content-type': 'image/png' } });
    }));
    // The old loader returned the good object and dropped the broken one, so a room with
    // one lost sprite still rendered — plausibly, and wrongly. `Promise.all` over the
    // manifest is what makes that impossible now.
    await expect(load()).rejects.toBeInstanceOf(MissingAssetError);
  });
});
