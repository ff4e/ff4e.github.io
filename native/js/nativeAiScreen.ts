/**
 * `AiTarget` on the native GPU — the native counterpart of `GlAiScreen`
 * (src/render/glRoomAi.ts). Same seam, same per-pass inputs: everything that is ARITHMETIC
 * (the wobble phase, the ripple packets) is computed here by the very functions the
 * WebGL backend calls, so the only thing the native side owns is the shader that
 * consumes those numbers. That is what keeps the two backends comparable.
 */
import { RIPPLE_GPU_SLOTS, activeRipples, wobblePhase } from '../../src/render/aiTarget.js';
import type { AiImage, AiTarget, AiWobble } from '../../src/render/aiTarget.js';
import type { NativeTexture } from './nativeApi.js';

function texOf(img: AiImage): NativeTexture {
  const t = img as unknown as NativeTexture;
  if (typeof t.id !== 'number') throw new Error('native target was handed an image it did not decode (a DOM canvas?)');
  return t;
}

export class NativeAiScreen implements AiTarget {
  width = 0;
  height = 0;
  private readonly rip = new Array<number>(RIPPLE_GPU_SLOTS * 4).fill(0);
  private readonly ripPh = new Array<number>(RIPPLE_GPU_SLOTS).fill(0);
  private bandBuf = new Uint8Array(0);

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
    const t = texOf(src);
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
    const b = texOf(bg);
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
      b.id, texOf(wall).id, scale, b.width, wobble !== null,
      wobble ? wobble.wamp / 2 : 0, wobble ? wobble.wper : 1, wobble ? wobblePhase(wobble) : 0,
      Math.min(rips.length, RIPPLE_GPU_SLOTS), this.rip, this.ripPh, zx,
    );
  }

  disintegrate(src: AiImage, x: number, y: number, scale: number, rozpad: number): void {
    const t = texOf(src);
    __native.disintegrate(t.id, x, y, t.width, t.height, scale, Math.max(1, Math.round(t.width / scale)), rozpad);
  }

  mirrorGlass(): void {
    throw new Error('spike: mirrorGlass (spec=1 mirror) is not implemented natively yet');
  }
}
