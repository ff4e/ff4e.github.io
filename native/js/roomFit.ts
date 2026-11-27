/**
 * How large a room is shown: as large as the window allows, but a cell no larger than
 * `ROOM_CELL_PX` window pixels per `ROOM_CELL_LINES` lines of the window's height — 45 px at
 * 1080, 90 px at 2160.
 *
 * Without it the host filled the window with every room, and a TV made a small room
 * enormous: MIKRO (24×14 cells) came out at 77 px a cell on a 1080-line set, against 28 for
 * the largest rooms. The web caps the same enlargement for the same reason, at 42 CSS px a
 * cell on a desktop and 34 on a tablet (`MAX_CELL_PX`, `MAX_CELL_PX_TOUCH` in
 * src/app/layout.ts); a TV is further away and gets 45 (Martin, 2026-11-27). The cap is a
 * share of the window's height rather than a number of points, so a 4K set shows what a
 * 1080-line one does and a desktop window of any size shows it in proportion. On a 1920×1080
 * window it binds on 9 rooms (test/native-room-fit.test.ts); the others are shown exactly as
 * before. The border it leaves is the letterbox's plain black.
 *
 * Rooms only: the world map, the story pages, KUFRIK's briefcase story, the credits and the
 * intro keep filling the window (they pass no cap).
 *
 * Pure, and free of `__native`: the unit tests import it.
 */
import { CELL_NATIVE } from '../../src/app/layout.js';

/** A room's largest on-screen cell, in window pixels per `ROOM_CELL_LINES` of window height. */
export const ROOM_CELL_PX = 45;
export const ROOM_CELL_LINES = 1080;

/**
 * A room's cap as the host's `letterbox` takes it (native/host/main.c `cap_h`): the height of
 * a composite the cap would show exactly filling the window's height. A room composited at
 * `scale` px a native px (the `ai` tier's ×4) is then shown at most `windowH / capH` window
 * pixels a composite pixel, which is `ROOM_CELL_PX` a cell per `ROOM_CELL_LINES` lines.
 *
 * In the window's height rather than as a scale, because the host applies it to the window
 * it is actually presenting into (the swapchain's size), not to one JS read a moment before.
 */
export function roomCapH(scale: number): number {
  return (ROOM_CELL_LINES / ROOM_CELL_PX) * CELL_NATIVE * scale;
}

/** A rect in window pixels: left, top, width, height. */
export type Rect = [number, number, number, number];

const f = Math.fround;

/**
 * Where content of `w`×`h` lands in a `sw`×`sh` window: as large as fits (and, with `capH`,
 * no larger than the cap), centred, whole pixels.
 *
 * native/host/main.c `letterbox`, restated for what has no window to ask (`presentRect`):
 * the smokes' picture boxes and the subtitle parity scene. The uncapped path is the host's
 * float32 arithmetic, op for op (`Math.fround` after each, which for these operations is
 * exactly a float op), and the capped one its doubles — so the two agree to the pixel, which
 * the smoke gate checks for every room (roomFitSmoke.ts).
 */
export function letterboxRect(w: number, h: number, sw: number, sh: number, capH = 0): Rect {
  const scale = Math.min(f(sw / w), f(sh / h));
  let dw: number, dh: number;
  if (capH > 0 && sh / capH < scale) {
    dw = Math.floor(w * sh / capH);
    dh = Math.floor(h * sh / capH);
  } else {
    dw = Math.floor(f(w * scale));
    dh = Math.floor(f(h * scale));
  }
  return [Math.floor(f(f(sw - dw) / 2)), Math.floor(f(f(sh - dh) / 2)), dw, dh];
}
