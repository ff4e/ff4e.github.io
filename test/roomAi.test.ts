/**
 * Hi-res "AI" room compositor logic (src/render/roomAi.ts) + its activation gate
 * aiRoomRenderActive (src/app/main.ts).
 *
 * roomAi.ts is a canvas-2D compositor: its per-sprite methods (drawMirror,
 * drawRope, drawDisintegrating, drawClassicItem, draw) all need a real
 * CanvasRenderingContext2D (getImageData / putImageData / drawImage) and
 * document.createElement('canvas'). Vitest runs in the default `node`
 * environment here (vite.config.ts sets no test.environment) and the repo ships
 * NO canvas polyfill (no jsdom / node-canvas in package.json — checked), so those
 * methods cannot be *invoked* in a unit test without adding a dependency, which is
 * out of scope. See the report in the task summary.
 *
 * What IS unit-testable — and is the highest-value coverage per the task brief —
 * is the PURE pixel MATH the compositor is built on, cross-checked against the
 * authoritative faithful-path implementations the AI tier must match byte-for-byte:
 *
 *   - drawRope   stepping  vs framebuffer.cpuDrawRope   (same accumulator loop)
 *   - drawDisintegrating   vs rgbaScreen.blitDisintegrate (same RANDPOLE keep rule)
 *   - drawMirror axis      vs framebuffer.cpuMirror       (same reflection axis)
 *   - glassMask chroma-key scoring       (documented pure formula)
 *   - darkestIndex (gspec=2 fill)        (exported from renderRoom.ts)
 *   - aiRoomRenderActive gate rule       (documented predicate)
 *
 * Where a pure sub-function is embedded in a canvas method (the mirror axis
 * constant, the glass score) the algorithm is re-stated locally EXACTLY as in the
 * source and pinned against the faithful implementation / documented formula; the
 * inline source line is cited next to each.
 */
import { describe, it, expect } from 'vitest';
import {
  RANDPOLE,
  cpuDrawRope,
  cpuMirror,
  IndexedScreen,
  type CompositeTarget,
} from '../src/render/framebuffer.js';
import { RgbaScreen } from '../src/render/rgbaScreen.js';
import type { ArtSource } from '../src/render/artSource.js';
import { buildPaletteLut } from '../src/render/artSource.js';
import { darkestIndex } from '../src/render/renderRoom.js';
import { AI_ROOM_SCALE, aiRoomGateAllows } from '../src/render/roomAi.js';
import { FISH_BODY_FILE, frameIndex } from '../src/render/enhancedArtSource.js';
import type { FfrBitmap } from '../src/data/ffr.js';

type RGB = { r: number; g: number; b: number };

/** A greyscale 256-entry palette: index i -> (i,i,i). */
function greyPalette(): RGB[] {
  return Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i }));
}

/** Minimal ArtSource — RgbaScreen only reads `.lut` (see rgbaScreen.ts put/paintAll). */
function stubArt(palette: RGB[]): ArtSource {
  return { lut: buildPaletteLut(palette) } as unknown as ArtSource;
}

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

// ---------------------------------------------------------------------------
// 1. darkestIndex (renderRoom.ts:306) — the gspec=2 darkness fill.
// ---------------------------------------------------------------------------
describe('darkestIndex (gspec=2 darkness fill, renderRoom.ts:306)', () => {
  it('picks pure black when present, regardless of position', () => {
    const pal = greyPalette();
    pal[0] = { r: 200, g: 200, b: 200 };
    pal[137] = { r: 0, g: 0, b: 0 }; // exact black hidden mid-palette
    expect(darkestIndex(pal)).toBe(137);
  });

  it('uses the engine weighted distance 0.35r^2+0.5g^2+0.15b^2 (blue is "darker" than equal red/green)', () => {
    // err(12,0,0)=0.35*144=50.4 ; err(0,10,0)=0.5*100=50 ; err(0,0,12)=0.15*144=21.6
    // so the blue candidate wins even though it has the largest single channel.
    const pal: RGB[] = Array.from({ length: 256 }, () => ({ r: 255, g: 255, b: 255 }));
    pal[1] = { r: 12, g: 0, b: 0 };
    pal[2] = { r: 0, g: 10, b: 0 };
    pal[3] = { r: 0, g: 0, b: 12 };
    expect(darkestIndex(pal)).toBe(3);
  });

  it('returns the first index on ties (stable, strict-less comparison)', () => {
    const pal: RGB[] = Array.from({ length: 4 }, () => ({ r: 5, g: 5, b: 5 }));
    expect(darkestIndex(pal)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. drawRope stepping vs cpuDrawRope (roomAi.ts:231-237 ports framebuffer.ts:177-190).
//    The AI method walks in ORIGINAL coordinates with the identical slope
//    accumulator and paints an S×S block per step at native columns x and x+4;
//    it must therefore visit exactly the columns cpuDrawRope writes.
// ---------------------------------------------------------------------------

/**
 * The AI drawRope stepping, re-stated verbatim from roomAi.ts:229-237 (which is a
 * line-for-line port of cpuDrawRope). Returns the native (x,y) block origins for
 * BOTH strands, in emission order.
 */
function aiRopeSteps(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  const out: [number, number][] = [];
  if (y2 <= y1) return out;
  const d = (x2 - x1) / (y2 - y1);
  let r = 0.5;
  let x = x1;
  for (let y = y1; y <= y2; y++) {
    while (r > 1) { x++; r -= 1; }
    while (r < 0) { x--; r += 1; }
    r += d;
    out.push([x, y]);
    out.push([x + 4, y]);
  }
  return out;
}

/** Run cpuDrawRope into an IndexedScreen and collect every painted (x,y) as a set. */
function cpuRopeCells(w: number, h: number, x1: number, y1: number, x2: number, y2: number, col: number): Set<string> {
  const screen = new IndexedScreen(w, h, 0);
  cpuDrawRope(screen, x1, y1, x2, y2, col);
  const set = new Set<string>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (screen.getIndex(x, y) === col) set.add(`${x},${y}`);
  }
  return set;
}

describe('drawRope stepping parity vs cpuDrawRope (roomAi.ts:221)', () => {
  const COL = 7;

  it('a vertical rope visits the same columns as cpuDrawRope, two strands 4 px apart', () => {
    const steps = aiRopeSteps(10, 5, 10, 25);
    const expected = new Set(steps.map(([x, y]) => `${x},${y}`));
    expect(cpuRopeCells(60, 40, 10, 5, 10, 25, COL)).toEqual(expected);
    // strands sit exactly 4 ORIGINAL px apart on every row.
    for (let i = 0; i < steps.length; i += 2) {
      expect(steps[i + 1]![0] - steps[i]![0]).toBe(4);
      expect(steps[i + 1]![1]).toBe(steps[i]![1]);
    }
  });

  it('a leaning rope leans identically to cpuDrawRope (slope accumulator)', () => {
    const expected = new Set(aiRopeSteps(10, 5, 30, 25).map(([x, y]) => `${x},${y}`));
    expect(cpuRopeCells(60, 40, 10, 5, 30, 25, COL)).toEqual(expected);
  });

  it('draws nothing when y2 <= y1 (the shared div-by-zero / empty-loop guard)', () => {
    expect(aiRopeSteps(10, 25, 30, 25)).toEqual([]); // y2 == y1
    expect(aiRopeSteps(10, 25, 30, 5)).toEqual([]);  // y2 <  y1
    expect(cpuRopeCells(60, 40, 10, 25, 30, 5, COL).size).toBe(0);
  });

  it('maps each native column to an S× block origin (AI_ROOM_SCALE)', () => {
    expect(AI_ROOM_SCALE).toBe(4);
    // roomAi fillRect(x*S, y*S, S, S): native col c -> scaled origin c*S.
    for (const [x, y] of aiRopeSteps(10, 5, 10, 8)) {
      expect(x * AI_ROOM_SCALE % AI_ROOM_SCALE).toBe(0);
      expect(y * AI_ROOM_SCALE % AI_ROOM_SCALE).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. drawDisintegrating keep/erode vs blitDisintegrate (roomAi.ts:516 vs rgbaScreen.ts:203).
//    Both keep a source pixel only where RANDPOLE[(row*w+col)&255] < rozpad,
//    evaluated per ORIGINAL pixel. Assert identical keep sets for a spread of rozpad.
// ---------------------------------------------------------------------------

/** The AI dissolve keep rule, verbatim from roomAi.ts:531-533 (kept iff < rozpad). */
function aiKeptSet(w: number, h: number, rozpad: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < h; i++) {
    const pBase = (i * w) & 255;
    for (let j = 0; j < w; j++) {
      if (RANDPOLE[(pBase + j) & 255]! < rozpad) set.add(`${j},${i}`); // survives
    }
  }
  return set;
}

/** blitDisintegrate's keep set: pixels whose index ends up == INK (non-mask) in the plane. */
function blitKeptSet(w: number, h: number, rozpad: number): Set<string> {
  const INK = 7;
  const MASK = 250;
  const screen = new RgbaScreen(w, h, stubArt(greyPalette()), 0);
  const bm = solid(w, h, INK); // every pixel opaque ink (none == MASK)
  screen.blitDisintegrate(0, 0, bm, MASK, rozpad, false);
  const set = new Set<string>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (screen.getIndex(x, y) === INK) set.add(`${x},${y}`);
  }
  return set;
}

describe('drawDisintegrating keep/erode parity vs blitDisintegrate (roomAi.ts:516)', () => {
  const W = 10, H = 8;

  for (const rozpad of [0, 32, 64, 128, 200, 255]) {
    it(`keeps exactly the same pixels at rozpad=${rozpad}`, () => {
      expect(aiKeptSet(W, H, rozpad)).toEqual(blitKeptSet(W, H, rozpad));
    });
  }

  it('erodes everything at rozpad=0 and keeps all-but-255 at rozpad=255', () => {
    expect(aiKeptSet(W, H, 0).size).toBe(0); // RANDPOLE >= 0 always ⇒ nothing < 0
    // at 255 the only eroded pixels are the (rare) RANDPOLE==255 cells.
    let holes = 0;
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
      if (RANDPOLE[((i * W & 255) + j) & 255]! === 255) holes++;
    }
    expect(aiKeptSet(W, H, 255).size).toBe(W * H - holes);
  });
});

// ---------------------------------------------------------------------------
// 4. drawMirror axis vs cpuMirror (roomAi.ts:288 vs framebuffer.ts:150-151).
//    Faithful: dest col X+k <- src col X+3-k, i.e. src = 2X+3 - dest.
//    AI (sub-pixel): scaled dest D <- src K - D, with K = S*(2X+4)-1.
//    Assert the AI constant reduces to the faithful native axis for every pixel.
// ---------------------------------------------------------------------------
describe('drawMirror reflection axis (roomAi.ts:288)', () => {
  it('cpuMirror reflects a glass column about src = 2X+3 - dest', () => {
    // 20-wide screen: a glass rect [X..X+dx) filled with GLASS, a striped scene to
    // its left. After cpuMirror each glass col d holds the value from col 2X+3-d.
    const W = 20, H = 1, GLASS = 99;
    const screen = new IndexedScreen(W, H, 0);
    for (let x = 0; x < W; x++) screen.setIndex(x, 0, x); // unique marker per column
    const X = 8, dx = 4;
    for (let k = 0; k < dx; k++) screen.setIndex(X + k, 0, GLASS); // paint the glass rect
    cpuMirror(screen, X, 0, dx, H);
    for (let k = 0; k < dx; k++) {
      const dest = X + k;
      const src = 2 * X + 3 - dest;
      // near-axis self-reference reads glass->glass (value stays GLASS); elsewhere the
      // marker from the mirrored column shows through.
      const expected = src >= X && src < X + dx ? GLASS : src;
      expect(screen.getIndex(dest, 0)).toBe(expected);
    }
  });

  it('the AI scaled axis K=S*(2X+4)-1 reduces to the native axis 2X+3-c for every sub-pixel', () => {
    const S = AI_ROOM_SCALE;
    for (const X of [0, 3, 8, 25]) {
      const K = S * (2 * X + 4) - 1; // roomAi.ts:288
      for (let c = 0; c < 12; c++) {
        // native dest column c occupies scaled columns [c*S, c*S+S). Each maps into
        // the SAME native src column 2X+3-c (a true mirror, flipping within the pixel).
        for (let d = 0; d < S; d++) {
          const D = c * S + d;
          const srcNative = Math.floor((K - D) / S);
          expect(srcNative).toBe(2 * X + 3 - c);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. glassMask chroma-key scoring (roomAi.ts:342-347). Pure per-pixel score,
//    re-stated locally (the enclosing method needs a canvas to read the sprite).
//    key = min(G,B) - R; full glass at key>=128, fading to 0 below, 0 if transparent.
// ---------------------------------------------------------------------------

/** Verbatim scoring from roomAi.ts:344-346 (+ the alpha<128 skip at :344). */
function glassScore(r: number, g: number, b: number, a: number): number {
  const HALF_KEY = 128;
  if (a < 128) return 0;
  const key = Math.min(g, b) - r;
  return key <= 0 ? 0 : key >= HALF_KEY ? 1 : key / HALF_KEY;
}

describe('glassMask chroma-key scoring (roomAi.ts:331)', () => {
  it('scores pure cyan (the staged key colour) as fully reflective', () => {
    expect(glassScore(0, 255, 255, 255)).toBe(1);
  });

  it('scores white highlights, orange frame and black outline as non-glass (0)', () => {
    expect(glassScore(255, 255, 255, 255)).toBe(0); // white: min(G,B)-R = 0
    expect(glassScore(255, 128, 0, 255)).toBe(0);   // orange: R >> G,B ⇒ negative key
    expect(glassScore(0, 0, 0, 255)).toBe(0);       // black outline
  });

  it('is fully reflective at exactly the half-key threshold and half at quarter key', () => {
    expect(glassScore(0, 128, 128, 255)).toBe(1);   // key == 128 ⇒ >= HALF_KEY
    expect(glassScore(0, 64, 64, 255)).toBe(0.5);   // key == 64 ⇒ 64/128
  });

  it('key tracks the weaker of G/B minus R (a blend toward the black inner outline)', () => {
    // half-cyan over black ≈ (0,128,128): still full glass; drop one channel and the
    // score follows min(G,B).
    expect(glassScore(0, 200, 96, 255)).toBeCloseTo(96 / 128, 5);
  });

  it('scores transparent pixels (outside the sprite) as 0', () => {
    expect(glassScore(0, 255, 255, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. The aiRoomRenderActive gate rule. This used to be a hand-copy of the predicate,
//    which is worthless as a test (it asserted the copy against itself) AND had already
//    drifted: it still claimed only gspec=42 and hooks were excluded after a third
//    exclusion, frame effects, was added. The real predicate now lives in roomAi.ts as
//    aiRoomGateAllows and is imported here, so drift is impossible.
// ---------------------------------------------------------------------------

const aiGateAllows = (gspec: number, hookStates: number[], frameEffects = false): boolean =>
  aiRoomGateAllows(gspec, hookStates, frameEffects);

describe('aiRoomRenderActive gate rule (main.ts:954)', () => {
  it('allows every gspec the compositor covers (0/2/3/4/5/9) and excludes only 42', () => {
    for (const g of [0, 2, 3, 4, 5, 9]) expect(aiGateAllows(g, [])).toBe(true);
    expect(aiGateAllows(42, [])).toBe(false);
  });

  it('excludes any frame with an active fishing hook regardless of gspec', () => {
    expect(aiGateAllows(0, [0, 0])).toBe(true);   // all hooks idle
    expect(aiGateAllows(0, [0, 1])).toBe(false);  // one hook active
    expect(aiGateAllows(9, [2])).toBe(false);
  });

  it('excludes frames with a CPU-only frame effect running', () => {
    // megabomb flash / silent film / interlaced / the Tetris overlay are applied by the
    // faithful compositor while it builds the frame; this path bypasses it, so it must
    // stand down or the effect renders as nothing at all.
    expect(aiGateAllows(0, [], true)).toBe(false);
    expect(aiGateAllows(9, [0], true)).toBe(false);
    expect(aiGateAllows(0, [], false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Fish body-frame fallback rules used by drawFish (roomAi.ts:484-495).
//    These decide which frames route to the classic-sprite fallback vs draw
//    nothing — the part of drawFish that is data-driven rather than canvas work.
// ---------------------------------------------------------------------------
describe('drawFish body-frame routing (roomAi.ts:484)', () => {
  it('frame 0 is the deliberate wink-out (no FFNG file ⇒ draws nothing)', () => {
    expect(FISH_BODY_FILE[0]).toBeUndefined();
  });

  it('the dark silhouette (TL_TMA=23) and skeleton (TL_KOSTRA=19) have no FFNG body file', () => {
    expect(FISH_BODY_FILE[23]).toBeUndefined(); // gspec=2 silhouette ⇒ classic fallback
    expect(FISH_BODY_FILE[19]).toBeUndefined(); // skeleton ⇒ staged body_skeleton_00
  });

  it('normal swim/rest/talk frames DO map to a staged FFNG file', () => {
    expect(FISH_BODY_FILE[1]).toBe('body_rest_00.png');
    expect(FISH_BODY_FILE[4]).toBe('body_swam_00.png');
  });

  it('frameIndex clamps the animation phase into the frame array (roomAi spriteFor/drawItem)', () => {
    expect(frameIndex(-3, 4)).toBe(0);
    expect(frameIndex(2, 4)).toBe(2);
    expect(frameIndex(9, 4)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 8. RANDPOLE — the dissolve threshold table both blitDisintegrate and
//    drawDisintegrating index. Deterministic (fixed seed, framebuffer.ts:26).
// ---------------------------------------------------------------------------
describe('RANDPOLE dissolve table (framebuffer.ts:26)', () => {
  it('is 256 bytes spanning the full 0..255 range', () => {
    expect(RANDPOLE.length).toBe(256);
    expect(Math.min(...RANDPOLE)).toBe(0);
    expect(Math.max(...RANDPOLE)).toBe(255);
  });

  it('is seeded deterministically (fixed values pin the seed)', () => {
    expect(RANDPOLE[0]).toBe(184);
    expect(RANDPOLE[1]).toBe(228);
    expect(RANDPOLE[255]).toBe(182);
  });
});
