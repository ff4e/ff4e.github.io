/**
 * The draw surface the hi-res `ai` room compositor paints onto.
 *
 * `AiRoom.drawInto` (src/render/roomAi.ts) walks the room ONCE — background, item
 * z-order, fish, mirror, rope — and emits its primitives here. Two targets implement
 * them: `Canvas2dAiTarget` below (the canvas-2D compositor that has always shipped,
 * still the parity oracle and the no-WebGL2 / context-loss fallback) and `GlAiScreen`
 * (src/render/glRoomAi.ts, the GPU path).
 *
 * The seam is deliberately drawn HERE rather than by giving the GPU its own copy of
 * the room walk. Every rule about what is drawn, in what order, at what coordinates —
 * the gspec=2 visibility flip, the gspec=5 fish swap, the spec=1/3/4 effect anchors,
 * the slide interpolation — has one definition ACROSS THESE TWO BACKENDS, so they
 * cannot drift from each other. This codebase has already shipped bugs from hand-copied
 * duplicates of such rules (see the note on aiRoomGateAllows in roomAi.ts).
 *
 * It does NOT unify this tier with the faithful compositor: `renderInto`
 * (src/render/renderRoom.ts) still encodes those same rules independently, for the
 * native-resolution palette-index tiers. Merging the two walks is separate work; this
 * seam only ensures the `ai` tier did not become a third copy.
 *
 * Coordinates are BACKING-STORE pixels (native game px × the room's AI scale) in a
 * top-down, y-down space — the same space canvas-2D uses, which the GL target
 * reproduces rather than exposing GL's bottom-up convention upward.
 */
import { RANDPOLE, delphiRound, waterShift, waterShiftAtPhase } from './framebuffer.js';

/**
 * The water wobble as the two `ai` backends receive it: the room's FFR wave data, plus
 * the GAME TIME to evaluate it at.
 *
 * `time` is fractional — `count + alpha`, the same sub-tick fraction the loop already
 * uses to interpolate fish motion between logic ticks. `count` is kept alongside it
 * because the canvas-2D target composites on the LOGIC tick and caches on it (see
 * `Canvas2dAiTarget.background`), so it must not be handed a value that changes every
 * display frame.
 *
 * The two backends deliberately sample this differently — see `AiTarget.background`.
 */
export interface AiWobble {
  readonly wamp: number;
  readonly wper: number;
  readonly wspd: number;
  /** Integer logic tick (the faithful sampling instant). */
  readonly count: number;
  /** `count + alpha`: the same instant, at display resolution. */
  readonly time: number;
}

/**
 * The faithful per-NATIVE-row integer wobble, exactly as Kresli2 computes it — the
 * canvas-2D target's rule, and the one classic/enhanced use at native resolution.
 *
 * Evaluated at the integer `count`: this is the 1998 sampling, quantized in all three
 * axes (one shift per native row, rounded to whole native px, advanced at 12.5 Hz).
 */
export function faithfulWobbleShifts(w: AiWobble, nativeHeight: number): Int16Array {
  const out = new Int16Array(nativeHeight);
  for (let i = 0; i < nativeHeight; i++) out[i] = delphiRound(waterShift(i, w.count, w.wamp, w.wper, w.wspd));
  return out;
}

/**
 * One ripple: a Gaussian-windowed wave packet riding on the base wobble, in NATIVE units.
 *
 * `c` is its centre row, `halfW` the Gaussian sigma in rows, `amp` its peak displacement
 * in native px (already faded by its own age envelope), and `k` its angular frequency in
 * radians per row. The wave is `sin((row - c) · k)` — odd about the centre, so the packet
 * is a wavelet with no discontinuity at either end of its window.
 */
export interface Ripple {
  readonly c: number;
  readonly halfW: number;
  readonly amp: number;
  readonly k: number;
  /** Carrier phase now, in radians. Advances on its own — see `activeRipples`. */
  readonly phase: number;
}

/** Dev-tunable shape of the ripple effect; the shipped values are the defaults here. */
export interface RippleTuning {
  /** MEAN ticks between trains, before `jitter` scatters them. */
  periodTicks: number;
  /**
   * How irregular the arrivals are, 0..0.95. A gap runs
   * `periodTicks · (1 ± jitter)`, so 0 is a metronome and 0.5 gives gaps between half
   * and one-and-a-half times the mean. Must stay below 1 or births could reorder.
   */
  jitter: number;
  /** How long one train takes to cross, in ticks. */
  lifeTicks: number;
  /** Gaussian sigma of the travelling band, in native rows. */
  halfWidth: number;
  /** Peak amplitude as a fraction of the room's own `wamp/2`. 0 disables the effect. */
  amp: number;
  /** Carrier angular frequency as a multiple of the base wave's `1/wper`. */
  freq: number;
  /** Carrier phase speed, radians per tick — how fast the crests themselves flow. */
  carrier: number;
  /**
   * How many trains may overlap. Clamped to `RIPPLE_GPU_SLOTS` when the list is built —
   * the GPU path has a fixed number of uniform slots and would otherwise drop the excess
   * silently, which would also desync the JS oracle that scores it.
   */
  max: number;
  /**
   * Shifts the birth schedule, in ticks. Zero in the game; the ripple lab sets it to
   * start a train on demand instead of waiting out `periodTicks`.
   */
  offsetTicks: number;
}

/**
 * The shipped ripple tuning. Mutable so a capture/dev probe can sweep it without a
 * rebuild — nothing in the game writes to it.
 *
 * Chosen on screen, in the lab, not derived. What the numbers mean: a train takes
 * `lifeTicks` = 48 ticks (~3.8 s) to rise, and the next is born a mean `periodTicks` = 60
 * ticks (~4.8 s) after the last. Because the mean gap EXCEEDS the lifetime, trains are
 * usually discrete events with calm water between them — `jitter` = 0.5 then spreads the
 * gaps over 30..90 ticks (2.4..7.2 s) so they do not arrive on a metronome, and `max` = 2
 * covers the part of that spread where one train is still leaving as the next arrives.
 */
/**
 * How many ripple trains the GPU path can carry at once.
 *
 * The single definition of that number: `glRoomAi.ts` sizes its uniform arrays, its
 * upload buffers and its GLSL loop bound from this, and `activeRipples` clamps to it. It
 * used to be a literal 3 repeated in four places (a JS const, two GLSL array sizes and a
 * loop bound) against a tuning cap of 2 — an arrangement where raising the cap dropped
 * trains on the floor with no error.
 */
export const RIPPLE_GPU_SLOTS = 3;

export const RIPPLE: RippleTuning = {
  periodTicks: 60,
  jitter: 0.5,
  lifeTicks: 48,
  halfWidth: 25,
  amp: 0.8,
  freq: 6,
  carrier: 0.4,
  max: 2,
  offsetTicks: 0,
};

/**
 * When train `n` is born, in ticks — deterministic, and strictly increasing in `n`.
 *
 * Both properties are load-bearing. Deterministic, because a frame has to be a pure
 * function of game time (see `rippleHash`); strictly increasing, because the search in
 * `activeRipples` finds the live trains by bracketing `n` around `clock / periodTicks`,
 * which only works if birth order matches index order. That is why the offset is a
 * bounded jitter around a fixed cadence rather than an accumulated random walk: a walk
 * would drift away from the bracket without limit and trains would start disappearing.
 * `jitter` is clamped below 1 so the gap can never reach zero or go negative.
 */
function birthTick(n: number, t: RippleTuning): number {
  const j = Math.min(Math.max(t.jitter, 0), 0.95);
  return n * t.periodTicks + (rippleHash(n, 6) - 0.5) * j * t.periodTicks;
}

/** The first train born strictly after `clock` (used by the lab's "start a train now"). */
export function nextRippleBirth(clock: number, t: RippleTuning = RIPPLE): number {
  let n = Math.floor(clock / Math.max(1, t.periodTicks)) - 1;
  for (let i = 0; i < 8; i++, n++) {
    const b = birthTick(n, t);
    if (b > clock) return b;
  }
  return clock + t.periodTicks;
}

/**
 * A stable [0,1) pseudo-random from a ripple index — integer mixing only.
 *
 * NOT `Math.random()`, and that is the whole point: every frame this tier draws has to be
 * a pure function of game time, or the JS oracle in `aiWobbleCheck` cannot reproduce what
 * the shader drew, the composite cache cannot key on anything, and two calls at the same
 * `count` stop agreeing. "Random-looking" here means "a hash of which ripple this is".
 * It also must not draw on the engine's own RNG, which is game state.
 */
function rippleHash(n: number, salt: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x165667b1, 0xc2b2ae35);
  x = Math.imul(x ^ (x >>> 15), 0x2545f491);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/**
 * The ripple trains alive at `w.time`, newest first.
 *
 * A train is a broad Gaussian BAND that sweeps across the room once, carrying a much
 * finer wave inside it. Its two speeds are deliberately independent, which is the whole
 * trick: the band (the group velocity) crosses the room in `lifeTicks`, while the crests
 * inside it (the phase velocity) advance at `carrier` rad/tick.
 *
 * Tying the two together — the obvious first implementation — does not work. A band wide
 * enough to read as "a wave of ripples" has to cross ~900 native rows in a few seconds,
 * i.e. ~20 rows/tick; at a carrier of 0.6 rad/row that is ~19 Hz of crest passage, which
 * is above what a 30 fps idle repaint can show and turns the whole effect into aliased
 * shimmer. Split, the band can sweep fast while the crests flow at a visible ~2 Hz.
 *
 * Trains always run BOTTOM TO TOP, like anything rising through water; the direction is
 * not randomised, because water that sometimes flows one way and sometimes the other
 * reads as a glitch rather than as a current.
 *
 * Arrivals are irregular: `birthTick` scatters them around a mean cadence by `jitter`,
 * so the water is not on a metronome. Everything else is hashed from the train's index
 * too (width, strength, pace, exact frequency and phase), so the sequence looks random
 * but is identical on every machine and every replay. Each fades in and out over its life
 * (`sin(π·age)`), so nothing pops, and each starts and ends fully off-screen.
 *
 * Returns nothing for a room with `wamp === 0` (46 and 66): a still room stays still, and
 * that is also what keeps the CPU↔GPU still-water parity comparison exact.
 */
export function activeRipples(w: AiWobble, nativeHeight: number, t: RippleTuning = RIPPLE): Ripple[] {
  if (w.wamp === 0 || t.amp <= 0 || t.lifeTicks <= 0 || t.periodTicks <= 0) return [];
  const out: Ripple[] = [];
  const cap = Math.min(t.max, RIPPLE_GPU_SLOTS);
  const clock = w.time + t.offsetTicks;
  // A train born at birthTick(n) is alive while clock - birthTick(n) is in [0, life).
  // birthTick sits within ±jitter·period/2 of n·period, so bracket `n` by that much and
  // test each candidate — newest first, so the `max` cap drops the OLDEST (already
  // fading, on its way off-screen) rather than the one just arriving.
  const slack = t.periodTicks * 0.5 + 1;
  const hi = Math.floor((clock + slack) / t.periodTicks);
  const lo = Math.ceil((clock - t.lifeTicks - slack) / t.periodTicks) - 1;
  for (let n = hi; n >= lo && out.length < cap; n--) {
    const age = clock - birthTick(n, t);
    if (age < 0 || age >= t.lifeTicks) continue;
    const u = age / t.lifeTicks;
    const sigma = t.halfWidth * (0.8 + 0.4 * rippleHash(n, 3));
    // Enter and leave fully outside the room, so the band is never clipped mid-crest.
    // Row 0 is the TOP, so rising means a decreasing centre.
    const span = (nativeHeight + 4 * sigma) * (0.9 + 0.2 * rippleHash(n, 1));
    out.push({
      c: nativeHeight + 2 * sigma - u * span,
      halfW: sigma,
      amp: (w.wamp / 2) * t.amp * (0.7 + 0.3 * rippleHash(n, 2)) * Math.sin(Math.PI * u),
      k: (t.freq / w.wper) * (0.85 + 0.3 * rippleHash(n, 4)),
      // Increasing phase moves the crests toward decreasing rows, i.e. up with the band.
      phase: rippleHash(n, 5) * Math.PI * 2 + t.carrier * age,
    });
  }
  return out;
}

/**
 * The `ai` tier's CONTINUOUS wobble: the horizontal displacement, in SCALED pixels, of
 * scaled row `y` — the exact rule `glRoomAi.ts`'s BG_FS evaluates per fragment, kept
 * here in JS so a probe can hold the shader to it without restating it.
 *
 * `(y + 0.5)/scale - 0.5` is the scaled row's centre expressed as a NATIVE row
 * coordinate. That centring matters: its mean over the `scale` rows of one native row's
 * band is exactly that native row's index, so the smooth curve is the faithful curve
 * resampled — it does not translate the image. (Using `y/scale` instead would bias the
 * whole background up by half a native row.)
 *
 * `phase` is `time/wspd` pre-reduced into [0, 2π) in FP64 by `wobblePhase` below.
 * `ripples` is the additive wave-packet term (see `activeRipples`); pass none for the
 * bare 1998 curve.
 */
export function smoothWobbleShift(
  y: number,
  scale: number,
  w: AiWobble,
  phase: number,
  ripples: readonly Ripple[] = [],
): number {
  const row = (y + 0.5) / scale - 0.5;
  // The base swell is the FAITHFUL rule, imported — not restated. Only the phase
  // differs (pre-reduced, see wobblePhase), which is why framebuffer.ts splits
  // `waterShiftAtPhase` out of `waterShift`.
  let sh = waterShiftAtPhase(row, phase, w.wamp, w.wper);
  for (const r of ripples) {
    const e = (row - r.c) / r.halfW;
    // Band (group) and crests (phase) are separate: the envelope follows `r.c`, the
    // carrier follows `r.phase`. See activeRipples for why they must not be the same.
    sh += r.amp * Math.exp(-0.5 * e * e) * Math.sin(row * r.k + r.phase);
  }
  return sh * scale;
}

/**
 * `time/wspd` reduced into [0, 2π).
 *
 * The GPU evaluates `sin` in FP32, and `count` grows without bound — an hour of play is
 * `count ≈ 45 000`, so the raw argument reaches ~9 000 rad and ten hours reaches ~90 000,
 * where FP32 range reduction visibly degrades. Reducing here, in FP64, keeps the shader's
 * argument small forever and keeps it within ~1e-7 of this JS oracle, which is what lets
 * a probe pin one against the other.
 */
export function wobblePhase(w: AiWobble): number {
  const TAU = Math.PI * 2;
  return ((w.time / w.wspd) % TAU + TAU) % TAU;
}

/** Anything both backends can sample: staged AI art, or a ×S palette sprite canvas. */
export type AiImage = ImageBitmap | HTMLCanvasElement;

const aiImageMutations = new WeakMap<AiImage, { revision: number; patch: AiImagePatch | null }>();

/** A rectangle of straight-RGBA pixels that a mutation wrote, tagged with its revision. */
export interface AiImagePatch {
  readonly revision: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
}

/**
 * How many times this source image has been mutated in place.
 *
 * Almost all `ai` art is immutable once decoded, so both backends cache by source
 * IDENTITY. LODE's falling wreck breaks that: it exchanges pixels between the room
 * background and the ship sprite, so the background image object stays the same while
 * its pixels change. An identity-only cache then keeps serving the undamaged art —
 * invisibly on canvas-2D, which re-reads the canvas anyway, and permanently on the GPU,
 * whose texture was uploaded once.
 *
 * Same shape and same reason as `bitmapPixelRevision` in data/ffr.ts, which exists for
 * this exact effect on the faithful tier (see glScreen.ts's `lastUpload`). It is a
 * separate mechanism rather than that one because these are DOM images, not the
 * `Uint8Array` bitmap planes that one keys on, and because a texture consumer needs the
 * dirty rect that one has no notion of.
 */
export function aiImageRevision(img: AiImage): number {
  return aiImageMutations.get(img)?.revision ?? 0;
}

/**
 * The pixels the LAST mutation wrote, for a consumer that can update in place.
 *
 * Re-uploading LODE's whole ×4 background costs 12.3 ms on an M4 — a dropped frame on
 * every logic tick of the fall — against 0.68 ms for a `texSubImage2D` of the ship's
 * footprint. Only the most recent patch is kept: a consumer exactly one revision behind
 * (the GPU, which draws every frame) takes it, anything further behind re-uploads whole.
 */
export function aiImagePatch(img: AiImage): AiImagePatch | null {
  return aiImageMutations.get(img)?.patch ?? null;
}

/**
 * Mark an image's pixels as changed without replacing the image object.
 *
 * A mutation with no patch (the wreck resetting to pristine art) DROPS the stored patch,
 * so the next consumer cannot mistake a stale rect for the current delta and must
 * re-upload whole.
 */
export function markAiImageChanged(img: AiImage, patch?: { x: number; y: number; w: number; h: number; data: Uint8ClampedArray }): void {
  const revision = aiImageRevision(img) + 1;
  aiImageMutations.set(img, { revision, patch: patch ? { revision, ...patch } : null });
}

export interface AiTarget {
  /** Backing-store size in pixels (native × the room's AI scale). */
  readonly width: number;
  readonly height: number;

  /** Fill the whole target with an opaque colour (the gspec=2 darkness room). */
  fill(r: number, g: number, b: number): void;

  /** Opaque rect fill in backing-store px (the spec=3/4 elevator rope). */
  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void;

  /** Alpha-blend `src` at (x,y), optionally mirrored horizontally (KresliRev). */
  blit(src: AiImage, x: number, y: number, mirror: boolean): void;

  /**
   * The wall-over-wobbled-background composite.
   *
   * **The two backends deliberately sample the water differently, and this is the only
   * place in the tier where that is true.** `wobble` is the room's wave DATA (null = the
   * room does not wobble), not a pre-computed answer, precisely because there are now two
   * answers:
   *
   *  - `GlAiScreen` evaluates the wave per FRAGMENT at ×S — a shift per scaled row, a
   *    fractional shift sampled between source columns, and the sub-tick `time`. The
   *    water is then as hi-res as the art, which is the whole point of the tier (the
   *    same reasoning already shipped for the mirror, `AiRoom.drawMirror`).
   *  - `Canvas2dAiTarget` keeps the faithful 1998 sampling: one rounded shift per NATIVE
   *    row, advanced on the logic tick. It cannot follow — at ×S the spatial half is
   *    thousands of `drawImage` calls per rebuild, and a fractional `time` misses its
   *    composite cache on every single display frame. It is the FALLBACK (no WebGL2,
   *    context loss, the CPU-only frame paths), and a fallback being lower fidelity is
   *    what a fallback is.
   *
   * `sig` identifies the composite so a target may reuse a cached copy across frames; it
   * carries the LOGIC tick, so a target that caches on it is not invalidated by the
   * sub-tick term only the GPU consumes.
   */
  background(sig: string, bg: AiImage, wall: AiImage, wobble: AiWobble | null, scale: number): void;

  /**
   * The gspec=42 ZX composite: the same wobbled background, but the wall painted as flat
   * loading stripes instead of as art (see zxBands.ts).
   *
   * Separate from `background` rather than a flag on it because the wall stops being a
   * picture here — only its SILHOUETTE survives, and the colour comes from the palette.
   * `bands` is one palette index per NATIVE row, already sequenced; a target paints each
   * entry `scale` device rows tall and must not re-derive the sequence, because
   * generating it advances the room's band state.
   *
   * Not cached on `sig` by the callers: the stripes move every frame, so there is
   * nothing to reuse.
   */
  backgroundZx(
    bg: AiImage,
    wall: AiImage,
    bands: Uint8Array,
    palette: ReadonlyArray<{ r: number; g: number; b: number }>,
    wobble: AiWobble | null,
    scale: number,
  ): void;

  /** KresliK's dithered dissolve of `src` at (x,y) — see the RANDPOLE rule below. */
  disintegrate(src: AiImage, x: number, y: number, scale: number, rozpad: number): void;

  /**
   * KresliZrcadlo: replace the already-composited pixels under the mirror's glass with
   * their reflection about the mirror axis. `x`,`y` are NATIVE coordinates and `w`,`h`
   * the mirror bitmap's NATIVE size; `mask` is the per-pixel glassness of the mirror's
   * ×S sprite (`mw`×`mh`), 0 = keep, 1 = fully reflected, in between = blended rim.
   */
  mirrorGlass(
    x: number,
    y: number,
    w: number,
    h: number,
    scale: number,
    mask: Float32Array,
    mw: number,
    mh: number,
  ): void;
}

/**
 * True where KresliK keeps the source pixel: `RANDPOLE[(row*w + col) & 255] < rozpad`,
 * evaluated on the ORIGINAL pixel grid (the AI sprite is ×S of it) so the dissolve keeps
 * the faithful render's coarse granularity instead of turning into fine noise. As
 * `rozpad` counts down, fewer indices pass and the skeleton erodes away.
 *
 * **The inequality is the whole rule and it is easy to get backwards** — an earlier
 * revision of this function had it reversed, so the skeleton materialised instead of
 * eroding. Nothing caught it: both AI backends call THIS function, so the CPU↔GPU parity
 * probe compared two identically-wrong implementations and reported a byte-exact match.
 * It is pinned against the faithful `RgbaScreen.blitDisintegrate` in test/roomAi.test.ts
 * by IMPORTING this function rather than restating it — a restated copy cannot catch the
 * bug it is guarding.
 */
export function dissolveKeeps(nativeRow: number, nativeCol: number, nativeW: number, rozpad: number): boolean {
  return RANDPOLE[(((nativeRow * nativeW) & 255) + nativeCol) & 255]! < rozpad;
}

/**
 * The canvas-2D compositor: the `ai` tier's fallback renderer and its parity oracle.
 *
 * Fidelity note, because it is the one place the tier is not backend-independent: this
 * target draws the FAITHFUL 1998 water wobble (banded, integer, 12.5 Hz) while the GPU
 * draws it at ×S. See `AiTarget.background`.
 */
export class Canvas2dAiTarget implements AiTarget {
  private ctx: CanvasRenderingContext2D;
  /** Cached background+wall composite, and the signature it was built for. */
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgSig = '';
  /** Scratch canvas the ZX stripes are masked on (see backgroundZx). */
  private zxCanvas: HTMLCanvasElement | null = null;
  /** Scratch canvas reused by the skeleton dissolve (see disintegrate). */
  private dissolveCanvas: HTMLCanvasElement | null = null;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  /** Point this target at the frame's context (the caches outlive any one frame). */
  bind(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  /** Drop the cached composites (AiRoom.dispose). */
  release(): void {
    this.bgCanvas = null;
    this.bgSig = '';
    this.dissolveCanvas = null;
  }

  get width(): number { return this.ctx.canvas.width; }
  get height(): number { return this.ctx.canvas.height; }

  // #screen is shared with drawMap / drawCutscene / the room-loading fill, so these
  // restore `fillStyle` rather than leaving the room's colour on the context.
  fill(r: number, g: number, b: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  blit(src: AiImage, x: number, y: number, mirror: boolean): void {
    const ctx = this.ctx;
    if (!mirror) { ctx.drawImage(src, x, y); return; }
    ctx.save();
    ctx.translate(x + src.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }

  /**
   * Draw the background+wall composite, reusing a cached copy when it has not changed.
   *
   * The composite depends only on the wall's animation phase and — when the room has
   * water wobble — the logic tick, both of which advance at 12.5Hz. The fish, however,
   * interpolate between ticks, so the room repaints at the display rate; without this
   * cache every one of those frames re-ran the whole banded wobble.
   *
   * Measured on a 435×405 room at ×4: 85 drawImage calls and 5.98 Mpx blitted per
   * frame, against a canvas of only 2.82 Mpx. Cached, a repeat frame is a single
   * full-canvas blit. With no wobble the composite is built exactly once.
   */
  background(sig: string, bg: AiImage, wall: AiImage, wobble: AiWobble | null, scale: number): void {
    const ctx = this.ctx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    // The faithful integer shift table, derived here rather than handed down: this target
    // is the only consumer of it now (the GPU samples the wave continuously instead).
    const shifts = wobble ? faithfulWobbleShifts(wobble, Math.max(1, Math.round(bg.height / scale))) : null;
    // No DOM (unit tests drive this with a recording context) ⇒ paint straight through.
    // The cache is a rendering optimisation, not behaviour: the composite it produces is
    // identical either way, so the uncached path is the correct fallback.
    if (typeof document === 'undefined') { this.paint(ctx, bg, wall, shifts, scale); return; }
    const key = `${sig}|${W}x${H}`;
    if (!this.bgCanvas || this.bgSig !== key) {
      if (!this.bgCanvas) this.bgCanvas = document.createElement('canvas');
      if (this.bgCanvas.width !== W || this.bgCanvas.height !== H) {
        this.bgCanvas.width = W;
        this.bgCanvas.height = H;
      }
      const bctx = this.bgCanvas.getContext('2d');
      if (!bctx) { this.bgCanvas = null; this.paint(ctx, bg, wall, shifts, scale); return; }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.imageSmoothingEnabled = false;
      bctx.clearRect(0, 0, W, H);
      this.paint(bctx, bg, wall, shifts, scale);
      this.bgSig = key;
    }
    ctx.drawImage(this.bgCanvas, 0, 0);
  }

  /**
   * The ZX composite: wobbled background, then the wall's silhouette filled with flat
   * horizontal loading stripes.
   *
   * The wall image is used as a MASK, not as art. `source-in` against the stripes keeps
   * exactly the pixels the wall is opaque at — which at ×S is the AI wall's own alpha,
   * so the silhouette is as hi-res as the rest of the tier while the stripes stay
   * quantised to native rows. That split is the point: the low-fi thing about ZX is the
   * band structure, not the outline of the room.
   *
   * Uncached, unlike `background`: the stripes advance every frame, so there is nothing
   * a signature could reuse.
   */
  backgroundZx(
    bg: AiImage,
    wall: AiImage,
    bands: Uint8Array,
    palette: ReadonlyArray<{ r: number; g: number; b: number }>,
    wobble: AiWobble | null,
    scale: number,
  ): void {
    const ctx = this.ctx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const shifts = wobble ? faithfulWobbleShifts(wobble, Math.max(1, Math.round(bg.height / scale))) : null;
    this.paintBg(ctx, bg, shifts, scale);
    if (typeof document === 'undefined') return; // no DOM ⇒ no scratch canvas; background only
    let cv = this.zxCanvas;
    if (!cv || cv.width !== W || cv.height !== H) {
      cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      this.zxCanvas = cv;
    }
    const zctx = cv.getContext('2d');
    if (!zctx) return;
    zctx.setTransform(1, 0, 0, 1, 0, 0);
    zctx.globalCompositeOperation = 'source-over';
    zctx.clearRect(0, 0, W, H);
    // Stripes first, then keep only what the wall covers. Consecutive native rows
    // sharing a colour are one rect — at pruh 38.5 that is most of them.
    let start = 0;
    const flush = (endRow: number): void => {
      const c = palette[bands[start]!] ?? { r: 0, g: 0, b: 0 };
      zctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      zctx.fillRect(0, start * scale, W, (endRow - start) * scale);
    };
    for (let i = 1; i < bands.length; i++) {
      if (bands[i] !== bands[start]) {
        flush(i);
        start = i;
      }
    }
    flush(bands.length);
    // destination-in, NOT source-in: keep the STRIPES where the wall is opaque. The
    // other way round replaces the stripes with the wall art clipped to them, which
    // composites to an ordinary AI room and looks plausible enough to ship by mistake.
    zctx.globalCompositeOperation = 'destination-in';
    zctx.drawImage(wall, 0, 0);
    ctx.drawImage(cv, 0, 0);
  }

  /**
   * Wall over the water-wobbled background. Only the background wobbles (a per-row
   * horizontal shift, Kresli2), so it is drawn as horizontal bands — consecutive
   * native rows sharing a shift are one draw — then the wall (its matted alpha carries
   * the doorway hole) is drawn flat on top.
   */
  private paint(ctx: CanvasRenderingContext2D, bg: AiImage, wall: AiImage, shifts: Int16Array | null, scale: number): void {
    this.paintBg(ctx, bg, shifts, scale);
    ctx.drawImage(wall, 0, 0);
  }

  /** The wobbled background alone — the half `backgroundZx` shares, which paints its own wall. */
  private paintBg(ctx: CanvasRenderingContext2D, bg: AiImage, shifts: Int16Array | null, scale: number): void {
    if (shifts === null) {
      ctx.drawImage(bg, 0, 0);
    } else {
      const W = bg.width;
      const H = shifts.length;
      let bandStart = 0;
      let bandK = shifts[0]!;
      const flush = (endRow: number) => {
        const sy = bandStart * scale;
        const sh = (endRow - bandStart) * scale;
        const dx = -bandK * scale; // dest[j] = bg[j+k] ⇒ shift the image left by k
        ctx.drawImage(bg, 0, sy, W, sh, dx, sy, W, sh);
        if (bandK > 0) ctx.drawImage(bg, W - 1, sy, 1, sh, W - bandK * scale, sy, bandK * scale, sh); // clamp right edge
        else if (bandK < 0) ctx.drawImage(bg, 0, sy, 1, sh, 0, sy, -bandK * scale, sh); // clamp left edge
      };
      for (let i = 1; i < H; i++) {
        const k = shifts[i]!;
        if (k !== bandK) { flush(i); bandStart = i; bandK = k; }
      }
      flush(H);
    }
  }

  /**
   * KresliK's dithered dissolve at ×S. Composed on a scratch canvas — punching the
   * holes with clearRect there and blitting once keeps the room composite untouched.
   */
  disintegrate(src: AiImage, x: number, y: number, scale: number, rozpad: number): void {
    const nw = Math.max(1, Math.round(src.width / scale));
    const nh = Math.max(1, Math.round(src.height / scale));
    let cv = this.dissolveCanvas;
    if (!cv || cv.width !== src.width || cv.height !== src.height) {
      cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height;
      this.dissolveCanvas = cv;
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(src, 0, 0);
    for (let i = 0; i < nh; i++) {
      for (let j = 0; j < nw; j++) {
        if (dissolveKeeps(i, j, nw, rozpad)) continue;
        g.clearRect(j * scale, i * scale, scale, scale);
      }
    }
    this.ctx.drawImage(cv, x, y);
  }

  /**
   * KresliZrcadlo at ×S. Original col d reflects to 2X+3-d, so with sub-pixel accuracy
   * scaled col D reflects to S*(2X+4)-1-D (a true mirror, flipping inside each source
   * pixel too — a free win from having real hi-res art). Rows are untouched. Reads from
   * a snapshot of the pre-mirror pixels, which is what the original's in-place
   * left-to-right loop effectively produces (its near-axis self-reference reads
   * glass→glass, a no-op).
   */
  mirrorGlass(X: number, Y: number, w: number, h: number, S: number, mask: Float32Array, MW: number, MH: number): void {
    const ctx = this.ctx;
    const CW = ctx.canvas.width, CH = ctx.canvas.height;
    // dest span [X, X+w) and its reflection [X+4-w, X+4), both in native columns.
    const rx0 = Math.max(0, Math.min(X, X + 4 - w) * S);
    const rx1 = Math.min(CW, Math.max(X + w, X + 4) * S);
    const ry0 = Math.max(0, Y * S), ry1 = Math.min(CH, (Y + h) * S);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const img = ctx.getImageData(rx0, ry0, rx1 - rx0, ry1 - ry0);
    const px = img.data;
    const snap = new Uint8ClampedArray(px); // pre-mirror snapshot to read from
    const RW = img.width;
    const K = S * (2 * X + 4) - 1; // srcCol = K - destCol
    const dx0 = Math.max(rx0, X * S), dx1 = Math.min(rx1, (X + w) * S);
    for (let sy = ry0; sy < ry1; sy++) {
      const my = sy - Y * S;
      if (my < 0 || my >= MH) continue;
      const rowBase = (sy - ry0) * RW;
      const mRow = my * MW;
      for (let D = dx0; D < dx1; D++) {
        const mx = D - X * S;
        if (mx < 0 || mx >= MW) continue;
        const g = mask[mRow + mx]!;
        if (g <= 0) continue; // frame / highlight streak / outside the glass
        const sX = K - D;
        if (sX < rx0 || sX >= rx1) continue;
        const di = (rowBase + (D - rx0)) * 4;
        const si = (rowBase + (sX - rx0)) * 4;
        if (g >= 1) {
          px[di] = snap[si]!; px[di + 1] = snap[si + 1]!; px[di + 2] = snap[si + 2]!; px[di + 3] = 255;
        } else { // soft rim: blend so the oval edge stays anti-aliased
          const n = 1 - g;
          px[di] = snap[si]! * g + snap[di]! * n;
          px[di + 1] = snap[si + 1]! * g + snap[di + 1]! * n;
          px[di + 2] = snap[si + 2]! * g + snap[di + 2]! * n;
          px[di + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, rx0, ry0);
  }
}
