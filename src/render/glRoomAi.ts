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
import type { AiImage, AiTarget } from './aiTarget.js';

const QUAD_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** A screen-rect quad in FBO pixel space; the VS maps [0,1]² across uRect (NDC). */
const RECT_VS = `#version 300 es
in vec2 aCorner;
uniform vec4 uRect;
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aCorner);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/** Opaque colour fill (the darkness room, the elevator rope). */
const FILL_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor, 1.0); }`;

/**
 * Wall over the water-wobbled background, in ONE opaque pass.
 *
 * Kresli2's wobble is `dest[j] = bg[j + k]` for the row's shift k, clamped at both
 * edges — the CPU draws that as horizontal bands of ×S rows, which is the same
 * per-pixel rule this evaluates directly. `uShift` carries k per NATIVE row, already
 * rounded on the CPU: this shader must not re-derive `sin` (that is what makes the
 * classic tier's GPU background delicate, and the AI tier has no reason to inherit it).
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
uniform highp isampler2D uShift;
uniform int uScale, uBgW, uWobble;
out vec4 outColor;
void main() {
  int x = int(gl_FragCoord.x);
  int y = int(gl_FragCoord.y);
  int sx = x;
  if (uWobble == 1) {
    int k = texelFetch(uShift, ivec2(y / uScale, 0), 0).r;
    sx = clamp(x + k * uScale, 0, uBgW - 1);
  }
  vec3 bg = texelFetch(uBg, ivec2(sx, y), 0).rgb;
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
  if (int(texelFetch(uRand, ivec2(p, 0), 0).r) < uRozpad) discard;
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

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`ai shader: ${gl.getShaderInfoLog(sh) ?? ''}`);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string, attrib0: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, attrib0);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`ai program: ${gl.getProgramInfoLog(p) ?? ''}`);
  }
  return p;
}

type Uni = Record<string, WebGLUniformLocation | null>;

/** The art owner whose disposal must also release this backend's textures. */
export interface AiTextureOwner {
  onDispose(fn: () => void): void;
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
  private readonly shiftTex: WebGLTexture;

  /**
   * Art texture per source bitmap. Weak so a bitmap the room has dropped takes its
   * texture with it; `own()` additionally deletes them the moment the room is evicted,
   * because at ×4 a room's art is ~50 MB of VRAM and waiting for GC to notice is not
   * good enough.
   */
  private readonly texCache = new WeakMap<AiImage, WebGLTexture>();
  private readonly maskCache = new WeakMap<Float32Array, WebGLTexture>();
  /** Textures uploaded for the currently-tracked owner, so its eviction can free them. */
  private pending = new Map<AiImage | Float32Array, WebGLTexture>();
  private tracked: AiTextureOwner | null = null;

  private fboA: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private fboB: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private cur: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private fboW = 0;
  private fboH = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.fillProg = program(gl, RECT_VS, FILL_FS, 'aCorner');
    this.bgProg = program(gl, QUAD_VS, BG_FS, 'aPos');
    this.spriteProg = program(gl, RECT_VS, SPRITE_FS, 'aCorner');
    this.disintProg = program(gl, RECT_VS, DISINT_FS, 'aCorner');
    this.mirrorProg = program(gl, QUAD_VS, MIRROR_FS, 'aPos');
    this.presentProg = program(gl, QUAD_VS, PRESENT_FS, 'aPos');
    this.fillUni = this.uniforms(this.fillProg, ['uColor', 'uRect']);
    this.bgUni = this.uniforms(this.bgProg, ['uBg', 'uWall', 'uShift', 'uScale', 'uBgW', 'uWobble']);
    this.spriteUni = this.uniforms(this.spriteProg, ['uSprite', 'uX', 'uY', 'uW', 'uMirror', 'uRect']);
    this.disintUni = this.uniforms(this.disintProg, ['uSprite', 'uRand', 'uX', 'uY', 'uScale', 'uNativeW', 'uRozpad', 'uRect']);
    this.mirrorUni = this.uniforms(this.mirrorProg, ['uSrc', 'uMask', 'uRx0', 'uRx1', 'uRy0', 'uRy1', 'uDx0', 'uDx1', 'uK', 'uMX', 'uMY', 'uMW', 'uMH']);
    this.presentUni = this.uniforms(this.presentProg, ['uTex', 'uSize', 'uFootprint', 'uTaps']);

    this.fsVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.fsVao);
    const fsBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.rectVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.rectVao);
    const rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.randTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.randTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 256, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, RANDPOLE);
    nearestClamp(gl);

    this.shiftTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shiftTex);
    nearestClamp(gl);
  }

  private uniforms(p: WebGLProgram, names: readonly string[]): Uni {
    const u: Uni = {};
    for (const n of names) u[n] = this.gl.getUniformLocation(p, n);
    return u;
  }

  /**
   * Bind the art owner whose textures this backend is about to build.
   *
   * A room's art is ~50 MB of VRAM at ×4 and `AiRoom.dispose()` exists precisely to
   * bound that, so the textures are freed from its hook rather than left to GC. The
   * cache entry is dropped with the texture: the fish set is SHARED between rooms and
   * is attributed to whichever room happened to upload it first, so a stale cache entry
   * would hand a later room a deleted texture. Re-uploading it is the cheap, correct
   * outcome (once per room entry, against a room load that already moves megabytes).
   */
  track(owner: AiTextureOwner): void {
    if (this.tracked === owner) return;
    this.tracked = owner;
    const mine = new Map<AiImage | Float32Array, WebGLTexture>();
    this.pending = mine;
    owner.onDispose(() => {
      for (const [src, tex] of mine) {
        this.gl.deleteTexture(tex);
        if (src instanceof Float32Array) this.maskCache.delete(src);
        else this.texCache.delete(src);
      }
      mine.clear();
    });
  }

  /** RGBA8 texture for a decoded sprite, uploaded once and cached by source object. */
  private texture(src: AiImage): WebGLTexture {
    const hit = this.texCache.get(src);
    if (hit) return hit;
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    // Straight (non-premultiplied) alpha, top-down — matching how the CPU path reads
    // these bitmaps, and what the blend equations below assume.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    nearestClamp(gl);
    this.texCache.set(src, t);
    this.pending.set(src, t);
    return t;
  }

  private maskTexture(mask: Float32Array, w: number, h: number): WebGLTexture {
    const hit = this.maskCache.get(mask);
    if (hit) return hit;
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, mask);
    nearestClamp(gl);
    this.maskCache.set(mask, t);
    this.pending.set(mask, t);
    return t;
  }

  private makeFbo(w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
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
    return { fbo, tex };
  }

  /**
   * Size the offscreen buffer to the room's ×S backing store and clear it.
   *
   * Two buffers are allocated only when a room actually needs the mirror ping-pong;
   * at ×4 each one is ~20 MB, so the 71 rooms with no spec=1 mirror never pay for the
   * second.
   */
  begin(w: number, h: number): void {
    const gl = this.gl;
    if (this.fboW !== w || this.fboH !== h || !this.fboA) {
      if (this.fboA) { gl.deleteFramebuffer(this.fboA.fbo); gl.deleteTexture(this.fboA.tex); }
      if (this.fboB) { gl.deleteFramebuffer(this.fboB.fbo); gl.deleteTexture(this.fboB.tex); this.fboB = null; }
      this.fboA = this.makeFbo(w, h);
      this.fboW = w;
      this.fboH = h;
    }
    this.width = w;
    this.height = h;
    this.cur = this.fboA;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cur.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Map a pixel rect to the NDC rect the RECT_VS quad spans. */
  private setRect(loc: WebGLUniformLocation | null, x0: number, y0: number, x1: number, y1: number): void {
    this.gl.uniform4f(
      loc,
      (x0 / this.width) * 2 - 1,
      (y0 / this.height) * 2 - 1,
      (x1 / this.width) * 2 - 1,
      (y1 / this.height) * 2 - 1,
    );
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
  background(_sig: string, bg: AiImage, wall: AiImage, shifts: Int16Array | null, scale: number): void {
    const gl = this.gl;
    const u = this.bgUni;
    if (shifts) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.shiftTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16I, shifts.length, 1, 0, gl.RED_INTEGER, gl.SHORT, shifts);
    }
    gl.disable(gl.BLEND);
    gl.useProgram(this.bgProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(bg));
    gl.uniform1i(u.uBg!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(wall));
    gl.uniform1i(u.uWall!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.shiftTex);
    gl.uniform1i(u.uShift!, 2);
    gl.uniform1i(u.uScale!, scale);
    gl.uniform1i(u.uBgW!, bg.width);
    gl.uniform1i(u.uWobble!, shifts ? 1 : 0);
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

function nearestClamp(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
