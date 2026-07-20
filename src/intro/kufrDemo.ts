/**
 * Briefcase story cutscene (KUFRIK's InitKufrDemo / Kufrik, URoom.pas:2860-2970).
 *
 * Plays the packed delta-frame animation `demo.pck` over the base image
 * `kufr256.bmp`, driven by `script.txt`, with the `KD-*` narration captions.
 *
 * Assets (Intro/): kufr256.bmp (720x555, 8-bit) is the canvas; the animation is
 * a 380x285 region at offset (135,25). Each demo.pck frame is a run-coded delta:
 * alternating skip / draw runs; a draw run copies literal palette bytes, with an
 * 0xFF escape = [count, colour] RLE (kresli_obrazek).
 */
import { FFS_SAMPLE_RATE } from '../audio/ffs.js';
import { parseBmp, type Bmp } from '../data/bmp.js';

const DEMO_X = 135;
const DEMO_Y = 25;
const DEMO_W = 380;
const DEMO_H = 285;


type Cmd =
  | { kod: 'o' }
  | { kod: 'd'; n: number }
  | { kod: 'w' }
  | { kod: 'caption'; name: string }
  | { kod: 'X' };

/** Parse script.txt into the command stream ('a' expands to delay-1 + draw). */
function parseScript(text: string): Cmd[] {
  const cmds: Cmd[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length === 0) continue;
    const kod = raw[0]!;
    const arg = raw.slice(1).trim();
    switch (kod) {
      case 'a':
        cmds.push({ kod: 'd', n: 1 }, { kod: 'o' });
        break;
      case 'o':
        cmds.push({ kod: 'o' });
        break;
      case 'd':
        cmds.push({ kod: 'd', n: parseInt(arg, 10) || 0 });
        break;
      case 'w':
        cmds.push({ kod: 'w' });
        break;
      case '$':
        cmds.push({ kod: 'caption', name: arg });
        break;
      case 'X':
        cmds.push({ kod: 'X' });
        break;
    }
  }
  cmds.push({ kod: 'X' });
  return cmds;
}

export class KufrDemo {
  private readonly base: Bmp;
  private readonly canvas: Uint8Array; // working copy (persistent delta target)
  private readonly pck: Uint8Array;
  private pckPos = 0;
  private readonly script: Cmd[];
  private scriptPos = 0;
  private cekani = 0;
  done = false;

  constructor(bmpBytes: Uint8Array, pckBytes: Uint8Array, scriptText: string) {
    this.base = parseBmp(bmpBytes);
    this.canvas = this.base.pixels.slice();
    this.pck = pckBytes;
    this.script = parseScript(scriptText);
  }

  get width(): number {
    return this.base.w;
  }
  get height(): number {
    return this.base.h;
  }
  /** The live indexed canvas (draw subtitles over a copy of this). */
  get pixels(): Uint8Array {
    return this.canvas;
  }
  /** The base palette (for RGBA conversion + subtitle colour mapping). */
  get palette(): readonly { r: number; g: number; b: number }[] {
    return this.base.palette;
  }

  /** kresli_obrazek: decode the next demo.pck frame into the canvas (delta). */
  private drawFrame(): void {
    if (this.pckPos + 4 > this.pck.length) return;
    const dv = new DataView(this.pck.buffer, this.pck.byteOffset, this.pck.byteLength);
    const pcknum = dv.getInt32(this.pckPos, true);
    this.pckPos += 4;
    if (pcknum <= 0) return; // hold current frame
    let pos = this.pckPos;
    this.pckPos += pcknum;
    const W = this.base.w;
    let x = 0;
    let y = 0;
    let draw = false;
    const put = (col: number): void => {
      this.canvas[(y + DEMO_Y) * W + (x + DEMO_X)] = col;
      x++;
      if (x === DEMO_W) {
        x = 0;
        y++;
      }
    };
    while (y < DEMO_H) {
      const poc = this.pck[pos]! | (this.pck[pos + 1]! << 8);
      pos += 2;
      if (!draw) {
        x += poc;
        while (x >= DEMO_W) {
          x -= DEMO_W;
          y++;
        }
      } else {
        let i = 0;
        while (i < poc) {
          if (this.pck[pos] === 0xff) {
            const cnt = this.pck[pos + 1]!;
            const col = this.pck[pos + 2]!;
            pos += 3;
            i += cnt;
            for (let j = 0; j < cnt; j++) put(col);
          } else {
            put(this.pck[pos]!);
            pos++;
            i++;
          }
        }
      }
      draw = !draw;
    }
  }

  /**
   * Advance the cutscene one tick (Kufrik). `onCaption(name)` plays 'KD-<name>'
   * and returns its length in frames (used for the 'w' wait). `isPlaying`
   * reports whether that voice is still sounding.
   */
  tick(onCaption: (name: string) => number, isPlaying: () => boolean): void {
    if (this.done) return;
    if (this.cekani > 0) this.cekani--;
    // Process zero-delay commands until we hit a wait.
    let guard = 0;
    while (this.cekani === 0 && !this.done && guard++ < 1000) {
      const c = this.script[this.scriptPos];
      if (!c) {
        this.done = true;
        break;
      }
      switch (c.kod) {
        case 'o':
          this.drawFrame();
          this.scriptPos++;
          break;
        case 'd':
          this.cekani = c.n;
          this.scriptPos++;
          break;
        case 'w':
          if (!isPlaying()) this.scriptPos++;
          else this.cekani = 1;
          break;
        case 'caption':
          onCaption(c.name);
          this.scriptPos++;
          break;
        case 'X':
          this.done = true;
          break;
      }
    }
  }

  /** Current canvas as an RGBA buffer (using the base palette). */
  toRgba(): Uint8Array {
    const out = new Uint8Array(this.canvas.length * 4);
    for (let i = 0; i < this.canvas.length; i++) {
      const c = this.base.palette[this.canvas[i]!]!;
      const o = i * 4;
      out[o] = c.r;
      out[o + 1] = c.g;
      out[o + 2] = c.b;
      out[o + 3] = 255;
    }
    return out;
  }
}

/** Estimate a voice length in frames from an FFS sample count (for 'w' waits). */
export function samplesToFrames(samples: number): number {
  return Math.max(30, Math.round((samples / FFS_SAMPLE_RATE) * 60));
}
