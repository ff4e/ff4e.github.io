/**
 * The functions the C host (native/host/main.c) installs on `globalThis.__native`.
 * This file is the whole contract between the JS game and the native shell.
 */
export interface NativeTexture {
  readonly id: number;
  readonly width: number;
  readonly height: number;
}

export interface MovieInfo {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  /** Seconds: the longer of its tracks, as a <video> reports it. */
  readonly duration: number;
  readonly frameRate: number;
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
  /** Whether a file is under the asset root (the browser's HEAD probe), without reading it. */
  fileExists(path: string): boolean;
  /** Write `bytes` to `path` (as given, not under the asset root): output for the parity harnesses. */
  writeFile(path: string, bytes: ArrayBuffer): void;
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
   * subtitles, laid out for the rect `presentRect` reports. `ui` is a surface drawn over the
   * whole window at one texel per window pixel (the menus and the button legend, `uiLayer.ts`).
   */
  present(overlay?: number, ui?: number): void;
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
  /**
   * Show a surface (or a movie frame) in the window, as `present` shows the composite, with
   * `overlay` — a premultiplied surface the size of the whole WINDOW — drawn over it 1:1, and
   * `ui` (the menus and the legend, `uiLayer.ts`) over that.
   */
  presentTexture(id: number, overlay?: number, ui?: number): void;
  /** Built for tvOS: the remote is the input until something else is pressed. */
  readonly tv: boolean;
  /** `[w, h, density]`: the window's size in pixels, and pixels per point. Null headless. */
  windowSize(): [number, number, number] | null;
  /**
   * `[left, top, right, bottom]`: how far in from each edge of the window, in its pixels, what
   * must be seen has to stay — a TV's title-safe insets (tvOS: the view's `safeAreaInsets`,
   * 60 points above and below and 80 at the sides). Zeros on a desktop; null headless.
   */
  safeArea(): [number, number, number, number] | null;
  /**
   * Whether the system owns Back now, given that the game is (`atRoot`) or is not at its top
   * level: true only on tvOS at the top level, where Back must go Home and the game must not
   * quit itself (native/host/main.c, `n_systemBack`).
   */
  systemBack(atRoot: boolean): boolean;
  /**
   * Where the thumb is on the Siri Remote's touch surface, `[x, y]` in -1..1 (right, down),
   * or null when nothing touches it, no remote is connected, or headless
   * (native/host/main.c, `n_remoteTouch`). Read by `remoteSwipe.ts` through `uiInput.ts`.
   */
  remoteTouch(): [number, number] | null;
  /** A text file by plain path (not under the asset root), or null when absent. */
  readText(path: string): string | null;
  /** Write a text file by plain path. Throws when it cannot. */
  writeText(path: string, text: string): void;
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
   * Input transitions since the last call, oldest first: `+Code` down, `-Code` up,
   * `!blur` when the window loses focus, `!background` when the app left the foreground
   * (delivered on its first frame back: nothing runs in between), and `!kvs` when iCloud
   * brings another device's progress. A keyboard's Code is the DOM `KeyboardEvent.code`
   * the browser game's router reads (`KeyI`, `ArrowUp`, `Space`, `Minus`, `F2`…); a
   * gamepad's is `Pad…` and a TV remote's `Remote…` (the list is in native/host/main.c's
   * input section). `uiInput.ts` routes them.
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

  // ── Movies (native/host/movie.c over the platform decoder; native/js/movie.ts). ──
  /** Open a movie under the asset root to read its frames from `start` s. Throws when it cannot. */
  movieOpen(path: string, start?: number): MovieInfo;
  /**
   * `[texture, pts, last]`: the frame shown at `t` s — the last whose time is not after `t` —
   * decoded forward to and uploaded into a BGRA texture (0 while none is due yet), its time,
   * and whether it is the movie's last frame.
   */
  movieFrame(id: number, t: number): [number, number, boolean];
  /** Decode the movie's sound and start it now, beside the mixer at gain 1. False: it has none. */
  moviePlay(id: number): boolean;
  /** Seconds into the playing movie's sound — the A/V clock — or null with none playing. */
  movieClock(): number | null;
  /** Headless only: play `ms` more of the movie's sound; with `capture`, return it (interleaved float32). */
  movieAdvance(ms: number, capture?: boolean): ArrayBuffer | undefined;
  /** The movie's audio track decoded on its own: `[interleaved float32, channels, rate]`, or null. */
  movieAudioPcm(path: string): [ArrayBuffer, number, number] | null;
  /** Close a movie: its decoder, its texture, and its sound if it is the one playing. */
  movieClose(id: number): void;

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
  /**
   * The store is `TvStore` (`tvStore.ts`): built for tvOS, or `--tv-store DIR` on a Mac,
   * where the four calls below are files in DIR (`native/host/store.c`).
   */
  readonly tvStore: boolean;
  /** The NSUserDefaults copy (`damaged`: the unreadable one set aside), or null. */
  prefsLoad(damaged: boolean): string | null;
  /** Replace it; throws when it cannot (the Mac stand-in: over 500 000 bytes, as tvOS's limit). */
  prefsSave(json: string, damaged: boolean): void;
  /** Every `ff4e.` key in iCloud's key-value store, as a JSON object of strings. */
  kvsLoad(): string;
  /** Set (or with null remove) one key; throws over its limits (1024 keys, 1 MB, 128-char keys). */
  kvsSave(key: string, value: string | null): void;
  args(): string[];
  /** Leave the frame loop; the process exits with `code` (default 0). */
  quit(code?: number): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __native: NativeApi;
}
