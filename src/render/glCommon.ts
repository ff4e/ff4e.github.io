/**
 * WebGL2 plumbing shared by the two room compositors.
 *
 * `GlScreen` (src/render/glScreen.ts) composites the classic/enhanced tiers from
 * palette-INDEX art through an MRT colour+index framebuffer; `GlAiScreen`
 * (src/render/glRoomAi.ts) composites the `ai` tier from straight-RGBA art at ×S with no
 * index plane at all. Those pixel models are genuinely different and the two classes stay
 * separate — `GlScreen`'s byte-exact CPU parity across all 72 rooms is a hard constraint,
 * and folding a second differently-shaped pipeline into it is how that gets regressed.
 *
 * None of which applies to the mechanical part. Shader compilation, program linking,
 * uniform-location caching, the fullscreen triangle and the unit quad, and the
 * pixel-rect-to-NDC mapping are identical in both and have no opinion about pixel
 * models. They live here so there is one copy.
 *
 * Convention shared by both compositors: textures are uploaded top-down (row 0 = the top
 * of the image) and `gl_FragCoord.y` IS the top-down row, so offscreen buffers hold the
 * image flipped in GL's own terms and the present pass flips Y on the way to the canvas.
 */

/** Fullscreen pass: an oversized triangle covering the viewport. */
export const QUAD_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** A screen-rect quad in framebuffer pixel space; the VS maps [0,1]² across uRect (NDC). */
export const RECT_VS = `#version 300 es
in vec2 aCorner;         // unit quad corner 0..1
uniform vec4 uRect;      // (x0,y0,x1,y1) in NDC
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aCorner);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string, tag: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`${tag} shader: ${gl.getShaderInfoLog(sh) ?? ''}`);
  }
  return sh;
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  attrib0: string,
  tag: string,
): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs, tag));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs, tag));
  gl.bindAttribLocation(p, 0, attrib0);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${tag} program: ${gl.getProgramInfoLog(p) ?? ''}`);
  }
  return p;
}

/** Uniform-location cache for one program (getUniformLocation is slow to call in loops). */
export type Uni = Record<string, WebGLUniformLocation | null>;

export function uniformLocations(gl: WebGL2RenderingContext, p: WebGLProgram, names: readonly string[]): Uni {
  const u: Uni = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}

/** VAO for the fullscreen triangle (background / mirror / present passes). */
export function makeFullscreenVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  return vaoFrom(gl, new Float32Array([-1, -1, 3, -1, -1, 3]));
}

/** VAO for the unit quad drawn as a triangle strip (item / fish / rect passes). */
export function makeRectVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  return vaoFrom(gl, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]));
}

function vaoFrom(gl: WebGL2RenderingContext, verts: Float32Array): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

/** Map a framebuffer pixel rect onto the NDC rect `RECT_VS` spans. */
export function setRectUniform(
  gl: WebGL2RenderingContext,
  loc: WebGLUniformLocation | null,
  fbW: number,
  fbH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  gl.uniform4f(loc, (x0 / fbW) * 2 - 1, (y0 / fbH) * 2 - 1, (x1 / fbW) * 2 - 1, (y1 / fbH) * 2 - 1);
}

/** Point-sampled, edge-clamped filtering for the currently bound TEXTURE_2D. */
export function nearestClamp(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
