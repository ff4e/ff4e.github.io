/**
 * The functions the C host (native/host/main.c) installs on `globalThis.__native`.
 * This file is the whole contract between the JS game and the native shell.
 */
export interface NativeTexture {
  readonly id: number;
  readonly width: number;
  readonly height: number;
}

export interface GlyphRaster {
  readonly w: number;
  readonly h?: number;
  readonly x?: number;
  readonly y?: number;
  readonly fill?: ArrayBuffer;
  readonly stroke?: ArrayBuffer;
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
  /**
   * Show the composite in the window (box-filtered to fit, letterboxed). `overlay` is a
   * surface drawn over the same rect at one texel per window pixel, premultiplied — the
   * subtitles, laid out for the rect `presentRect` reports.
   */
  present(overlay?: number): void;
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
  /**
   * Where `present` puts content of `w`×`h` in the window right now: `[x, y, w, h, density]`
   * in window pixels, `density` being pixels per point. Null without a window (headless).
   */
  presentRect(w: number, h: number): [number, number, number, number, number] | null;

  // ── Subtitle text (native/host/text.c, FreeType). Read by native/js/subtitleFonts.ts. ──
  /** Load a TrueType face; a variable one is set to `weight` on its `wght` axis. Returns its id. */
  fontLoad(bytes: ArrayBuffer, weight: number): number;
  /** Each code point's unhinted advance, in em. */
  fontAdvances(font: number, codepoints: number[]): number[];
  /** `[ascent, descent, lineGap]` in em, from the face's hhea — what a CSS line box is built of. */
  fontMetrics(font: number): [number, number, number];
  /**
   * One glyph at `px` pixels per em, its pen at (`fx`, `fy`) inside a pixel (y down), as two
   * `w`×`h` coverage masks (one byte a pixel, top row first) whose top-left is (`x`, `y`)
   * pixels from the pen's pixel. `fill` is the glyph; `stroke` is the glyph and a stroke of
   * radius `r` centred on its outline, together. `w` is 0 for a glyph that inks nothing.
   */
  fontGlyph(font: number, cp: number, px: number, r: number, fx: number, fy: number): GlyphRaster;
  /** The user's preferred language as a BCP 47 tag (`cs-CZ`), or null. */
  locale(): string | null;

  // ── Input. ──
  /**
   * Key transitions since the last call, oldest first: `+Code` down, `-Code` up, where Code
   * is the DOM `KeyboardEvent.code` the browser game's router reads (`KeyI`, `ArrowUp`,
   * `Space`, `Minus`, `F2`…). The gamepad arrives as the same codes — see `pollGamepad` in
   * native/host/main.c for the mapping — so there is one router for both.
   */
  events(): string[];

  // ── Sound: the mixer (native/host/audio.c), driven by sdlAudioBackend.ts. ──
  // Everything is mono at 22050 Hz; frames are 22050 Hz samples. Buses: 0 effect, 1 voice, 2 music.
  /**
   * Open the mixer under `master` gain. Returns what drives it: `device` (the default
   * output), `dummy` (no output could be opened: SDL's silent driver keeps real time), or
   * `manual` (`--headless`: no output, the clock moves only by `audioAdvance`).
   */
  audioOpen(master: number): string;
  /** A buffer from 16-bit PCM (`Int16Array` bytes). Returns its id. */
  audioFromPcm16(pcm: ArrayBuffer): number;
  /** Decode AAC in MP4 with the platform's decoder; `maxFrames` > 0 trims. Returns [id, frames]. */
  audioDecode(bytes: ArrayBuffer, maxFrames: number): [number, number];
  /** The JS side has let go of a buffer; its PCM is freed once no voice plays it. */
  audioRelease(id: number): void;
  /** Start a buffer from the next mixed block. Loop points in frames (0 end = the buffer's). Returns the voice id. */
  audioStart(buf: number, gain: number, bus: number, loop: boolean, loopStart: number, loopEnd: number): number;
  /** Stop a voice; its id is reported by `audioEnded`. Stopping an ended voice is a no-op. */
  audioStop(voice: number): void;
  audioBusGain(bus: number, gain: number): void;
  /** Pause or resume the mix: paused, it outputs silence and its clock stands still. */
  audioPause(on: boolean): void;
  /** Frames mixed so far. */
  audioClock(): number;
  /** The voices that ended or were stopped since the last call. */
  audioEnded(): number[];
  /** How many voices are sounding. */
  audioVoices(): number;
  /** `manual` only: mix `frames` more; with `capture`, return them (float32). */
  audioAdvance(frames: number, capture?: boolean): ArrayBuffer | undefined;

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
