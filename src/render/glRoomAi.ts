/**
 * GPU backend for the hi-res `ai` room compositor (`AiTarget`, src/render/aiTarget.ts).
 *
 * Why this is not part of `GlScreen`: that class exists to composite the classic /
 * enhanced tiers, which are palette-INDEX renders. Its whole shape — MRT (RGBA8 colour
 * + R8UI index plane), the palette LUT texture, the ping-pong index buffers — serves
 * the index read-back effects, and its byte-exact CPU parity across all 72 rooms is a
 * hard constraint. The `ai` tier has no index plane at all: its art is straight-RGBA
 * `ImageBitmap`s and its one read-back effect (the spec=1 mirror) keys off a chroma
 * mask, not an index. Growing a second, differently-shaped pipeline inside GlScreen is
 * how that parity gets regressed by accident. What actually has to be shared is the
 * WebGL2 CONTEXT — one canvas, one context — and that is shared; the class is not.
 *
 * Conventions follow glScreen.ts so the two are readable together: textures are
 * uploaded top-down (row 0 = top), `gl_FragCoord.y` IS the top-down row, and the
 * present pass flips Y on the way to the canvas.
 *
 * Everything is composited into an offscreen FBO at the room's ×S backing resolution —
 * the same buffer the canvas-2D path paints, so `readback()` is directly comparable to
 * it (see tools/test-gl-room-ai.mjs) — and then presented, downscaled, to #screen-gl.
 */
import { RANDPOLE } from './framebuffer.js';
import {
  QUAD_VS,
  RECT_VS,
  linkProgram,
  makeFullscreenVao,
  makeRectVao,
  nearestClamp,
  setRectUniform,
  uniformLocations,
  type Uni,
} from './glCommon.js';
import { RIPPLE_GPU_SLOTS, activeRipples, aiImagePatch, aiImageRevision, wobblePhase } from './aiTarget.js';
import type { AiImage, AiTarget, AiWobble } from './aiTarget.js';

/** Opaque colour fill (the darkness room, the elevator rope). */
const FILL_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor, 1.0); }`;

/**
 * Wall over the water-wobbled background, in ONE opaque pass — and the one place the
 * `ai` tier renders the water at the resolution of its art rather than at 1998's.
 *
 * Kresli2's wobble is `dest[j] = bg[j + k]` for the row's shift k. The 1998 engine
 * indexed a bitmap with k, so k was quantized three ways: one value per NATIVE row,
 * rounded to a whole NATIVE pixel, advanced once per 12.5 Hz logic tick. Magnified ×4
 * that is a 4-scaled-pixel step, held across runs of a dozen or more scaled rows, lurching
 * eight times a second — the one element of the tier that visibly was not hi-res, on
 * screen in 70 of 72 rooms. None of those quantizations is part of the RULE; they are
 * the sampling. So this evaluates the rule directly instead:
 *
 *   - per FRAGMENT, from the scaled row's own centre expressed as a native-row
 *     coordinate — `(y + 0.5)/S - 0.5`, whose mean over a band is the native row index,
 *     so the wave is resampled, not translated;
 *   - as a FRACTIONAL shift in scaled pixels, linearly interpolated between the two
 *     source columns it falls between;
 *   - at `count + alpha`, the sub-tick fraction the loop already uses for fish motion.
 *
 * Interpolating by hand (two `texelFetch` + `mix`) rather than binding a LINEAR sampler
 * is deliberate: hardware filtering carries only 8 sub-texel bits and the exact result
 * is vendor-dependent, whereas this is FP32 arithmetic that a JS oracle can reproduce
 * exactly. It also leaves the texture's own NEAREST/CLAMP state alone, which the LODE
 * wreck's in-place patches share.
 *
 * `uPhase` arrives pre-reduced into [0, 2π) — see `wobblePhase` in aiTarget.ts for why
 * a FP32 `sin` must not be handed a raw `count/wspd`.
 *
 * RIPPLES (`uRip`/`uRipPh`) are an additive second term and, unlike everything above,
 * they are a genuine LIBERTY rather than a resampling: the 1998 engine had one sine and
 * no more. Every so often a broad Gaussian BAND sweeps across the room carrying a much
 * finer wave (~6× the base frequency) inside it — so the water occasionally gets a train
 * of ripples flowing through, and is plain in between.
 *
 * The band and the crests move at different speeds ON PURPOSE — `uRip[i].x` is the band's
 * centre, `uRipPh[i]` the carrier's own phase. Driving the crests from the band's
 * position instead (the obvious version) puts crest passage at ~19 Hz, above what a
 * 30 fps idle repaint can show, and the effect degenerates into aliased shimmer.
 *
 * They are computed on the CPU (`activeRipples`) and arrive as at most three
 * `vec4(centre, sigma, amplitude, freq)` in NATIVE units — deliberately not hashed in
 * GLSL, because the JS oracle has to reproduce this arithmetic exactly and
 * `fract(sin(...))` noise is precision-dependent. A room with `wamp == 0` gets none, so a
 * still room stays perfectly still.
 *
 * With `uWobble == 0` (rooms 46 and 66) this is a plain `texelFetch`, bit-identical to
 * the canvas-2D path — which is what the CPU↔GPU parity probe compares.
 *
 * The wall is then composited over it here rather than as a second blended draw, which
 * is exactly what canvas-2D's premultiplied `drawImage` of a straight-alpha wall
 * computes: out = wall.rgb·a + bg·(1−a).
 */
const BG_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uBg;
uniform sampler2D uWall;
uniform int uScale, uBgW, uWobble, uRipN;
uniform float uAmp, uPer, uPhase;
uniform vec4 uRip[${RIPPLE_GPU_SLOTS}];
uniform float uRipPh[${RIPPLE_GPU_SLOTS}];
out vec4 outColor;
void main() {
  int x = int(gl_FragCoord.x);
  int y = int(gl_FragCoord.y);
  vec3 bg;
  if (uWobble == 1) {
    float row = (float(y) + 0.5) / float(uScale) - 0.5;
    float sh = uAmp * sin(row / uPer + uPhase);
    for (int i = 0; i < ${RIPPLE_GPU_SLOTS}; i++) {
      if (i >= uRipN) break;
      float e = (row - uRip[i].x) / uRip[i].y;
      sh += uRip[i].z * exp(-0.5 * e * e) * sin(row * uRip[i].w + uRipPh[i]);
    }
    sh *= float(uScale);
    float f = floor(sh);
    int s0 = clamp(x + int(f), 0, uBgW - 1);
    int s1 = clamp(x + int(f) + 1, 0, uBgW - 1);
    bg = mix(texelFetch(uBg, ivec2(s0, y), 0).rgb, texelFetch(uBg, ivec2(s1, y), 0).rgb, sh - f);
  } else {
    bg = texelFetch(uBg, ivec2(x, y), 0).rgb;
  }
  vec4 w = texelFetch(uWall, ivec2(x, y), 0);
  outColor = vec4(w.rgb * w.a + bg * (1.0 - w.a), 1.0);
}`;

/** Straight-RGBA sprite; `uMirror` flips within [uX, uX+uW-1] (KresliRev geometry). */
const SPRITE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSprite;
uniform int uX, uY, uW, uMirror;
out vec4 outColor;
void main() {
  int fx = int(gl_FragCoord.x);
  int fy = int(gl_FragCoord.y);
  int j = (uMirror == 1) ? (uX + uW - 1 - fx) : (fx - uX);
  outColor = texelFetch(uSprite, ivec2(j, fy - uY), 0);
}`;

/**
 * KresliK's dithered dissolve: keep the source pixel only where
 * `RANDPOLE[(nativeRow·nativeW + nativeCol) & 255] >= rozpad`, evaluated on the
 * ORIGINAL pixel grid so the erosion keeps the faithful render's coarse granularity
 * instead of turning into fine noise. Same rule as `dissolveKeeps` in aiTarget.ts.
 */
const DISINT_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSprite;
uniform highp usampler2D uRand;
uniform int uX, uY, uScale, uNativeW, uRozpad;
out vec4 outColor;
void main() {
  int col = int(gl_FragCoord.x) - uX;
  int row = int(gl_FragCoord.y) - uY;
  int p = ((((row / uScale) * uNativeW) & 255) + col / uScale) & 255;
  if (int(texelFetch(uRand, ivec2(p, 0), 0).r) >= uRozpad) discard;
  outColor = texelFetch(uSprite, ivec2(col, row), 0);
}`;

/**
 * KresliZrcadlo as a ping-pong pass: copy the composited buffer, replacing glass
 * pixels with their reflection about the mirror axis (scaled col D ← S·(2X+4)−1−D).
 * `uMask` is the mirror sprite's per-pixel glassness — the SAME Float32Array the CPU
 * path computes, uploaded as R32F, so neither backend has its own chroma-key rule.
 * The bounds replicate the CPU's read window exactly, including its "reflection source
 * outside the window ⇒ leave the pixel alone" guard.
 */
const MIRROR_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSrc;
uniform sampler2D uMask;
uniform int uRx0, uRx1, uRy0, uRy1, uDx0, uDx1, uK, uMX, uMY, uMW, uMH;
out vec4 outColor;
void main() {
  int D = int(gl_FragCoord.x);
  int sy = int(gl_FragCoord.y);
  vec4 col = texelFetch(uSrc, ivec2(D, sy), 0);
  int my = sy - uMY;
  int mx = D - uMX;
  if (sy >= uRy0 && sy < uRy1 && D >= uDx0 && D < uDx1 &&
      my >= 0 && my < uMH && mx >= 0 && mx < uMW) {
    float g = texelFetch(uMask, ivec2(mx, my), 0).r;
    int sX = uK - D;
    if (g > 0.0 && sX >= uRx0 && sX < uRx1) {
      vec4 src = texelFetch(uSrc, ivec2(sX, sy), 0);
      col = vec4(g >= 1.0 ? src.rgb : src.rgb * g + col.rgb * (1.0 - g), 1.0);
    }
  }
  outColor = col;
}`;

/**
 * Present the composited ×S frame to the canvas, flipping Y to top-down and BOX
 * DOWNSAMPLING it.
 *
 * The AI backing store is always displayed smaller than it is (2400 px in a ~2000 px
 * device-pixel box), so presentation is a minification, and how it is filtered is the
 * whole point of the tier: the canvas-2D path leans on the browser's own high-quality
 * downscale (that is what `scalingFilterFor` switches `image-rendering` to `auto` for).
 * A single bilinear tap throws most of the upscaled detail away, and mipmapping
 * over-blurs at the ratios that actually occur here — at 1.2× it blends in a
 * half-resolution level and the stone texture visibly softens against the CPU frame.
 *
 * So average uTaps×uTaps bilinear samples spread across the destination pixel's
 * footprint in the source: a real box filter at the actual ratio, sharp where the ratio
 * is mild and correctly anti-aliased where it is not.
 */
const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;       // destination size in px
uniform vec2 uFootprint;  // source texels covered by one destination pixel, normalised
uniform int uTaps;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  uv.y = 1.0 - uv.y;
  float n = float(uTaps);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < uTaps; j++) {
    for (int i = 0; i < uTaps; i++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / n - 0.5;
      acc += texture(uTex, uv + o * uFootprint).rgb;
    }
  }
  frag = vec4(acc / (n * n), 1.0);
}`;

/**
 * The art owner whose disposal must also release this backend's textures.
 *
 * `ownedImages` is what makes the distinction that matters: a room's own background,
 * wall and object bitmaps die with it, but the fish sprite set is SHARED by every room
 * at a given scale and must outlive any of them.
 */
export interface AiTextureOwner {
  onDispose(fn: () => void): void;
  /** The bitmaps this owner alone holds — NOT the shared ones it merely draws from. */
  ownedImages(): Iterable<AiImage>;
}

export class GlAiScreen implements AiTarget {
  width = 0;
  height = 0;

  private readonly gl: WebGL2RenderingContext;
  private readonly fillProg: WebGLProgram;
  private readonly bgProg: WebGLProgram;
  private readonly spriteProg: WebGLProgram;
  private readonly disintProg: WebGLProgram;
  private readonly mirrorProg: WebGLProgram;
  private readonly presentProg: WebGLProgram;
  private readonly fillUni: Uni;
  private readonly bgUni: Uni;
  private readonly spriteUni: Uni;
  private readonly disintUni: Uni;
  private readonly mirrorUni: Uni;
  private readonly presentUni: Uni;
  private readonly fsVao: WebGLVertexArrayObject;
  private readonly rectVao: WebGLVertexArrayObject;
  private readonly randTex: WebGLTexture;
  /** Scratch for the per-frame `uRip` upload — allocated once, not per frame. */
  private readonly ripBuf = new Float32Array(RIPPLE_GPU_SLOTS * 4);
  private readonly ripPhBuf = new Float32Array(RIPPLE_GPU_SLOTS);

  /**
   * One texture per source bitmap, for the LIFE OF THE CONTEXT.
   *
   * Deliberately global rather than per owner. The fish sprite set (~130 sprites at ×4)
   * is shared by every room at a given scale, so a per-room cache re-uploaded all of it
   * on every room entry — in every probe in the suite, since `ai` + `webgl` is the
   * default configuration. Measured: that alone raised the whole UI suite's CPU from
   * 592s to ~1080s.
   *
   * Weak, so a bitmap nothing references any more takes its texture with it; `track()`
   * additionally frees a room's OWN textures the moment it is evicted, because at ×4
   * those are ~50 MB of VRAM and waiting for GC is not good enough.
   *
   * Keyed on identity PLUS `aiImageRevision`, for the same reason GlScreen's `lastUpload`
   * carries `bitmapPixelRevision`: LODE's ×S background is mutated IN PLACE by the
   * falling wreck, so an identity-only cache would keep rendering the undamaged art on
   * the GPU while canvas-2D — which re-reads the canvas every frame — looked perfectly
   * correct. That asymmetry is invisible to any test not exercising the wreck mid-fall
   * on BOTH backends.
   */
  private readonly texCache = new WeakMap<AiImage | Float32Array, { tex: WebGLTexture; revision: number }>();
  private tracked: AiTextureOwner | null = null;
  private readonly hooked = new WeakSet<AiTextureOwner>();

  private fboA: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private fboB: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private cur: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private fboW = 0;
  private fboH = 0;

  /**
   * "This backend could not fully composite the frame." Same seam GlScreen exposes: the
   * caller checks it after the room walk and falls back to canvas-2D for that frame,
   * rather than presenting a frame that is silently missing an effect. Set only when the
   * mirror ping-pong buffer cannot be allocated. Cleared by `begin`.
   */
  unsupported = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.fillProg = linkProgram(gl, RECT_VS, FILL_FS, 'aCorner', 'ai');
    this.bgProg = linkProgram(gl, QUAD_VS, BG_FS, 'aPos', 'ai');
    this.spriteProg = linkProgram(gl, RECT_VS, SPRITE_FS, 'aCorner', 'ai');
    this.disintProg = linkProgram(gl, RECT_VS, DISINT_FS, 'aCorner', 'ai');
    this.mirrorProg = linkProgram(gl, QUAD_VS, MIRROR_FS, 'aPos', 'ai');
    this.presentProg = linkProgram(gl, QUAD_VS, PRESENT_FS, 'aPos', 'ai');
    this.fillUni = uniformLocations(gl, this.fillProg, ['uColor', 'uRect']);
    this.bgUni = uniformLocations(gl, this.bgProg, ['uBg', 'uWall', 'uScale', 'uBgW', 'uWobble', 'uAmp', 'uPer', 'uPhase', 'uRipN', 'uRip[0]', 'uRipPh[0]']);
    this.spriteUni = uniformLocations(gl, this.spriteProg, ['uSprite', 'uX', 'uY', 'uW', 'uMirror', 'uRect']);
    this.disintUni = uniformLocations(gl, this.disintProg, ['uSprite', 'uRand', 'uX', 'uY', 'uScale', 'uNativeW', 'uRozpad', 'uRect']);
    this.mirrorUni = uniformLocations(gl, this.mirrorProg, ['uSrc', 'uMask', 'uRx0', 'uRx1', 'uRy0', 'uRy1', 'uDx0', 'uDx1', 'uK', 'uMX', 'uMY', 'uMW', 'uMH']);
    this.presentUni = uniformLocations(gl, this.presentProg, ['uTex', 'uSize', 'uFootprint', 'uTaps']);

    this.fsVao = makeFullscreenVao(gl);
    this.rectVao = makeRectVao(gl);

    this.randTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.randTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 256, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, RANDPOLE);
    nearestClamp(gl);
  }

  /**
   * Bind the art owner whose textures this backend is about to build, and arrange for its
   * OWN textures to be freed when it is evicted.
   *
   * The hook is registered exactly once per owner (an earlier version registered a fresh
   * one every time the tracked owner changed, so alternating between two cached rooms
   * accumulated closures without bound). It frees only `ownedImages()`: the shared fish
   * set stays in the cache for the life of the context, which is the whole point — it is
   * the same art for every room and re-uploading it per room was measurably expensive.
   */
  track(owner: AiTextureOwner): void {
    this.tracked = owner;
    if (this.hooked.has(owner)) return;
    this.hooked.add(owner);
    owner.onDispose(() => {
      for (const img of owner.ownedImages()) {
        const entry = this.texCache.get(img);
        if (!entry) continue;
        this.gl.deleteTexture(entry.tex);
        this.texCache.delete(img);
      }
    });
  }

  /**
   * RGBA8 texture for a decoded sprite, uploaded once and cached by source object —
   * and RE-uploaded when the source's `aiImageRevision` moves (LODE's wreck mutating
   * the ×S background in place). The re-upload goes into the SAME texture object, so a
   * mutating source does not churn textures the way delete-and-recreate would.
   *
   * A consumer exactly one revision behind takes the source's patch and updates only the
   * rect that changed: LODE's background is 2760×2280, and re-uploading it whole costs
   * 12.3 ms on an M4 — a dropped frame on every logic tick of the fall — against 0.68 ms
   * for the ship's footprint. Anything further behind (a room re-entered after eviction,
   * a reset to pristine art) re-uploads whole, which is always correct.
   */
  private texture(src: AiImage): WebGLTexture {
    const gl = this.gl;
    const revision = aiImageRevision(src);
    const hit = this.texCache.get(src);
    if (hit) {
      if (hit.revision === revision) return hit.tex;
      gl.bindTexture(gl.TEXTURE_2D, hit.tex);
      const patch = aiImagePatch(src);
      if (patch && patch.revision === revision && hit.revision === revision - 1) {
        // A typed-array source, so UNPACK_FLIP_Y / UNPACK_PREMULTIPLY_ALPHA do not apply
        // to it at all: the rows are top-down and straight-alpha, matching the texture
        // this is patching into.
        gl.texSubImage2D(gl.TEXTURE_2D, 0, patch.x, patch.y, patch.w, patch.h, gl.RGBA, gl.UNSIGNED_BYTE, patch.data);
      } else {
        this.uploadImage(src);
      }
      hit.revision = revision;
      return hit.tex;
    }
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    this.uploadImage(src);
    nearestClamp(gl);
    this.texCache.set(src, { tex: t, revision });
    return t;
  }

  /** texImage2D of `src` into the currently bound texture. */
  private uploadImage(src: AiImage): void {
    const gl = this.gl;
    // Straight (non-premultiplied) alpha, top-down — matching how the CPU path reads
    // these bitmaps, and what the blend equations below assume. The bitmaps themselves
    // are decoded with `premultiplyAlpha: 'none'` (see roomAi.ts) because texImage2D
    // takes an ImageBitmap's OWN alpha mode and ignores these flags for that source.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  /** Look an immutable source up in the texture cache, uploading it once on a miss. */
  private cached(src: AiImage | Float32Array, upload: () => WebGLTexture): WebGLTexture {
    const hit = this.texCache.get(src);
    if (hit) return hit.tex;
    const t = upload();
    this.texCache.set(src, { tex: t, revision: 0 });
    return t;
  }

  private maskTexture(mask: Float32Array, w: number, h: number): WebGLTexture {
    return this.cached(mask, () => {
      const gl = this.gl;
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, mask);
      nearestClamp(gl);
      return t;
    });
  }

  /**
   * Whether this GPU can hold the room's ×S buffer AND its art.
   *
   * WebGL2 only GUARANTEES `MAX_TEXTURE_SIZE` of 2048, while the shipped rooms reach
   * 3120×1980 at ×4. This has to be asked rather than attempted, because an oversized
   * `texImage2D` reports an INVALID_VALUE GL error instead of throwing: without the
   * check the compositor would sail on, `drawAiGpu` would return true, the canvas-2D
   * frame would be hidden, and the player would get a blank room — on the default tier,
   * on exactly the low-end hardware that can least afford a silent failure.
   */
  canRender(w: number, h: number): boolean {
    const max = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
    return w > 0 && h > 0 && w <= max && h <= max;
  }

  private makeFbo(w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } | null {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    // Same reasoning as canRender(): allocation failure is reported, not thrown. An
    // incomplete framebuffer renders nothing at all, so it must fail the caller rather
    // than be drawn into.
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return null;
    }
    return { fbo, tex };
  }

  /**
   * Size the offscreen buffer to the room's ×S backing store and clear it.
   *
   * Two buffers are allocated only when a room actually needs the mirror ping-pong;
   * at ×4 each one is ~20 MB, so the 71 rooms with no spec=1 mirror never pay for the
   * second.
   */
  begin(w: number, h: number): boolean {
    const gl = this.gl;
    if (this.fboW !== w || this.fboH !== h || !this.fboA) {
      if (this.fboA) { gl.deleteFramebuffer(this.fboA.fbo); gl.deleteTexture(this.fboA.tex); }
      if (this.fboB) { gl.deleteFramebuffer(this.fboB.fbo); gl.deleteTexture(this.fboB.tex); this.fboB = null; }
      this.fboA = null;
      this.fboW = 0;
      this.fboH = 0;
      if (!this.canRender(w, h)) return false;
      const made = this.makeFbo(w, h);
      if (!made) return false;
      this.fboA = made;
      this.fboW = w;
      this.fboH = h;
    }
    this.width = w;
    this.height = h;
    this.unsupported = false;
    this.cur = this.fboA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cur.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return true;
  }

  private setRect(loc: WebGLUniformLocation | null, x0: number, y0: number, x1: number, y1: number): void {
    setRectUniform(this.gl, loc, this.width, this.height, x0, y0, x1, y1);
  }

  private drawRect(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.rectVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private drawFullscreen(): void {
    const gl = this.gl;
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  fill(r: number, g: number, b: number): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.clearColor(r / 255, g / 255, b / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.useProgram(this.fillProg);
    gl.uniform3f(this.fillUni.uColor!, r / 255, g / 255, b / 255);
    this.setRect(this.fillUni.uRect!, x, y, x + w, y + h);
    this.drawRect();
  }

  blit(src: AiImage, x: number, y: number, mirror: boolean): void {
    const gl = this.gl;
    const u = this.spriteUni;
    gl.enable(gl.BLEND);
    // Straight-alpha source over an opaque destination; the separate alpha term keeps
    // the buffer's own alpha at 1 so a readback is directly comparable to the canvas.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.spriteProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(src));
    gl.uniform1i(u.uSprite!, 0);
    gl.uniform1i(u.uX!, x);
    gl.uniform1i(u.uY!, y);
    gl.uniform1i(u.uW!, src.width);
    gl.uniform1i(u.uMirror!, mirror ? 1 : 0);
    this.setRect(u.uRect!, x, y, x + src.width, y + src.height);
    this.drawRect();
    gl.disable(gl.BLEND);
  }

  /** `sig` is ignored: the composite is one fullscreen pass, so caching it would cost more than it saves. */
  background(_sig: string, bg: AiImage, wall: AiImage, wobble: AiWobble | null, scale: number): void {
    const gl = this.gl;
    const u = this.bgUni;
    gl.disable(gl.BLEND);
    gl.useProgram(this.bgProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(bg));
    gl.uniform1i(u.uBg!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(wall));
    gl.uniform1i(u.uWall!, 1);
    gl.uniform1i(u.uScale!, scale);
    gl.uniform1i(u.uBgW!, bg.width);
    gl.uniform1i(u.uWobble!, wobble ? 1 : 0);
    // The wave is evaluated in NATIVE units and scaled at the end, so the ripple packets
    // (whose width and frequency are naturally per native row) need no conversion. The
    // phase is pre-reduced in FP64 (wobblePhase) so the FP32 `sin` never sees a large
    // argument. Uploaded even when the room does not wobble: a uniform left at whatever
    // the previous room set is exactly the sort of state that survives a `uWobble` guard
    // being edited later.
    gl.uniform1f(u.uAmp!, wobble ? wobble.wamp / 2 : 0);
    gl.uniform1f(u.uPer!, wobble ? wobble.wper : 1);
    gl.uniform1f(u.uPhase!, wobble ? wobblePhase(wobble) : 0);
    const rips = wobble ? activeRipples(wobble, Math.max(1, Math.round(bg.height / scale))) : [];
    // The whole array is written every frame, expired slots included: leaving a dead
    // ripple's numbers behind a shrinking uRipN is invisible until something reorders the
    // loop, and then it is a ghost that only appears on some frames.
    for (let i = 0; i < RIPPLE_GPU_SLOTS; i++) {
      const r = rips[i];
      const o = i * 4;
      this.ripBuf[o] = r ? r.c : 0;
      this.ripBuf[o + 1] = r ? r.halfW : 1;
      this.ripBuf[o + 2] = r ? r.amp : 0;
      this.ripBuf[o + 3] = r ? r.k : 0;
      this.ripPhBuf[i] = r ? r.phase : 0;
    }
    gl.uniform1i(u.uRipN!, Math.min(rips.length, RIPPLE_GPU_SLOTS));
    gl.uniform4fv(u['uRip[0]']!, this.ripBuf);
    gl.uniform1fv(u['uRipPh[0]']!, this.ripPhBuf);
    this.drawFullscreen();
  }

  disintegrate(src: AiImage, x: number, y: number, scale: number, rozpad: number): void {
    const gl = this.gl;
    const u = this.disintUni;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.disintProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(src));
    gl.uniform1i(u.uSprite!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.randTex);
    gl.uniform1i(u.uRand!, 1);
    gl.uniform1i(u.uX!, x);
    gl.uniform1i(u.uY!, y);
    gl.uniform1i(u.uScale!, scale);
    gl.uniform1i(u.uNativeW!, Math.max(1, Math.round(src.width / scale)));
    gl.uniform1i(u.uRozpad!, rozpad);
    this.setRect(u.uRect!, x, y, x + src.width, y + src.height);
    this.drawRect();
    gl.disable(gl.BLEND);
  }

  mirrorGlass(X: number, Y: number, w: number, h: number, S: number, mask: Float32Array, MW: number, MH: number): void {
    const gl = this.gl;
    const CW = this.width, CH = this.height;
    // The CPU reads a window, snapshots it and reflects within it; these are that
    // window's bounds, replicated so the "source outside the window" guard matches.
    const rx0 = Math.max(0, Math.min(X, X + 4 - w) * S);
    const rx1 = Math.min(CW, Math.max(X + w, X + 4) * S);
    const ry0 = Math.max(0, Y * S), ry1 = Math.min(CH, (Y + h) * S);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const dx0 = Math.max(rx0, X * S), dx1 = Math.min(rx1, (X + w) * S);
    if (dx1 <= dx0) return;
    if (!this.fboB) this.fboB = this.makeFbo(this.fboW, this.fboH);
    if (!this.fboB) { this.unsupported = true; return; } // no VRAM for the ping-pong
    const src = this.cur!;
    const dst = src === this.fboA ? this.fboB : this.fboA!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, CW, CH);
    gl.disable(gl.BLEND);
    const u = this.mirrorUni;
    gl.useProgram(this.mirrorProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(u.uSrc!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture(mask, MW, MH));
    gl.uniform1i(u.uMask!, 1);
    gl.uniform1i(u.uRx0!, rx0);
    gl.uniform1i(u.uRx1!, rx1);
    gl.uniform1i(u.uRy0!, ry0);
    gl.uniform1i(u.uRy1!, ry1);
    gl.uniform1i(u.uDx0!, dx0);
    gl.uniform1i(u.uDx1!, dx1);
    gl.uniform1i(u.uK!, S * (2 * X + 4) - 1);
    gl.uniform1i(u.uMX!, X * S);
    gl.uniform1i(u.uMY!, Y * S);
    gl.uniform1i(u.uMW!, MW);
    gl.uniform1i(u.uMH!, MH);
    this.drawFullscreen();
    this.cur = dst; // the rope, drawn after the mirror, must land on the reflected buffer
  }

  /** Present the composited ×S frame to the canvas, box-filtered (see PRESENT_FS). */
  present(canvasW: number, canvasH: number): void {
    const gl = this.gl;
    if (!this.cur) return;
    const rx = this.fboW / canvasW;
    const ry = this.fboH / canvasH;
    // One tap per source pixel the destination pixel covers, capped: past 4× the extra
    // taps stop being visible and the tier never minifies that hard in practice.
    const taps = Math.min(4, Math.max(1, Math.ceil(Math.max(rx, ry))));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cur.tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.disable(gl.BLEND);
    gl.useProgram(this.presentProg);
    gl.uniform1i(this.presentUni.uTex!, 0);
    gl.uniform2f(this.presentUni.uSize!, canvasW, canvasH);
    gl.uniform2f(this.presentUni.uFootprint!, rx / this.fboW, ry / this.fboH);
    gl.uniform1i(this.presentUni.uTaps!, taps);
    this.drawFullscreen();
  }

  /**
   * Test-only: present at `w`×`h` and read the PRESENTED pixels back from the default
   * framebuffer (top-down RGBA).
   *
   * `readback()` reads the offscreen composite and so is blind to the present pass —
   * which is the only pass the player actually sees, and where a wrong viewport, Y flip
   * or filter footprint would leave the composite byte-exact and the screen wrong.
   */
  presentReadback(w: number, h: number): Uint8Array {
    const gl = this.gl;
    this.present(w, h);
    const out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // The default framebuffer is bottom-up; flip so callers get the same top-down
    // orientation readback() and the canvas-2D path use.
    const flipped = new Uint8Array(out.length);
    const row = w * 4;
    for (let y = 0; y < h; y++) flipped.set(out.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return flipped;
  }

  /** Read the composited ×S frame back as top-down RGBA (for the parity probe). */
  readback(): { w: number; h: number; rgba: Uint8Array } {
    const gl = this.gl;
    const out = new Uint8Array(this.fboW * this.fboH * 4);
    if (!this.cur) return { w: this.fboW, h: this.fboH, rgba: out };
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cur.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, this.fboW, this.fboH, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return { w: this.fboW, h: this.fboH, rgba: out };
  }

  /**
   * Block until the GPU has actually executed the queued work (benchmarks only).
   *
   * `gl.finish()` alone is not enough: WebGL calls only QUEUE work, and on ANGLE/Metal
   * finish() returned in microseconds for 60 full ×S frames — a throughput no GPU
   * delivers, i.e. it timed command submission. Reading a single pixel back from the
   * target is a real synchronisation point (the result cannot exist until the frame
   * has been rendered), and one pixel costs nothing next to the frame it drains.
   */
  finish(): void {
    const gl = this.gl;
    gl.finish();
    if (!this.cur) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cur.fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
}
