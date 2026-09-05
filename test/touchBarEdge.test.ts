/**
 * The touch bar's landscape edge (`src/app/touchBarEdge.ts`).
 *
 * The rule is "lay the room out both ways and keep whichever shows more of it", so these
 * tests are about the three things that rule has to get right and nothing else: that a
 * width-bound room prefers the top, that a height-bound one prefers the left, and that a
 * room the top edge would CLIP is not chosen for the top just because it is drawn larger
 * there. The scaling arithmetic itself is `layout.test.ts`'s job — this file must not
 * re-test it.
 *
 * The sizes are real: 780x225 UTES and 555x225 ZRC are the two widest rooms, 795x585
 * PUCLIK the largest, 315x555 VRAK the tallest, and the viewports come from Playwright's
 * device registry (`tools/measure-touchbar-edge.mjs`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeStageLayout, contentScale } from '../src/app/layout.js';
import {
  preferredTouchBarEdge,
  visibleRoomArea,
  TOUCHBAR_H,
  TOUCHBAR_LEAD,
  TOUCHBAR_W,
  touchBarLeftW,
} from '../src/app/touchBarEdge.js';

/** iPhone 15 in landscape, as Playwright reports it (browser chrome already off). */
const PHONE: [number, number] = [734, 343];
/** Galaxy Tab S9 in landscape, minus Chrome's toolbar + tab strip. */
const TABLET: [number, number] = [1024, 568];
/** iPad (gen 11) in landscape, minus the same chrome — squarer than the Android tablets. */
const IPAD: [number, number] = [944, 584];
/** Galaxy Z Fold 7 opened, in landscape — near square, minus the same chrome. */
const FOLD: [number, number] = [1040, 860];

const edge = (w: number, h: number, [vw, vh]: [number, number]) =>
  preferredTouchBarEdge(w, h, vw, vh, 'fill');

describe('preferredTouchBarEdge', () => {
  it('puts the bar on top for a room far wider than the viewport', () => {
    // UTES, 3.47:1 against the phone's 2.14:1 — width-bound, so the 72px left bar comes
    // off the axis that decides its scale and the 66px top bar comes off the one with
    // slack. Measured +11% on this viewport.
    expect(edge(780, 225, PHONE)).toBe('top');
  });

  it('leaves the bar on the left for an ordinary room on a phone', () => {
    // PUCLIK 1.36:1 and KOSTE 540x495 are both flatter than the viewport, so they are
    // height-bound and the top bar takes from the axis they need.
    expect(edge(795, 585, PHONE)).toBe('left');
    expect(edge(540, 495, PHONE)).toBe('left');
  });

  it('leaves the tallest room on the left', () => {
    expect(edge(315, 555, PHONE)).toBe('left');
  });

  it('is decided against the VIEWPORT, so one room can answer both ways', () => {
    // DRAKAR 795x435 is 1.83:1. Below the phone's 2.14 (height-bound -> left), above the
    // iPad's 1.62 (width-bound -> top, by +18%). "Wide" is never absolute.
    expect(edge(795, 435, PHONE)).toBe('left');
    expect(edge(795, 435, IPAD)).toBe('top');
    // And a viewport sitting AT the room's own aspect is the crossover: on the 1.80:1
    // tablet the two edges are within 2.5% and the left one wins.
    expect(edge(795, 435, TABLET)).toBe('left');
  });

  it('puts most rooms on top on a near-square foldable', () => {
    // 1.21:1 leaves almost nothing to choose between the two axes, so the top wins
    // broadly rather than only for the extreme rooms.
    expect(edge(795, 585, FOLD)).toBe('top');
    expect(edge(780, 225, FOLD)).toBe('top');
  });

  it('never moves the bar onto an edge that would clip the room', () => {
    // A 320px-tall landscape phone: with 66px gone the floor (MIN_STAGE_SCALE) is allowed
    // to overflow the height, so the room is CUT rather than shrunk. Comparing VISIBLE
    // area is what catches that — a scale comparison alone would move the bar here.
    const short: [number, number] = [740, 320];
    for (const [w, h] of [
      [795, 585],
      [720, 555],
      [600, 450],
    ] as const) {
      const drawnOnTop = visibleRoomArea(w, h, short[0], short[1] - TOUCHBAR_H, 'fill');
      expect(drawnOnTop).toBeLessThanOrEqual(short[0] * (short[1] - TOUCHBAR_H));
      expect(edge(w, h, short)).toBe('left');
    }
  });

  it('no longer has a cut room to prefer against (669x280, Martin 2026-08-31)', () => {
    // This case is why the whole-room test exists. ZRC 555x225 at 669x280: the top edge
    // left 214px of height, `MIN_STAGE_SCALE`'s floor overflowed it, and the room was drawn
    // 266px tall — 52px of the level not on screen. It still won on visible area (140,598
    // against 138,740) because the surviving part was bigger than the whole room is on the
    // other edge, so a plain area comparison moved the bar onto the layout that hid part of
    // the puzzle.
    //
    // `layout.ts`'s rework removed the class: `contentScale` is bounded by the area, so
    // NEITHER edge cuts anything here any more, and the plain area comparison now gets the
    // same answer the whole-room test used to have to rescue. Both halves are asserted —
    // that nothing is cut, and that the rule still says 'left'.
    const short: [number, number] = [669, 280];
    const onTop = visibleRoomArea(555, 225, short[0], short[1] - TOUCHBAR_H, 'fill');
    const onLeft = visibleRoomArea(555, 225, short[0] - touchBarLeftW(), short[1], 'fill');
    expect(onTop).toBeLessThan(onLeft); // area alone now says 'left' on its own
    expect(edge(555, 225, short)).toBe('left');
    // And it says it because the room FITS both ways, not because one was rejected.
    //
    // That has to be asserted against the DRAWN size, not against `visibleRoomArea` —
    // `roomOn` clamps its result to the area it was given, so `visible <= availW * availH`
    // is true by construction and an assertion in those terms cannot fail for any input in
    // any version of `layout.ts`. Re-deriving the scale here is the only way to see what the
    // room would have been drawn at BEFORE the clamp, which is the quantity that used to be
    // 266px into 214px of space.
    for (const [availW, availH] of [
      [short[0], short[1] - TOUCHBAR_H], // the top edge — the one that used to cut
      [short[0] - touchBarLeftW(), short[1]],
    ] as const) {
      const l = computeStageLayout(availW, availH, 'fill', false);
      const s = contentScale(555, 225, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
      expect(s * 555).toBeLessThanOrEqual(availW + 1e-6);
      expect(s * 225).toBeLessThanOrEqual(availH + 1e-6);
    }
  });

  it('ignores an overflow smaller than one pixel of the artwork', () => {
    // BATYSKAF 690x300 at 653x344: the top edge overflows by 0.7 CSS px, which at the scale
    // it is drawn works out at two thirds of ONE game pixel — nothing of the room is
    // hidden, because there is no such thing as half a pixel of wall. Measuring the
    // threshold in CSS px instead made this a "cut" room and cost 27% of the room's area to
    // avoid it. (Found by review, 2026-08-31.)
    expect(edge(690, 300, [653, 344])).toBe('top');
  });

  it('still takes the bigger room when NEITHER edge cuts it', () => {
    // Same viewport, UTES 780x225: short enough that it fits either way, so nothing
    // outranks the area and the top edge's +26% wins. Guards the fix above against being
    // over-applied into "never use the top edge on a short viewport".
    expect(edge(780, 225, [669, 280])).toBe('top');
  });

  it('falls back to hiding less when BOTH edges cut the room', () => {
    // KOSTE 540x495 and DRAKAR 795x435 at 669x280 are cut whatever the bar does — the
    // floor overflows the height on both. With no whole room to prefer, the comparison is
    // which one hides less, and the left edge cuts 20px against the top edge's 86px.
    expect(edge(540, 495, [669, 280])).toBe('left');
    expect(edge(795, 435, [669, 280])).toBe('left');
  });

  it('breaks a tie towards the top', () => {
    // Nothing to choose between the edges means the room does not care, and the top is the
    // preferred look — so the comparison is `>=`, not `>`. A degenerate room makes both
    // areas exactly 0, which is the only tie that can be constructed exactly.
    expect(preferredTouchBarEdge(0, 0, 800, 400, 'fill')).toBe('top');
  });

  /**
   * And the housing, which is the reason the last two parameters exist at all.
   *
   * Every other test in this file — and every tool that models the layout offline — calls
   * through `edge()`, which passes no insets, so all of them price a device with no cutout
   * on a viewport that has already had a browser's chrome taken off it. The app is the only
   * caller that supplies the real numbers (`touchButtons.ts`), and the effect they have is
   * the whole justification for the left bar's rework: at a 62px housing the left edge
   * costs 58 + 62 = 120px of the room's width instead of 58 + 14 = 72, and 48px is more
   * than enough to change which edge shows more of the room.
   *
   * These are real rooms at real full-bleed sizes, not constructed ones. `PHONE` and the
   * rest above are Playwright's browser viewports; an iPhone 17 Pro in landscape gives the
   * app the whole 852x393 and puts 47-68px of housing (model-dependent) on whichever side
   * is up. `insetTop` stays 0 because in landscape the cutout is never on the top edge.
   */
  const edgeAt = (w: number, h: number, [vw, vh]: [number, number], inset: number) =>
    preferredTouchBarEdge(w, h, vw, vh, 'fill', 1, 0, Math.max(inset, TOUCHBAR_LEAD));

  it('moves the bar off the left edge when the housing makes it too expensive', () => {
    const NATIVE: [number, number] = [852, 393]; // iPhone 17 Pro / 14 Pro, landscape, full-bleed.
    // BATYSKAF is the clearest case: it prefers the left on a screen with no housing, and
    // every housing this app will ever meet is enough to turn that round.
    expect(edgeAt(690, 300, NATIVE, 0)).toBe('left');
    for (const inset of [47, 62, 68]) expect(edgeAt(690, 300, NATIVE, inset), `${inset}`).toBe('top');
    // VITEJTE1 needs a bigger one, which is the point — the answer tracks the number, it is
    // not simply "any inset means top".
    expect(edgeAt(750, 345, NATIVE, 0)).toBe('left');
    expect(edgeAt(750, 345, NATIVE, 47)).toBe('left');
    expect(edgeAt(750, 345, NATIVE, 62)).toBe('top');
  });

  it('leaves the answer alone on a screen with no housing', () => {
    // The other half of the claim, and the one that protects the web: `clearLeft` defaults
    // to the lead, so a browser gets exactly the decisions it always got. If this ever
    // fails, a change meant for the phone has reached the website.
    for (const [w, h] of [
      [690, 300],
      [750, 345],
      [780, 225],
      [795, 435],
      [540, 495],
    ] as const) {
      expect(edgeAt(w, h, PHONE, 0), `${w}x${h}`).toBe(edge(w, h, PHONE));
    }
  });
});

describe('visibleRoomArea', () => {
  it('never reports more than the area it was given', () => {
    for (const [vw, vh] of [PHONE, TABLET, FOLD, [400, 260] as [number, number]]) {
      expect(visibleRoomArea(795, 585, vw, vh, 'fill')).toBeLessThanOrEqual(vw * vh);
    }
  });

  it('is zero for a degenerate room or area', () => {
    expect(visibleRoomArea(0, 585, 800, 400, 'fill')).toBe(0);
    expect(visibleRoomArea(795, 585, 0, 400, 'fill')).toBe(0);
    expect(visibleRoomArea(795, 585, 800, -1, 'fill')).toBe(0);
  });
});

/**
 * The bar's footprint is stated twice — as CSS in `index.html`, which places the bar, and
 * as `TOUCHBAR_W`/`TOUCHBAR_H` here, which PRICE the two placements before either is
 * applied. They have to agree, and nothing else in the suite can notice if they stop:
 * `tools/test-touchbar.mjs` pins the rendered margins against string literals, so it
 * catches a CSS change but not a change to the constants, and `verify-touchbar-edge.mjs`
 * (which would catch both) needs a browser and is not part of the suite.
 *
 * So this reads the stylesheet. Every px length inside the landscape branch has to BE the
 * bar's size on that branch's axis — the width rule, the stage margin, and the two halves
 * of #126's centring clamp (`min-width` and the negative margin that shifts the split back
 * onto the viewport) are all the same number, and a change that updated one of them and
 * not the others would be a real bug even if the constants were left alone.
 */
describe('the bar footprint in index.html and the constants here', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  /**
   * Every rule inside `@media (orientation: landscape)`, as selector + body.
   *
   * Comments are stripped first: the block's own prose quotes both numbers ("the 72px the
   * left bar takes", "66px a top bar takes"), and counting those would make this pass on
   * the documentation rather than on the rules.
   */
  const rules = (() => {
    const start = html.indexOf('@media (orientation: landscape)');
    const end = html.indexOf('@media (orientation: portrait)', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Quote style is normalised first: Prettier rewrites `[a='b']` to `[a="b"]` in HTML by
    // default, which is the same CSS, and matching the selector as a raw substring would
    // otherwise turn a reformat into two spurious failures.
    const block = html
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/"/g, "'");
    const inner = block.slice(block.indexOf('{') + 1);
    return [...inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: m[1].replace(/\s+/g, ' ').trim(),
      body: m[2],
      lengths: [...m[2].matchAll(/-?(\d+)px/g)]
        .map((n) => Number(n[1]))
        .filter((n) => n !== 0),
    }));
  })();

  /**
   * `:not([data-touchbar-edge='top'])` CONTAINS `[data-touchbar-edge='top']`, so the top
   * branch has to be selected by the absence of the `:not(`, not by a substring test.
   */
  const TOP = "[data-touchbar-edge='top']";
  const NOT_TOP = `:not(${TOP})`;
  const lengthsOf = (isTop: boolean) =>
    rules
      .filter((r) =>
        isTop ? r.selector.includes(TOP) && !r.selector.includes(NOT_TOP) : r.selector.includes(NOT_TOP),
      )
      .flatMap((r) => r.lengths);

  it('leaves no px length in the landscape branch unaccounted for', () => {
    // The dangerous direction the two tests below cannot see: a rule that mentions neither
    // attribute — the shape portrait already uses (`html[data-touchbar] .stage`) — would be
    // filtered out of both and could drift from the constants unnoticed. Every px length in
    // here has to belong to one branch or the other.
    const unclassified = rules.filter(
      (r) => r.lengths.length > 0 && !r.selector.includes(TOP) && !r.selector.includes(NOT_TOP),
    );
    expect(unclassified.map((r) => r.selector)).toEqual([]);
  });

  /**
   * The size the landscape branch spends is a custom property now, not a literal.
   *
   * It had to become one: what the bar has to clear is part of its footprint, so the top
   * edge is `54px + env(safe-area-inset-top)` and the left edge is
   * `58px + max(env(safe-area-inset-left), --bar-lead)`, and repeating either sum in the
   * four places that have to agree is exactly the drift this describe block exists to
   * catch. `:root` states each once and the rules reference it.
   *
   * So the guard moves with it, and keeps both directions: the branch must spend its size
   * ONLY through the property (no stray literal creeping back), and the property must be
   * the constant plus that edge's clearance (no silently resized bar, and no silently
   * dropped inset).
   *
   * The two edges have different SHAPES, and that difference is load-bearing rather than
   * cosmetic. The top edge adds its inset outright. The left edge takes `max()` of the
   * inset and the lead, because the lead is a floor under the housing and not something to
   * spend on top of it — summing them stranded the buttons 76px in against a 62px island.
   * A single permissive regex over both would let one collapse into the other, so each is
   * matched for the operator it is supposed to use.
   */
  const varRefs = (isTop: boolean) => {
    const name = isTop ? '--bar-h' : '--bar-w';
    return rules
      .filter((r) =>
        isTop ? r.selector.includes(TOP) && !r.selector.includes(NOT_TOP) : r.selector.includes(NOT_TOP),
      )
      .flatMap((r) => [...r.body.matchAll(new RegExp(`var\\(${name}\\)`, 'g'))]);
  };

  const root = html.slice(html.indexOf(':root {'), html.indexOf('html, body {'));

  /** `--bar-h: calc(54px + var(--sa-top));` -> { px: 54, inset: '--sa-top' } */
  const topDef = () => {
    const m = /--bar-h:\s*calc\((\d+)px \+ var\((--sa-[a-z]+)\)\)/.exec(root);
    return m === null ? null : { px: Number(m[1]), inset: m[2] };
  };

  /**
   * `--bar-w: calc(58px + max(var(--sa-left), var(--bar-lead)));`
   * -> { px: 58, inset: '--sa-left', lead: '--bar-lead' }
   */
  const leftDef = () => {
    const m = /--bar-w:\s*calc\((\d+)px \+ max\(var\((--sa-[a-z]+)\), var\((--bar-[a-z]+)\)\)\)/.exec(root);
    return m === null ? null : { px: Number(m[1]), inset: m[2], lead: m[3] };
  };

  /** `--bar-lead: 14px;` -> 14 */
  const leadPx = () => {
    const m = /--bar-lead:\s*(\d+)px/.exec(root);
    return m === null ? null : Number(m[1]);
  };

  it('agrees on the left bar in every rule that spends its width', () => {
    // The bar's own width, `.stage`'s margin, and both halves of #126's centring clamp
    // (`min-width` and the negative margin that shifts the split back onto the viewport).
    expect(varRefs(false).length).toBeGreaterThanOrEqual(4);
    expect(lengthsOf(false)).toEqual([]);
    expect(leftDef()).toEqual({ px: TOUCHBAR_W, inset: '--sa-left', lead: '--bar-lead' });
  });

  it('agrees on the lead, which is the left bar spends it as a floor', () => {
    // The stylesheet's `--bar-lead` and this module's `TOUCHBAR_LEAD` are the same number
    // stated twice — the module needs it to price the left edge (it is the default for
    // `clearLeft`), and CSS needs it to lay the bar out. Nothing else would notice them
    // drifting: the pricing would simply be wrong by the difference, on every phone.
    expect(leadPx()).toEqual(TOUCHBAR_LEAD);
  });

  it('agrees on the top bar in every rule that spends its height', () => {
    expect(varRefs(true).length).toBeGreaterThanOrEqual(4);
    expect(lengthsOf(true)).toEqual([]);
    expect(topDef()).toEqual({ px: TOUCHBAR_H, inset: '--sa-top' });
  });

  /**
   * And the footprint itself, which is the number every caller outside this module wants.
   *
   * The two above pin the PARTS — the constant and the lead — but a caller that has to
   * subtract the bar from a viewport needs the sum, and reading `TOUCHBAR_W` for it is the
   * mistake that left `tools/verify-touchbar-edge.mjs` failing both left-edge cases for
   * the whole of the iOS branch without anything noticing. `touchBarLeftW()` is that sum,
   * so it is asserted against the stylesheet rather than against the constants it is made
   * of — otherwise it would only be checking its own arithmetic.
   *
   * Both sides of the `max()`, because they are different claims: at 0 the lead is what
   * the bar spends (this is what a browser and every offline model see), and at a real
   * housing inset the inset is, which is the case no test that runs on this machine can
   * reach any other way.
   */
  it('gives the whole left footprint a name, and it is what the stylesheet resolves to', () => {
    const def = leftDef();
    const lead = leadPx();
    if (def === null || lead === null) throw new Error('index.html no longer defines --bar-w/--bar-lead');
    // `calc(58px + max(var(--sa-left), var(--bar-lead)))`, resolved by hand at two insets.
    expect(touchBarLeftW(0)).toEqual(def.px + Math.max(0, lead));
    expect(touchBarLeftW(62)).toEqual(def.px + Math.max(62, lead));
    // The no-housing case is the old flat width, which is why nothing on the web moved.
    expect(touchBarLeftW()).toEqual(72);
  });
});
