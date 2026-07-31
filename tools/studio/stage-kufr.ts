/**
 * Stage the BRIEFCASE INTRO cutscene into the Upscaler Studio.
 *
 * The cutscene (KUFRIK's InitKufrDemo, URoom.pas:2860) is a suitcase containing a TV:
 * `Intro/kufr256.BMP` is the 720x555 static canvas, and `Intro/demo.pck` holds a stream
 * of run-coded DELTA frames painted into a 380x285 region at (135,25) — the TV screen,
 * which is pure black in the base image.
 *
 * Deltas cannot be upscaled: they are per-pixel palette writes, not pictures. So this
 * replays the animation and materialises every frame as a complete image, which the
 * upscaler can then treat as ordinary art.
 *
 * Written in TypeScript, and driving the REAL KufrDemo from src/, precisely so the
 * decoder cannot drift from the one the game runs. A second copy of the delta decoder
 * living in the tooling is exactly how this codebase has produced silent wrongness
 * before (the art would still look plausible, just not match the game).
 *
 * Output layout under `public/enhanced/_kufr/`:
 *   base.png            the 720x555 canvas, before any frame is painted   [Studio card]
 *   anim.png            one representative frame region                   [Studio card]
 *   frames/fNNNN.png    every distinct 380x285 region frame           [build input only]
 *
 * Only TWO cards are indexed, on purpose. An animation must use ONE model for every
 * frame — mixing models across frames would flicker — so the Studio should present one
 * decision for the whole animation (anim.png) plus one for the static canvas (base.png).
 * `frames/` is deliberately excluded from the index and from git: it is fully derived
 * from demo.pck, which the repo already ships, so regenerate it with this script.
 *
 * Because the animated region sits inside the TV's black screen area, upscaling the base
 * and the frames independently cannot produce a visible seam at the region border.
 *
 * Usage: npx tsx tools/studio/stage-kufr.ts [--force]
 * Then rebuild the index (delete tools/studio/index.json or restart the server).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { KufrDemo } from '../../src/intro/kufrDemo.js';

const studioDir = dirname(fileURLToPath(import.meta.url));
const root = join(studioDir, '..', '..');
const introDir = join(root, 'public', 'data', 'Intro');
const outDir = join(root, 'public', 'enhanced', '_kufr');
const framesDir = join(outDir, 'frames');

const FORCE = process.argv.includes('--force');

/** The animated region — must match src/intro/kufrDemo.ts. */
const DEMO_X = 135;
const DEMO_Y = 25;
const DEMO_W = 380;
const DEMO_H = 285;

function encodePng(rgba: Uint8Array, w: number, h: number, dst: string): void {
  const work = mkdtempSync(join(tmpdir(), 'kufr-'));
  try {
    const raw = join(work, 'in.rgba');
    writeFileSync(raw, Buffer.from(rgba));
    const r = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', raw,
      // Drop the (fully opaque) alpha channel: these are LAYERS, not sprites. Staging
      // them RGBA made the index flag them alpha, which routes the build through the
      // sprite pipeline (matting//contour) and ships a redundant alpha plane.
      '-pix_fmt', 'rgb24',
      '-frames:v', '1', dst,
    ]);
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(0, 200)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Write only when the bytes differ, so content hashes (and picks) stay stable. */
function writeIfChanged(dst: string, bytes: Buffer): boolean {
  if (!FORCE && existsSync(dst)) {
    const cur = readFileSync(dst);
    if (cur.length === bytes.length && cur.equals(bytes)) return false;
  }
  writeFileSync(dst, bytes);
  return true;
}

function pngBytes(rgba: Uint8Array, w: number, h: number): Buffer {
  const tmp = join(tmpdir(), `kufr-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
  encodePng(rgba, w, h, tmp);
  const b = readFileSync(tmp);
  rmSync(tmp, { force: true });
  return b;
}

const demo = new KufrDemo(
  new Uint8Array(readFileSync(join(introDir, 'kufr256.BMP'))),
  new Uint8Array(readFileSync(join(introDir, 'demo.pck'))),
  readFileSync(join(introDir, 'script.txt'), 'utf8'),
);

mkdirSync(outDir, { recursive: true });
mkdirSync(framesDir, { recursive: true });

/** Expand the whole indexed canvas to RGBA. */
const canvasRgba = (): Uint8Array => {
  const out = new Uint8Array(demo.width * demo.height * 4);
  for (let i = 0; i < demo.pixels.length; i++) {
    const c = demo.palette[demo.pixels[i]!]!;
    const o = i * 4;
    out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; out[o + 3] = 255;
  }
  return out;
};

/** Expand just the animated region to RGBA. */
const regionRgba = (): Uint8Array => {
  const out = new Uint8Array(DEMO_W * DEMO_H * 4);
  for (let y = 0; y < DEMO_H; y++) {
    for (let x = 0; x < DEMO_W; x++) {
      const c = demo.palette[demo.pixels[(y + DEMO_Y) * demo.width + (x + DEMO_X)]!]!;
      const o = (y * DEMO_W + x) * 4;
      out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b; out[o + 3] = 255;
    }
  }
  return out;
};

// The static canvas, captured BEFORE any delta is painted.
const baseWritten = writeIfChanged(join(outDir, 'base.png'), pngBytes(canvasRgba(), demo.width, demo.height));

// Replay the whole cutscene. Voices are stubbed as instantly-finished so the script
// runs deterministically to the end; only the PICTURE matters here, and the runtime
// keeps driving the real audio-dependent timeline.
const seen = new Map<string, string>();   // content hash -> file name
const order: string[] = [];               // file name per DECODED frame, in playback order
/** Per distinct frame: encoded size and a high-frequency "is this just TV static?" score. */
const stats: { name: string; size: number; noise: number }[] = [];
let ticks = 0;
let wrote = 0, skipped = 0;
let lastShown = 0;

/**
 * Mean absolute difference between horizontally adjacent pixels.
 *
 * The cutscene contains several frames of TV STATIC, which are by far the largest PNGs
 * (noise does not compress) and by far the worst thing to judge an upscaler on. Real
 * artwork has flat regions and edges; static has none, so this score separates them
 * cleanly.
 */
function noiseScore(rgba: Uint8Array, w: number, h: number): number {
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const a = (y * w + x) * 4, b = (y * w + x - 1) * 4;
      const la = (rgba[a]! * 299 + rgba[a + 1]! * 587 + rgba[a + 2]! * 114) / 1000;
      const lb = (rgba[b]! * 299 + rgba[b + 1]! * 587 + rgba[b + 2]! * 114) / 1000;
      sum += Math.abs(la - lb); n++;
    }
  }
  return sum / n;
}

// Record one entry per VISIBLE frame, keyed by KufrDemo.framesShown — the same counter
// the runtime indexes by, so the shipped sequence and the playback position cannot
// drift. NOT framesDrawn: one tick here decodes two frames and only the second is ever
// displayed, so a per-decode index runs ahead of what is actually shown.
// Identical frames still share one file (the animation repeats a few), but each visible
// state gets its own slot in `order`.
while (!demo.done && ticks++ < 20000) {
  demo.tick(() => 1, () => false);
  if (demo.framesShown === lastShown) continue;   // a hold: nothing decoded this tick
  lastShown = demo.framesShown;
  const rgba = regionRgba();
  const bytes = pngBytes(rgba, DEMO_W, DEMO_H);
  const hash = createHash('md5').update(bytes).digest('hex');
  const known = seen.get(hash);
  if (known) { order.push(known); continue; }
  const name = `f${String(seen.size).padStart(4, '0')}.png`;
  seen.set(hash, name);
  order.push(name);
  stats.push({ name, size: bytes.length, noise: noiseScore(rgba, DEMO_W, DEMO_H) });
  if (writeIfChanged(join(framesDir, name), bytes)) wrote++;
  else skipped++;
}

// The representative frame the Studio curates the animation with: the most detailed
// frame that is NOT static — i.e. the largest PNG among the quieter half of the frames.
// Judging a model on TV noise would be meaningless (and the noise frames are the very
// largest, so a plain "biggest PNG" rule picks exactly the wrong one).
const median = [...stats].sort((a, b) => a.noise - b.noise)[Math.floor(stats.length / 2)]?.noise ?? Infinity;
const candidates = stats.filter((s) => s.noise <= median);
const rep = (candidates.length ? candidates : stats).reduce((a, b) => (b.size > a.size ? b : a));
const best = rep.name, bestSize = rep.size;
if (best) writeIfChanged(join(outDir, 'anim.png'), readFileSync(join(framesDir, best)));

// The playback order, so the build and the runtime replay exactly this sequence.
writeIfChanged(join(outDir, 'frames.json'), Buffer.from(JSON.stringify({
  region: { x: DEMO_X, y: DEMO_Y, w: DEMO_W, h: DEMO_H },
  base: { w: demo.width, h: demo.height },
  representative: best,
  order,
}), 'utf8'));

console.log(`_kufr: base ${baseWritten ? 'written' : 'unchanged'} (${demo.width}x${demo.height})`);
console.log(`_kufr: ${wrote} frames written, ${skipped} unchanged — ${seen.size} distinct, ${order.length} decoded frames in playback order`);
console.log(`_kufr: representative frame ${best} (${(bestSize / 1024).toFixed(0)}KB) → anim.png`);
console.log(`_kufr: → public/enhanced/_kufr (frames/ is derived + gitignored)`);
