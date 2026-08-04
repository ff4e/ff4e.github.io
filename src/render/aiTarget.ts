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
import { RANDPOLE, delphiRound, waterShift } from './framebuffer.js';

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
 */
export function smoothWobbleShift(y: number, scale: number, w: AiWobble, phase: number): number {
  const row = (y + 0.5) / scale - 0.5;
  return (w.wamp / 2) * scale * Math.sin(row / w.wper + phase);
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
   *    same reasoning already shipped for the mirror, roomAi.ts:816).
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
   * Wall over the water-wobbled background. Only the background wobbles (a per-row
   * horizontal shift, Kresli2), so it is drawn as horizontal bands — consecutive
   * native rows sharing a shift are one draw — then the wall (its matted alpha carries
   * the doorway hole) is drawn flat on top.
   */
  private paint(ctx: CanvasRenderingContext2D, bg: AiImage, wall: AiImage, shifts: Int16Array | null, scale: number): void {
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
    ctx.drawImage(wall, 0, 0);
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
