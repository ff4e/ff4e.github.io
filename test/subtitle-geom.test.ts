/**
 * The vector-subtitle geometry (src/render/subtitleGeom.ts).
 *
 * `subtitleDom` measures from this module to place real text, so these are the rules that
 * decide where a subtitle actually appears. They used to exist twice, once per renderer,
 * which is how the two drifted: the DOM path had no 8px floor on the fit and started its
 * wave one step early. The canvas renderer is gone, but the rules stay pinned here at
 * milliseconds a test rather than in a ~10 s probe — which is the reason the module is pure
 * and import-free.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  BORDERTITLE,
  SUB_FONT_PX,
  SUB_SCALE,
  UNDERTITLE,
  VECTOR_GEOM,
  WAVE_LEN,
  WAVE_PER_TICK,
  bevelBottomRgb,
  bevelSpan,
  SUB_MAX_PX,
  SUB_MIN_PX,
  clampTextScale,
  fitBlockFontPx,
  fitFontPx,
  fitScreenW,
  lineAnchor,
  lineOffset,
  setSubPxBand,
  strokeWidth,
  subtitleScale,
  waveDy,
  wavePhase,
} from '../src/render/subtitleGeom.js';

const SCREEN_W = 780; // a wide room
const maxW = SCREEN_W - BORDERTITLE * 2;

describe('fitFontPx — shrink a long line to the room, never wrap it', () => {
  it('leaves a line that fits at the full size', () => {
    expect(fitFontPx(maxW - 1, SCREEN_W)).toBe(SUB_FONT_PX);
    expect(fitFontPx(1, SCREEN_W)).toBe(SUB_FONT_PX);
  });

  // Exactly at the limit is not "too wide" — the condition is `>`, and a
  // line that fits to the pixel must not be shrunk by a rounding hair.
  it('does not shrink a line that fits exactly', () => {
    expect(fitFontPx(maxW, SCREEN_W)).toBe(SUB_FONT_PX);
  });

  it('scales the font by exactly the overflow ratio', () => {
    // Twice the budget -> half the size.
    expect(fitFontPx(maxW * 2, SCREEN_W)).toBeCloseTo(SUB_FONT_PX / 2, 10);
    expect(fitFontPx(maxW * 1.25, SCREEN_W)).toBeCloseTo(SUB_FONT_PX / 1.25, 10);
  });

  // The floor comes from the original vector path. Without it a pathological line collapses to something
  // unreadable, and shrinking past 8px would not make it fit anyway.
  it('never goes below the 8px floor', () => {
    expect(fitFontPx(maxW * 1000, SCREEN_W)).toBe(8);
  });

  // A measurement of 0 means the caller could not measure. It cannot exceed a positive
  // budget, so it keeps the full size rather than dividing by it — asserted because the
  // alternative (a divide reaching the font size) would be silent and awful.
  it('treats an unmeasurable line as fitting', () => {
    expect(fitFontPx(0, SCREEN_W)).toBe(SUB_FONT_PX);
    expect(fitFontPx(-1, SCREEN_W)).toBe(SUB_FONT_PX);
  });

  it('uses a narrower budget in a narrower room', () => {
    const narrow = 435;
    const wide = fitFontPx(500, 780);
    const tight = fitFontPx(500, narrow);
    expect(tight).toBeLessThan(wide);
    expect(tight).toBeCloseTo((SUB_FONT_PX * (narrow - BORDERTITLE * 2)) / 500, 10);
  });
});

describe('fitBlockFontPx — one size for a whole message, not one per row', () => {
  // The reported case (KUFRIK, ai tier): "Nyní začínáme znovu - můžeme však nahrát
  // uloženou pozici" / "klávesou F3.". The wrap is faithful (it uses the ORIGINAL
  // BITMAP font's metrics, NovyTitulek URoom.pas:592) but the vector face draws 20%
  // larger, so the first row still overflows and the short remainder does not. Fitted
  // per row that is two visibly different sizes in one spoken sentence.
  const longRow = maxW * 1.18;
  const shortRow = maxW * 0.2;

  it('gives every row of a message the size of its widest row', () => {
    const block = fitBlockFontPx([longRow, shortRow], SCREEN_W);
    expect(block).toBeCloseTo(fitFontPx(longRow, SCREEN_W), 10);
    expect(block).toBeLessThan(fitFontPx(shortRow, SCREEN_W)); // …which the short row alone would not have got
  });

  it('leaves a message whose rows all fit at the full size', () => {
    expect(fitBlockFontPx([shortRow, shortRow], SCREEN_W)).toBe(SUB_FONT_PX);
  });

  it('is the plain fit for a message that did not wrap', () => {
    expect(fitBlockFontPx([longRow], SCREEN_W)).toBeCloseTo(fitFontPx(longRow, SCREEN_W), 10);
    expect(fitBlockFontPx([shortRow], SCREEN_W)).toBe(SUB_FONT_PX);
  });

  // Order must not matter: the rows arrive in reading order, and the widest one is as
  // likely to be the last as the first.
  it('does not depend on the order the rows are measured in', () => {
    expect(fitBlockFontPx([shortRow, longRow], SCREEN_W)).toBeCloseTo(
      fitBlockFontPx([longRow, shortRow], SCREEN_W),
      10,
    );
  });

  it('keeps the 8px floor, and treats no rows at all as fitting', () => {
    expect(fitBlockFontPx([maxW * 1000, shortRow], SCREEN_W)).toBe(8);
    expect(fitBlockFontPx([], SCREEN_W)).toBe(SUB_FONT_PX);
  });
});

describe('wavePhase — which glyphs have started', () => {
  // PisStringF counts characters from 1 (p = cas*5 - index), so glyph 0 starts one step
  // in. Getting this off by one is what makes a line appear a frame early or late.
  it('is cas*5 - (index + 1)', () => {
    expect(wavePhase(0, 0)).toBe(-1);
    expect(wavePhase(1, 0)).toBe(WAVE_PER_TICK - 1);
    expect(wavePhase(2, 3)).toBe(2 * WAVE_PER_TICK - 4);
  });

  it('is negative for a glyph that has not started, which is what hides it', () => {
    expect(wavePhase(0, 5)).toBeLessThan(0);
    expect(wavePhase(0.1, 0)).toBeLessThan(0);
    // ...and reaches exactly 0 the moment the first glyph is due, a fifth of a tick in.
    expect(wavePhase(1 / WAVE_PER_TICK, 0)).toBe(0);
  });

  it('advances WAVE_PER_TICK per logic tick', () => {
    expect(wavePhase(3, 0) - wavePhase(2, 0)).toBe(WAVE_PER_TICK);
  });

  it('staggers the glyphs by one step each, which is the letter-by-letter reveal', () => {
    expect(wavePhase(10, 0) - wavePhase(10, 1)).toBe(1);
  });
});

describe('waveDy — the damped cosine a glyph rides in on', () => {
  it('starts at the full amplitude', () => {
    expect(waveDy(0, 100)).toBeCloseTo(100, 10);
  });

  it('is exactly zero once the wave is over, so a settled line sits on its baseline', () => {
    expect(waveDy(WAVE_LEN, 100)).toBe(0);
    expect(waveDy(WAVE_LEN + 1, 100)).toBe(0);
    expect(waveDy(1e6, 100)).toBe(0);
  });

  it('decays as it goes: the envelope shrinks toward the end', () => {
    const at = (p: number) => Math.abs(waveDy(p, 100));
    expect(at(45)).toBeLessThan(at(5));
  });

  it('crosses the baseline — it is a cosine, not a slide', () => {
    const sampled = [];
    for (let p = 0; p < WAVE_LEN; p += 0.5) sampled.push(waveDy(p, 100));
    expect(sampled.some((v) => v > 0)).toBe(true);
    expect(sampled.some((v) => v < 0)).toBe(true);
  });

  it('scales linearly with the amplitude', () => {
    expect(waveDy(7, 200)).toBeCloseTo(waveDy(7, 100) * 2, 10);
  });

  it('is flat when there is no amplitude left to travel', () => {
    expect(waveDy(3, 0)).toBe(0);
  });
});

describe('lineAnchor — where a line sits and how far its wave swings', () => {
  const screenH = 225;

  // Pinned to LITERALS, not rebuilt from the same constants the function uses: an
  // expectation assembled from SUB_SCALE and baselineOff would follow any change to
  // them and assert nothing. These are the numbers a player sees.
  //   baseline = -26*1.2 + 225 + (-6*1.2) = 225 - 31.2 - 7.2 = 186.6
  //   amp      = 15*1.2 - (-26*1.2)       = 18 + 31.2        = 49.2
  it('places the first row 186.6px down a 225px screen', () => {
    expect(lineAnchor(-26, screenH).baseline).toBeCloseTo(186.6, 10);
  });

  it('gives that row a 49.2px wave, measured from UNDERTITLE below it', () => {
    expect(lineAnchor(-26, screenH).amp).toBeCloseTo(49.2, 10);
  });

  // A line resting AT the wave's origin has nowhere to travel; anything above it does.
  it('gives a line further up the screen a longer travel', () => {
    expect(lineAnchor(-100, screenH).amp).toBeGreaterThan(lineAnchor(-26, screenH).amp);
  });

  it('moves the baseline down with a taller screen, since ys is measured from the bottom', () => {
    expect(lineAnchor(-26, 400).baseline - lineAnchor(-26, 225).baseline).toBeCloseTo(175, 10);
  });
});

describe('subtitleScale — constant on screen, but never too big for the room', () => {
  const stageScale = 1.655; // a 1600x1000 viewport

  // The graded modes (and the shipped default) never draw a room smaller than the stage,
  // so the cap does nothing and the text is the same size in every room. That is the
  // whole point.
  it('takes the stage scale when the room is drawn at least that big', () => {
    expect(subtitleScale(stageScale, 1.665)).toBeCloseTo(stageScale, 10); // the least-zoomed room
    expect(subtitleScale(stageScale, 2.234)).toBeCloseTo(stageScale, 10); // the most-zoomed
    expect(subtitleScale(stageScale, stageScale)).toBeCloseTo(stageScale, 10); // 'fixed'
  });

  // 'x1' at dpr 2 draws every room at 0.5 while the stage sits at 1.655. Uncapped, the
  // text is over three times too big for the room and fitFontPx shrinks nearly every line
  // by whatever that room's width and that sentence's length demand — text that varies
  // per room and per line, which is the symptom, not the fix. Reported from 'x1'.
  it('falls back to the room when the room is drawn smaller than the stage', () => {
    expect(subtitleScale(stageScale, 0.5)).toBe(0.5);
    expect(subtitleScale(stageScale, 1)).toBe(1);
  });

  // 'native' spans 1.5..3.5 on that viewport: the low end is capped to the room, the high
  // end to the stage. Neither is ever bigger than the room can carry.
  it('never returns more than the room scale', () => {
    for (const box of [0.5, 1, 1.5, 2, 3.5]) {
      expect(subtitleScale(stageScale, box)).toBeLessThanOrEqual(box);
    }
  });

  // The elastic stage box (app/layout.ts) means the ROOM's scale now moves with the
  // viewport WIDTH even though stageScale does not — so subtitle size is not invariant
  // here, contrary to what the elastic-box change first claimed. This pins the actual
  // rule, in both directions, so the claim cannot be quietly re-asserted:
  //   - graded modes: the room is never drawn smaller than the stage, so the min still
  //     returns stageScale and a wider box cannot move the text at all;
  //   - crisp-integer modes: a wider box raises the room's scale, and the text rises
  //     WITH it, toward — never past — the constant stage size.
  it('a wider stage box moves the text only where the room is drawn below the stage', () => {
    // graded: untouched whatever the box does to the room.
    expect(subtitleScale(stageScale, 1.738)).toBeCloseTo(stageScale, 10);
    expect(subtitleScale(stageScale, 2.211)).toBeCloseTo(stageScale, 10);
    // crisp: measured at 2048x1017 in 'native', room 07, box 800 -> 1017 native.
    const before = subtitleScale(stageScale, 1); // room drawn at 1x
    const after = subtitleScale(stageScale, 2); // the wider box lets it reach 2x
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(stageScale); // never past the constant stage size
  });
});

describe('clampTextScale — hold the font in a readable band', () => {
  const NO_CAP = Infinity; // a room big enough that the floor is free to act
  const px = (textScale, maxScale = NO_CAP) => clampTextScale(textScale, maxScale) * SUB_FONT_PX;

  it('pulls an oversized line down to the ceiling', () => {
    expect(px(3.4)).toBeCloseTo(SUB_MAX_PX, 10); // an unscaled 4K desktop
  });

  it('lifts an undersized line up to the floor', () => {
    expect(px(0.3)).toBeCloseTo(SUB_MIN_PX, 10); // a small window
  });

  // The common case has to be left alone, or this is not a clamp but a resize.
  it('leaves a size already inside the band exactly as it was', () => {
    const inBand = (SUB_MIN_PX + SUB_MAX_PX) / 2 / SUB_FONT_PX;
    expect(clampTextScale(inBand, NO_CAP)).toBe(inBand);
  });

  // The floor may not lift the text past the room. `subtitleScale` holds it at the room
  // scale in the crisp-integer modes precisely so it stays ONE size; text bigger than the
  // room is then cut back by fitFontPx to whatever each room and each line allow, which
  // is the per-room variation that cap removes. Measured at 'x1' on a large retina
  // window, a floor that ignored the room gave the same line 26.0px in one room and
  // 14.0px in another.
  it('does not lift the text past what the room can carry', () => {
    const room = 0.5; // 'x1' at dpr 2
    expect(clampTextScale(room, room)).toBe(room);
    expect(px(room, room)).toBeCloseTo(SUB_FONT_PX * room, 10);
    expect(px(room, room)).toBeLessThan(SUB_MIN_PX); // …and so lands BELOW the floor, deliberately
  });

  // The ceiling has no such caveat: a smaller line always fits, so the room never limits
  // it. Asserted because capping the floor at the room must not accidentally cap this.
  it('still applies the ceiling in a room smaller than the text wants to be', () => {
    expect(px(3.4, 1.2)).toBeCloseTo(SUB_MAX_PX, 10);
  });

  // The band sizes the FAITHFUL font; the ai tier draws a fraction of that with a
  // container transform. The first version of this clamped the RENDERED size, which put
  // both tiers into one band and collapsed aiSubScale — test-aisubs read 1.00 where it
  // must read 0.75. The assertion that catches that is the ai line sitting BELOW the
  // ceiling when the faithful line is on it; a bare ratio of x*0.75 to x cannot, since
  // that is 0.75 for any x at all.
  it('leaves the ai tier its own smaller size, below the band', () => {
    const AI = 0.75;
    const faithful = px(3.4); // pinned to the ceiling
    expect(faithful).toBeCloseTo(SUB_MAX_PX, 10);
    expect(faithful * AI).toBeCloseTo(SUB_MAX_PX * AI, 10);
    expect(faithful * AI).toBeLessThan(SUB_MAX_PX - 1); // the old clamp-past-the-tier made this 40 too
  });

  // A room scale that cannot be read must not become a cap of zero and size every line
  // off the screen.
  it('treats an unusable room scale as no cap rather than a cap of nothing', () => {
    expect(px(1.2, 0)).toBeCloseTo(SUB_FONT_PX * 1.2, 10);
    expect(px(0.3, -1)).toBeCloseTo(SUB_MIN_PX, 10);
  });
});

describe('setSubPxBand — the band is tunable, but not into nonsense', () => {
  const before = [SUB_MIN_PX, SUB_MAX_PX];
  afterEach(() => setSubPxBand(before[0], before[1]));

  it('takes a sane band', () => {
    setSubPxBand(20, 30);
    expect([SUB_MIN_PX, SUB_MAX_PX]).toEqual([20, 30]);
  });

  it('refuses a reversed or non-positive band, leaving the old one', () => {
    setSubPxBand(40, 20);
    expect([SUB_MIN_PX, SUB_MAX_PX]).toEqual(before);
    setSubPxBand(0, 30);
    expect([SUB_MIN_PX, SUB_MAX_PX]).toEqual(before);
  });
});

describe('lineOffset and fitScreenW — text drawn at a different scale from the room', () => {
  // The port zooms rooms to fit and the subtitle deliberately does not follow (the room's
  // fit factor spans 1.006-1.35 over the 71 real rooms in the default mode, which is the
  // reported symptom). That splits the old single multiplication in two, and this is the
  // identity that says the split is exact.
  it('lineOffset is lineAnchor.baseline with the box height taken out of it', () => {
    for (const ys of [-130, -26, 0, 15]) {
      for (const h of [210, 225, 585]) {
        expect(h + lineOffset(ys)).toBeCloseTo(lineAnchor(ys, h).baseline, 10);
      }
    }
  });

  it('is negative for the rows on screen, which sit above the bottom edge', () => {
    expect(lineOffset(-26)).toBeCloseTo(-38.4, 10); // -26*1.2 - 7.2
    expect(lineOffset(-130)).toBeLessThan(lineOffset(-26)); // …and more so the further up it has scrolled
  });

  // The fit budget is in the TEXT's units, so a room physically wider than those units
  // say has to widen it — otherwise a long line is shrunk while it still has room, and
  // most in exactly the small rooms the zoom enlarges most.
  it('widens the fit budget by however much the room outscales the text', () => {
    expect(fitScreenW(600, 1.35, 1)).toBeCloseTo(810, 10);
    expect(fitScreenW(600, 2.7, 2)).toBeCloseTo(810, 10);
  });

  it('changes nothing when the text and the room share a scale', () => {
    expect(fitScreenW(600, 1, 1)).toBe(600);
    expect(fitScreenW(600, 2.5, 2.5)).toBeCloseTo(600, 10);
  });

  // An unmeasurable scale must not divide the budget to Infinity and hand every line the
  // full size regardless of width.
  it('falls back to the plain room width on a nonsense text scale', () => {
    expect(fitScreenW(600, 1.35, 0)).toBe(600);
    expect(fitScreenW(600, 1.35, -1)).toBe(600);
  });
});

describe('strokeWidth and bevelSpan — the glyph decoration', () => {
  it('the outline is 16% of the font size (the original strokeText width)', () => {
    expect(strokeWidth(30)).toBeCloseTo(4.8, 10);
  });

  // Anchored to the glyph's OWN baseline, not to the line box: spreading the ramp over a
  // CSS line box instead is what made the DOM text look washed out.
  it('the bevel ramps across the cap height, above the baseline and a little below', () => {
    const s = bevelSpan(30);
    expect(s.top).toBeCloseTo(-21.6, 10);
    expect(s.bottom).toBeCloseTo(3, 10);
    expect(s.top).toBeLessThan(0);
    expect(s.bottom).toBeGreaterThan(0);
  });

  it('both scale with the font, so a shrunk line keeps its proportions', () => {
    expect(strokeWidth(15) * 2).toBeCloseTo(strokeWidth(30), 10);
    expect(bevelSpan(15).top * 2).toBeCloseTo(bevelSpan(30).top, 10);
  });

  it('the bevel darkens to 42% of the speaker colour, rounded', () => {
    expect(bevelBottomRgb(255, 150, 0)).toEqual([107, 63, 0]);
    expect(bevelBottomRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });
});

describe('the constants the renderer and the tick logic both place text from', () => {
  // Absolute, because everything else in this file is relative to them. Without this the
  // whole suite would follow a change to SUB_SCALE and still pass, which is how a
  // subtitle silently ends up the wrong size.
  it('are the values the geometry is tuned to', () => {
    expect(SUB_SCALE).toBe(1.2);
    expect(SUB_FONT_PX).toBeCloseTo(27.6, 10);
    expect(VECTOR_GEOM.baselineOff).toBeCloseTo(-7.2, 10);
    expect(BORDERTITLE).toBe(20);
    expect(UNDERTITLE).toBe(15);
    expect(WAVE_LEN).toBe(50);
    expect(WAVE_PER_TICK).toBe(5);
  });

  it('are frozen, so one renderer cannot reach in and retune the other', () => {
    expect(Object.isFrozen(VECTOR_GEOM)).toBe(true);
  });
});
