/**
 * The native half of native/compare-media.mjs: the movie frames, the movie sound and the
 * credits roll, rendered headless by the same code the game uses, for comparison with the
 * browser's (native/js/mediaReference.ts).
 *
 *   --movie-frames URL --at T1,T2,… --out PREFIX
 *       the frame `movieFrame` shows at each time, decoding the movie FORWARD from its start
 *       as playback does (no seeking), drawn 1:1 onto an RGBA surface: PREFIX-<i>.rgba
 *   --movie-audio URL --out FILE
 *       the movie's sound as the player plays it: started with `moviePlay` and pulled through
 *       the movie track on the headless clock, to a little past its end, interleaved
 *       float32, prefixed by u32 channels, u32 rate and u32 the track's decoded length
 *   --credits-scene MS1,MS2,… --out PREFIX [--mutate KIND]
 *       the roll each time after it opened (`creditsAt`, `paintCredits`), at the art's own
 *       size: PREFIX-<i>.rgba
 */
import { NativeSurface } from './nativeSurface.js';
import { creditsAt, loadCreditsArt, paintCredits } from './creditsScreen.js';
import { creditsTranslate } from '../../src/render/creditsAi.js';
import { readBytes } from './shims.js';

export async function renderMovieFrames(url: string, times: number[], prefix: string): Promise<void> {
  const m = __native.movieOpen(url);
  let surface: NativeSurface | null = null;
  for (const [i, t] of times.entries()) {
    const [tex, pts] = __native.movieFrame(m.id, t);
    if (!tex) throw new Error(`${url}: no frame at ${t} s`);
    surface ??= new NativeSurface(m.width, m.height);
    surface.setSmoothing(false);
    surface.drawImage({ id: tex, width: m.width, height: m.height, premultiplied: true } as never, 0, 0);
    __native.saveTexture(surface.id, `${prefix}-${i}.rgba`);
    console.log(`frame at ${t.toFixed(4)} s: pts ${pts.toFixed(4)}`);
  }
  __native.movieClose(m.id);
}

export async function renderMovieAudio(url: string, out: string): Promise<void> {
  __native.audioOpen(1); // headless: the manual clock, which only movieAdvance moves
  const m = __native.movieOpen(url);
  if (!__native.moviePlay(m.id)) throw new Error(`${url}: no sound`);
  const parts: Float32Array[] = [];
  // 80 ms at a time, as the headless game advances; a little past the end, which is silence.
  for (let t = 0; t < m.duration * 1000 + 160; t += 80) parts.push(new Float32Array(__native.movieAdvance(80, true)!));
  const ref = __native.movieAudioPcm(url)!;
  const n = parts.reduce((a, p) => a + p.length, 0);
  const buf = new ArrayBuffer(12 + n * 4);
  const head = new Uint32Array(buf, 0, 3);
  head[0] = ref[1];
  head[1] = ref[2];
  head[2] = ref[0].byteLength / 4 / ref[1]; // the track's own length, before the silence after it
  let at = 0;
  const body = new Float32Array(buf, 12);
  for (const p of parts) {
    body.set(p, at);
    at += p.length;
  }
  __native.writeFile(out, buf);
  __native.movieClose(m.id);
  console.log(`${url}: ${n / ref[1]} frames of ${ref[1]}-channel sound at ${ref[2]} Hz played`);
}

/**
 * The roll `ms` milliseconds after it opened, for each time given. `mutate` draws it wrong
 * for the comparison's self-test: `late` (one native pixel further on: the roll 25 ms late,
 * four pixels of the art), `unflipped` (the strip the right way up), `nostat` (no static frame over it),
 * `bg` (the wrong backdrop colour).
 */
export async function renderCreditsScene(times: number[], prefix: string, mutate?: string): Promise<void> {
  const real = await loadCreditsArt(readBytes);
  const art = mutate === 'bg' ? { ...real, bg: real.bg ^ 0x303030 } : real;
  const s = new NativeSurface(art.stat.width, art.stat.height);
  for (const [i, ms] of times.entries()) {
    const posun = creditsAt(ms).creditScroll + (mutate === 'late' ? 1 : 0);
    if (mutate === 'unflipped' || mutate === 'nostat') {
      // paintCredits with one step wrong: the strip upright, or no frame over it.
      const W = s.width, H = s.height;
      const t = creditsTranslate(art.nativeH, art.delka, posun, W / art.nativeW);
      const mh = (art.mov.height * W) / art.mov.width;
      s.setSmoothing(false);
      s.fillRect(0, 0, W, H, art.bg);
      s.save();
      s.setSmoothing(true);
      if (mutate === 'nostat') {
        s.translate(0, t + mh);
        s.scale(1, -1);
        s.drawImage(art.mov, 0, 0, W, mh);
      } else {
        s.drawImage(art.mov, 0, t, W, mh);
      }
      s.restore();
      if (mutate === 'unflipped') s.drawImage(art.stat, 0, 0, W, H);
    } else {
      paintCredits(s, art, posun);
    }
    __native.saveTexture(s.id, `${prefix}-${i}.rgba`);
  }
}
