/**
 * `AiTarget` on the native GPU — the native counterpart of `GlAiScreen`
 * (src/render/glRoomAi.ts). Same seam, same per-pass inputs: everything that is ARITHMETIC
 * (the wobble phase, the ripple packets) is computed here by the very functions the
 * WebGL backend calls, so the only thing the native side owns is the shader that
 * consumes those numbers. That is what keeps the two backends comparable.
 */
import { RIPPLE_GPU_SLOTS, activeRipples, aiImagePatch, aiImageRevision, wobblePhase } from '../../src/render/aiTarget.js';
import type { AiImage, AiTarget, AiWobble } from '../../src/render/aiTarget.js';
import type { NativeTexture } from './nativeApi.js';
import { NativeCanvas } from './nativeCanvas.js';

/** The bytes of a typed-array view as a whole ArrayBuffer, which is what the host reads. */
function bytesOf(v: ArrayBufferView): ArrayBuffer {
  const whole = v.byteOffset === 0 && v.byteLength === v.buffer.byteLength;
  return (whole ? v.buffer : v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) as ArrayBuffer;
}

/** Frees a scratch canvas's or a mask's texture once nothing references the source. */
const reclaim = typeof FinalizationRegistry === 'function'
  ? new FinalizationRegistry<number>((id) => __native.releaseTexture(id))
  : null;

export class NativeAiScreen implements AiTarget {
  width = 0;
  height = 0;
  /**
   * Textures for the scratch canvases the room hands over (classic-sprite fallbacks,
   * LODE's wreck background), by identity plus `aiImageRevision` — the rule of
   * GlAiScreen.texture, including taking the last patch when exactly one revision behind.
   */
  private readonly canvasTex = new WeakMap<NativeCanvas, { id: number; revision: number }>();
  private readonly maskTex = new WeakMap<Float32Array, number>();
  private readonly rip = new Array<number>(RIPPLE_GPU_SLOTS * 4).fill(0);
  private readonly ripPh = new Array<number>(RIPPLE_GPU_SLOTS).fill(0);
  private bandBuf = new Uint8Array(0);

  private texOf(img: AiImage): NativeTexture {
    if (!(img instanceof NativeCanvas)) {
      const t = img as unknown as NativeTexture;
      if (typeof t.id !== 'number') throw new Error('native target was handed an image it did not decode (a DOM canvas?)');
      return t;
    }
    const revision = aiImageRevision(img);
    const hit = this.canvasTex.get(img);
    if (!hit) {
      const id = __native.createTexture(bytesOf(img.data), img.width, img.height, false);
      reclaim?.register(img, id);
      this.canvasTex.set(img, { id, revision });
      return { id, width: img.width, height: img.height };
    }
    if (hit.revision !== revision) {
      const patch = aiImagePatch(img);
      if (patch && patch.revision === revision && hit.revision === revision - 1) {
        __native.updateTexture(hit.id, patch.x, patch.y, patch.w, patch.h, bytesOf(patch.data));
      } else {
        __native.updateTexture(hit.id, 0, 0, img.width, img.height, bytesOf(img.data));
      }
      hit.revision = revision;
    }
    return { id: hit.id, width: img.width, height: img.height };
  }

  begin(w: number, h: number): void {
    this.width = w;
    this.height = h;
    __native.begin(w, h);
  }

  fill(r: number, g: number, b: number): void {
    __native.fill(r, g, b);
  }

  fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number): void {
    __native.fillRect(x, y, w, h, r, g, b);
  }

  blit(src: AiImage, x: number, y: number, mirror: boolean): void {
    const t = this.texOf(src);
    __native.blit(t.id, x, y, t.width, t.height, mirror);
  }

  background(_sig: string, bg: AiImage, wall: AiImage, wobble: AiWobble | null, scale: number): void {
    this.bgPass(bg, wall, wobble, scale, false);
  }

  /**
   * GlAiScreen.backgroundZx: one RGBA texel per NATIVE row, palette-resolved here, then
   * the same pass as `background` with `zx` selecting the band colour for the wall.
   * The bands are consumed as given — re-deriving them would advance the room's band state.
   */
  backgroundZx(
    bg: AiImage,
    wall: AiImage,
    bands: Uint8Array,
    palette: ReadonlyArray<{ r: number; g: number; b: number }>,
    wobble: AiWobble | null,
    scale: number,
  ): void {
    const n = bands.length;
    if (this.bandBuf.length !== n * 4) this.bandBuf = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const c = palette[bands[i]!] ?? { r: 0, g: 0, b: 0 };
      this.bandBuf[i * 4] = c.r;
      this.bandBuf[i * 4 + 1] = c.g;
      this.bandBuf[i * 4 + 2] = c.b;
      this.bandBuf[i * 4 + 3] = 255;
    }
    __native.setBands(this.bandBuf.buffer as ArrayBuffer, n);
    this.bgPass(bg, wall, wobble, scale, true);
  }

  /** Exactly GlAiScreen.bgPass's uniforms (src/render/glRoomAi.ts). */
  private bgPass(bg: AiImage, wall: AiImage, wobble: AiWobble | null, scale: number, zx: boolean): void {
    const b = this.texOf(bg);
    const rips = wobble ? activeRipples(wobble, Math.max(1, Math.round(b.height / scale))) : [];
    for (let i = 0; i < RIPPLE_GPU_SLOTS; i++) {
      const r = rips[i];
      const o = i * 4;
      this.rip[o] = r ? r.c : 0;
      this.rip[o + 1] = r ? r.halfW : 1;
      this.rip[o + 2] = r ? r.amp : 0;
      this.rip[o + 3] = r ? r.k : 0;
      this.ripPh[i] = r ? r.phase : 0;
    }
    __native.background(
      b.id, this.texOf(wall).id, scale, b.width, wobble !== null,
      wobble ? wobble.wamp / 2 : 0, wobble ? wobble.wper : 1, wobble ? wobblePhase(wobble) : 0,
      Math.min(rips.length, RIPPLE_GPU_SLOTS), this.rip, this.ripPh, zx,
    );
  }

  disintegrate(src: AiImage, x: number, y: number, scale: number, rozpad: number): void {
    const t = this.texOf(src);
    __native.disintegrate(t.id, x, y, t.width, t.height, scale, Math.max(1, Math.round(t.width / scale)), rozpad);
  }

  /** GlAiScreen.mirrorGlass: the same window arithmetic, then the MIRROR_FS pass. */
  mirrorGlass(X: number, Y: number, w: number, h: number, S: number, mask: Float32Array, MW: number, MH: number): void {
    const CW = this.width, CH = this.height;
    const rx0 = Math.max(0, Math.min(X, X + 4 - w) * S);
    const rx1 = Math.min(CW, Math.max(X + w, X + 4) * S);
    const ry0 = Math.max(0, Y * S), ry1 = Math.min(CH, (Y + h) * S);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const dx0 = Math.max(rx0, X * S), dx1 = Math.min(rx1, (X + w) * S);
    if (dx1 <= dx0) return;
    let id = this.maskTex.get(mask);
    if (id === undefined) {
      id = __native.createTexture(bytesOf(mask), MW, MH, true);
      reclaim?.register(mask, id);
      this.maskTex.set(mask, id);
    }
    __native.mirror(id, rx0, rx1, ry0, ry1, dx0, dx1, S * (2 * X + 4) - 1, X * S, Y * S, MW, MH);
  }
}
