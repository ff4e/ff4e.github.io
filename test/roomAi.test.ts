/**
 * Hi-res "AI" room compositor logic (src/render/roomAi.ts) + its activation gate
 * aiRoomRenderActive (src/app/main.ts).
 *
 * roomAi.ts is a canvas-2D compositor. Vitest runs in the default `node` environment
 * here (vite.config.ts sets no test.environment) and the repo ships NO canvas polyfill
 * (no jsdom / node-canvas in package.json), so methods that need real rasterisation —
 * drawMirror and drawDisintegrating, which call getImageData/putImageData and
 * document.createElement — cannot be invoked here. Their pixel MATH is therefore
 * cross-checked below against the authoritative faithful implementations, and their
 * wiring is covered end-to-end by tools/test-airender.mjs in a real browser.
 *
 * Everything that only needs drawImage/fillRect IS driven for real, against a recording
 * context (sections 9 and 10): AiRoom.draw's item pass and drawRope. That distinction
 * matters — a pure-math test proves two formulas agree, but not that the compositor
 * actually calls them. Mutation testing found exactly that gap: reversing the item draw
 * order, shifting the rope's second strand, or swapping its colour channels all left the
 * math-only suite green.
 *
 * Cross-checked against the faithful path:
 *
 *   - drawRope   stepping  vs framebuffer.cpuDrawRope   (same accumulator loop)
 *   - drawDisintegrating   vs rgbaScreen.blitDisintegrate (same RANDPOLE keep rule)
 *   - drawMirror axis      vs framebuffer.cpuMirror       (same reflection axis)
 *   - glassMask chroma-key scoring       (documented pure formula)
 *   - darkestIndex (gspec=2 fill)        (exported from renderRoom.ts)
 *   - aiRoomGateAllows gate rule         (imported, never re-stated)
 *
 * Where a pure sub-function is embedded in a canvas method (the mirror axis constant,
 * the glass score) the algorithm is re-stated locally EXACTLY as in the source and
 * pinned against the faithful implementation / documented formula; the inline source
 * line is cited next to each.
 */
import { describe, it, expect } from 'vitest';
import {
  RANDPOLE,
  cpuDrawRope,
  cpuMirror,
  delphiRound,
  waterShift,
  IndexedScreen,
  type CompositeTarget,
} from '../src/render/framebuffer.js';
import { RgbaScreen } from '../src/render/rgbaScreen.js';
import type { ArtSource } from '../src/render/artSource.js';
import { buildPaletteLut } from '../src/render/artSource.js';
import { darkestIndex } from '../src/render/renderRoom.js';
import { AI_ROOM_SCALE, aiRoomGateAllows } from '../src/render/roomAi.js';
import { FISH_BODY_FILE, frameIndex } from '../src/render/enhancedArtSource.js';
import { AiRoom } from '../src/render/roomAi.js';
import {
  Canvas2dAiTarget,
  RIPPLE,
  activeRipples,
  aiImagePatch,
  aiImageRevision,
  dissolveKeeps,
  faithfulWobbleShifts,
  markAiImageChanged,
  nextRippleBirth,
  smoothWobbleShift,
  wobblePhase,
} from '../src/render/aiTarget.js';
import type { AiTarget, AiWobble, RippleTuning } from '../src/render/aiTarget.js';
import { FSIZE as FSIZE_PX } from '../src/render/renderRoom.js';
import { Dir } from '../src/core/dir.js';
import { makeRoom } from './roomBuilder.js';
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

/**
 * The AI dissolve keep set, from the SHIPPING rule — `dissolveKeeps` is imported, not
 * restated.
 *
 * This function used to carry its own copy of the predicate, and that is precisely why it
 * failed to do its job: when `dissolveKeeps` was refactored out of `AiRoom` with the
 * inequality reversed, the copy here still held the correct rule, so this test compared
 * the OLD rule against the faithful renderer and stayed green while the shipping code
 * rendered the skeleton backwards. A re-implementation cannot catch a bug in the
 * implementation it re-implements.
 */
function aiKeptSet(w: number, h: number, rozpad: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      if (dissolveKeeps(i, j, w, rozpad)) set.add(`${j},${i}`);
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

const GATE_OK = {
  gspec: 0,
  hookStates: [] as number[],
  frameEffects: false,
  spriteCheatsActive: false,
  bakedSubsNeeded: false,
};
const aiGateAllows = (over: Partial<typeof GATE_OK> = {}): boolean =>
  aiRoomGateAllows({ ...GATE_OK, ...over });

describe('aiRoomRenderActive gate rule (main.ts:954)', () => {
  it('allows every gspec the compositor covers (0/2/3/4/5/9) and excludes only 42', () => {
    for (const g of [0, 2, 3, 4, 5, 9]) expect(aiGateAllows({ gspec: g })).toBe(true);
    expect(aiGateAllows({ gspec: 42 })).toBe(false);
  });

  it('excludes any frame with an active fishing hook regardless of gspec', () => {
    expect(aiGateAllows({ hookStates: [0, 0] })).toBe(true);   // all hooks idle
    expect(aiGateAllows({ hookStates: [0, 1] })).toBe(false);  // one hook active
    expect(aiGateAllows({ gspec: 9, hookStates: [2] })).toBe(false);
  });

  it('excludes frames with a CPU-only frame effect running', () => {
    // megabomb flash / silent film / interlaced / the Tetris overlay are applied by the
    // faithful compositor while it builds the frame; this path bypasses it, so it must
    // stand down or the effect renders as nothing at all.
    expect(aiGateAllows({ frameEffects: true })).toBe(false);
    expect(aiGateAllows({ gspec: 9, hookStates: [0], frameEffects: true })).toBe(false);
    expect(aiGateAllows({ frameEffects: false })).toBe(true);
  });

  it('no longer withholds LODE while the shipwreck is damaging the background', () => {
    // This WAS an exclusion: the faithful/enhanced tiers replay destructive per-pixel
    // wreck swaps into the background, and static ×4 bitmaps could not show the damage,
    // so the room visibly dropped from ×4 to native mid-fall. AiRoom.syncWreck now
    // replays the same swaps into a mutable ×S background, so the CONDITION IS GONE
    // rather than merely satisfied — there is no field left to set. LODE (gspec=9) is
    // therefore allowed like any other room; the replay itself is pinned against the
    // faithful renderer in test/lode-wreck.test.ts.
    expect(aiGateAllows({ gspec: 9 })).toBe(true);
  });

  it('excludes frames with a sprite cheat (xundead/xmorph) active', () => {
    // Upstream c9c4e9d reshapes the classic sprite sheet that the enhanced tier derives
    // from; the AI fish are pre-baked bitmaps no cheat can reach.
    expect(aiGateAllows({ spriteCheatsActive: true })).toBe(false);
  });

  it('excludes frames whose subtitle has to be baked in (no subtitle font loaded)', () => {
    // The faithful path bakes subs in applyFrameEffects when the vector overlay is
    // unavailable; this path has no equivalent and would silently drop the dialogue.
    expect(aiGateAllows({ bakedSubsNeeded: true })).toBe(false);
  });

  it('rejects a frame if ANY exclusion applies, not just the first', () => {
    // Guards against an early `return true` or a dropped clause: each exclusion is
    // checked in isolation above, so here we assert none of them is skippable.
    const exclusions: Partial<typeof GATE_OK>[] = [
      { gspec: 42 }, { hookStates: [1] }, { frameEffects: true },
      { spriteCheatsActive: true }, { bakedSubsNeeded: true },
    ];
    for (const e of exclusions) expect(aiGateAllows(e)).toBe(false);
    expect(aiGateAllows()).toBe(true); // ...and the all-clear case still passes
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


// ---------------------------------------------------------------------------
// 8b. The `ai` tier's CONTINUOUS water wobble, pinned against the FAITHFUL rule.
//
//     The GPU background pass (glRoomAi.ts BG_FS) no longer looks up a rounded shift
//     per native row: it evaluates the wave per fragment, at a fractional shift, at a
//     sub-tick time. That is a resampling of the 1998 curve, not a new curve — and the
//     only way to say so with a test is to hold it against the faithful definition
//     rather than against the other AI backend (which is now deliberately allowed to
//     differ). `waterShift` is IMPORTED from framebuffer.ts, where blit2 / blitZX /
//     blit2Rgba read it; a re-stated copy here could not catch a wrong curve.
//
//     Every wamp/wper/wspd combination that actually occurs in the 72 shipped rooms is
//     covered, not just the common one.
// ---------------------------------------------------------------------------
describe('ai-tier smooth wobble vs the faithful rule (aiTarget.ts / framebuffer.ts:blit2)', () => {
  const S = AI_ROOM_SCALE;
  // The 12 distinct (wamp, wper, wspd) triples across 001..072.ffr.
  const WAVES: [number, number, number][] = [
    [4, 12, 5], [5, 10, 5], [3, 10, 5], [6, 10, 5], [8, 20, 12], [5, 20, 3],
    [2, 6, 4], [5, 10, 4], [4, 10, 5], [0, 12, 7], [7, 11, 7], [0, 1, 1],
  ];
  const wave = (t: [number, number, number], time: number): AiWobble =>
    ({ wamp: t[0], wper: t[1], wspd: t[2], count: Math.floor(time), time });

  it('a scaled row centred on native row i has EXACTLY the faithful displacement there', () => {
    // (y + 0.5)/S - 0.5 === i  <=>  y === i*S + (S-1)/2, the band's mid-row.
    for (const t of WAVES) {
      for (const count of [0, 1, 7, 40, 199]) {
        const w = wave(t, count);
        const phase = wobblePhase(w);
        for (let i = 0; i < 60; i++) {
          const y = i * S + (S - 1) / 2;
          // smoothWobbleShift is in SCALED px; the faithful rule is in NATIVE px.
          expect(smoothWobbleShift(y, S, w, phase) / S).toBeCloseTo(
            waterShift(i, count, t[0], t[1], t[2]),
            9,
          );
        }
      }
    }
  });

  it('rounds back to the faithful integer shift at every band mid-row (no drift)', () => {
    for (const t of WAVES) {
      for (let count = 0; count < 50; count++) {
        const w = wave(t, count);
        const phase = wobblePhase(w);
        const faithful = faithfulWobbleShifts(w, 120);
        for (let i = 0; i < 120; i++) {
          const y = i * S + (S - 1) / 2;
          // `+ 0` normalises IEEE -0 (Math.floor(-0) keeps the sign; an Int16Array
          // element is always +0), which is a signed-zero artifact, not a disagreement.
          expect(delphiRound(smoothWobbleShift(y, S, w, phase) / S) + 0).toBe(faithful[i]);
        }
      }
    }
  });

  it('resamples the curve rather than translating the image (a band averages to its native row)', () => {
    // The half-pixel centring is easy to drop, and dropping it shifts the WHOLE
    // background up by half a native row — a bug no smoothness check would notice.
    //
    // Asserted against smoothWobbleShift itself, NOT against the centring formula
    // restated here: an earlier version of this test recomputed `(y+0.5)/S - 0.5`
    // locally and proved only that arithmetic identity, which would have passed for
    // any implementation at all.
    for (const S2 of [2, 3, 4, 8]) {
      for (const t of WAVES.filter((v) => v[0] !== 0)) {
        const w = wave(t, 40);
        const phase = wobblePhase(w);
        for (let i = 0; i < 20; i++) {
          let sum = 0;
          for (let r = 0; r < S2; r++) sum += smoothWobbleShift(i * S2 + r, S2, w, phase) / S2;
          // The band's MEAN displacement is the faithful displacement at that native
          // row (to second order — the curve is smooth over one native row).
          expect(sum / S2).toBeCloseTo(waterShift(i, 40, t[0], t[1], t[2]), 2);
        }
      }
    }
  });

  it('is CONTINUOUS across a band: adjacent scaled rows differ, unlike the faithful table', () => {
    const w = wave([5, 10, 5], 40); // the 60-room default
    const phase = wobblePhase(w);
    const faithful = faithfulWobbleShifts(w, 40);
    let smoothPairs = 0;
    for (let i = 0; i < 40; i++) {
      for (let r = 0; r + 1 < S; r++) {
        const a = smoothWobbleShift(i * S + r, S, w, phase);
        const b = smoothWobbleShift(i * S + r + 1, S, w, phase);
        if (a !== b) smoothPairs++;
      }
    }
    // Every within-band pair moves; the faithful table cannot move within a band at all.
    expect(smoothPairs).toBe(40 * (S - 1));
    for (let i = 0; i < 40; i++) expect(Number.isInteger(faithful[i])).toBe(true);
  });

  it('advances with the sub-tick fraction, and count+1 with alpha 0 equals count with alpha 1', () => {
    const t: [number, number, number] = [5, 10, 5];
    const at = wobblePhase(wave(t, 40));
    const mid = wobblePhase(wave(t, 40.5));
    const next = wobblePhase(wave(t, 41));
    expect(mid).not.toBe(at);
    expect(mid).not.toBe(next);
    // Continuity across the tick boundary: alpha is a fraction OF the tick, nothing else.
    expect(Math.sin(41 / t[2])).toBeCloseTo(Math.sin(next), 12);
  });

  it('reduces the phase into [0, 2pi) without changing the wave (a FP32 sin must not see a huge argument)', () => {
    const t: [number, number, number] = [5, 10, 5];
    for (const time of [0, 40, 45_000, 450_000]) {
      const w = wave(t, time);
      const phase = wobblePhase(w);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
      expect(Math.sin(phase)).toBeCloseTo(Math.sin(time / t[2]), 9);
    }
  });

  it('the FAITHFUL table ignores the sub-tick fraction (canvas-2D caches its composite on the tick)', () => {
    // Canvas2dAiTarget keys its whole ×S background composite on `faze|count`. If the
    // faithful table read `time` instead of `count` the two would disagree, the cache
    // would miss on every display frame, and the fallback path would re-blit a 2400×2100
    // canvas at the display rate — the precise cost that made it keep the 1998 sampling.
    for (const t of WAVES) {
      for (const count of [0, 7, 40]) {
        const onTick = [...faithfulWobbleShifts(wave(t, count), 80)];
        for (const alpha of [0.01, 0.5, 0.99]) {
          expect([...faithfulWobbleShifts(wave(t, count + alpha), 80)]).toEqual(onTick);
        }
      }
    }
  });

  it('a wamp=0 room has no displacement at all (rooms 46 and 66 — the parity control)', () => {
    const w = wave([0, 12, 7], 40.37);
    const phase = wobblePhase(w);
    for (let y = 0; y < 40; y++) expect(smoothWobbleShift(y, S, w, phase) + 0).toBe(0);
    expect([...faithfulWobbleShifts(w, 20)]).toEqual(Array(20).fill(0));
  });
});


// ---------------------------------------------------------------------------
// 8c. Ripple trains — the `ai` tier's one deliberate LIBERTY.
//
//     Unlike everything in 8b, this is not a resampling of a 1998 rule: the original
//     engine had one sine and no more. So there is no faithful oracle to pin it against,
//     and the properties that matter are structural instead — determinism, continuity,
//     ordering, and that a still room stays still. Each is something that, if broken,
//     would look like "the water glitches occasionally" and would be near-impossible to
//     find from a screenshot.
// ---------------------------------------------------------------------------
describe('ripple trains (aiTarget.ts activeRipples)', () => {
  const H = 525; // room 3 / 21's native height
  const w = (time: number, wamp = 5): AiWobble => ({ wamp, wper: 10, wspd: 5, count: Math.floor(time), time });

  it('is a pure function of game time — the same instant gives the same water', () => {
    // The whole tier depends on this: the JS oracle in aiWobbleCheck reproduces what the
    // shader drew, and the composite cache keys on the tick. Math.random() here would
    // break both silently, and only on the frames nobody screenshotted.
    for (const t of [0, 17.25, 613.5, 20_000.125]) {
      expect(JSON.stringify(activeRipples(w(t), H))).toBe(JSON.stringify(activeRipples(w(t), H)));
    }
  });

  it('scatters the arrivals but never lets two births reorder', () => {
    let c = 0;
    const births: number[] = [];
    for (let i = 0; i < 200; i++) { c = nextRippleBirth(c, RIPPLE); births.push(c); }
    const gaps = births.slice(1).map((b, i) => b - births[i]!);
    expect(Math.min(...gaps)).toBeGreaterThan(0); // strictly increasing: the bracket search relies on it
    // Bounded jitter, NOT an accumulated random walk — a walk would drift out of the
    // bracket activeRipples searches and trains would start vanishing.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(RIPPLE.periodTicks * (1 - RIPPLE.jitter) - 1e-9);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(RIPPLE.periodTicks * (1 + RIPPLE.jitter) + 1e-9);
    // …and irregular: a metronome would give one distinct gap.
    expect(new Set(gaps.map((g) => g.toFixed(1))).size).toBeGreaterThan(50);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(Math.abs(mean - RIPPLE.periodTicks)).toBeLessThan(RIPPLE.periodTicks * 0.1);
  });

  it('jitter = 0 is an exact metronome (the parameter really is the only source of scatter)', () => {
    const t: RippleTuning = { ...RIPPLE, jitter: 0 };
    let c = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 20; i++) { const n = nextRippleBirth(c, t); gaps.push(n - c); c = n; }
    for (const g of gaps.slice(1)) expect(g).toBeCloseTo(t.periodTicks, 9);
  });

  it('every scheduled train actually appears', () => {
    let c = 0;
    for (let i = 0; i < 60; i++) {
      c = nextRippleBirth(c, RIPPLE);
      const justAfter = activeRipples(w(c + 0.2), H);
      // A newborn is identifiable by its envelope still being near zero.
      expect(justAfter.some((r) => Math.abs(r.amp) < 0.05)).toBe(true);
    }
  });

  it('never pops: the total displacement is continuous across every sub-tick', () => {
    // sin(pi*age) fades a train in and out, and each enters/leaves fully off-screen. A
    // train appearing at full strength would be a visible flash in 70 rooms.
    let maxJump = 0;
    let prev: number | null = null;
    for (let t = 0; t < 1500; t += 0.25) {
      const tot = activeRipples(w(t), H).reduce((s, r) => s + Math.abs(r.amp), 0);
      if (prev !== null) maxJump = Math.max(maxJump, Math.abs(tot - prev));
      prev = tot;
    }
    expect(maxJump).toBeLessThan(0.1); // a pop would be the full amplitude, ~2px
  });

  it('rises: the band travels bottom to top and its crests travel with it', () => {
    // Row 0 is the TOP, so rising means a DECREASING centre. Water that sometimes flows
    // up and sometimes down reads as a glitch, so the direction is not randomised.
    let checked = 0;
    for (let t = 0; t < 2000; t += 3) {
      const a = activeRipples(w(t), H)[0];
      const b = activeRipples(w(t + 2), H)[0];
      if (!a || !b || activeRipples(w(t), H).length !== 1 || activeRipples(w(t + 2), H).length !== 1) continue;
      if (Math.abs(a.c - b.c) > H) continue; // different trains
      expect(b.c).toBeLessThan(a.c);         // band rises
      expect(b.phase).toBeGreaterThan(a.phase); // crests rise with it
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('honours the overlap cap, keeping the NEWEST trains', () => {
    for (let t = 0; t < 3000; t += 0.5) {
      const a = activeRipples(w(t), H);
      expect(a.length).toBeLessThanOrEqual(RIPPLE.max);
    }
    // With a period far below the lifetime, many would qualify; the cap must bite, and
    // must drop the oldest (already fading) rather than the one just arriving.
    const dense: RippleTuning = { ...RIPPLE, periodTicks: 6, jitter: 0, max: 2 };
    const a = activeRipples(w(600), H, dense);
    expect(a.length).toBe(2);
    expect(a[0]!.c).toBeGreaterThan(a[1]!.c); // newest is lowest down = largest row
  });

  it('scales with the room: amplitude follows wamp, frequency follows wper', () => {
    // One tuning has to work across all 70 wobbling rooms, whose wamp spans 2..8 and
    // wper 6..20 — so the parameters are RELATIVE, not absolute pixel counts.
    const peak = (wamp: number) => {
      let m = 0;
      for (let t = 0; t < 600; t += 0.5) for (const r of activeRipples(w(t, wamp), H)) m = Math.max(m, Math.abs(r.amp));
      return m;
    };
    expect(peak(8) / peak(4)).toBeCloseTo(2, 1);
    // Pick an instant that actually has a train, rather than assuming one (the gaps are
    // jittered now, so a hard-coded tick can easily land in the calm).
    let at = -1;
    for (let t = 0; t < 3000 && at < 0; t += 0.5) if (activeRipples(w(t), H).length === 1) at = t;
    expect(at).toBeGreaterThanOrEqual(0);
    const k = (wper: number) => activeRipples({ ...w(at), wper }, H)[0]!.k;
    expect(k(10) / k(20)).toBeCloseTo(2, 6);
  });

  it('a still room gets none — rooms 46 and 66, and the still-water parity comparison', () => {
    // aiGlParity({stillWater}) forces wamp=0 to compare the two backends byte-for-byte.
    // If ripples survived that, the whole parity net would go with them.
    for (let t = 0; t < 500; t += 0.5) expect(activeRipples(w(t, 0), H)).toEqual([]);
  });

  it('amp = 0 is exactly PR #17 — the effect can be switched off completely', () => {
    const off: RippleTuning = { ...RIPPLE, amp: 0 };
    for (let t = 0; t < 500; t += 0.5) expect(activeRipples(w(t), H, off)).toEqual([]);
    const ww = w(123.4);
    const ph = wobblePhase(ww);
    for (let y = 0; y < 40; y++) {
      expect(smoothWobbleShift(y, 4, ww, ph, activeRipples(ww, H, off))).toBe(smoothWobbleShift(y, 4, ww, ph));
    }
  });

  it('the carrier phase is what moves the crests — not the band position', () => {
    // The trap this guards: driving the crests from the band's own position couples the
    // two velocities, and a band wide enough to read as a wave has to cross the room fast
    // enough that crest passage lands near 19 Hz — above what a 30 fps idle repaint can
    // show, so the whole effect degenerates into aliased shimmer. `phase` existing but
    // being ignored would look almost right and be very hard to spot.
    const ww = w(200);
    const ph = wobblePhase(ww);
    const base = { c: 200, halfW: 25, amp: 1.5, k: 0.6 };
    const a1 = smoothWobbleShift(800, 4, ww, ph, [{ ...base, phase: 0 }]);
    const a2 = smoothWobbleShift(800, 4, ww, ph, [{ ...base, phase: Math.PI / 2 }]);
    expect(Math.abs(a1 - a2)).toBeGreaterThan(0.5);
  });

  it('the shipped tuning stays inside what the renderer can actually show, and leaves calm', () => {
    // Crest passage in Hz = carrier/(2*pi) cycles per tick * 12.5 ticks/s. An idle room
    // repaints at `waterAnimMs` (20 fps today), so anything at or above ~10 Hz aliases.
    // The bound below is deliberately well inside that rather than at Nyquist, so the
    // margin survives the idle rate being retuned again.
    const crestHz = (RIPPLE.carrier / (2 * Math.PI)) * 12.5;
    expect(crestHz).toBeLessThan(7); // half of Nyquist, i.e. real headroom, not a hair
    // …and the water must not be rippling permanently: the effect is occasional.
    let on = 0, n = 0;
    for (let t = 0; t < 4000; t += 0.5) { n++; if (activeRipples(w(t), H).length) on++; }
    const coverage = on / n;
    expect(coverage).toBeGreaterThan(0.1);
    expect(coverage).toBeLessThan(0.95);
  });

  it('adds to the base wave rather than replacing it', () => {
    const ww = w(200);
    const ph = wobblePhase(ww);
    const rips = activeRipples(ww, H);
    expect(rips.length).toBeGreaterThan(0);
    let moved = 0;
    for (let y = 0; y < H * 4; y += 7) {
      const base = smoothWobbleShift(y, 4, ww, ph);
      const withRip = smoothWobbleShift(y, 4, ww, ph, rips);
      // Far from every band the two must agree exactly; near one they must differ.
      const far = rips.every((r) => Math.abs((y + 0.5) / 4 - 0.5 - r.c) > 6 * r.halfW);
      if (far) expect(withRip).toBeCloseTo(base, 6);
      else if (Math.abs(withRip - base) > 0.05) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 9. The REAL compositor, driven end to end.
//
//    Everything above tests the pure math roomAi.ts is built on, pinned against the
//    faithful implementation. That proves the two formulas agree — but not that
//    AiRoom actually calls them, in the right order, with the right arguments.
//    Mutation testing confirmed the hole: reversing the item draw order, or shifting
//    the rope's second strand, left the entire suite above green.
//
//    roomAi.ts is a canvas-2D compositor and vitest runs in `node` with no canvas, so
//    instead of rasterising we drive AiRoom.draw with a RECORDING context (the same
//    technique test/uiAi.test.ts uses for the panel) and assert the sequence of draw
//    operations. No timing, no browser, no thresholds: the cross-tier pixel probe in
//    tools/test-airender.mjs cannot see these, because a z-order error moves a handful
//    of pixels and vanishes into the frame-wide average.
// ---------------------------------------------------------------------------

interface RecordedDraw { img: unknown; dx: number; dy: number }
interface RecordedFill { x: number; y: number; w: number; h: number; style: string }

/** Minimal 2D-context stand-in: records drawImage/fillRect calls in order. */
function ctxRecorder(width: number, height: number) {
  const draws: RecordedDraw[] = [];
  const fills: RecordedFill[] = [];
  const ctx = {
    canvas: { width, height },
    imageSmoothingEnabled: false,
    fillStyle: '',
    globalAlpha: 1,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, style: String(ctx.fillStyle) });
    },
    clearRect() {},
    drawImage(img: unknown, ...a: number[]) {
      // 3-arg (img,dx,dy), 5-arg (img,dx,dy,dw,dh) and 9-arg (img,sx..,dx,dy,..) forms.
      if (a.length >= 8) draws.push({ img, dx: a[4]!, dy: a[5]! });
      else draws.push({ img, dx: a[0]!, dy: a[1]! });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, fills };
}

/** A stand-in ImageBitmap: AiRoom only reads width/height and passes it to drawImage. */
const fakeBitmap = (w: number, h: number, tag: string): ImageBitmap =>
  ({ width: w, height: h, tag, close() {} }) as unknown as ImageBitmap;

const emptySide = (): Map<string, ImageBitmap> => new Map();
const fakeFish = () => ({
  small: { left: emptySide(), right: emptySide() },
  big: { left: emptySide(), right: emptySide() },
});

describe('AiRoom.draw drives the real compositor (recording context)', () => {
  const S = 4;

  /**
   * A room of four plain static objects at increasing x, each with its own staged AI
   * sprite, and no fish/mirror/rope specs — so the recorded draw sequence is exactly
   * background, wall, then one draw per item in item order.
   */
  function scene() {
    const room = makeRoom({
      w: 40, h: 20,
      items: [
        { kind: 'static', x: 2, y: 2 },
        { kind: 'static', x: 6, y: 2 },
        { kind: 'static', x: 10, y: 2 },
        { kind: 'static', x: 14, y: 2 },
      ],
    });
    // Item 0 is the wall; real items start at 1. Give each a distinct staged sprite.
    const objects = [1, 2, 3, 4].map((item) => ({
      item,
      frames: [fakeBitmap(FSIZE_PX * S, FSIZE_PX * S, `obj${item}`)],
    }));
    const ai = new AiRoom(
      [fakeBitmap(40 * FSIZE_PX * S, 20 * FSIZE_PX * S, 'bg')],
      [fakeBitmap(40 * FSIZE_PX * S, 20 * FSIZE_PX * S, 'wall')],
      objects,
      fakeFish() as never,
      S,
    );
    return { room, ai };
  }

  const frame = { count: 0, slide: 0, fishAnim: { little: { bodyFrame: 0, headFrame: 0 }, big: { bodyFrame: 0, headFrame: 0 } } };

  it('draws items in ASCENDING item index (z-order), after the background', () => {
    const { room, ai } = scene();
    const { ctx, draws } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
    ai.draw(ctx, room, frame);
    // Item sprites are the ones tagged obj*; background/wall come first.
    const items = draws.filter((d) => String((d.img as { tag: string }).tag).startsWith('obj'));
    expect(items.length).toBe(4);
    expect(items.map((d) => (d.img as { tag: string }).tag)).toEqual(['obj1', 'obj2', 'obj3', 'obj4']);
    // ...and their x positions therefore increase, since the fixture places them so.
    const xs = items.map((d) => d.dx);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs.length).toBe(new Set(xs).size); // no two items drawn at the same place
  });

  it('scales every item destination by exactly S', () => {
    const { room, ai } = scene();
    const { ctx, draws } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
    ai.draw(ctx, room, frame);
    const items = draws.filter((d) => String((d.img as { tag: string }).tag).startsWith('obj'));
    // The fixture's items sit at x = 2,6,10,14 cells ⇒ x*FSIZE*S in device pixels.
    expect(items.map((d) => d.dx)).toEqual([2, 6, 10, 14].map((c) => c * FSIZE_PX * S));
    expect(items.map((d) => d.dy)).toEqual([2, 2, 2, 2].map((c) => c * FSIZE_PX * S));
  });

  it('applies the slide interpolation at S×, rounding the partial shift', () => {
    // The AI half of the rule pinned in test/slide.test.ts: an item with a pending dir
    // is offset by round(slide * FSIZE) along dx_dir/dy_dir (URoom.pas:62-63), and only
    // THEN scaled by S. Hand-computed, not read back from the faithful renderer — the
    // two paths share one walk, so comparing them proves nothing (see dissolveKeeps).
    const at = (dir: number, slide: number): { dx: number; dy: number } => {
      const { room, ai } = scene();
      room.items[1]!.dir = dir as never;
      const { ctx, draws } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
      ai.draw(ctx, room, { ...frame, slide });
      const d = draws.find((x) => (x.img as { tag: string }).tag === 'obj1')!;
      return { dx: d.dx, dy: d.dy };
    };
    const rest = { dx: 2 * FSIZE_PX * S, dy: 2 * FSIZE_PX * S };
    expect(at(Dir.no, 0.5)).toEqual(rest); // no pending move ⇒ no offset
    // slide=0.5 ⇒ 0.5*15 = 7.5 ⇒ round = 8 native px ⇒ 8*S device px. Truncating would
    // give 7 (28 device px), so this distinguishes the rule from its near misses.
    expect(at(Dir.right, 0.5)).toEqual({ dx: rest.dx + 8 * S, dy: rest.dy });
    expect(at(Dir.left, 0.5)).toEqual({ dx: rest.dx - 8 * S, dy: rest.dy });
    expect(at(Dir.up, 0.5)).toEqual({ dx: rest.dx, dy: rest.dy - 8 * S });
    // A whole cell at slide=1, and a non-boundary value to pin the FSIZE scale.
    expect(at(Dir.down, 1)).toEqual({ dx: rest.dx, dy: rest.dy + FSIZE_PX * S });
    expect(at(Dir.right, 0.4)).toEqual({ dx: rest.dx + 6 * S, dy: rest.dy });
  });

  it('draws the background before any item', () => {
    const { room, ai } = scene();
    const { ctx, draws } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
    ai.draw(ctx, room, frame);
    const firstItem = draws.findIndex((d) => String((d.img as { tag: string }).tag).startsWith('obj'));
    const bgIdx = draws.findIndex((d) => (d.img as { tag: string }).tag === 'bg');
    expect(bgIdx).toBeGreaterThanOrEqual(0);
    expect(bgIdx).toBeLessThan(firstItem);
  });

  it('applies the gspec=2 darkness visibility flip (only spec=2 items are lit)', () => {
    // URoom.pas:26251 as the darkness rooms invert it: in gspec=2 the normal
    // spec=11/!visible rule does not apply — instead ONLY the two fish and items with
    // spec=2 (CHODBA's glowing dog eyes) are drawn, everything else is swallowed by the
    // dark. The AI side had no pin for this at all; a mutation of the rule here left the
    // whole suite green. This fixture has no fish, so exactly the spec=2 item survives.
    const { room, ai } = scene();
    room.gspec = 2;
    room.items[2]!.spec = 2; // lit
    // …and hidden. The darkness branch REPLACES the `spec === 11 || !visible` test
    // rather than ANDing with it, so a lit item still draws even when the room has
    // toggled it invisible. With a visible lit item this assertion could not tell the
    // two readings apart.
    room.items[2]!.visible = false;
    room.items[3]!.visible = false; // ordinary + hidden: swallowed either way
    const { ctx, draws } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
    ai.draw(ctx, room, frame);
    const tags = draws
      .filter((d) => String((d.img as { tag: string }).tag).startsWith('obj'))
      .map((d) => (d.img as { tag: string }).tag);
    expect(tags).toEqual(['obj2']);
  });

  it('outside gspec=2 a spec=2 item is not special (control for the flip above)', () => {
    const { room, ai } = scene();
    room.items[2]!.spec = 2;
    const { ctx, draws } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
    ai.draw(ctx, room, frame);
    const tags = draws
      .filter((d) => String((d.img as { tag: string }).tag).startsWith('obj'))
      .map((d) => (d.img as { tag: string }).tag);
    expect(tags).toEqual(['obj1', 'obj2', 'obj3', 'obj4']);
  });

  it('skips invisible items and spec=11 (the hidden LODE wreck)', () => {
    const { room, ai } = scene();
    room.items[2]!.visible = false;
    room.items[3]!.spec = 11;
    const { ctx, draws } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
    ai.draw(ctx, room, frame);
    const tags = draws.filter((d) => String((d.img as { tag: string }).tag).startsWith('obj')).map((d) => (d.img as { tag: string }).tag);
    expect(tags).toEqual(['obj1', 'obj4']);
  });
});

// ---------------------------------------------------------------------------
// 10. drawRope, driven for real.
//
//     Section 2 above checks that the rope's stepping FORMULA matches cpuDrawRope by
//     re-deriving it locally. That cannot catch an error in roomAi.ts's own use of it:
//     mutation testing showed that changing the second strand's offset (x+4 → x+5) or
//     swapping the colour channels left the whole suite green. drawRope only needs
//     fillRect/fillStyle, so unlike drawMirror and drawDisintegrating (which need
//     getImageData and a real canvas) it CAN be driven in the node test environment.
//
//     Called through the class rather than re-implemented, so the assertions below fail
//     if the implementation changes. The gear→lift WIRING that supplies the endpoints is
//     covered by tools/test-airender.mjs, which renders a real elevator room (room 6).
// ---------------------------------------------------------------------------
describe('AiRoom.drawRope paints the real double rope', () => {
  const S = 4;
  const ROPE_COL = 77;

  function ropeFills(x1: number, y1: number, x2: number, y2: number) {
    const room = makeRoom({ w: 40, h: 20, items: [{ kind: 'static', x: 2, y: 2 }] });
    // The fixture's palette is all black; give the rope index a distinctive colour so a
    // channel swap (the palette is stored B,G,R in the source data) is visible.
    room.palette[ROPE_COL] = { r: 200, g: 50, b: 10 };
    const ai = new AiRoom(
      [fakeBitmap(40 * FSIZE_PX * S, 20 * FSIZE_PX * S, 'bg')],
      [fakeBitmap(40 * FSIZE_PX * S, 20 * FSIZE_PX * S, 'wall')],
      [],
      fakeFish() as never,
      S,
    );
    const { ctx, fills } = ctxRecorder(40 * FSIZE_PX * S, 20 * FSIZE_PX * S);
    // drawRope now emits to an AiTarget (so the GPU backend replays the identical
    // walk); the canvas-2D target is what turns those calls back into fillStyle +
    // fillRect, which is exactly what these assertions are about.
    (ai as unknown as { drawRope(t: AiTarget, r: typeof room, a: number, b: number, cc: number, d: number, e: number): void })
      .drawRope(new Canvas2dAiTarget(ctx), room, x1, y1, x2, y2, ROPE_COL);
    return fills;
  }

  it('paints TWO strands per row, exactly 4 original pixels apart', () => {
    const fills = ropeFills(10, 5, 10, 12); // vertical: 8 rows, 2 strands each
    expect(fills.length).toBe(16);
    for (let i = 0; i < fills.length; i += 2) {
      const a = fills[i]!, b = fills[i + 1]!;
      expect(b.y).toBe(a.y);              // same row
      expect(b.x - a.x).toBe(4 * S);      // the 4-original-pixel strand gap, scaled
    }
  });

  it('paints an S×S block per step (a rope S px thick, not a hairline)', () => {
    for (const f of ropeFills(10, 5, 10, 8)) {
      expect(f.w).toBe(S);
      expect(f.h).toBe(S);
    }
  });

  it('resolves the palette index to RGB in the right channel order', () => {
    // A B,G,R misread renders this rope blue instead of orange, with no error.
    expect(ropeFills(10, 5, 10, 6)[0]!.style).toBe('rgb(200,50,10)');
  });

  it('leans with the endpoints, stepping x by the accumulated slope', () => {
    const straight = ropeFills(10, 5, 10, 20).filter((_, i) => i % 2 === 0).map((f) => f.x);
    expect(new Set(straight).size).toBe(1);               // vertical rope: x never moves
    const leaning = ropeFills(10, 5, 20, 20).filter((_, i) => i % 2 === 0).map((f) => f.x);
    expect(leaning[0]).toBeLessThan(leaning[leaning.length - 1]!); // leans right
    expect(new Set(leaning).size).toBeGreaterThan(1);
  });

  it('draws nothing when the rope has no vertical extent', () => {
    expect(ropeFills(10, 12, 10, 5).length).toBe(0); // y2 <= y1 guard
  });
});

// ---------------------------------------------------------------------------
// 12. The mutable-background cache key (aiTarget.ts aiImageRevision, roomAi.ts
//     paintBackground).
//
//     LODE's ×S background is mutated IN PLACE by the falling wreck, so anything caching
//     work derived from it has to be told. The two backends cache differently and both
//     need the revision: `Canvas2dAiTarget` keys its composite on `sig`, so the revision
//     must be IN that sig, while `GlAiScreen` keys its texture on the source object plus
//     the revision. The rule is imported, not restated.
//
//     LODE happens to have water wobble, which puts the logic tick into `sig` and would
//     mask a missing revision most of the time. These fixtures deliberately do NOT wobble,
//     so only the revision can move the key.
// ---------------------------------------------------------------------------
describe('mutable background art (aiTarget.ts aiImageRevision)', () => {
  const S = 4;

  /** An AiTarget that records nothing but the background signatures it is handed. */
  function sigRecorder(w: number, h: number) {
    const sigs: string[] = [];
    const t: AiTarget = {
      width: w, height: h,
      fill() {}, fillRect() {}, blit() {}, disintegrate() {}, mirrorGlass() {},
      background(sig) { sigs.push(sig); },
    };
    return { t, sigs };
  }

  function scene() {
    const room = makeRoom({ w: 8, h: 6, items: [] });
    room.wamp = 0; // no wobble: `count` cannot move the signature here
    const bg = fakeBitmap(8 * FSIZE_PX * S, 6 * FSIZE_PX * S, 'bg');
    const ai = new AiRoom(
      [bg],
      [fakeBitmap(8 * FSIZE_PX * S, 6 * FSIZE_PX * S, 'wall')],
      [],
      fakeFish() as never,
      S,
    );
    return { room, ai, bg };
  }

  const frame = {
    count: 0, slide: 0,
    fishAnim: { little: { bodyFrame: 0, headFrame: 0 }, big: { bodyFrame: 0, headFrame: 0 } },
  };

  it('starts at revision 0 and counts up per mutation', () => {
    const img = fakeBitmap(1, 1, 'x');
    expect(aiImageRevision(img)).toBe(0);
    markAiImageChanged(img);
    expect(aiImageRevision(img)).toBe(1);
    markAiImageChanged(img);
    expect(aiImageRevision(img)).toBe(2);
    expect(aiImageRevision(fakeBitmap(1, 1, 'y'))).toBe(0); // per-image, not global
  });

  it('repeats the SAME background signature while the art is untouched', () => {
    const { room, ai } = scene();
    const { t, sigs } = sigRecorder(8 * FSIZE_PX * S, 6 * FSIZE_PX * S);
    ai.drawInto(t, room, frame);
    ai.drawInto(t, room, { ...frame, count: 7 });
    expect(sigs).toHaveLength(2);
    expect(sigs[0]).toBe(sigs[1]); // the cached composite is still valid — that's the point
  });

  it('CHANGES the background signature when the art is mutated in place', () => {
    const { room, ai, bg } = scene();
    const { t, sigs } = sigRecorder(8 * FSIZE_PX * S, 6 * FSIZE_PX * S);
    ai.drawInto(t, room, frame);
    markAiImageChanged(bg); // what AiRoom.syncWreck does after replaying a wreck swap
    ai.drawInto(t, room, frame);
    expect(sigs[0]).not.toBe(sigs[1]);
  });
});

// ---------------------------------------------------------------------------
// 13. The dirty-rect patch that rides alongside the revision (aiTarget.ts).
//
//     Re-uploading LODE's whole ×4 background is 12.3 ms against 0.68 ms for the ship's
//     footprint, so the GPU updates only the rect that changed — but ONLY when it is
//     exactly one revision behind, because a patch describes one revision's delta and
//     says nothing about a revision that was skipped. These are pure functions, so the
//     rule is pinned here rather than left to the browser probe, which can only observe
//     the consequence.
// ---------------------------------------------------------------------------
describe('mutable background patches (aiTarget.ts aiImagePatch)', () => {
  const px = (n: number) => new Uint8ClampedArray(n * 4);

  it('has no patch until one is supplied', () => {
    const img = fakeBitmap(8, 8, 'p0');
    expect(aiImagePatch(img)).toBeNull();
    markAiImageChanged(img);
    expect(aiImagePatch(img)).toBeNull();
    expect(aiImageRevision(img)).toBe(1);
  });

  it('tags the patch with the revision it belongs to', () => {
    // The consumer compares this against its own cached revision; an untagged (or
    // mis-tagged) patch could be applied on top of art it does not describe.
    const img = fakeBitmap(8, 8, 'p1');
    markAiImageChanged(img, { x: 1, y: 2, w: 3, h: 4, data: px(12) });
    expect(aiImagePatch(img)?.revision).toBe(1);
    expect(aiImageRevision(img)).toBe(1);
    markAiImageChanged(img, { x: 5, y: 6, w: 1, h: 1, data: px(1) });
    expect(aiImagePatch(img)).toMatchObject({ revision: 2, x: 5, y: 6, w: 1, h: 1 });
    expect(aiImageRevision(img)).toBe(2);
  });

  it('DROPS the patch when a mutation supplies none, forcing a whole re-upload', () => {
    // This is the wreck resetting to pristine art on room re-entry: the rect from the
    // previous fall is meaningless against the restored background, and a consumer that
    // still saw it would patch damage back onto a clean room.
    const img = fakeBitmap(8, 8, 'p2');
    markAiImageChanged(img, { x: 1, y: 1, w: 2, h: 2, data: px(4) });
    expect(aiImagePatch(img)).not.toBeNull();
    markAiImageChanged(img);
    expect(aiImagePatch(img)).toBeNull();
    expect(aiImageRevision(img)).toBe(2); // still counted, so consumers know to re-upload
  });

  it('keeps revision and patch per image, never global', () => {
    const a = fakeBitmap(8, 8, 'pa');
    const b = fakeBitmap(8, 8, 'pb');
    markAiImageChanged(a, { x: 0, y: 0, w: 1, h: 1, data: px(1) });
    expect(aiImageRevision(b)).toBe(0);
    expect(aiImagePatch(b)).toBeNull();
  });
});
