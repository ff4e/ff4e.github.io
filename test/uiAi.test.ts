import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composePanel, composeOptions, PANEL_W, PANEL_H, type PanelState, type OptionsState } from '../src/render/hud.js';
import { PANEL_IMAGES, CUDL_SIZE } from '../src/data/ffp.js';
import { AiPanel } from '../src/render/panelAi.js';
import { creditsMaxScroll, creditsTranslate } from '../src/render/creditsAi.js';

/**
 * The AI panel/credits compositors duplicate rectangle tables that live in hud.ts and
 * credits.ts (they must, because one works on palette indices and the other on RGBA
 * bitmaps). Duplicated constants drift, and the failure is silent — a band copied from
 * the wrong rows still renders a plausible panel.
 *
 * So rather than assert the tables match, these tests run the AI compositor AT SCALE 1
 * against a recording canvas and replay its draws onto an indexed buffer, then compare
 * that buffer to the faithful composer's output. Identical output means every rect,
 * every image index and the draw ORDER agree.
 */

/** A ctx stand-in that records drawImage rectangles instead of rasterising. */
interface Draw { img: number; sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number }

function recorder(imgIds: Map<unknown, number>) {
  const draws: Draw[] = [];
  const ctx = {
    canvas: { width: 0, height: 0 },
    clearRect() { draws.length = 0; },
    drawImage(img: unknown, ...a: number[]) {
      const id = imgIds.get(img) ?? -1;
      if (a.length === 8) {
        draws.push({ img: id, sx: a[0]!, sy: a[1]!, sw: a[2]!, sh: a[3]!, dx: a[4]!, dy: a[5]!, dw: a[6]!, dh: a[7]! });
      } else {
        // 4-arg form: whole source into a destination rect.
        draws.push({ img: id, sx: 0, sy: 0, sw: a[2]!, sh: a[3]!, dx: a[0]!, dy: a[1]!, dw: a[2]!, dh: a[3]! });
      }
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws };
}

/** Replay recorded draws onto an indexed buffer, honouring per-image transparency. */
function replay(draws: Draw[], sources: Uint8Array[], w: number, h: number, transparentOf: (i: number) => number | null): Uint8Array {
  const out = new Uint8Array(w * h);
  for (const d of draws) {
    const src = sources[d.img];
    if (!src) continue;
    const key = transparentOf(d.img);
    for (let row = 0; row < d.sh; row++) {
      const sy = d.sy + row, dy = d.dy + row;
      if (dy < 0 || dy >= h) continue;
      for (let col = 0; col < d.sw; col++) {
        const sx = d.sx + col, dx = d.dx + col;
        if (dx < 0 || dx >= w) continue;
        const px = src[sy * PANEL_W + sx];
        if (px === undefined || px === key) continue;   // baked-alpha pixels don't draw
        out[dy * w + dx] = px;
      }
    }
  }
  return out;
}

/** Deterministic pseudo-art: each image is filled with a recognisable pattern. */
function fakeImages(): Uint8Array[] {
  return Array.from({ length: PANEL_IMAGES }, (_, i) => {
    const a = new Uint8Array(PANEL_W * PANEL_H);
    for (let y = 0; y < PANEL_H; y++) for (let x = 0; x < PANEL_W; x++) a[y * PANEL_W + x] = (i * 37 + x * 3 + y * 5) % 253;
    return a;
  });
}

describe('AiPanel matches the faithful composer', () => {
  const images = fakeImages();
  const ids = new Map<unknown, number>(images.map((im, i) => [im, i]));
  // Scale 1 makes the AI compositor's rectangles directly comparable to hud.ts's.
  const panel = new AiPanel(images as unknown as ImageBitmap[], images[0] as unknown as ImageBitmap, 1);

  // EVERY pressed direction (0..8), twice.
  //  - "mixed": bands take assorted colour indices, so a wrong BAND is visible.
  //  - "flat": every band is SEDY(0) while the lit overlay is SVITICI(3), so a wrong
  //    OVERLAY rect is visible. Without this second family a rect error hides whenever
  //    the band underneath happens to use the same image as the overlay.
  const states: PanelState[] = [
    ...Array.from({ length: 9 }, (_, d) => ({
      velka: d % 4, space: (d + 1) % 4, mala: (d + 2) % 4, save: (d + 3) % 4,
      load: d % 4, abort: (d + 1) % 4, restart: (d + 2) % 4, pressedDir: d,
    })),
    ...Array.from({ length: 9 }, (_, d) => ({
      velka: 0, space: 0, mala: 0, save: 0, load: 0, abort: 0, restart: 0, pressedDir: d,
    })),
  ];

  for (const [i, st] of states.entries()) {
    it(`normal panel, pressedDir ${st.pressedDir} (${i < 9 ? 'mixed' : 'flat'})`, () => {
      const { ctx, draws } = recorder(ids);
      panel.drawPanel(ctx, st);
      const mine = replay(draws, images, PANEL_W, PANEL_H, () => null);
      expect(Array.from(mine)).toEqual(Array.from(composePanel(images, st)));
    });
  }

  it('clamps an out-of-range colour index like the faithful composer', () => {
    const st = { velka: 99, space: -5, mala: 2, save: 0, load: 0, abort: 0, restart: 0, pressedDir: 0 } as PanelState;
    const { ctx, draws } = recorder(ids);
    panel.drawPanel(ctx, st);
    const mine = replay(draws, images, PANEL_W, PANEL_H, () => null);
    expect(Array.from(mine)).toEqual(Array.from(composePanel(images, st)));
  });
});

describe('AiPanel options match the faithful composer', () => {
  // The faithful options path colour-keys the scroll overlay and the handle sprite;
  // the AI path relies on baked alpha. Replaying with the same key reproduces it.
  const images = fakeImages();
  const SCROLL_KEY = 254;
  for (let i = 6; i < PANEL_IMAGES; i++) {
    // Give the scroll frames a keyed border so the overlay is genuinely partial.
    for (let y = 0; y < PANEL_H; y++) for (let x = 0; x < PANEL_W; x++) {
      if (x < 20 || y < 20) images[i]![y * PANEL_W + x] = SCROLL_KEY;
    }
  }
  images[PANEL_IMAGES - 1]![(PANEL_H - 1) * PANEL_W] = SCROLL_KEY; // the key hud.ts reads
  const cudl = new Uint8Array(CUDL_SIZE * CUDL_SIZE);
  for (let i = 0; i < cudl.length; i++) cudl[i] = i % 2 === 0 ? 7 : 200;
  cudl[0] = 7; // transparent index = top-left

  const ids = new Map<unknown, number>(images.map((im, i) => [im, i]));
  ids.set(cudl, PANEL_IMAGES); // the handle gets its own id
  const sources = [...images, cudl];
  const panel = new AiPanel(images as unknown as ImageBitmap[], cudl as unknown as ImageBitmap, 1);

  // Every subtitle mode (each has its own highlight X), both help states, and a
  // scroll frame — the same "only some branches exercised" hazard as the directions.
  const states: OptionsState[] = [
    { volume: { effect: 0, voice: 6, music: 12 }, subtitles: 'cz', helpActive: false, scrollFrame: -1 },
    { volume: { effect: 12, voice: 0, music: 5 }, subtitles: 'en', helpActive: true, scrollFrame: -1 },
    { volume: { effect: 3, voice: 9, music: 1 }, subtitles: 'off', helpActive: false, scrollFrame: 9 },
    { volume: { effect: 7, voice: 2, music: 8 }, subtitles: 'cz', helpActive: true, scrollFrame: 6 },
    { volume: { effect: 1, voice: 11, music: 4 }, subtitles: 'en', helpActive: false, scrollFrame: 15 },
    { volume: { effect: 5, voice: 5, music: 5 }, subtitles: 'off', helpActive: true, scrollFrame: -1 },
  ];

  for (const [i, st] of states.entries()) {
    it(`options, state ${i} (subtitles ${st.subtitles}, scroll ${st.scrollFrame})`, () => {
      const { ctx, draws } = recorder(ids);
      panel.drawOptions(ctx, st);
      // Handle sprite rows are CUDL_SIZE wide, not PANEL_W — replay it separately.
      const out = new Uint8Array(PANEL_W * PANEL_H);
      for (const d of draws) {
        const isCudl = d.img === PANEL_IMAGES;
        const srcW = isCudl ? CUDL_SIZE : PANEL_W;
        const key = isCudl ? cudl[0] : (d.img >= 6 ? SCROLL_KEY : null);
        const src = sources[d.img]!;
        for (let row = 0; row < d.sh; row++) {
          const sy = d.sy + row, dy = d.dy + row;
          if (dy < 0 || dy >= PANEL_H) continue;
          for (let col = 0; col < d.sw; col++) {
            const sx = d.sx + col, dx = d.dx + col;
            if (dx < 0 || dx >= PANEL_W) continue;
            const px = src[sy * srcW + sx];
            if (px === undefined || px === key) continue;
            out[dy * PANEL_W + dx] = px;
          }
        }
      }
      expect(Array.from(out)).toEqual(Array.from(composeOptions(images, cudl, st)));
    });
  }
});

describe('AiCredits scroll maps to the faithful row', () => {
  // The faithful renderer reads mov[delka-1-yobs] per screen row; the AI path translates
  // the vertically-flipped strip by a single offset and lets the compositor do the rest.
  // This checks the two agree for every visible row across the whole roll — the one
  // piece of arithmetic that could silently be off by one (it would look like a
  // slightly mistimed scroll rather than an error).
  const H = 480, DELKA = 2921;

  it('settles where the faithful renderer settles', () => {
    // credits.ts: maxScroll = delka + PRESAH(150). If these diverge the two tiers end
    // the roll differently.
    expect(creditsMaxScroll(DELKA)).toBe(DELKA + 150);
  });

  it('places every visible row where the faithful renderer would', () => {
    for (const posun of [0, 1, 137, 480, 1000, DELKA, DELKA + 150]) {
      // At cssScale 1 the translate is in native units, directly comparable.
      const dstY = creditsTranslate(H, DELKA, posun, 1);
      for (let y = 0; y < H; y++) {
        const yobs = y + posun - H;
        if (yobs < 0 || yobs >= DELKA) continue;    // background, nothing drawn
        // The flipped strip's row r is mov[DELKA-1-r], and it lands at screen dstY + r.
        const r = y - dstY;
        expect(DELKA - 1 - r, `posun ${posun}, row ${y}`).toBe(DELKA - 1 - yobs);
      }
    }
  });

  it('clamps past the settle point instead of scrolling on', () => {
    const settled = creditsTranslate(H, DELKA, creditsMaxScroll(DELKA), 1);
    for (const over of [1, 50, 600]) {
      expect(creditsTranslate(H, DELKA, creditsMaxScroll(DELKA) + over, 1)).toBe(settled);
    }
  });

  it('scales the translate to the display box', () => {
    // A fractional offset must survive — it is what makes the scroll smooth.
    expect(creditsTranslate(H, DELKA, 100.5, 2)).toBeCloseTo((H - 100.5) * 2, 6);
  });
});


/**
 * The web-port credit is PREPENDED to the scroll strip (tools/build-credits-port.py),
 * because the strip's top rows are what the roll shows last. If it is ever appended, or
 * the generator silently no-ops, the card would scroll past FIRST (or not at all) — and
 * nothing would error, so assert the shape of the shipped data instead.
 */
const MENU = join(process.cwd(), 'public/data/Menu');
const portStrip = join(MENU, 'CredMov_port.BMP');
const origStrip = join(MENU, 'CredMov.BMP');

describe.skipIf(!existsSync(portStrip))('web-port credit card', () => {
  const dib = (f: string): { w: number; h: number; bpp: number } => {
    const b = readFileSync(f);
    return { w: b.readInt32LE(18), h: b.readInt32LE(22), bpp: b.readUInt16LE(28) };
  };

  it('is taller than the original strip, in the same format', () => {
    const port = dib(portStrip), orig = dib(origStrip);
    expect(port.w).toBe(orig.w);
    expect(port.bpp).toBe(orig.bpp);          // same 8-bit palette format = drop-in
    expect(port.h).toBeGreaterThan(orig.h);
  });

  it('leaves the original game asset untouched', () => {
    expect(dib(origStrip).h).toBe(2921);
  });
});

/** The shipped art must exist and match what the loaders ask for. */
const AI = join(process.cwd(), 'public/enhanced-ai');
const havePanel = existsSync(join(AI, '_panel/ai.json'));
const haveCredits = existsSync(join(AI, '_credits/ai.json'));

describe.skipIf(!havePanel)('shipped panel art', () => {
  const man = JSON.parse(readFileSync(join(AI, '_panel/ai.json'), 'utf8'));
  it('ships all 16 colour variants plus the handle', () => {
    for (let i = 0; i < PANEL_IMAGES; i++) {
      expect(existsSync(join(AI, '_panel', `img${String(i).padStart(2, '0')}.webp`)), `img${i}`).toBe(true);
    }
    expect(existsSync(join(AI, '_panel/cudl.webp'))).toBe(true);
    expect(man.files).toHaveLength(PANEL_IMAGES + 1);
  });
  it('declares a scale', () => expect(man.scale).toBeGreaterThanOrEqual(4));
});

describe.skipIf(!haveCredits)('shipped credits art', () => {
  const man = JSON.parse(readFileSync(join(AI, '_credits/ai.json'), 'utf8'));
  it('ships the static frame and the scroll strip', () => {
    expect(existsSync(join(AI, '_credits/stat.webp'))).toBe(true);
    expect(existsSync(join(AI, '_credits/mov.webp'))).toBe(true);
    expect(man.files.sort()).toEqual(['mov.webp', 'stat.webp']);
  });
});
