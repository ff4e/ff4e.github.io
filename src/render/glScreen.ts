/**
 * WebGL2 GPU compositor target (P3). `GlScreen` implements the same
 * `CompositeTarget` interface as the CPU `RgbaScreen`, so the room compositor
 * `renderInto(target, room, opts, art)` — the single source of truth for
 * structure (z-order, visibility, fish selection, effect geometry) — drives the
 * GPU through the *exact same* code path as the CPU. The backend is the only
 * switch (the compositor seam). Each blit primitive records an
 * immediate GPU draw into an offscreen framebuffer at native room resolution
 * (W×H), so the result is comparable 1:1 with the CPU frame; classic pixels are
 * coloured in-shader through a 256×1 palette LUT (index texture → LUT), matching
 * `RgbaScreen`'s `rgba[p] === lut[idx[p]]`.
 *
 * The framebuffer carries TWO attachments (MRT): RGBA8 (the displayed colour)
 * and R8UI (the palette index, the structural plane). Every draw writes both, so
 * the index-space read-back effect — the spec=1 mirror (`KresliZrcadlo`) — runs
 * as a shader pass that samples the composited index to find the glass pixels,
 * exactly like the CPU. Two framebuffers ping-pong for that pass.
 *
 * `present()` upscales the RGBA attachment to the canvas (DPR-correct) — the HD
 * hook. WebGL is opt-in with the CPU compositor as the fallback + oracle, so a
 * GPU issue can never take down the shipped renderer.
 *
 * Every room composites here byte-exact vs the CPU: background, items, fish,
 * disintegrate, darkness `fillIndex`, the spec=1 mirror, `setIndex`-driven
 * ropes/hooks, and the gspec=42 ZX render (`blitZX`, whose per-scanline bands are
 * computed CPU-side and uploaded). ZX's band width is `Math.random`-driven per
 * frame, so only the byte-exact TEST re-seeds it — the live render stays random.
 */
import { FFR_EXTRA } from '../data/ffr.js';
import { RANDPOLE, cpuDrawRope } from './framebuffer.js';
import type { FfrBitmap, FfrPaletteEntry } from '../data/ffr.js';
import type { CompositeTarget, TruecolorTarget } from './framebuffer.js';
import type { Room } from '../core/room.js';
import { backgroundInputs } from './renderRoom.js';

const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** A screen-rect quad in FBO pixel space; the VS maps [0,1]² across uRect (NDC). */
const RECT_VS = `#version 300 es
in vec2 aCorner;         // unit quad corner 0..1
uniform vec4 uRect;      // (x0,y0,x1,y1) in NDC
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aCorner);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/** Dual-output tail shared by every draw shader (RGBA colour + R8UI index). */
const MRT_OUT = `layout(location = 0) out vec4 outColor;
layout(location = 1) out uint outIdx;`;

/** Classic Kresli2 background: wall over the per-scanline water-wobbled bg, palette-coloured. */
const BG_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uWall; // R8UI, W×H  (palette indices)
uniform highp usampler2D uBg;   // R8UI, bgW×H (padded background)
uniform sampler2D uLut;         // RGBA8, 256×1 palette LUT
uniform int uMask;
uniform int uBgExtra;
uniform float uWamp, uWper, uWspd, uCount;
${MRT_OUT}
void main() {
  int j = int(gl_FragCoord.x);
  int i = int(gl_FragCoord.y); // FB is stored GL-bottom-up; readback + present handle the flip
  uint wallIdx = texelFetch(uWall, ivec2(j, i), 0).r;
  uint idx;
  if (int(wallIdx) == uMask) {
    float kf = uWamp * 0.5 * sin(float(i) / uWper + uCount / uWspd);
    int k = int(floor(kf + 0.5)); // round-half-up; ties vs the CPU's round-half-even are tolerance-covered
    idx = texelFetch(uBg, ivec2(j + k + uBgExtra, i), 0).r;
  } else {
    idx = wallIdx;
  }
  outColor = texelFetch(uLut, ivec2(int(idx), 0), 0);
  outIdx = idx;
}`;

/**
 * Classic masked item blit (Kresli / KresliRev / KresliR base pose). uMode:
 *   0 = blit       screenCol = uX + j             (columns [uX, uX+uW))
 *   1 = blitRev    screenCol = uX + (uW-1-j)       (mirror in place, [uX, uX+uW))
 *   2 = leftward   screenCol = uX - j             (KresliR rev body, [uX-uW+1, uX])
 * Rows are always screenRow = uY + i. Pixels equal to uMask are discarded, so a
 * later quad OVERWRITES an earlier one exactly like the CPU's opaque masked copy.
 */
const ITEM_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uItem;
uniform sampler2D uLut;
uniform int uX, uY, uW, uMask, uMode;
${MRT_OUT}
void main() {
  int fx = int(gl_FragCoord.x);
  int fy = int(gl_FragCoord.y);
  int j = (uMode == 0) ? (fx - uX) : (uMode == 1) ? (uX + uW - 1 - fx) : (uX - fx);
  int i = fy - uY;
  uint idx = texelFetch(uItem, ivec2(j, i), 0).r;
  if (int(idx) == uMask) discard;
  outColor = texelFetch(uLut, ivec2(int(idx), 0), 0);
  outIdx = idx;
}`;

/**
 * Fish composite (KresliR): a body quad with the head drawn over the front
 * `uSplit` columns. uRev flips it leftward from the anchor. Faithful to
 * `RgbaScreen.blitFishComposite`: head where `j < split && j < headW`, else body,
 * `j >= headW` inside the split is transparent (the CPU `continue`s).
 */
const FISH_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uBody;
uniform highp usampler2D uHead;
uniform sampler2D uLut;
uniform int uAX, uY, uMask, uSplit, uHeadW, uHasHead, uRev;
${MRT_OUT}
void main() {
  int fx = int(gl_FragCoord.x);
  int fy = int(gl_FragCoord.y);
  int j = (uRev == 1) ? (uAX - fx) : (fx - uAX);
  int i = fy - uY;
  uint idx;
  if (uHasHead == 1 && j < uSplit) {
    if (j >= uHeadW) discard;
    idx = texelFetch(uHead, ivec2(j, i), 0).r;
  } else {
    idx = texelFetch(uBody, ivec2(j, i), 0).r;
  }
  if (int(idx) == uMask) discard;
  outColor = texelFetch(uLut, ivec2(int(idx), 0), 0);
  outIdx = idx;
}`;

/**
 * Disintegrate dither (KresliK): the eroding skeleton. A pixel is kept only if
 * `RANDPOLE[(i*uW + j) & 255] < uRozpad` — faithful to `RgbaScreen.blitDisintegrate`
 * (`pBase = (i*w)&255`, then `(pBase+j)&255`, which equals `(i*w+j)&255`). uRev
 * anchors leftward like the fish body.
 */
const DISINT_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uItem;
uniform highp usampler2D uRand; // R8UI, 256×1
uniform sampler2D uLut;
uniform int uAX, uY, uW, uMask, uRozpad, uRev;
${MRT_OUT}
void main() {
  int fx = int(gl_FragCoord.x);
  int fy = int(gl_FragCoord.y);
  int j = (uRev == 1) ? (uAX - fx) : (fx - uAX);
  int i = fy - uY;
  uint idx = texelFetch(uItem, ivec2(j, i), 0).r;
  if (int(idx) == uMask) discard;
  int rp = int(texelFetch(uRand, ivec2((i * uW + j) & 255, 0), 0).r);
  if (rp >= uRozpad) discard;
  outColor = texelFetch(uLut, ivec2(int(idx), 0), 0);
  outIdx = idx;
}`;

/** Single palette-index pixel (setIndex): a 1×1 quad writing colour + index. */
const SET_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uLut;
uniform int uIdx;
${MRT_OUT}
void main() {
  outColor = texelFetch(uLut, ivec2(uIdx, 0), 0);
  outIdx = uint(uIdx);
}`;

/**
 * Full-frame indexed blit (the briefcase cutscene): a whole W×H palette-index
 * buffer → LUT → RGBA. Same Y convention as `BG_FS` (FB stored GL-bottom-up,
 * `present()` un-flips), so it can be smoothly upscaled at present time.
 */
const INDEXED_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uIdxTex; // R8UI, W×H (palette indices, whole frame)
uniform sampler2D uLut;
${MRT_OUT}
void main() {
  int j = int(gl_FragCoord.x);
  int i = int(gl_FragCoord.y);
  uint idx = texelFetch(uIdxTex, ivec2(j, i), 0).r;
  outColor = texelFetch(uLut, ivec2(int(idx), 0), 0);
  outIdx = idx;
}`;

/**
 * Enhanced (FFNG truecolor) background — the GPU counterpart of
 * `RgbaScreen.blit2Rgba`. The classic wall mask decides structure per pixel
 * (wall-opaque vs background, so the index plane stays byte-identical to classic);
 * the colour is the FFNG truecolor texel (the wobbled `-p` background, unpadded
 * and clamped, or the `-w` wall).
 */
const BG2_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uWall;  // classic wall R8UI (iw×ih)
uniform highp usampler2D uBgIdx; // classic bg   R8UI (bgW×ih, padded)
uniform sampler2D uFfngWall;     // FFNG wall RGBA8 (W×H)
uniform sampler2D uFfngBg;       // FFNG bg   RGBA8 (W×H)
uniform int uMask, uBgExtra, uW;
uniform float uWamp, uWper, uWspd, uCount;
${MRT_OUT}
void main() {
  int j = int(gl_FragCoord.x);
  int i = int(gl_FragCoord.y);
  uint wallIdx = texelFetch(uWall, ivec2(j, i), 0).r;
  uint idx;
  vec3 col;
  if (int(wallIdx) == uMask) {
    float kf = uWamp * 0.5 * sin(float(i) / uWper + uCount / uWspd);
    int k = int(floor(kf + 0.5));
    idx = texelFetch(uBgIdx, ivec2(j + k + uBgExtra, i), 0).r;
    int bx = clamp(j + k, 0, uW - 1);
    col = texelFetch(uFfngBg, ivec2(bx, i), 0).rgb;
  } else {
    idx = wallIdx;
    col = texelFetch(uFfngWall, ivec2(j, i), 0).rgb;
  }
  outColor = vec4(col, 1.0);
  outIdx = idx;
}`;

/**
 * Alpha-blended truecolor sprite (FFNG object/fish overlay) — the GPU counterpart
 * of `RgbaScreen.blitSpriteRgba`. Straight-alpha over the composited colour (GL
 * SRC_ALPHA / ONE_MINUS_SRC_ALPHA blend); the index plane is left untouched (the
 * sprite is a display-only overlay), achieved by disabling the index draw buffer.
 * `uMirror` flips within [uX, uX+uW-1] (KresliRev geometry).
 */
const SPRITE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSprite;
uniform int uX, uY, uW, uMirror;
${MRT_OUT}
void main() {
  int fx = int(gl_FragCoord.x);
  int fy = int(gl_FragCoord.y);
  int j = (uMirror == 1) ? (uX + uW - 1 - fx) : (fx - uX);
  int i = fy - uY;
  vec4 s = texelFetch(uSprite, ivec2(j, i), 0);
  if (s.a == 0.0) discard;
  outColor = s;
  outIdx = 0u; // index draw buffer is disabled for this pass; value ignored
}`;

/**
 * KresliZrcadlo mirror pass. Reads the composited RGBA + index of the *other*
 * framebuffer and reflects glass pixels (index == the glass index sampled at the
 * mirror centre) about column X+1.5 (source column 2X+3-c). The CPU's in-place
 * sequential loop reduces to this pure reflection of the pre-mirror buffer (the
 * only self-referential columns read glass→glass, a no-op).
 */
const MIRROR_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uRgba;
uniform highp usampler2D uIdx;
uniform int uX, uY, uDX, uDY, uCX, uCY, uW;
in vec2 vUV;
${MRT_OUT}
void main() {
  int c = int(gl_FragCoord.x);
  int r = int(gl_FragCoord.y);
  vec4 col = texelFetch(uRgba, ivec2(c, r), 0);
  uint idx = texelFetch(uIdx, ivec2(c, r), 0).r;
  if (c >= uX && c < uX + uDX && r >= uY && r < uY + uDY) {
    uint m = texelFetch(uIdx, ivec2(uCX, uCY), 0).r;
    if (idx == m) {
      int sCol = 2 * uX + 3 - c;
      if (sCol >= 0 && sCol < uW) {
        col = texelFetch(uRgba, ivec2(sCol, r), 0);
        idx = texelFetch(uIdx, ivec2(sCol, r), 0).r;
      }
    }
  }
  outColor = col;
  outIdx = idx;
}`;

/**
 * ZX-Spectrum wall render (gspec=42, KresliZX). Like the background, but where
 * the wall is opaque the pixel is the animated loading-stripe band for that
 * scanline (a palette index precomputed on the CPU into `uBands`, a W×1... here
 * H-long R8UI strip indexed by row), not the wall texel. The per-scanline band
 * assignment is a sequential running counter (`st`), so it's computed CPU-side
 * (cheap, O(rows)) and fed here; the massively-parallel per-pixel lookup is the GPU's.
 */
const ZX_FS = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uWall;  // classic wall R8UI (iw×ih)
uniform highp usampler2D uBg;    // classic bg   R8UI (bgW×ih, padded)
uniform highp usampler2D uBands; // per-scanline band palette index R8UI (ih×1)
uniform sampler2D uLut;
uniform int uMask, uBgExtra;
uniform float uWamp, uWper, uWspd, uCount;
${MRT_OUT}
void main() {
  int j = int(gl_FragCoord.x);
  int i = int(gl_FragCoord.y);
  uint wallIdx = texelFetch(uWall, ivec2(j, i), 0).r;
  uint idx;
  if (int(wallIdx) == uMask) {
    float kf = uWamp * 0.5 * sin(float(i) / uWper + uCount / uWspd);
    int k = int(floor(kf + 0.5));
    idx = texelFetch(uBg, ivec2(j + k + uBgExtra, i), 0).r;
  } else {
    idx = texelFetch(uBands, ivec2(i, 0), 0).r; // the scanline's loading-stripe band
  }
  outColor = texelFetch(uLut, ivec2(int(idx), 0), 0);
  outIdx = idx;
}`;

/** Present an offscreen RGBA texture to the canvas, flipping Y to top-down. */
const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 frag;
void main() {
  frag = texture(uTex, vec2(vUV.x, 1.0 - vUV.y));
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader compile failed: ' + gl.getShaderInfoLog(sh));
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
    throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

function indexTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** A NEAREST RGBA8 texture (FFNG truecolor art: backgrounds + sprites). */
function rgbaTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Uniform-location cache per program (getUniformLocation is slow to call in loops). */
type Uni = Record<string, WebGLUniformLocation | null>;

/** An offscreen render target: RGBA8 colour + R8UI palette-index (MRT). */
interface FboSet {
  fbo: WebGLFramebuffer;
  rgbaTex: WebGLTexture;
  idxTex: WebGLTexture;
}

export class GlScreen implements TruecolorTarget {
  width = 0;
  height = 0;

  private readonly gl: WebGL2RenderingContext;
  private readonly bgProg: WebGLProgram;
  private readonly bg2Prog: WebGLProgram;
  private readonly zxProg: WebGLProgram;
  private readonly itemProg: WebGLProgram;
  private readonly fishProg: WebGLProgram;
  private readonly disintProg: WebGLProgram;
  private readonly setProg: WebGLProgram;
  private readonly indexedProg: WebGLProgram;
  private readonly spriteProg: WebGLProgram;
  private readonly mirrorProg: WebGLProgram;
  private readonly presentProg: WebGLProgram;
  private readonly bgUni: Uni;
  private readonly bg2Uni: Uni;
  private readonly zxUni: Uni;
  private readonly itemUni: Uni;
  private readonly fishUni: Uni;
  private readonly disintUni: Uni;
  private readonly setUni: Uni;
  private readonly indexedUni: Uni;
  private readonly spriteUni: Uni;
  private readonly mirrorUni: Uni;
  private readonly presentUni: Uni;

  private readonly fsVao: WebGLVertexArrayObject; // fullscreen triangle (bg/mirror/present)
  private readonly rectVao: WebGLVertexArrayObject; // unit quad (items/fish/setIndex)

  private readonly wallTex: WebGLTexture;
  private readonly bgTex: WebGLTexture;
  // Last (immutable) index bitmap uploaded to each texture, so a frame that re-blits
  // the same static wall/bg (the common case at 60fps) skips the texImage2D re-upload.
  private readonly lastUpload = new WeakMap<WebGLTexture, { pixels: Uint8Array; w: number; h: number }>();
  private readonly itemTex: WebGLTexture;
  private readonly cutTex: WebGLTexture;
  private readonly bodyTex: WebGLTexture;
  private readonly headTex: WebGLTexture;
  private readonly randTex: WebGLTexture;
  private readonly bandsTex: WebGLTexture;
  private readonly lutTex: WebGLTexture;
  private readonly ffngWallTex: WebGLTexture;
  private readonly ffngBgTex: WebGLTexture;
  private readonly spriteTex: WebGLTexture;

  private setA: FboSet | null = null;
  private setB: FboSet | null = null;
  private cur: FboSet | null = null; // the framebuffer currently being drawn into
  private fboW = 0;
  private fboH = 0;

  private lut = new Uint8Array(256 * 4);
  /**
   * Defensive per-frame "this target couldn't fully composite the frame" flag.
   * Set only by getIndex/copyPixel, which are reached solely via cpuMirror — and
   * GlScreen overrides `mirror` with a shader pass, so on the live GPU path this
   * is never set. Kept as a graceful per-frame CPU-fallback seam for any future
   * primitive that can't run on the GPU (drawGpu checks it).
   */
  unsupported = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.bgProg = program(gl, QUAD_VS, BG_FS, 'aPos');
    this.bg2Prog = program(gl, QUAD_VS, BG2_FS, 'aPos');
    this.zxProg = program(gl, QUAD_VS, ZX_FS, 'aPos');
    this.itemProg = program(gl, RECT_VS, ITEM_FS, 'aCorner');
    this.fishProg = program(gl, RECT_VS, FISH_FS, 'aCorner');
    this.disintProg = program(gl, RECT_VS, DISINT_FS, 'aCorner');
    this.setProg = program(gl, RECT_VS, SET_FS, 'aCorner');
    this.indexedProg = program(gl, QUAD_VS, INDEXED_FS, 'aPos');
    this.spriteProg = program(gl, RECT_VS, SPRITE_FS, 'aCorner');
    this.mirrorProg = program(gl, QUAD_VS, MIRROR_FS, 'aPos');
    this.presentProg = program(gl, QUAD_VS, PRESENT_FS, 'aPos');
    this.bgUni = this.uniforms(this.bgProg, ['uWall', 'uBg', 'uLut', 'uMask', 'uBgExtra', 'uWamp', 'uWper', 'uWspd', 'uCount']);
    this.bg2Uni = this.uniforms(this.bg2Prog, ['uWall', 'uBgIdx', 'uFfngWall', 'uFfngBg', 'uMask', 'uBgExtra', 'uW', 'uWamp', 'uWper', 'uWspd', 'uCount']);
    this.zxUni = this.uniforms(this.zxProg, ['uWall', 'uBg', 'uBands', 'uLut', 'uMask', 'uBgExtra', 'uWamp', 'uWper', 'uWspd', 'uCount']);
    this.itemUni = this.uniforms(this.itemProg, ['uItem', 'uLut', 'uX', 'uY', 'uW', 'uMask', 'uMode', 'uRect']);
    this.fishUni = this.uniforms(this.fishProg, ['uBody', 'uHead', 'uLut', 'uAX', 'uY', 'uMask', 'uSplit', 'uHeadW', 'uHasHead', 'uRev', 'uRect']);
    this.disintUni = this.uniforms(this.disintProg, ['uItem', 'uRand', 'uLut', 'uAX', 'uY', 'uW', 'uMask', 'uRozpad', 'uRev', 'uRect']);
    this.setUni = this.uniforms(this.setProg, ['uLut', 'uIdx', 'uRect']);
    this.indexedUni = this.uniforms(this.indexedProg, ['uIdxTex', 'uLut']);
    this.spriteUni = this.uniforms(this.spriteProg, ['uSprite', 'uX', 'uY', 'uW', 'uMirror', 'uRect']);
    this.mirrorUni = this.uniforms(this.mirrorProg, ['uRgba', 'uIdx', 'uX', 'uY', 'uDX', 'uDY', 'uCX', 'uCY', 'uW']);
    this.presentUni = this.uniforms(this.presentProg, ['uTex']);

    // Fullscreen oversized triangle (background + mirror + present).
    this.fsVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.fsVao);
    const fsBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Unit quad (item/fish/setIndex rects), triangle strip corners.
    this.rectVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.rectVao);
    const rectBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.wallTex = indexTexture(gl);
    this.bgTex = indexTexture(gl);
    this.itemTex = indexTexture(gl);
    this.cutTex = indexTexture(gl);
    this.bodyTex = indexTexture(gl);
    this.headTex = indexTexture(gl);
    this.randTex = indexTexture(gl);
    this.uploadIndex(this.randTex, 256, 1, RANDPOLE);
    this.bandsTex = indexTexture(gl);
    this.ffngWallTex = rgbaTexture(gl);
    this.ffngBgTex = rgbaTexture(gl);
    this.spriteTex = rgbaTexture(gl);
    this.lutTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uniforms(p: WebGLProgram, names: readonly string[]): Uni {
    const u: Uni = {};
    for (const n of names) u[n] = this.gl.getUniformLocation(p, n);
    return u;
  }

  private uploadIndex(tex: WebGLTexture, w: number, h: number, pixels: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, pixels);
  }

  /**
   * Like uploadIndex, but skips the (full-texture) re-upload when the exact same
   * immutable bitmap is already resident in this texture. Used only for the static
   * wall/bg index textures — which are re-blitted every frame at 60fps while their
   * pixels only change on a room change / wall-animation frame (12.5fps). The wobble
   * itself is a per-frame `uCount` uniform, so the textures don't need re-uploading
   * between those changes. Keyed on the pixels array IDENTITY (FFR bitmaps are parsed
   * once and never mutated in place), so an animated wall frame — a different array —
   * re-uploads correctly. Safe because wallTex/bgTex are sampled-only (never FBO
   * targets), so uploadIndex is the sole way their content changes.
   */
  private uploadIndexCached(tex: WebGLTexture, w: number, h: number, pixels: Uint8Array): void {
    const prev = this.lastUpload.get(tex);
    if (prev && prev.pixels === pixels && prev.w === w && prev.h === h) return; // already resident
    this.uploadIndex(tex, w, h, pixels);
    this.lastUpload.set(tex, { pixels, w, h });
  }

  private uploadLut(palette: readonly FfrPaletteEntry[]): void {
    const gl = this.gl;
    const lut = this.lut;
    for (let idx = 0; idx < 256; idx++) {
      const c = palette[idx] ?? { r: 0, g: 0, b: 0 };
      lut[idx * 4] = c.r;
      lut[idx * 4 + 1] = c.g;
      lut[idx * 4 + 2] = c.b;
      lut[idx * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
  }

  private makeFboSet(w: number, h: number): FboSet {
    const gl = this.gl;
    const rgbaTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, rgbaTex);
    // NEAREST so the present upscale stays pixel-crisp — identical to the CPU
    // path's `image-rendering: pixelated`, so switching backend never changes the
    // classic look. (The mirror pass reads this via texelFetch, filter-independent.)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const idxTex = indexTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, w, h, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rgbaTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, idxTex, 0);
    return { fbo, rgbaTex, idxTex };
  }

  private ensureFbos(w: number, h: number): void {
    if (this.setA && this.fboW === w && this.fboH === h) return;
    const gl = this.gl;
    for (const s of [this.setA, this.setB]) {
      if (!s) continue;
      gl.deleteTexture(s.rgbaTex);
      gl.deleteTexture(s.idxTex);
      gl.deleteFramebuffer(s.fbo);
    }
    this.setA = this.makeFboSet(w, h);
    this.setB = this.makeFboSet(w, h);
    this.fboW = w;
    this.fboH = h;
  }

  /** Bind an FBO set as the draw target with both attachments as draw buffers. */
  private bindTarget(s: FboSet): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.viewport(0, 0, this.fboW, this.fboH);
  }

  /**
   * Begin a frame: size the offscreen FBOs to W×H, upload the palette LUT, and
   * bind the primary FBO as the draw target. Every subsequent blit draws into it
   * in call order (z-order). GL state: no depth, no blend — masking is per-pixel
   * `discard`, so a later opaque quad overwrites an earlier one like the CPU copy.
   */
  begin(w: number, h: number, palette: readonly FfrPaletteEntry[]): void {
    const gl = this.gl;
    this.width = w;
    this.height = h;
    this.unsupported = false;
    this.ensureFbos(w, h);
    this.uploadLut(palette);
    this.cur = this.setA;
    this.bindTarget(this.cur!);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** NDC rect for a screen pixel rect [x0,x1)×[y0,y1); no Y flip (matches the bg shader). */
  private setRect(loc: WebGLUniformLocation | null, x0: number, y0: number, x1: number, y1: number): void {
    const nx0 = (x0 / this.width) * 2 - 1;
    const nx1 = (x1 / this.width) * 2 - 1;
    const ny0 = (y0 / this.height) * 2 - 1;
    const ny1 = (y1 / this.height) * 2 - 1;
    this.gl.uniform4f(loc, nx0, ny0, nx1, ny1);
  }

  // --- CompositeTarget: read-back primitives the GPU path never uses ----------
  // Only the CPU `cpuMirror` calls these; GlScreen overrides `mirror` with a
  // shader pass, so they are never reached on the GPU path (they flag
  // `unsupported` purely as a defensive seam — see the field's doc).

  getIndex(_x: number, _y: number): number {
    this.unsupported = true;
    return 0;
  }

  copyPixel(_dx: number, _dy: number, _sx: number, _sy: number): void {
    this.unsupported = true;
  }

  // --- CompositeTarget: supported primitives ---------------------------------

  /** Write one palette-index pixel (ropes/hooks/baked subtitles) as a 1×1 quad. */
  setIndex(x: number, y: number, idx: number): void {
    const gl = this.gl;
    const u = this.setUni;
    gl.useProgram(this.setProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uLut!, 0);
    gl.uniform1i(u.uIdx!, idx);
    this.setRect(u.uRect!, x, y, x + 1, y + 1);
    gl.bindVertexArray(this.rectVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  fillIndex(idx: number): void {
    const gl = this.gl;
    const o = idx << 2;
    gl.clearBufferfv(gl.COLOR, 0, [this.lut[o]! / 255, this.lut[o + 1]! / 255, this.lut[o + 2]! / 255, 1]);
    gl.clearBufferuiv(gl.COLOR, 1, new Uint32Array([idx, 0, 0, 0]));
  }

  blit(x: number, y: number, bm: FfrBitmap, mask: number): void {
    this.drawMasked(x, y, bm, mask, 0);
  }

  blitRev(x: number, y: number, bm: FfrBitmap, mask: number): void {
    this.drawMasked(x, y, bm, mask, 1);
  }

  blitFishBody(x: number, y: number, bm: FfrBitmap, mask: number, rev: boolean): void {
    this.drawMasked(x, y, bm, mask, rev ? 2 : 0);
  }

  /** Shared item draw for blit/blitRev/blitFishBody (mode selects the column map). */
  private drawMasked(x: number, y: number, bm: FfrBitmap, mask: number, mode: number): void {
    const gl = this.gl;
    const u = this.itemUni;
    this.uploadIndex(this.itemTex, bm.w, bm.h, bm.pixels);
    gl.useProgram(this.itemProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.itemTex);
    gl.uniform1i(u.uItem!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uLut!, 1);
    gl.uniform1i(u.uX!, x);
    gl.uniform1i(u.uY!, y);
    gl.uniform1i(u.uW!, bm.w);
    gl.uniform1i(u.uMask!, mask);
    gl.uniform1i(u.uMode!, mode);
    // Quad extent: modes 0/1 occupy [x, x+w); mode 2 (leftward) occupies [x-w+1, x+1).
    const x0 = mode === 2 ? x - bm.w + 1 : x;
    const x1 = mode === 2 ? x + 1 : x + bm.w;
    this.setRect(u.uRect!, x0, y, x1, y + bm.h);
    gl.bindVertexArray(this.rectVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  blit2(
    x: number,
    y: number,
    wall: FfrBitmap,
    bg: FfrBitmap,
    mask: number,
    count: number,
    wamp: number,
    wper: number,
    wspd: number,
  ): void {
    // The faithful Kresli2 background is a fullscreen pass; (x,y) is always (0,0)
    // in the shipped rooms. Anything else would need an offset uniform.
    void x;
    void y;
    const gl = this.gl;
    const u = this.bgUni;
    this.uploadIndexCached(this.wallTex, wall.w, wall.h, wall.pixels);
    this.uploadIndexCached(this.bgTex, bg.w, bg.h, bg.pixels);
    gl.useProgram(this.bgProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.wallTex);
    gl.uniform1i(u.uWall!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(u.uBg!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uLut!, 2);
    gl.uniform1i(u.uMask!, mask);
    gl.uniform1i(u.uBgExtra!, FFR_EXTRA);
    gl.uniform1f(u.uWamp!, wamp);
    gl.uniform1f(u.uWper!, wper);
    gl.uniform1f(u.uWspd!, wspd);
    gl.uniform1f(u.uCount!, count);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  blitDisintegrate(x: number, y: number, bm: FfrBitmap, mask: number, rozpad: number, rev: boolean): void {
    const gl = this.gl;
    const u = this.disintUni;
    this.uploadIndex(this.itemTex, bm.w, bm.h, bm.pixels);
    gl.useProgram(this.disintProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.itemTex);
    gl.uniform1i(u.uItem!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.randTex);
    gl.uniform1i(u.uRand!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uLut!, 2);
    gl.uniform1i(u.uAX!, x);
    gl.uniform1i(u.uY!, y);
    gl.uniform1i(u.uW!, bm.w);
    gl.uniform1i(u.uMask!, mask);
    gl.uniform1i(u.uRozpad!, Math.min(rozpad, 255));
    gl.uniform1i(u.uRev!, rev ? 1 : 0);
    const x0 = rev ? x - bm.w + 1 : x;
    const x1 = rev ? x + 1 : x + bm.w;
    this.setRect(u.uRect!, x0, y, x1, y + bm.h);
    gl.bindVertexArray(this.rectVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  blitFishComposite(
    x: number,
    y: number,
    body: FfrBitmap,
    head: FfrBitmap | null,
    mask: number,
    split: number,
    rev: boolean,
  ): void {
    if (!head) split = 0;
    const gl = this.gl;
    const u = this.fishUni;
    this.uploadIndex(this.bodyTex, body.w, body.h, body.pixels);
    if (head) this.uploadIndex(this.headTex, head.w, head.h, head.pixels);
    gl.useProgram(this.fishProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bodyTex);
    gl.uniform1i(u.uBody!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, head ? this.headTex : this.bodyTex);
    gl.uniform1i(u.uHead!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uLut!, 2);
    gl.uniform1i(u.uAX!, x);
    gl.uniform1i(u.uY!, y);
    gl.uniform1i(u.uMask!, mask);
    gl.uniform1i(u.uSplit!, split);
    gl.uniform1i(u.uHeadW!, head ? head.w : 0);
    gl.uniform1i(u.uHasHead!, head ? 1 : 0);
    gl.uniform1i(u.uRev!, rev ? 1 : 0);
    const x0 = rev ? x - body.w + 1 : x;
    const x1 = rev ? x + 1 : x + body.w;
    this.setRect(u.uRect!, x0, y, x1, y + body.h);
    gl.bindVertexArray(this.rectVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * ZX-Spectrum wall render (gspec=42, KresliZX) — GPU counterpart of
   * `RgbaScreen.blitZX`. The per-scanline loading-stripe band is a sequential
   * running counter over `st`, so it's computed here on the CPU (cheap, O(rows))
   * — mutating `st` byte-identically to the CPU path so the animation state
   * advances the same on either backend — then uploaded as a 1-row palette-index
   * strip; the shader does the parallel per-pixel wall/bg/band lookup. The band
   * WIDTH (`st.pruh`) is randomised per frame upstream in `classicBackground`, so
   * the live animation is non-deterministic (matched only under a seeded probe).
   */
  blitZX(
    x: number,
    y: number,
    wall: FfrBitmap,
    bg: FfrBitmap,
    mask: number,
    count: number,
    wamp: number,
    wper: number,
    wspd: number,
    colors: readonly number[],
    st: { pruh: number; count: number; cur: number },
  ): void {
    void x;
    void y;
    const gl = this.gl;
    const ih = wall.h;
    // Precompute the per-scanline band palette index, mutating st exactly as the
    // CPU blitZX does — including its bounds guard: a row whose destination
    // (y + i) is off-screen is skipped BEFORE the counter advances, so st stays
    // in lockstep with the CPU path (rgbaScreen.ts blitZX). In every shipped ZX
    // frame y=0 and ih=height so no row is skipped, but matching the guard keeps
    // the two backends from silently desyncing if that ever changes.
    const bands = new Uint8Array(ih);
    for (let i = 0; i < ih; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      st.count += 1;
      if (st.count > st.pruh) {
        st.count -= st.pruh;
        st.cur = st.cur === 0 ? 1 : st.cur === 1 ? 0 : st.cur === 2 ? 3 : 2;
      }
      bands[i] = colors[st.cur] ?? 0;
    }
    this.uploadIndexCached(this.wallTex, wall.w, wall.h, wall.pixels);
    this.uploadIndexCached(this.bgTex, bg.w, bg.h, bg.pixels);
    this.uploadIndex(this.bandsTex, ih, 1, bands);
    const u = this.zxUni;
    gl.useProgram(this.zxProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.wallTex);
    gl.uniform1i(u.uWall!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(u.uBg!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bandsTex);
    gl.uniform1i(u.uBands!, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uLut!, 3);
    gl.uniform1i(u.uMask!, mask);
    gl.uniform1i(u.uBgExtra!, FFR_EXTRA);
    gl.uniform1f(u.uWamp!, wamp);
    gl.uniform1f(u.uWper!, wper);
    gl.uniform1f(u.uWspd!, wspd);
    gl.uniform1f(u.uCount!, count);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Upload straight-RGBA pixels (W*H*4) to an RGBA8 texture. */
  private uploadRgba(tex: WebGLTexture, w: number, h: number, rgba: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  /**
   * Enhanced (FFNG truecolor) background — GPU counterpart of
   * `RgbaScreen.blit2Rgba`. Structure (index plane, wall-vs-bg + wobble offset)
   * from the classic bitmaps; colour from the FFNG masters. Fullscreen pass.
   */
  blit2Rgba(
    classicWall: FfrBitmap,
    classicBg: FfrBitmap,
    ffngWall: Uint8Array,
    ffngBg: Uint8Array,
    mask: number,
    count: number,
    wamp: number,
    wper: number,
    wspd: number,
  ): void {
    const gl = this.gl;
    const u = this.bg2Uni;
    this.uploadIndexCached(this.wallTex, classicWall.w, classicWall.h, classicWall.pixels);
    this.uploadIndexCached(this.bgTex, classicBg.w, classicBg.h, classicBg.pixels);
    this.uploadRgba(this.ffngWallTex, this.width, this.height, ffngWall);
    this.uploadRgba(this.ffngBgTex, this.width, this.height, ffngBg);
    gl.useProgram(this.bg2Prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.wallTex);
    gl.uniform1i(u.uWall!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(u.uBgIdx!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.ffngWallTex);
    gl.uniform1i(u.uFfngWall!, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.ffngBgTex);
    gl.uniform1i(u.uFfngBg!, 3);
    gl.uniform1i(u.uMask!, mask);
    gl.uniform1i(u.uBgExtra!, FFR_EXTRA);
    gl.uniform1i(u.uW!, this.width);
    gl.uniform1f(u.uWamp!, wamp);
    gl.uniform1f(u.uWper!, wper);
    gl.uniform1f(u.uWspd!, wspd);
    gl.uniform1f(u.uCount!, count);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * Alpha-blend a straight-RGBA truecolor sprite (FFNG object/fish) — GPU
   * counterpart of `RgbaScreen.blitSpriteRgba`. Straight-alpha GL blend over the
   * composited colour; the index plane is preserved (draw buffer 1 disabled), so
   * the sprite is a display-only overlay exactly like the CPU.
   */
  blitSpriteRgba(rgba: Uint8Array, sw: number, sh: number, x0: number, y0: number, mirror: boolean): void {
    const gl = this.gl;
    const u = this.spriteUni;
    this.uploadRgba(this.spriteTex, sw, sh, rgba);
    // Only touch the colour attachment; leave the palette-index plane intact.
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.spriteProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.spriteTex);
    gl.uniform1i(u.uSprite!, 0);
    gl.uniform1i(u.uX!, x0);
    gl.uniform1i(u.uY!, y0);
    gl.uniform1i(u.uW!, sw);
    gl.uniform1i(u.uMirror!, mirror ? 1 : 0);
    this.setRect(u.uRect!, x0, y0, x0 + sw, y0 + sh);
    gl.bindVertexArray(this.rectVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); // restore MRT
  }

  /**
   * KresliZrcadlo mirror as a ping-pong shader pass: read the composited buffer,
   * reflect glass pixels, write to the other FBO, then make it current. Guards
   * match `cpuMirror` (degenerate size / centre out of bounds → no-op).
   */
  mirror(x: number, y: number, dx: number, dy: number): void {
    if (dx <= 0 || dy <= 0) return;
    const cx = x + (dx >> 1);
    const cy = y + (dy >> 1);
    if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) return;
    const gl = this.gl;
    const src = this.cur!;
    const dst = src === this.setA ? this.setB! : this.setA!;
    this.bindTarget(dst);
    gl.useProgram(this.mirrorProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.rgbaTex);
    gl.uniform1i(this.mirrorUni.uRgba!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.idxTex);
    gl.uniform1i(this.mirrorUni.uIdx!, 1);
    gl.uniform1i(this.mirrorUni.uX!, x);
    gl.uniform1i(this.mirrorUni.uY!, y);
    gl.uniform1i(this.mirrorUni.uDX!, dx);
    gl.uniform1i(this.mirrorUni.uDY!, dy);
    gl.uniform1i(this.mirrorUni.uCX!, cx);
    gl.uniform1i(this.mirrorUni.uCY!, cy);
    gl.uniform1i(this.mirrorUni.uW!, this.width);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.cur = dst; // subsequent draws (ropes/hooks) target the reflected buffer
  }

  /** KresliDvojlano double rope — driven through the GPU setIndex primitive. */
  drawRope(x1: number, y1: number, x2: number, y2: number, col: number): void {
    cpuDrawRope(this, x1, y1, x2, y2, col);
  }

  // --- background-only convenience (isolated diagnostic) ---------------------

  /**
   * Render just the Kresli2 background. Intentionally retained (not vestigial):
   * the isolated background parity check (glBgParity / test-gl-background) is the
   * clean first-failure signal for the FP32-`sin` wobble, isolating it from the
   * thousands of pixels in a full-room compare.
   */
  renderBackgroundOnly(room: Room, palette: readonly FfrPaletteEntry[], count: number): void {
    const { wall, bg, mask, wamp, wper, wspd } = backgroundInputs(room);
    this.begin(wall.w, wall.h, palette);
    this.blit2(0, 0, wall, bg, mask, count, wamp, wper, wspd);
  }

  /**
   * Render a whole palette-indexed frame (the briefcase cutscene) into the
   * offscreen FBO. Unlike the room path this is a single full-screen LUT lookup;
   * `present(..., true)` then upscales it with LINEAR filtering for a smooth
   * (non-blocky) enlargement of the 256-colour source on hi-DPI displays.
   */
  renderIndexed(pixels: Uint8Array, w: number, h: number, palette: readonly FfrPaletteEntry[]): void {
    const gl = this.gl;
    this.begin(w, h, palette);
    this.uploadIndex(this.cutTex, w, h, pixels);
    const u = this.indexedUni;
    gl.useProgram(this.indexedProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cutTex);
    gl.uniform1i(u.uIdxTex!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u.uLut!, 1);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * Present the composited offscreen frame to the canvas (upscaled, DPR-correct).
   * `smooth` swaps the FBO texture filter to LINEAR for a bilinear upscale (the
   * cutscene); the default NEAREST keeps room art pixel-crisp like the CPU path.
   */
  present(canvasW: number, canvasH: number, smooth = false): void {
    const gl = this.gl;
    if (!this.cur) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.useProgram(this.presentProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cur.rgbaTex);
    const filt = smooth ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.uniform1i(this.presentUni.uTex!, 0);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /** Read the composited native-res frame back as top-down RGBA (for tolerance tests). */
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
   * Test-only: present the current FBO to the canvas at canvasW×canvasH and read
   * the *presented* pixels back from the default framebuffer. Unlike `readback()`
   * (which reads the offscreen FBO, independent of the upscale filter), this
   * captures the on-screen result, so a test can assert the present filter —
   * NEAREST (crisp) vs LINEAR (smooth) — and that a smooth present does not leak
   * its LINEAR filter into a subsequent crisp present.
   */
  presentReadback(canvasW: number, canvasH: number, smooth: boolean): Uint8Array {
    const gl = this.gl;
    this.present(canvasW, canvasH, smooth);
    const out = new Uint8Array(canvasW * canvasH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  /**
   * Block until all issued GL commands have finished executing on the GPU. WebGL
   * calls are asynchronous (they only queue work), so a benchmark must call this
   * to include real GPU execution time rather than just command-submission time.
   */
  finish(): void {
    this.gl.finish();
  }
}

/** True if the browser can create a WebGL2 context (capability check for the opt-in path). */
export function webgl2Available(): boolean {
  if (webgl2Cached === null) {
    try {
      webgl2Cached = !!document.createElement('canvas').getContext('webgl2');
    } catch {
      webgl2Cached = false;
    }
  }
  return webgl2Cached;
}
let webgl2Cached: boolean | null = null;
