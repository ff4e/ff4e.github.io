/**
 * Full-frame effects for the xsilent and xinterlaced cheats
 * (URoom.pas:24627-24665, ZpracujInterlaced :26053, Sum :26082,
 * zcernobilit :23914).
 *
 * All three run over the finished frame, exactly where the original runs them at
 * the tail of KresliMistnost — so they compose with whatever the room drew, and
 * work for both the classic palette art and the enhanced truecolor art. The
 * original gets its sepia by swapping the screen's PALETTE; recolouring the
 * finished RGBA plane instead gives the same picture and also covers the
 * truecolor art, which has no palette to swap.
 */

/** The slice of `RgbaScreen` these effects need. */
export interface FrameTarget {
  readonly width: number;
  readonly height: number;
  /** Palette-index plane. */
  readonly idx: Uint8Array;
  /** Displayed RGBA plane. */
  readonly rgba: Uint8Array;
  setIndex(x: number, y: number, a: number): void;
}

/** interlacedfaze values (URoom.pas:1430, 24631-24638). */
export const INTERLACED_OFF = -1;
export const INTERLACED_STOP = -2;
export const INTERLACED_START = 0;
/** The phase at which posun hits -10 and the collapse sound fires. */
export const INTERLACED_SND_FAZE = 33;

/** Copy one whole scanline (both planes) from row `sy` to row `dy`. */
function copyRow(s: FrameTarget, dy: number, sy: number): void {
  const w = s.width;
  s.idx.copyWithin(dy * w, sy * w, sy * w + w);
  s.rgba.copyWithin(dy * w * 4, sy * w * 4, (sy * w + w) * 4);
}

/** Fill one whole scanline with a palette index. */
function fillRow(s: FrameTarget, y: number, a: number): void {
  for (let x = 0; x < s.width; x++) s.setIndex(x, y, a);
}

/**
 * ZpracujInterlaced (URoom.pas:26053): one frame of the screen collapsing in on
 * itself — the bottom of the picture folds up over its own mirror image while the
 * rest is pulled down `posun` rows with every other line blanked.
 *
 * Draws only. The original advances `interlacedfaze` in here because it is called
 * once per game tick; the port paints far more often than it ticks, so the caller
 * advances the phase on the logic tick instead (see `tickFrameEffects`).
 *
 * Rows are walked bottom-up so a row is only ever read before it is overwritten,
 * exactly as the Delphi does.
 */
export function zpracujInterlaced(s: FrameTarget, faze: number, fillIdx: number): void {
  let posun = (faze - 35) * 5;
  if (posun < 0) posun = 0;
  if (posun >= s.height) posun = s.height - 1;
  for (let i = s.height - 1; i >= 0; i--) {
    let source: number | null;
    if (s.height - 1 - i <= posun) {
      const m = i - (s.height - 1 - i);
      source = m < 0 ? null : m;
    } else {
      const m = i - posun;
      source = (m & 1) === 1 || m < 0 ? null : m;
    }
    if (source === null) fillRow(s, i, fillIdx);
    else copyRow(s, i, source);
  }
}

/** True on the frame whose `posun` is -10 — the original fires 'sp-smrt' there. */
export function interlacedSounds(faze: number): boolean {
  return (faze - 35) * 5 === -10;
}

/**
 * Sum (URoom.pas:26082): the silent-film scratch grain — a hundred pixels of a
 * drunkard's walk across the frame, occasionally veering or teleporting. The
 * original samples its start position from a fixed 800x600 field and simply
 * discards anything off-screen, so the constants stay literal here.
 */
export function sum(s: FrameTarget, random: (n: number) => number): void {
  let x = random(800);
  let y = random(600);
  let col = random(256);
  let sm = random(8);
  for (let i = 0; i < 100; i++) {
    const r = random(13);
    if (r === 0) sm = (sm + 1) % 8;
    else if (r === 1) sm = (sm + 7) % 8;
    else if (r > 9) {
      x = random(800);
      y = random(600);
      col = random(256);
      sm = random(8);
    }
    switch (sm) {
      case 0: x++; break;
      case 1: y++; break;
      case 2: x--; break;
      case 3: y--; break;
      case 4: x++; y++; break;
      case 5: x++; y--; break;
      case 6: x--; y++; break;
      default: x--; y--; break;
    }
    if (x < s.width && y < s.height && x > 0 && y > 0) s.setIndex(x, y, col);
  }
}

/**
 * zcernobilit (URoom.pas:23914): the silent-film tint. Luminance is weighted
 * 0.4/0.5/0.1 and lifted 20%, clamped, then tinted 1 / 0.8 / 0.5 — a warm sepia,
 * not a plain greyscale.
 */
export function zcernobilit(rgba: Uint8Array): void {
  for (let o = 0; o < rgba.length; o += 4) {
    let l = rgba[o]! * 0.4 + rgba[o + 1]! * 0.5 + rgba[o + 2]! * 0.1;
    l *= 1.2;
    if (l > 255) l = 255;
    rgba[o] = Math.round(l);
    rgba[o + 1] = Math.round(l * 0.8);
    rgba[o + 2] = Math.round(l * 0.5);
  }
}
