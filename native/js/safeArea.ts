/**
 * The window's title-safe area: on a TV the set's overscan may cut the picture's edges off,
 * and tvOS asks for menus and hints to stay 60 points in from the top and bottom and 80 from
 * the sides (the view's `safeAreaInsets`, which the host reports: `__native.safeArea`). The
 * UI layer (`uiLayer.ts`) and the intro's skip hint (`introScreen.ts`) keep inside it; the
 * pictures themselves (the room, the map, a movie) stay where they are, letterboxed to the
 * whole window, as a TV game's picture is.
 */

/** `[left, top, right, bottom]` insets from the window's edges, in its pixels. */
export type Insets = readonly [number, number, number, number];

const NO_INSETS: Insets = [0, 0, 0, 0];
let simulateTv = false;

/**
 * `--tv-safe-area`: the insets tvOS gives a 1920×1080 screen (80 px at the sides, 60 above
 * and below), scaled to whatever window this is — to see on a Mac where the UI goes on a TV.
 */
export function simulateTvSafeArea(): void {
  simulateTv = true;
}

/** The title-safe insets of a `w`×`h` window; none headless or on a desktop. */
export function safeInsets(w: number, h: number): Insets {
  if (simulateTv) {
    const x = Math.round((w * 80) / 1920), y = Math.round((h * 60) / 1080);
    return [x, y, x, y];
  }
  return __native.safeArea() ?? NO_INSETS;
}
