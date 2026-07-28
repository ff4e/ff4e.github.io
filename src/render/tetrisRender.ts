/**
 * The Tetris minigame's picture (`priprav` + `pis_cislo`, Ttr.pas:238 / :203).
 *
 * The board is drawn into a copy of `dira.bmp` (the 150x300 well), one 15x15
 * tile per occupied cell taken from the `all.bmp` atlas, rotated to the
 * orientation the block was placed at. Both bitmaps are palette-indexed and
 * share the atlas palette, so the result is an indexed frame the caller
 * colours once.
 */
import type { Bmp } from '../data/bmp.js';
import { DK, MAX_HISC, NX, NY, TRANSP, type TetrisGame } from '../core/tetris.js';

/** Digit glyph size in the atlas strip (pis_cislo's 13x17 window). */
const DIGIT_W = 13;
const DIGIT_H = 17;
/** Horizontal pitch between digit glyphs in the atlas (25px). */
const DIGIT_PITCH = 25;

export interface TetrisArt {
  /** `all.bmp` — the tile + digit atlas. */
  all: Bmp;
  /** `dira.bmp` — the empty well, and the frame size. */
  hole: Bmp;
  /** Digit-strip position in the atlas, in tiles. */
  xfont: number;
  yfont: number;
}

/**
 * `pis_cislo` (Ttr.pas:203): draw `h` right-aligned at (x,y), one digit at a
 * time, walking left. `h = -1` draws the atlas's 11th glyph — the dot the
 * hiscore table puts after the rank.
 */
function pisCislo(out: Uint8Array, w: number, h: number, art: TetrisArt, x: number, y: number, value: number): void {
  let v = value;
  let cc: number;
  if (v === -1) {
    v = 0;
    cc = 10;
  } else {
    cc = v % 10;
  }
  const xx = art.xfont * DK + DIGIT_PITCH * cc;
  const yy = art.yfont * DK;
  const aw = art.all.w;
  for (let j = 0; j < DIGIT_H; j++) {
    const sy = yy + j;
    const dy = y + j;
    if (sy < 0 || sy >= art.all.h || dy < 0 || dy >= h) continue;
    for (let i = 0; i < DIGIT_W; i++) {
      const sx = xx + i;
      const dx = x + i;
      if (sx < 0 || sx >= aw || dx < 0 || dx >= w) continue;
      const px = art.all.pixels[sy * aw + sx]!;
      if (px !== TRANSP) out[dy * w + dx] = px;
    }
  }
  v = Math.floor(v / 10);
  if (v > 0) pisCislo(out, w, h, art, x - DIGIT_W, y, v);
}

/**
 * The four blit orientations of `priprav` (Ttr.pas:255-300). A tile placed at
 * rotation `ss` is drawn turned by that many quarter-turns; `rev` additionally
 * flips the source rows. Written as index arithmetic rather than the original's
 * four scanline-pointer loops, which is the same mapping:
 *   ss=1 dest[j][i]       = src[j][i]        ss=2 dest[j][14-i] = src[i][j]
 *   ss=3 dest[14-j][14-i] = src[j][i]        ss=4 dest[j][i]    = src[i][14-j]
 */
function blitTile(
  out: Uint8Array,
  w: number,
  art: TetrisArt,
  cellX: number,
  cellY: number,
  xx: number,
  yy: number,
  ss: number,
  rev: boolean,
): void {
  const aw = art.all.w;
  const ah = art.all.h;
  const src = (a: number, b: number): number => {
    const sy = yy * DK + (rev ? DK - 1 - a : a);
    const sx = xx * DK + b;
    if (sy < 0 || sy >= ah || sx < 0 || sx >= aw) return TRANSP;
    return art.all.pixels[sy * aw + sx]!;
  };
  for (let j = 0; j < DK; j++) {
    for (let i = 0; i < DK; i++) {
      let px: number;
      let dj = j;
      let di = i;
      if (ss === 2) {
        px = src(i, j);
        di = DK - 1 - i;
      } else if (ss === 3) {
        px = src(j, i);
        dj = DK - 1 - j;
        di = DK - 1 - i;
      } else if (ss === 4) {
        px = src(i, DK - 1 - j);
      } else {
        px = src(j, i);
      }
      if (px === TRANSP) continue;
      out[(cellY * DK + dj) * w + cellX * DK + di] = px;
    }
  }
}

/**
 * `priprav` (Ttr.pas:238): compose the whole frame — the well, every settled
 * block, the score (top right) and the level (top left), plus the hiscore table
 * once the game is over, with the row just earned blinking.
 */
export function renderTetris(game: TetrisGame, art: TetrisArt): Uint8Array {
  const w = art.hole.w;
  const h = art.hole.h;
  const out = new Uint8Array(art.hole.pixels); // move(BMHole -> BMPole)
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      const c = game.pole[x]![y]!;
      if (!c.volno) blitTile(out, w, art, x, y, c.xx, c.yy, c.ss, c.rev);
    }
  }
  pisCislo(out, w, h, art, w - DK, 2, game.score);
  const level = 12 - game.rychlost;
  pisCislo(out, w, h, art, level < 10 ? 2 : 17, 2, level);
  if (game.gameover) {
    for (let i = 1; i <= MAX_HISC; i++) {
      if (game.umisteni !== i || game.blikani % 18 < 9) {
        pisCislo(out, w, h, art, 10, 30 + i * 25, i);
        pisCislo(out, w, h, art, 22, 30 + i * 25, -1);
        pisCislo(out, w, h, art, 130, 30 + i * 25, game.hiscore[i - 1]!);
      }
    }
    game.blikani++;
    if (game.blikani === 18) game.blikani = 0;
  }
  return out;
}

/** Colour an indexed Tetris frame through the atlas palette. */
export function tetrisRgba(indexed: Uint8Array, art: TetrisArt): Uint8Array {
  const pal = art.hole.palette;
  const rgba = new Uint8Array(indexed.length * 4);
  for (let i = 0; i < indexed.length; i++) {
    const c = pal[indexed[i]!] ?? { r: 0, g: 0, b: 0 };
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
