/**
 * The world-map "record" info panel (krokoměr / step-counter, UMain.pas:1364
 * KresliKrokomer) shown when an already-solved room is clicked. Pure geometry +
 * compositing helpers, unit-tested in isolation; the stateful wiring lives in
 * main.ts.
 *
 * Layout constants are the original's absolute map coordinates:
 *   - panel background `krokomer.bmp` at (193,141), 268×186
 *   - three 43×46 button icons from `ikonky.bmp` at y=222: Run x=258 (src col 0),
 *     Replay x=301 (src col 43), Cancel x=344 (src col 86); only the *hovered*
 *     button's highlighted icon is drawn over the panel's baked-in normal icons.
 *   - up to five 19×24 digits from `cisla.bmp` at (275+19·i, 177), each rolling in
 *     from 0 to its value (odometer: `y := 9*24 - 8*faze`, clamped to its digit).
 * Every blit is an opaque `move` (no transparency), matching Kresli (UMain.pas:1350).
 *
 * On a phone the whole panel is drawn INFO_PHONE_ZOOM× about its centre — not in the
 * original; see that constant. `infoPanelOrigin`/`applyInfoZoom` place it,
 * `hitInfoButton(…, zoom)` hits it, and `infoPanelCutout` separates the device from the
 * map baked into its bitmap so it can be scaled at all. At zoom 1 nothing changes.
 */
import type { Bmp } from '../data/bmp.js';

export const PANEL_X = 193;
export const PANEL_Y = 141;
export const PANEL_W = 268;
export const PANEL_H = 186;

export const ICON_W = 43;
export const ICON_H = 46;
export const ICON_Y = 222;

export const DIGIT_X0 = 275;
export const DIGIT_Y = 177;
export const DIGIT_W = 19;
export const DIGIT_H = 24;
export const INFO_DIGITS = 5;

export type InfoButton = 'run' | 'replay' | 'cancel';

/** The three buttons' map-space icon positions and their `ikonky.bmp` source column. */
export const INFO_BUTTONS: Readonly<Record<InfoButton, { x: number; srcX: number }>> = {
  run: { x: 258, srcX: 0 },
  replay: { x: 301, srcX: ICON_W },
  cancel: { x: 344, srcX: ICON_W * 2 },
};

/**
 * Once `faze` reaches this the odometer is fully settled (digit 9 rolls from
 * y=9·24=216 down to y=0 in steps of 8 → ⌈216/8⌉=27 frames), so callers can stop
 * advancing/repainting the panel.
 */
export const INFO_SETTLE_FAZE = 27;

/**
 * Wall-clock time per odometer frame. The original advances `InfoFaze` once per
 * game timer tick (KresliKrokomer's `Inc(InfoFaze)`), and Timer1.Interval = 100ms
 * (UMain.dfm), so the full roll takes 27·100ms ≈ 2.7s. Advancing per *paint*
 * instead would tie the speed to the frame rate (≈0.45s at 60fps), so the caller
 * gates it on this instead.
 */
export const INFO_FAZE_MS = 100;

/**
 * How much bigger the whole panel is drawn on a phone. NOT in the original, which only
 * ever ran on a monitor: there the panel is 268×186 of a 640×480 screen, and on a phone
 * held sideways the map is ~400 CSS px tall, so the odometer digits come out ~16×20 pt
 * and the three buttons ~36×39 pt — under the 44 pt minimum touch target. At 1.5× the
 * digits are ~24×30 pt and the buttons ~54×58 pt. Everything else — artwork, layout,
 * roll timing, the buttons' order and meaning — is the original's, just scaled as one
 * picture about the panel's centre (the device only; see `infoPanelCutout`). 2× would
 * still fit above the name plaque (y≥438) but covers almost the whole map; 1.5× keeps
 * the map visibly behind a modal panel.
 */
export const INFO_PHONE_ZOOM = 1.5;

/**
 * Map-space top-left of the panel drawn at `zoom`, centred on the faithful panel's
 * centre and rounded to a whole map pixel so its edges stay on the pixel grid.
 * At zoom 1 this is exactly (PANEL_X, PANEL_Y).
 */
export function infoPanelOrigin(zoom: number): { x: number; y: number } {
  return {
    x: Math.round(PANEL_X + (PANEL_W * (1 - zoom)) / 2),
    y: Math.round(PANEL_Y + (PANEL_H * (1 - zoom)) / 2),
  };
}

/**
 * Apply the panel zoom to a 2D context whose backing store is `scale`× map space, so
 * anything drawn afterwards at the panel's FAITHFUL map coordinates lands on the
 * enlarged panel. The caller brackets it with save/restore.
 */
export function applyInfoZoom(ctx: CanvasRenderingContext2D, scale: number, zoom: number): void {
  const o = infoPanelOrigin(zoom);
  ctx.translate(o.x * scale, o.y * scale);
  ctx.scale(zoom, zoom);
  ctx.translate(-PANEL_X * scale, -PANEL_Y * scale);
}

/** How far a panel pixel may stray from a pure darkening of the map and still be shadow. */
const CUTOUT_TOLERANCE = 24;
/** The darkest shadow the cutout accepts; anything darker than this fraction is the device. */
const CUTOUT_MIN_SHADE = 0.4;
/** Unreached islands smaller than this are dithered shadow, not part of the device. */
const CUTOUT_MIN_ISLAND = 64;

/**
 * Separate `krokomer.bmp` into the device and what is merely the map behind it.
 *
 * The bitmap is an opaque 268×186 rectangle, blitted over the map where its baked-in
 * background matches the map exactly — so at 1:1 the rectangle is invisible. Scaled up
 * for the phone that background no longer lines up with the map beneath it, and the
 * rectangle shows. So the rectangle is taken apart against the unlit map it was cut
 * from (`mapRgba`, map-sized): starting from the border, flood through every pixel that
 * is either the map itself or a uniform darkening of it (the table's soft cast shadow,
 * rows ~167-183). What the flood cannot reach is the device.
 *
 * Returns a panel-sized RGBA image: device pixels in their own colour, opaque; shadow
 * pixels as black at the alpha that darkens the map by the same factor; plain map
 * transparent. Over the map at 1:1 it reproduces the bitmap to within palette rounding.
 */
export function infoPanelCutout(krokomer: Bmp, mapRgba: Uint8ClampedArray, mapW: number): Uint8ClampedArray {
  const W = PANEL_W;
  const H = PANEL_H;
  const out = new Uint8ClampedArray(W * H * 4);
  // Per pixel: -1 = not map-like (device), else the darkening factor f in (0,1].
  const shade = (x: number, y: number): number => {
    const a = krokomer.palette[krokomer.pixels[y * krokomer.w + x]!]!;
    const m = ((PANEL_Y + y) * mapW + PANEL_X + x) * 4;
    const r = mapRgba[m]!, g = mapRgba[m + 1]!, b = mapRgba[m + 2]!;
    if (a.r === r && a.g === g && a.b === b) return 1;
    const sum = r + g + b;
    if (sum === 0) return -1;
    const f = (a.r + a.g + a.b) / sum;
    if (f > 1 || f < CUTOUT_MIN_SHADE) return -1;
    const off = Math.max(Math.abs(a.r - f * r), Math.abs(a.g - f * g), Math.abs(a.b - f * b));
    return off <= CUTOUT_TOLERANCE ? f : -1;
  };
  const seen = new Uint8Array(W * H); // 0 unvisited, 1 map or shadow, 2 device
  const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, 0, x, H - 1);
  for (let y = 1; y < H - 1; y++) stack.push(0, y, W - 1, y);
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x]) continue;
    const f = shade(x, y);
    if (f < 0) continue;
    seen[y * W + x] = 1;
    out[(y * W + x) * 4 + 3] = Math.round((1 - f) * 255); // black, at the shadow's strength
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  // The shadow is palette-dithered, so a few of its pixels miss the test and are left as
  // isolated specks of "device" — which, enlarged, are opaque dots of a map that is no
  // longer under them. The device is one large blob; any small island is shadow, at the
  // darkening its own brightness implies.
  const island: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start]) continue;
    island.length = 0;
    stack.push(start);
    seen[start] = 2;
    while (stack.length) {
      const i = stack.pop()!;
      island.push(i);
      const x = i % W;
      const y = (i - x) / W;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        const n = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[n]) continue;
        seen[n] = 2;
        stack.push(n);
      }
    }
    if (island.length >= CUTOUT_MIN_ISLAND) continue;
    for (const i of island) {
      const a = krokomer.palette[krokomer.pixels[Math.floor(i / W) * krokomer.w + (i % W)]!]!;
      const m = ((PANEL_Y + Math.floor(i / W)) * mapW + PANEL_X + (i % W)) * 4;
      const sum = mapRgba[m]! + mapRgba[m + 1]! + mapRgba[m + 2]!;
      const f = sum ? Math.min(1, (a.r + a.g + a.b) / sum) : 1;
      seen[i] = 1;
      out[i * 4 + 3] = Math.round((1 - f) * 255);
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (seen[i] === 1) continue; // map or shadow; 2 is the device
    const c = krokomer.palette[krokomer.pixels[Math.floor(i / W) * krokomer.w + (i % W)]!]!;
    out[i * 4] = c.r;
    out[i * 4 + 1] = c.g;
    out[i * 4 + 2] = c.b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * The button under map coordinate (mx,my) while the panel is open (UMain.pas:1626):
 * the icon band is y∈[222,268), split into Run [258,301) / Replay [301,344) /
 * Cancel [344,387). Anywhere else → null (a click there cancels). With a `zoom`
 * (phone), the point is first mapped back onto the faithful panel it was drawn from.
 */
export function hitInfoButton(mx: number, my: number, zoom = 1): InfoButton | null {
  if (zoom !== 1) {
    const o = infoPanelOrigin(zoom);
    mx = PANEL_X + (mx - o.x) / zoom;
    my = PANEL_Y + (my - o.y) / zoom;
  }
  if (my < ICON_Y || my >= ICON_Y + ICON_H) return null;
  if (mx >= INFO_BUTTONS.run.x && mx < INFO_BUTTONS.replay.x) return 'run';
  if (mx >= INFO_BUTTONS.replay.x && mx < INFO_BUTTONS.cancel.x) return 'replay';
  if (mx >= INFO_BUTTONS.cancel.x && mx < INFO_BUTTONS.cancel.x + ICON_W) return 'cancel';
  return null;
}

/**
 * The `cisla.bmp` source-y for a digit `cif` (0..9) at animation frame `faze`
 * (UMain.pas:1378): `y := 9*24 - 8*faze`, floored at the digit's resting row
 * `(9-cif)*24`. The atlas stacks digits 9(top)..0(bottom); rolling y downward
 * scrolls 0→…→cif.
 */
export function digitRollY(faze: number, cif: number): number {
  const rest = (9 - cif) * DIGIT_H;
  let y = 9 * DIGIT_H - 8 * faze;
  if (y < rest) y = rest;
  return y;
}

/** Opaque blit of a `w×h` region from a source Bmp (src origin) to (destX,destY). */
function blitRegion(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  bmp: Bmp,
  destX: number,
  destY: number,
  srcX: number,
  srcY: number,
  w: number,
  h: number,
): void {
  for (let row = 0; row < h; row++) {
    const sy = srcY + row;
    const dy = destY + row;
    if (sy < 0 || sy >= bmp.h || dy < 0 || dy >= mapH) continue;
    for (let col = 0; col < w; col++) {
      const sx = srcX + col;
      const dx = destX + col;
      if (sx < 0 || sx >= bmp.w || dx < 0 || dx >= mapW) continue;
      const idx = bmp.pixels[sy * bmp.w + sx]!;
      const c = bmp.palette[idx];
      if (!c) continue;
      const d = (dy * mapW + dx) * 4;
      rgba[d] = c.r;
      rgba[d + 1] = c.g;
      rgba[d + 2] = c.b;
      rgba[d + 3] = 255;
    }
  }
}

/** Darken a map-space rectangle in place (used to grey out a disabled Replay button). */
function darkenRect(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  factor: number,
): void {
  for (let row = 0; row < h; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= mapH) continue;
    for (let col = 0; col < w; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= mapW) continue;
      const d = (dy * mapW + dx) * 4;
      rgba[d] = rgba[d]! * factor;
      rgba[d + 1] = rgba[d + 1]! * factor;
      rgba[d + 2] = rgba[d + 2]! * factor;
    }
  }
}

export interface InfoPanelAssets {
  krokomer: Bmp;
  ikonky: Bmp;
  cisla: Bmp;
}

/**
 * Blit only the five odometer digits of `count` (zero-padded, rolling in per `faze`)
 * onto an RGBA buffer — the crisp/legible part of the panel, kept separate so the AI
 * map can render it nearest-neighbour-scaled (sharp numerals) over the AI panel art.
 * A null `count` (cheat-only room, no genuine best) draws nothing.
 */
export function drawInfoDigits(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  cisla: Bmp,
  count: number | null,
  faze: number,
): void {
  if (count === null) return;
  let cis = count;
  for (let i = INFO_DIGITS - 1; i >= 0; i--) {
    const cif = cis % 10;
    cis = Math.floor(cis / 10);
    const y = digitRollY(faze, cif);
    blitRegion(rgba, mapW, mapH, cisla, DIGIT_X0 + DIGIT_W * i, DIGIT_Y, 0, y, DIGIT_W, DIGIT_H);
  }
}

/**
 * Composite the record panel onto an RGBA map buffer: the `krokomer` background,
 * the hovered button's highlighted icon, and the five odometer digits of `count`
 * (or a blank slot when `count` is null — e.g. a cheat-only room with no genuine
 * best). A disabled Replay (`replayEnabled=false`) is greyed and never highlights.
 */
export function drawInfoPanel(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  assets: InfoPanelAssets,
  count: number | null,
  hover: InfoButton | null,
  faze: number,
  replayEnabled: boolean,
): void {
  // Panel background (opaque 268×186).
  blitRegion(rgba, mapW, mapH, assets.krokomer, PANEL_X, PANEL_Y, 0, 0, PANEL_W, PANEL_H);
  // Hovered button highlight (Replay only if it is enabled).
  if (hover && !(hover === 'replay' && !replayEnabled)) {
    const b = INFO_BUTTONS[hover];
    blitRegion(rgba, mapW, mapH, assets.ikonky, b.x, ICON_Y, b.srcX, 0, ICON_W, ICON_H);
  }
  // Grey out a disabled Replay icon.
  if (!replayEnabled) {
    darkenRect(rgba, mapW, mapH, INFO_BUTTONS.replay.x, ICON_Y, ICON_W, ICON_H, 0.45);
  }
  // Odometer digits (five, zero-padded), rolling in per `faze`.
  drawInfoDigits(rgba, mapW, mapH, assets.cisla, count, faze);
}

/**
 * Draw the record panel's *artwork* (background frame + hovered button highlight +
 * disabled-Replay greying) onto a 2D context at `scale`, sourcing the AI-upscaled
 * krokomer/ikonky ImageBitmaps (already `scale`× the native size). The odometer
 * digits are NOT drawn here — the caller overlays them crisply (see drawInfoDigits)
 * so numerals stay legible. Mirrors drawInfoPanel's bg/icon logic exactly.
 * `smooth` filters the art when it is being drawn enlarged (the phone zoom): the AI
 * bitmaps are already hi-res, so nearest-neighbour at a fractional scale only adds
 * uneven stair-steps.
 */
export function drawInfoPanelArtAi(
  ctx: CanvasRenderingContext2D,
  scale: number,
  krokomer: CanvasImageSource,
  ikonky: CanvasImageSource,
  hover: InfoButton | null,
  replayEnabled: boolean,
  smooth = false,
): void {
  ctx.imageSmoothingEnabled = smooth;
  // Panel background (the AI bitmap is the whole 268×186 region at `scale`×).
  ctx.drawImage(krokomer, PANEL_X * scale, PANEL_Y * scale, PANEL_W * scale, PANEL_H * scale);
  // Hovered button highlight (Replay only if enabled).
  if (hover && !(hover === 'replay' && !replayEnabled)) {
    const b = INFO_BUTTONS[hover];
    ctx.drawImage(
      ikonky,
      b.srcX * scale, 0, ICON_W * scale, ICON_H * scale,
      b.x * scale, ICON_Y * scale, ICON_W * scale, ICON_H * scale,
    );
  }
  // Grey out a disabled Replay icon (same 0.45 factor as darkenRect → 55% black wash).
  if (!replayEnabled) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#000';
    ctx.fillRect(INFO_BUTTONS.replay.x * scale, ICON_Y * scale, ICON_W * scale, ICON_H * scale);
    ctx.restore();
  }
}
