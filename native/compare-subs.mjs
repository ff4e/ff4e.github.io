// Native-vs-browser parity for the subtitles: draws each case of native/js/subtitleScene.ts
// with the browser's real DOM renderer (src/app/subtitleDom.ts, in Chromium, via
// native/subs-reference.html — screenshotted) and with the native one (FreeType glyphs
// through the GPU Surface2D), and compares the two.
//
//   node --import tsx native/compare-subs.mjs [--cases two-speakers,wave] [--out dir] [--keep]
//   node --import tsx native/compare-subs.mjs --self-test     # the gate must catch these
//
// Needs native/build/game.js and the host binary (see native/README.md).
//
// Text is never byte-identical between two rasterisers, so this is a TOLERANCE gate, and
// the tolerance is chosen to fail on what matters — the wrong text, the wrong place, the
// wrong colour — while passing two scalers drawing the same outline. Both are drawn over a
// mid grey, so the dark outline counts too. Per case:
//
//   - LINES: the ink (anything INK from the background) split into horizontal bands where a
//     pixel row has none — a line of text, or lines close enough to touch. The same number
//     of bands, and each band's ink box within LIMIT.box CSS px of the browser's on every
//     edge: the text's extent, so its centring, baseline and size, and how many glyphs a
//     row shows mid-wave.
//   - SHAPE: both frames blurred by a CSS pixel (which absorbs a glyph edge falling on the
//     next device pixel), their difference averaged over a glyph-sized window, and the worst
//     window taken. Two scalers spread their disagreement thinly along every edge; a
//     different letter, a missing outline or a glyph in the wrong place concentrates it.
//   - COLOUR: per band, the mean colour of the fill (what is brighter than the background)
//     within LIMIT.colour per channel.
//
// `--self-test` also renders wrong native frames — one letter changed, the text two device
// pixels low, the speaker's colour channels swapped, the text 6% larger, no outline, the wave
// a tick late — and fails unless the gate rejects every one. CI runs it.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/render/png.ts';
import { SUB_CASES } from './js/subtitleScene.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const only = opt('--cases', '').split(',').filter(Boolean);
const unknown = only.filter((n) => !SUB_CASES.some((c) => c.name === n));
if (unknown.length || (args.includes('--cases') && !only.length)) {
  console.error(`no such subtitle case(s): ${unknown.join(', ') || '(none given)'}; the cases are ${SUB_CASES.map((c) => c.name).join(', ')}`);
  process.exit(2);
}
const CASES = only.length ? SUB_CASES.filter((c) => only.includes(c.name)) : SUB_CASES;
const RUN_TIMEOUT_MS = 60_000;
/**
 * What both are drawn over: a mid grey, not the room. Over black the outline (rgb(5,5,12))
 * would be invisible, and a wrong outline would pass.
 */
const BG = 144;
const OUT = opt('--out', join(here, 'build', 'compare-subs'));
const HOST = join(here, 'build', 'cmake', 'ff4e-native');
const BUNDLE = join(here, 'build', 'game.js');
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root: repo, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const pages = new Map();
async function pageFor(density) {
  if (pages.has(density)) return pages.get(density);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: density });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`${server.resolvedUrls.local[0]}native/subs-reference.html`);
  await page.evaluate((g) => { document.documentElement.style.background = `rgb(${g},${g},${g})`; }, BG);
  await page.waitForFunction(() => typeof window.__refSubs === 'function', null, { timeout: 60000 });
  pages.set(density, page);
  return page;
}

async function reference(c) {
  const page = await pageFor(c.density);
  const r = await page.evaluate((n) => window.__refSubs(n), c.name);
  const shot = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  const px = await page.evaluate((b64) => window.__decodePng(b64), shot.toString('base64'));
  if (px.w !== r.devW || px.h !== r.devH) throw new Error(`${c.name}: screenshot ${px.w}x${px.h}, expected ${r.devW}x${r.devH}`);
  return { w: px.w, h: px.h, px: new Uint8Array(Buffer.from(px.b64, 'base64')) };
}

function native(c, mutate) {
  const raw = join(OUT, `${c.name}.rgba`);
  rmSync(raw, { force: true });
  execFileSync(HOST, [BUNDLE, '--root', join(repo, 'public'), '--headless', '--subs-scene', c.name, '--out', raw, ...(mutate ? ['--mutate', mutate] : [])],
    { stdio: 'pipe', timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' });
  const b = readFileSync(raw);
  rmSync(raw);
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  if (b.length !== 8 + w * h * 4) throw new Error(`${c.name}: short native frame`);
  // Premultiplied, over the same grey as the page.
  const px = new Uint8Array(b.subarray(8));
  for (let i = 0; i < px.length; i += 4) {
    const k = 255 - px[i + 3];
    for (let j = 0; j < 3; j++) px[i + j] = Math.min(255, px[i + j] + Math.round((BG * k) / 255));
    px[i + 3] = 255;
  }
  return { w, h, px };
}

/** Ink: anything more than INK from the background in some channel. */
const INK = 48;

function inkOf(img) {
  const { w, h, px } = img;
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const d = Math.max(Math.abs(px[p * 4] - BG), Math.abs(px[p * 4 + 1] - BG), Math.abs(px[p * 4 + 2] - BG));
    ink[p] = d > INK ? 1 : 0;
  }
  return ink;
}

/** Rows of text: runs of rows with ink, split where a row has none. Each with its ink box. */
function bands(img, ink) {
  const { w, h } = img;
  const out = [];
  let cur = null;
  for (let y = 0; y < h; y++) {
    let x0 = w, x1 = -1;
    for (let x = 0; x < w; x++) if (ink[y * w + x]) { if (x < x0) x0 = x; x1 = x; }
    if (x1 < 0) { cur = null; continue; }
    if (!cur) out.push((cur = { y0: y, y1: y, x0, x1 }));
    cur.y1 = y;
    cur.x0 = Math.min(cur.x0, x0);
    cur.x1 = Math.max(cur.x1, x1);
  }
  return out;
}

/** A box blur of radius `r` of one float plane (two passes of a running sum, zero outside). */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) acc += src[y * w + x + r];
      if (x - r - 1 >= 0) acc -= src[y * w + x - r - 1];
      if (x >= 0 && x < w) tmp[y * w + x] = acc / n;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) acc += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * w + x];
      if (y >= 0 && y < h) out[y * w + x] = acc / n;
    }
  }
  return out;
}

/** Each colour channel as a float plane, blurred by `r`. */
const planes = (img, r) => [0, 1, 2].map((c) => {
  const a = new Float32Array(img.w * img.h);
  for (let i = 0; i < a.length; i++) a[i] = img.px[i * 4 + c];
  return boxBlur(a, img.w, img.h, r);
});

/** The fill's mean colour in a band: the pixels brighter than the background in any channel. */
function fillColour(img, b) {
  const { w, px } = img;
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const p = (y * w + x) * 4;
    if (Math.max(px[p], px[p + 1], px[p + 2]) < BG + INK) continue;
    for (let c = 0; c < 3; c++) sum[c] += px[p + c];
    n++;
  }
  return n ? sum.map((v) => v / n) : [BG, BG, BG];
}

/** Every measure the gate reads, for one pair. Distances in device pixels. */
function measure(ref, nat, density) {
  const ri = inkOf(ref), ni = inkOf(nat);
  const rb = bands(ref, ri), nb = bands(nat, ni);
  let box = 0, colour = 0;
  if (rb.length === nb.length) {
    rb.forEach((a, i) => {
      const b = nb[i];
      box = Math.max(box, Math.abs(a.x0 - b.x0), Math.abs(a.x1 - b.x1), Math.abs(a.y0 - b.y0), Math.abs(a.y1 - b.y1));
      const ca = fillColour(ref, a), cb = fillColour(nat, b);
      colour = Math.max(colour, ...ca.map((v, c) => Math.abs(v - cb[c])));
    });
  }
  // SHAPE: the blurred difference, averaged over a glyph-sized window, at its worst.
  const ra = planes(ref, density), na = planes(nat, density);
  const d = new Float32Array(ref.w * ref.h);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(Math.abs(ra[0][i] - na[0][i]), Math.abs(ra[1][i] - na[1][i]), Math.abs(ra[2][i] - na[2][i]));
  let local = 0;
  for (const v of boxBlur(d, ref.w, ref.h, WINDOW_PX * density)) if (v > local) local = v;
  return { bands: `${nb.length}/${rb.length}`, sameBands: rb.length === nb.length && rb.length > 0, box: box / density, colour, local };
}

/**
 * The tolerance, measured (native/README.md has the table): BOX in CSS px — a glyph edge
 * landing on the neighbouring device pixel; LOCAL the worst window's mean blurred difference
 * (0–255), over 2·WINDOW_PX+1 CSS px, about a glyph's stem-and-counter; COLOUR the fill's
 * mean, per channel. Measured worst on correct frames: box 1, local 29.6 (retina), colour
 * 5.2. Measured least among the self-test's wrong frames: local 47.1 (one letter changed),
 * colour 35.3 (channels swapped), box 2 (moved two pixels; also local 57.2).
 */
const WINDOW_PX = 3;
const LIMIT = { box: 1.5, local: 38, colour: 10 };
const passes = (m) => m.sameBands && m.box <= LIMIT.box && m.local <= LIMIT.local && m.colour <= LIMIT.colour;
const fmt = (m) => `lines ${m.bands}  box ±${m.box.toFixed(2)}  local Δ ${m.local.toFixed(1).padStart(5)}  colour Δ ${m.colour.toFixed(1).padStart(4)}`;

/** The self-test's wrong frames; `late` (the clock a tick behind) only where something moves. */
const mutationsFor = (c) => ['letter', 'shift', 'colour', 'size', 'outline', ...(c.waving ? ['late'] : [])];
const selfTest = args.includes('--self-test');

const bad = [];
for (const c of CASES) {
  let ref, nat;
  try {
    ref = await reference(c);
    nat = native(c);
  } catch (e) {
    const out = String(e.stdout ?? '') + String(e.stderr ?? '') + String(e.message ?? '');
    console.log(`${c.name.padEnd(13)} FAILED: ${out.trim().split('\n').slice(-3).join(' | ')}`);
    bad.push(c.name);
    continue;
  }
  if (nat.w !== ref.w || nat.h !== ref.h) {
    console.log(`${c.name.padEnd(13)} SIZE: native ${nat.w}x${nat.h} vs browser ${ref.w}x${ref.h}`);
    bad.push(c.name);
    continue;
  }
  const m = measure(ref, nat, c.density);
  const ok = passes(m);
  if (!ok) bad.push(c.name);
  if (!ok || args.includes('--keep')) {
    writeFileSync(join(OUT, `${c.name}-native.png`), encodePng(nat.px, nat.w, nat.h));
    writeFileSync(join(OUT, `${c.name}-browser.png`), encodePng(ref.px, ref.w, ref.h));
  }
  console.log(`${c.name.padEnd(13)} ${fmt(m)}  ${ok ? 'ok' : 'FAIL'}  — ${c.what}`);
  if (!selfTest) continue;
  for (const k of mutationsFor(c)) {
    const mut = native(c, k);
    if (args.includes('--keep')) writeFileSync(join(OUT, `${c.name}+${k}-native.png`), encodePng(mut.px, mut.w, mut.h));
    const mm = measure(ref, mut, c.density);
    const caught = !passes(mm);
    if (!caught) bad.push(`${c.name}+${k}`);
    console.log(`  ${('+' + k).padEnd(11)} ${fmt(mm)}  ${caught ? 'caught' : 'MISSED'}`);
  }
}
await browser.close();
await server.close();
const total = CASES.reduce((n, c) => n + mutationsFor(c).length, 0);
console.log(`subtitles: ${CASES.length - CASES.filter((c) => bad.includes(c.name)).length}/${CASES.length} cases within tolerance` +
  (selfTest ? `, ${total - bad.filter((b) => b.includes('+')).length}/${total} wrong frames caught` : ''));
if (bad.length) console.log(`FAILED: ${bad.join(', ')}`);
process.exitCode = bad.length ? 1 : 0;
