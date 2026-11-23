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

  // ── Surface2D (native/js/nativeSurface.ts). Surfaces and their images are PREMULTIPLIED. ──
  /** Decode a WebP or PNG to a premultiplied texture, as a canvas holds an image it draws. */
  decodeImage(buf: ArrayBuffer): NativeTexture;
  /** A new transparent `w`×`h` render target; returns its texture id. */
  surfCreate(w: number, h: number): number;
  /**
   * Stage one quad into `target`: dest rect in its pixels, source rect of `tex` normalised
   * (0 = a white texel, for fills), filtered bilinearly or not, blended source-over (0) or
   * destination-in (1), multiplied by the premultiplied colour (r, g, b, a). Consecutive
   * quads with the same target, texture, filter and blend become one draw call.
   */
  surfQuad(target: number, tex: number, linear: boolean, blend: number,
    x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number,
    r: number, g: number, b: number, a: number): void;
  surfClear(target: number): void;
  /** Replace the whole surface with straight RGBA (width × height × 4), premultiplied on the way. */
  surfPut(target: number, rgba: ArrayBuffer): void;
  /** Show a surface in the window, as `present` shows the composite. */
  presentTexture(id: number): void;
  /** `saveComposite` for a surface's texture. */
  saveTexture(id: number, path: string): void;

  // ── Input. ──
  /**
   * Key transitions since the last call, oldest first: `+Code` down, `-Code` up, where Code
   * is the DOM `KeyboardEvent.code` the browser game's router reads (`KeyI`, `ArrowUp`,
   * `Space`, `Minus`, `F2`…). The gamepad arrives as the same codes — see `pollGamepad` in
   * native/host/main.c for the mapping — so there is one router for both.
   */
  events(): string[];

  // ── Persistence: the localStorage shim's backing file (shims.ts). ──
  /**
   * The whole store as last saved (a JSON object), or null when there is none yet. With
   * `backup`, the store as it was before the last save (`<store>.bak`).
   */
  storeLoad(backup?: boolean): string | null;
  /**
   * Replace the store durably: write and fsync a sibling, keep the current store as the
   * backup — unless `damaged`, when it is the unreadable store the reader fell back from —
   * and rename the sibling into place. Throws when it cannot.
   */
  storeSave(json: string, damaged?: boolean): void;
  /** Where the store is kept, for messages. */
  storePath(): string | null;
  args(): string[];
  /** Leave the frame loop; the process exits with `code` (default 0). */
  quit(code?: number): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __native: NativeApi;
}
