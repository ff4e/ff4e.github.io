/**
 * The shape of the touch Options face: the original 155x395 panel, or that same panel
 * cut in two and laid side by side for a phone held in landscape.
 *
 * ── Why a cut, and not a rotation or a new picture ───────────────────────────
 * A phone in landscape has ~330px of height for this dialog, and the face is 395 rows
 * tall: drawn whole, it would come out under 1x and its 9px sliders would be unhittable,
 * which is exactly why phones used to get HTML controls instead. panel.ffp has no bare
 * background to lay the controls out on afresh — the stone and the lettering ("EFFECT
 * VOLUME", "SUBTITLES", "HELP", "EXIT OPTIONS") are one bitmap — so a rotated slab would
 * rotate the words with it. But the face already falls into two halves of the same height:
 * the emblems and the three sliders above row 197, the subtitles, Help and the exit corner
 * below it, with plain stone between the music slider (its handle ends on row 191) and
 * the SUBTITLES lettering. Side by side they make a 305x198 face that fits a landscape
 * phone at ~1.6-1.9x, and every pixel in it is still ALTAR's.
 *
 * The two slabs do not match at the join — the top of the left one is the dark stone
 * behind the emblems — so the right half fades in over the last SEAM columns of the left
 * rather than butting against it. Five is the widest fade that touches no control: the
 * Czech highlight starts on column 5 of the lower half (the slider handles end on 145 of
 * the upper one, well clear), and test/optionsLayout.test.ts checks that against panel.ffp.
 *
 * Nothing here knows a region. Taps are mapped back into the original 155x395 space and go
 * through the panel's own hit test, so `panelAction` and the oracle `tools/test-options.mjs`
 * already pins stay the only definition of what a press does.
 */
import { PANEL_H, PANEL_W } from '../render/hud.js';
import { stage } from './stageGeometry.js';
import { phoneUi } from './touchButtons.js';
import { touchOptionsOpen } from './touchOptions.js';

export type OptionsLayout = 'portrait' | 'landscape';

/** The first row of the lower half: plain stone between the music slider and SUBTITLES. */
export const SPLIT_ROW = 197;
/** Columns over which the right half fades in over the left one. */
export const SEAM = 5;
/** Where the right half starts in the landscape face. */
const RIGHT_X = PANEL_W - SEAM;

/** The face's size in panel pixels (before the AI tier's backing-store scale). */
export function faceSize(layout: OptionsLayout): { w: number; h: number } {
  return layout === 'landscape' ? { w: 2 * PANEL_W - SEAM, h: PANEL_H - SPLIT_ROW } : { w: PANEL_W, h: PANEL_H };
}

/**
 * Which face to show. Only a phone's touch dialog is ever cut: a tablet has room for the
 * whole panel, and the desktop's side panel is the original and stays it.
 *
 * The face follows the viewport, re-read every frame, because the player may turn the
 * phone in a room. Over the map that is always landscape on the native app, which locks
 * the map there (`phoneOrientation.ts`) and keeps it under Options; it is not forced here,
 * because a phone BROWSER can show the map upright, and the cut face across a portrait
 * screen would be drawn too small to use.
 */
export function optionsLayout(): OptionsLayout {
  if (!phoneUi() || !touchOptionsOpen()) return 'portrait';
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

/**
 * A point on the face -> the original panel's 155x395 space, for `hitTest`/`sliderIndex`.
 *
 * Inside the fade, the column belongs to whichever half is mostly showing. A slider drag
 * stays in the left half however far the finger travels: all three sliders live there,
 * and `sliderIndex` clamps, so dragging past the seam reads as "loudest" rather than
 * jumping to the right half's x and back to silence.
 */
export function toPanelPoint(x: number, y: number, layout: OptionsLayout, dragging: boolean): { x: number; y: number } {
  if (layout === 'portrait' || dragging || x < PANEL_W - SEAM / 2) return { x, y };
  return { x: x - RIGHT_X, y: y + SPLIT_ROW };
}

/**
 * Lay the composed portrait face (`src`, `k` backing pixels per panel pixel) out as the
 * landscape one in `dst`. The left half is copied whole and the right half drawn over it,
 * its first SEAM columns one backing column at a time at rising opacity.
 */
export function composeLandscape(dst: CanvasRenderingContext2D, src: CanvasImageSource, k: number): void {
  const h = (PANEL_H - SPLIT_ROW) * k;
  const top = SPLIT_ROW * k;
  const fade = SEAM * k;
  dst.imageSmoothingEnabled = false;
  dst.globalAlpha = 1;
  dst.clearRect(0, 0, dst.canvas.width, dst.canvas.height);
  dst.drawImage(src, 0, 0, PANEL_W * k, h, 0, 0, PANEL_W * k, h);
  dst.drawImage(src, fade, top, (PANEL_W - SEAM) * k, h, PANEL_W * k, 0, (PANEL_W - SEAM) * k, h);
  for (let i = 0; i < fade; i++) {
    dst.globalAlpha = (i + 0.5) / fade;
    dst.drawImage(src, i, top, 1, h, RIGHT_X * k + i, 0, 1, h);
  }
  dst.globalAlpha = 1;
}

let scratch: CanvasRenderingContext2D | null = null;

/**
 * The off-screen canvas the portrait face is painted into before the landscape cut.
 * Created on first use rather than at module scope (the module-evaluation rule, AGENTS.md).
 */
export function scratchCtx(w: number, h: number): CanvasRenderingContext2D {
  scratch ??= document.createElement('canvas').getContext('2d')!;
  if (scratch.canvas.width !== w || scratch.canvas.height !== h) {
    scratch.canvas.width = w;
    scratch.canvas.height = h;
  }
  return scratch;
}

/** The largest scale at which a `w`x`h` face fits the box. */
export function fitScale(w: number, h: number, availW: number, availH: number): number {
  return Math.max(0, Math.min(availW / w, availH / h));
}

/**
 * The largest scale at which the face, plus a strip under it whose height depends on the
 * face's width, fits the box. `stripH(w)` is the strip's height when it wraps at `w`.
 *
 * Starts from the strip at its shortest (wrapped at the full box width), so the first
 * scale is an upper bound; each pass can only make the strip taller and the scale smaller,
 * so it settles on the largest scale that really fits, normally in two passes.
 */
export function fitWithStrip(
  w: number, h: number, availW: number, availH: number, stripH: (width: number) => number,
): number {
  let s = fitScale(w, h, availW, availH - stripH(availW));
  for (let i = 0; i < 4; i++) {
    const next = fitScale(w, h, availW, availH - stripH(w * s));
    if (next >= s) break;
    s = next;
  }
  return s;
}

let fitKey = '';
let fitSize = { w: 0, h: 0 };

/**
 * The CSS size of the face inside the touch dialog.
 *
 * A tablet keeps the stage's scale, as it always has. A phone's face is scaled to fill
 * the dialog instead: that, not the cut, is what makes its sliders a target — at the
 * stage scale a landscape phone draws the panel, they are ~7px tall. The box is the
 * dialog's content area less the feedback strip under the face, and it is measured only
 * when the viewport or the face changes, so a steady dialog does no layout work per frame.
 *
 * The strip wraps at the face's width, so its height is measured at the width being
 * decided, never at whatever width the face is showing now. Reading it as it stood made
 * the answer depend on the canvas's last size: reopened after a moment as a desktop
 * panel (touch dropped for a frame, as Chrome's emulation does as it rotates), the canvas
 * was still 63px wide, the strip wrapped a word to a line, and that 117px strip was
 * cached as if it were the real one — a landscape face three-quarters of its proper size.
 */
export function touchFaceCss(layout: OptionsLayout): { w: number; h: number } {
  const face = faceSize(layout);
  const dialog = phoneUi() ? document.getElementById('touchopts') : null;
  if (!dialog) return { w: face.w * stage.scale, h: face.h * stage.scale };
  const key = `${window.innerWidth}x${window.innerHeight}|${layout}`;
  if (key !== fitKey) {
    const cs = getComputedStyle(dialog);
    // The face's own border (every canvas has one, index.html) sits outside the size set here.
    const canvas = document.getElementById('panel');
    const ccs = canvas ? getComputedStyle(canvas) : null;
    const borderW = ccs ? parseFloat(ccs.borderLeftWidth) + parseFloat(ccs.borderRightWidth) : 0;
    const borderH = ccs ? parseFloat(ccs.borderTopWidth) + parseFloat(ccs.borderBottomWidth) : 0;
    const availW = dialog.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - borderW;
    const availH = dialog.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - borderH;
    const bar = document.getElementById('feedbar');
    const stripH = (width: number): number => {
      if (!bar || bar.hidden) return 0;
      const was = bar.style.width;
      bar.style.width = `${Math.floor(width + borderW)}px`;
      const h = bar.offsetHeight + parseFloat(getComputedStyle(bar).marginTop || '0');
      bar.style.width = was;
      return h;
    };
    const s = availW > 0 && availH > 0 ? fitWithStrip(face.w, face.h, availW, availH, stripH) : 0;
    fitSize = { w: face.w * s, h: face.h * s };
    // A dialog not laid out yet measures nothing; measure again next frame rather than keep it.
    fitKey = s > 0 ? key : '';
  }
  return fitSize;
}
