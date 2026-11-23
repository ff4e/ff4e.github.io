/**
 * The functions the C host (native/host/main.c) installs on `globalThis.__native`.
 * This file is the whole contract between the JS game and the native shell.
 */
export interface NativeTexture {
  readonly id: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeApi {
  print(s: string): void;
  /** Milliseconds on a monotonic clock. */
  now(): number;
  /** A file under the asset root (the repo's `public/`), or null when absent. */
  readFile(path: string): ArrayBuffer | null;
  utf8(buf: ArrayBuffer): string;
  /** Decode a WebP to straight-alpha RGBA8 and upload it as a GPU texture. */
  decodeWebp(buf: ArrayBuffer): NativeTexture;
  releaseTexture(id: number): void;
  /** The same decode to CPU memory, straight RGBA8 — for the scratch canvas's drawImage. */
  decodeWebpRgba(buf: ArrayBuffer): ArrayBuffer;
  /**
   * A texture from CPU pixels (`w`×`h`×4 bytes): RGBA8, or with `mask` one FP32 per texel
   * (a mirror's glass mask, as GlAiScreen uploads it). Returns its id.
   */
  createTexture(px: ArrayBuffer, w: number, h: number, mask: boolean): number;
  /** Replace a `w`×`h` rect of an RGBA8 texture at (x,y) — `texSubImage2D`. */
  updateTexture(id: number, x: number, y: number, w: number, h: number, px: ArrayBuffer): void;
  /** RANDPOLE (256 bytes), for the dissolve pass. Called once. */
  setRandTable(buf: ArrayBuffer): void;

  // ── The AiTarget passes. Coordinates are top-down backing-store pixels. ──
  begin(w: number, h: number): void;
  fill(r: number, g: number, b: number): void;
  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void;
  blit(tex: number, x: number, y: number, w: number, h: number, mirror: boolean): void;
  /**
   * Wall over wobbled background. `rip` is RIPPLE_GPU_SLOTS×(c, halfW, amp, k), `ripPh`
   * the carriers' phases — computed in JS by the shared `activeRipples`, as GlAiScreen does.
   * `zx` paints the wall's silhouette with the band texture last set by `setBands` (gspec=42).
   */
  background(bg: number, wall: number, scale: number, bgW: number, wobble: boolean, amp: number, per: number,
    phase: number, ripN: number, rip: number[], ripPh: number[], zx: boolean): void;
  /** Replace the ZX band texture: `n` RGBA texels, one per native row. */
  setBands(rgba: ArrayBuffer, n: number): void;
  disintegrate(tex: number, x: number, y: number, w: number, h: number, scale: number, nativeW: number, rozpad: number): void;
  /** GlAiScreen.mirrorGlass's pass, with its uniforms in the same order (MIRROR_FS). */
  mirror(mask: number, rx0: number, rx1: number, ry0: number, ry1: number, dx0: number, dx1: number,
    k: number, mx: number, my: number, mw: number, mh: number): void;
  /** Show the composite in the window (box-filtered to fit). */
  present(): void;
  /** Write the composite's RGBA (top-down) to `path`, prefixed by u32 w, u32 h. */
  saveComposite(path: string): void;

  // ── Input, sampled by the host from SDL each frame. ──
  /** Held direction (0 none, 1 up, 2 down, 3 left, 4 right) — the game's Dir values. */
  heldDir(): number;
  /** Edge-triggered buttons since the last call: bit 0 = switch fish, bit 1 = quit. */
  pressed(): number;
  args(): string[];
  /** Leave the frame loop; the process exits with `code` (default 0). */
  quit(code?: number): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __native: NativeApi;
}
