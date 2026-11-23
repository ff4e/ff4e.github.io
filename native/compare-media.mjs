// Native-vs-browser parity for the movies and the credits: what the native player shows and
// plays, against what the browser's own <video> and AiCredits show and play.
//
//   node --import tsx native/compare-media.mjs [--only frames,audio,credits] [--self-test] [--keep]
//
// Needs native/build/game.js and the host binary (see native/README.md).
//
// FRAMES. At fixed times in each AI movie (mid-frame, so neither side is on a boundary), the
// frame Chromium's <video> shows after a seek (native/js/mediaReference.ts, drawn 1:1 onto a
// canvas) against the frame the native player shows at that time, decoding forward from the
// start as playback does (`--movie-frames`). Two H.264 decoders and YUV conversions are never
// byte-identical, so it is a tolerance, chosen to separate "the same frame" from "the frame
// next to it": each frame is cut into 32×32 blocks and the worst block's mean |Δ| must be at
// most LIMIT.block, and the whole frame's at most LIMIT.mad (a colour-matrix or range error
// shifts every pixel). Measured on an M-series Mac: the same frame at most 2.7 (block) and
// 0.38 (frame) with Chromium on Metal, as launched here (4.7 and 0.76 on its default GL); the
// frame before or after, at the points below, at least 20.4. The points were
// picked where the picture moves: in a held shot two frames are the same picture, and no
// gate can tell them apart (nor does it matter which is shown).
//
// AUDIO. The movie's sound as the native player plays it (`moviePlay` through the movie track,
// on the headless clock) against Chromium's decode of the same file. In several 2-second
// windows across the movie the best alignment within ±100 ms must be lag 0 — not a sample
// off — with a correlation of at least LIMIT.corr; and the track's decoded length within a
// millisecond of the browser's. Measured: lag 0 everywhere, correlation 1.0000 to four places.
// The priming (1024 samples, 46 ms) kept, or the sound started a frame late, is a lag.
//
// CREDITS. The roll at fixed times after it opened: the browser's REAL AiCredits (two DOM
// layers and a CSS transform, screenshotted — what the compositor makes of them) against
// `paintCredits` on the native GPU surface, at the art's own 2560×1920. The compositor
// samples the strip bilinearly at its fractional offset as the native quad does, so they
// agree to within rounding: measured max Δ 6, worst block 0.38. LIMIT.credits is set above
// that and well below what one native pixel of offset makes.
//
// `--self-test` also checks that the gate fails on wrong native output: the frame before and
// the frame after, red and blue swapped; the sound shifted by the AAC priming either way and
// by a millisecond; the roll a native pixel (25 ms) late, the strip unflipped, the
// static frame missing, the wrong backdrop. CI runs it.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/render/png.ts';
import { CREDIT_SPEED, CREDIT_TICK_MS } from '../src/render/credits.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const PARTS = ['frames', 'audio', 'credits'];
const only = opt('--only', '').split(',').filter(Boolean);
if (only.some((p) => !PARTS.includes(p)) || (args.includes('--only') && !only.length)) {
  console.error(`--only takes ${PARTS.join(', ')}`);
  process.exit(2);
}
const want = (p) => !only.length || only.includes(p);
const selfTest = args.includes('--self-test');
const OUT = opt('--out', join(here, 'build', 'compare-media'));
const HOST = join(here, 'build', 'cmake', 'ff4e-native');
const BUNDLE = join(here, 'build', 'game.js');
const RUN_TIMEOUT_MS = 120_000;
mkdirSync(OUT, { recursive: true });

const LIMIT = {
  block: 8, // worst 32×32 block mean |Δ| of a movie frame
  mad: 1.5, // whole-frame mean |Δ| of a movie frame
  corr: 0.999, // sound correlation at lag 0
  lagSearch: 2205, // ±100 ms
  lengthFrames: 22, // decoded length within 1 ms
  credits: { max: 10, block: 0.8 },
};

/** The movies, their exact frame rates, and the frames compared (indices; see the header). */
const MOVIES = [
  { url: '/data/Movie/logo_ai.mp4', fps: 4000000 / 66667, frames: [200, 450, 700, 1100, 1300], windows: [3, 11, 18, 26] },
  { url: '/data/Movie/intro_ai.mp4', fps: 2000000 / 33333, frames: [1200, 1800, 2400, 3000, 3600, 4300], windows: [2, 15, 30, 45, 60, 70] },
];
/** Credits: ms after the roll opened — the start, mid-strip at fractional offsets, its end, and settled. */
const CREDIT_TIMES = [0, 3085, 25006.25, 42515, 82137.5, 87500, 95000];

const native = (argv) => execFileSync(HOST, [BUNDLE, '--root', join(repo, 'public'), '--headless', ...argv],
  { stdio: 'pipe', timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' });

function readRgba(file) {
  const b = readFileSync(file);
  rmSync(file);
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  if (b.length !== 8 + w * h * 4) throw new Error(`${file}: short native frame`);
  return { w, h, px: b.subarray(8) };
}

/** Whole-frame mean |Δ|, worst 32×32 block mean |Δ|, max per-channel Δ (RGB). */
function measure(a, b, w, h) {
  const B = 32, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const blk = new Float64Array(bw * bh), cnt = new Float64Array(bw * bh);
  let sum = 0, max = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      let s = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[p + c] - b[p + c]);
        s += d;
        if (d > max) max = d;
      }
      sum += s;
      const k = ((y / B) | 0) * bw + ((x / B) | 0);
      blk[k] += s;
      cnt[k] += 3;
    }
  }
  let block = 0;
  for (let k = 0; k < blk.length; k++) block = Math.max(block, blk[k] / cnt[k]);
  return { mad: sum / (w * h * 3), block, max };
}

const swapRB = (px) => {
  const o = Buffer.from(px);
  for (let i = 0; i < o.length; i += 4) { const r = o[i]; o[i] = o[i + 2]; o[i + 2] = r; }
  return o;
};

const server = await createServer({ root: repo, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
const ctx = await browser.newContext({ viewport: { width: 2560, height: 1920 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${server.resolvedUrls.local[0]}native/media-reference.html`);
await page.waitForFunction(() => window.__mediaReady === true, null, { timeout: 60000 });

const bad = [];
let checks = 0;
const caught = [];
const missed = [];
/** A self-test mutation: the gate must reject it. */
const mutation = (name, rejected) => {
  (rejected ? caught : missed).push(name);
  if (!rejected) console.log(`  MISSED  ${name}: the gate passed a wrong output`);
  else if (args.includes('--verbose')) console.log(`  caught  ${name}`);
};

if (want('frames')) {
  for (const m of MOVIES) {
    const times = m.frames.map((k) => (k + 0.5) / m.fps);
    const ref = await page.evaluate(([u, t]) => window.__refMovieFrames(u, t), [m.url, times]);
    // Each point, then (self-test) the frames either side of it, in time order for the forward decode.
    const at = m.frames.flatMap((k) => (selfTest ? [k - 1, k, k + 1] : [k])).map((k) => (k + 0.5) / m.fps);
    native(['--movie-frames', m.url, '--at', at.join(','), '--out', join(OUT, 'm')]);
    const nat = at.map((_, i) => readRgba(join(OUT, `m-${i}.rgba`)));
    m.frames.forEach((k, i) => {
      const r = ref.frames[i];
      const rpx = Buffer.from(r.b64, 'base64');
      const n = nat[selfTest ? 3 * i + 1 : i];
      const name = `${m.url.split('/').pop()} frame ${k} (${times[i].toFixed(3)} s)`;
      checks++;
      if (n.w !== r.w || n.h !== r.h) {
        console.log(`${name}: SIZE native ${n.w}x${n.h} vs browser ${r.w}x${r.h}`);
        bad.push(name);
        return;
      }
      const d = measure(n.px, rpx, r.w, r.h);
      const ok = d.block <= LIMIT.block && d.mad <= LIMIT.mad;
      if (!ok) bad.push(name);
      console.log(`${name.padEnd(36)} block ${d.block.toFixed(2).padStart(6)}  mean ${d.mad.toFixed(3)}  max ${String(d.max).padStart(3)}  ${ok ? 'ok' : 'FAIL'}`);
      if (!ok || args.includes('--keep')) {
        const base = join(OUT, `${m.url.split('/').pop()}-${k}`);
        writeFileSync(`${base}-native.png`, encodePng(new Uint8Array(n.px), r.w, r.h));
        writeFileSync(`${base}-browser.png`, encodePng(new Uint8Array(rpx), r.w, r.h));
      }
      if (selfTest) {
        for (const [what, px] of [['the frame before', nat[3 * i].px], ['the frame after', nat[3 * i + 2].px], ['red and blue swapped', swapRB(n.px)]]) {
          const e = measure(px, rpx, r.w, r.h);
          mutation(`${name}: ${what} (block ${e.block.toFixed(1)}, mean ${e.mad.toFixed(2)})`, e.block > LIMIT.block || e.mad > LIMIT.mad);
        }
      }
    });
  }
}

/** Best lag of `a` against `b` (mono, float) in a window, and the correlation at it and at 0. */
function align(a, b, start, len, search) {
  const corrAt = (lag) => {
    let s = 0, ea = 0, eb = 0;
    for (let i = start; i < start + len; i++) {
      const x = a[i + lag] ?? 0, y = b[i];
      s += x * y; ea += x * x; eb += y * y;
    }
    return ea > 0 && eb > 0 ? s / Math.sqrt(ea * eb) : 0;
  };
  let best = -2, lag = 0;
  for (let l = -search; l <= search; l++) {
    const c = corrAt(l);
    if (c > best) { best = c; lag = l; }
  }
  return { lag, corr: best, corr0: corrAt(0) };
}

const mono = (x, ch) => {
  const n = Math.floor(x.length / ch), o = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += x[i * ch + c]; o[i] = s / ch; }
  return o;
};

if (want('audio')) {
  for (const m of MOVIES) {
    const r = await page.evaluate((u) => window.__refMovieAudio(u), m.url);
    const refPcm = new Float32Array(Buffer.from(r.b64, 'base64').buffer.slice(0));
    const file = join(OUT, 'audio.f32');
    native(['--movie-audio', m.url, '--out', file]);
    const b = readFileSync(file);
    rmSync(file);
    const ch = b.readUInt32LE(0), rate = b.readUInt32LE(4), len = b.readUInt32LE(8);
    const natPcm = new Float32Array(b.buffer.slice(b.byteOffset + 12, b.byteOffset + b.length));
    const name = m.url.split('/').pop();
    const refN = refPcm.length / r.channels;
    checks++;
    const fmtOk = ch === r.channels && rate === r.rate && Math.abs(len - refN) <= LIMIT.lengthFrames;
    console.log(`${name.padEnd(16)} sound: ${ch} ch at ${rate} Hz, ${len} frames (browser ${r.channels} ch at ${r.rate} Hz, ${refN}) ${fmtOk ? 'ok' : 'FAIL'}`);
    if (!fmtOk) bad.push(`${name} sound format`);
    const A = mono(natPcm, ch), B = mono(refPcm, r.channels);
    const win = (s, shift = 0) => align(shift ? A.map((_, i) => A[i - shift] ?? 0) : A, B, Math.round(s * rate), 2 * rate, LIMIT.lagSearch);
    for (const s of m.windows) {
      checks++;
      const a = win(s);
      const ok = a.lag === 0 && a.corr0 >= LIMIT.corr;
      if (!ok) bad.push(`${name} sound at ${s} s`);
      console.log(`${name.padEnd(16)} sound at ${String(s).padStart(2)} s: best lag ${a.lag} samples, correlation ${a.corr0.toFixed(5)}  ${ok ? 'ok' : 'FAIL'}`);
    }
    if (selfTest) {
      const s = m.windows[1];
      for (const shift of [1024, -1024, 22]) {
        const a = win(s, shift);
        mutation(`${name} sound shifted ${shift} samples (lag ${a.lag}, corr at 0 ${a.corr0.toFixed(3)})`, !(a.lag === 0 && a.corr0 >= LIMIT.corr));
      }
    }
  }
}

if (want('credits')) {
  const ref = [];
  for (const ms of CREDIT_TIMES) {
    const posun = (ms / CREDIT_TICK_MS) * CREDIT_SPEED; // drawCredits' continuous ramp
    const r = await page.evaluate((p) => window.__refCredits(p), posun);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: r.w, height: r.h } });
    const px = await page.evaluate((x) => window.__decodePng(x), shot.toString('base64'));
    ref.push({ posun, w: px.w, h: px.h, px: Buffer.from(px.b64, 'base64') });
  }
  const run = (mutate) => {
    native(['--credits-scene', CREDIT_TIMES.join(','), '--out', join(OUT, 'c'), ...(mutate ? ['--mutate', mutate] : [])]);
    return CREDIT_TIMES.map((_, i) => readRgba(join(OUT, `c-${i}.rgba`)));
  };
  const okOf = (d) => d.max <= LIMIT.credits.max && d.block <= LIMIT.credits.block;
  const nat = run();
  CREDIT_TIMES.forEach((ms, i) => {
    const r = ref[i], n = nat[i];
    const name = `credits at ${(ms / 1000).toFixed(3)} s (offset ${r.posun.toFixed(2)})`;
    checks++;
    if (n.w !== r.w || n.h !== r.h) {
      console.log(`${name}: SIZE native ${n.w}x${n.h} vs browser ${r.w}x${r.h}`);
      bad.push(name);
      return;
    }
    const d = measure(n.px, r.px, r.w, r.h);
    const ok = okOf(d);
    if (!ok) bad.push(name);
    console.log(`${name.padEnd(36)} block ${d.block.toFixed(2).padStart(6)}  mean ${d.mad.toFixed(3)}  max ${String(d.max).padStart(3)}  ${ok ? 'ok' : 'FAIL'}`);
    if (!ok || args.includes('--keep')) {
      writeFileSync(join(OUT, `credits-${i}-native.png`), encodePng(new Uint8Array(n.px), r.w, r.h));
      writeFileSync(join(OUT, `credits-${i}-browser.png`), encodePng(new Uint8Array(r.px), r.w, r.h));
    }
  });
  if (selfTest) {
    for (const mutate of ['late', 'unflipped', 'nostat', 'bg']) {
      const wrong = run(mutate);
      // Every time must be rejected where the mutation changes the picture at all: before the
      // strip reaches the window, or once the roll has settled (the offset is clamped), a late
      // or unflipped strip draws the same frame, and there is nothing to catch.
      CREDIT_TIMES.forEach((ms, i) => {
        if (wrong[i].px.equals(nat[i].px)) return;
        const d = measure(wrong[i].px, ref[i].px, ref[i].w, ref[i].h);
        mutation(`credits at ${(ms / 1000).toFixed(3)} s, ${mutate} (max ${d.max}, block ${d.block.toFixed(2)})`, !okOf(d));
      });
    }
  }
}

await browser.close();
await server.close();
console.log(`media: ${checks - bad.length}/${checks} within tolerance` +
  (selfTest ? `; self-test: ${caught.length}/${caught.length + missed.length} wrong outputs rejected` : ''));
if (bad.length) console.log(`FAILED: ${bad.join(', ')}`);
process.exitCode = bad.length || missed.length ? 1 : 0;
