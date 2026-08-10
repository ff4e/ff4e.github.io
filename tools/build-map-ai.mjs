/**
 * Build the AI-UPSCALED world-map art for the `ai` graphics level (Phase B).
 *
 * The `ai` graphics tier is purely additive: the world map uses these upscaled
 * layers when present and otherwise falls back to the faithful native composite
 * (see the AI map renderer in src/render/worldMapAi.ts + drawMap in
 * src/app/main.ts). The two lower tiers (classic, enhanced) are byte-for-byte
 * untouched.
 *
 * The world map is NOT a single picture — it is a runtime palette-indexed
 * composite: `dest = mask ? mapa-1 : mapa-0`, with room-node sprites (n0..n4)
 * blitted on top and the record panel (krokoměr) over that (UMain.pas
 * PaintBox1Paint). So we can't upscale one frame; we upscale the *component art*
 * and re-composite at high resolution at runtime with the identical logic.
 *
 * What gets AI-upscaled here (smooth painted art — safe for super-resolution):
 *   mapa-0.BMP  -> mapa-0_ai.webp  (dark base layer, 640x480 -> 2560x1920, opaque)
 *   mapa-1.BMP  -> mapa-1_ai.webp  (lit  base layer,                        opaque)
 *   n0..n4.BMP  -> n0_ai.png..n4_ai.png   (room-ball sprites, 19x20 -> 76x80, RGBA)
 *   krokomer.BMP-> krokomer_ai.webp  (record-panel background frame + baked icons)
 *   ikonky.BMP  -> ikonky_ai.webp    (record-panel highlighted button icons)
 *   loading.BMP -> loading_ai.webp   (room-entry parchment, 192x161 -> 768x644, opaque)
 *
 * The base layers + panel art are full-frame opaque, delivered as lossy WebP (~0.5 MB
 * vs ~10 MB PNG for a base layer) — visually lossless for this smooth painted art.
 * The node sprites are tiny, delivered as lossless RGBA PNG with a smooth AI-matted
 * alpha: the native colour-key (Vykul: top-left pixel) is dilated into the sprite edge
 * BEFORE the colour upscale (so the AI never blends ball↔key → no magenta fringe), and
 * the alpha comes from a SECOND AI pass on a white-on-black silhouette of the ball —
 * so the edge is anti-aliased to match the AI ball's rounded shape, not a blocky
 * nearest-neighbour magnification of the 19-px native key mask.
 *
 * What is deliberately NOT AI-upscaled (index data / legible text — would smear),
 * handled crisply at runtime by the renderer instead:
 *   maska.BMP   — per-pixel branch/corner index selector (nearest-neighboured x4,
 *                 so the lit/dark + corner-button logic stays index-exact).
 *   cisla/desky — record-panel odometer digits + level name plaques (baked text);
 *                 rendered via a nearest-neighbour-scaled overlay so numerals and
 *                 names stay sharp.
 *
 * External tools (NOT in the repo, like build-movies-ai.mjs):
 *   Real-ESRGAN:  https://github.com/xinntao/Real-ESRGAN/releases
 *     export REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan   # dir must hold ./models
 *   ffmpeg (raw<->png), cwebp (libwebp, for the .webp layers).
 * The committed *_ai.* are the outputs, so a normal site build needs none of these.
 *
 * Usage: `node tools/build-map-ai.mjs [name ...]`   (default: all of the above)
 *   AI_MODEL=realesr-animevideov3-x4   (override the model; default per SCALE)
 *   AI_SCALE=4                         (upscale factor: 2|3|4; default 4)
 *   WEBP_Q=92                          (lossy WebP quality for the base layers)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBmp, indicesToRgb24, bleedKey, smoothstep } from './lib/mapsrc.mjs';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const menuDir = join(dirname(toolsDir), 'public', 'data', 'Menu');

const SCALE = Number(process.env.AI_SCALE || 4);
// An explicit AI_MODEL always wins (the "regenerate everything with model X" workflow);
// otherwise each asset uses its tuned default below, falling back to animevideov3.
const MODEL_OVERRIDE = process.env.AI_MODEL || null;
const DEFAULT_MODEL = `realesr-animevideov3-x${SCALE}`;
const WEBP_Q = String(process.env.WEBP_Q || 92);

// Per-asset model choice (see modelFor(): AI_MODEL env overrides this, else this, else
// DEFAULT_MODEL). The map BASE LAYERS use the general realesrgan-x4plus model — it keeps
// more of the hand-painted surface texture and gives a crisper result on the big
// background art. The room-ball sprites and the record-panel art keep the gentler
// realesr-animevideov3 (smooth, faithful, no over-sharpen halos on the small glossy
// balls / panel). Override all of them at once with AI_MODEL=<name>.
const X4PLUS = 'realesrgan-x4plus';

// kind 'layer' = opaque full-frame art -> lossy WebP.
// kind 'sprite' = tiny colour-keyed sprite -> baked-alpha RGBA PNG.
// kind 'inset' = an opaque rectangle the game blits ONTO the map -> lossy WebP,
//   upscaled IN PLACE on the map (see buildInset).
const ASSETS = {
  'mapa-0': { src: 'mapa-0.BMP', out: 'mapa-0_ai.webp', kind: 'layer', model: X4PLUS },
  'mapa-1': { src: 'mapa-1.BMP', out: 'mapa-1_ai.webp', kind: 'layer', model: X4PLUS },
  n0: { src: 'n0.BMP', out: 'n0_ai.png', kind: 'sprite' },
  n1: { src: 'n1.BMP', out: 'n1_ai.png', kind: 'sprite' },
  n2: { src: 'n2.BMP', out: 'n2_ai.png', kind: 'sprite' },
  n3: { src: 'n3.BMP', out: 'n3_ai.png', kind: 'sprite' },
  n4: { src: 'n4.BMP', out: 'n4_ai.png', kind: 'sprite' },
  krokomer: { src: 'krokomer.BMP', out: 'krokomer_ai.webp', kind: 'layer' },
  ikonky: { src: 'ikonky.BMP', out: 'ikonky_ai.webp', kind: 'layer' },
  // The room-entry parchment (UMain.pas:1489). Blitted at (227,160) over the map with
  // its RTable zeroed, i.e. over the DARK layer — which is baked into its own border
  // (mean per-pixel border difference 0.97 vs mapa-0, 21.26 vs mapa-1). Hence 'inset':
  // upscaling the 192x161 crop on its own would hand the model a different neighbourhood
  // than mapa-0_ai got for the same pixels, and the border would no longer line up with
  // the map it sits on.
  loading: { src: 'loading.BMP', out: 'loading_ai.webp', kind: 'inset', model: X4PLUS, over: 'mapa-0.BMP', x: 227, y: 160 },
};
const DEFAULT_NAMES = ['mapa-0', 'mapa-1', 'n0', 'n1', 'n2', 'n3', 'n4', 'krokomer', 'ikonky', 'loading'];

/** Resolve the model for an asset: explicit AI_MODEL override > per-asset default > global default. */
function modelFor(name) {
  return MODEL_OVERRIDE || ASSETS[name].model || DEFAULT_MODEL;
}

function run(label, cmd, args, opts = {}) {
  console.log(`${label} ...`);
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  if (r.status !== 0) {
    console.error(`FAILED ${label} (${cmd} exit ${r.status})`);
    process.exit(1);
  }
}

function requireBin(env, hint) {
  const p = process.env[env];
  if (!p || !existsSync(p)) {
    console.error(`${env} not set or not found. ${hint}`);
    process.exit(1);
  }
  return p;
}

/** Real-ESRGAN a single PNG file -> PNG file (x SCALE) with `model` (default DEFAULT_MODEL). */
function upscaleFile(inPng, outPng, model = DEFAULT_MODEL) {
  const binp = requireBin(
    'REALESRGAN_NCNN',
    'Set it to the realesrgan-ncnn-vulkan executable (its folder must contain ./models). ' +
    'Download: https://github.com/xinntao/Real-ESRGAN/releases',
  );
  const binDir = dirname(binp);
  run(`AI-upscaling (${model}, x${SCALE})`, binp,
    ['-i', inPng, '-o', outPng, '-n', model, '-s', String(SCALE), '-f', 'png', '-m', join(binDir, 'models')],
    { cwd: binDir });
}

/** Read a PNG back into a flat RGB24 buffer via ffmpeg. */
function pngToRgb24(png, w, h, work) {
  const raw = join(work, 'back.rgb');
  run('Decoding upscaled PNG', 'ffmpeg',
    ['-y', '-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const buf = readFileSync(raw);
  if (buf.length !== w * h * 3) throw new Error(`decoded ${buf.length} bytes, expected ${w * h * 3}`);
  return buf;
}

function buildLayer(name, bmp) {
  const { out: outName } = ASSETS[name];
  const model = modelFor(name);
  const dst = join(menuDir, outName);
  const work = mkdtempSync(join(tmpdir(), `mapai-${name}-`));
  try {
    const rawPath = join(work, 'in.rgb');
    const inPng = join(work, 'in.png');
    const aiPng = join(work, 'ai.png');
    writeFileSync(rawPath, indicesToRgb24(bmp.pixels, bmp.palette, bmp.w, bmp.h));
    run(`Encoding ${name} (${bmp.w}x${bmp.h}) -> PNG`, 'ffmpeg',
      ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
        '-video_size', `${bmp.w}x${bmp.h}`, '-i', rawPath, inPng]);
    upscaleFile(inPng, aiPng, model);
    run(`Encoding ${outName} (WebP q${WEBP_Q})`, 'cwebp',
      ['-quiet', '-q', WEBP_Q, aiPng, '-o', dst]);
    console.log(`  wrote ${outName} (${bmp.w * SCALE}x${bmp.h * SCALE}, ${(statSync(dst).size / 1e3).toFixed(0)} KB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Encode a native index buffer to a same-size PNG (palette applied) in `work`.
 */
function indicesToPng(pixels, palette, w, h, work, tag) {
  const raw = join(work, `${tag}.rgb`);
  const png = join(work, `${tag}.png`);
  writeFileSync(raw, indicesToRgb24(pixels, palette, w, h));
  run(`Encoding ${tag} (${w}x${h}) -> PNG`, 'ffmpeg',
    ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
      '-video_size', `${w}x${h}`, '-i', raw, png]);
  return png;
}

/** Smoothstep (Hermite) — a soft 0→1 ramp between edges `a` and `b` (from lib/mapsrc.mjs). */

function buildSprite(name, bmp) {
  const { out: outName } = ASSETS[name];
  const dst = join(menuDir, outName);
  const { w, h } = bmp;
  const key = bmp.pixels[0]; // Vykul: top-left pixel is the transparent colour
  const work = mkdtempSync(join(tmpdir(), `mapai-${name}-`));
  try {
    // 1. COLOUR pass: dilate the key so the upscaler sees no ball↔key boundary
    //    (no coloured fringe once matted), then AI-upscale the bled art.
    const bled = bleedKey(bmp.pixels, w, h, key, Math.max(2, Math.ceil(6 / SCALE)));
    const inPng = indicesToPng(bled, bmp.palette, w, h, work, 'colour');
    const aiPng = join(work, 'colour_ai.png');
    upscaleFile(inPng, aiPng, modelFor(name));

    const ow = w * SCALE;
    const oh = h * SCALE;
    const rgb = pngToRgb24(aiPng, ow, oh, work);

    // 2. MATTE pass: AI-upscale a white-on-black silhouette of the ball. The AI
    //    anti-aliases the blob edge exactly as it rounds the colour ball, so the
    //    alpha follows the smooth AI silhouette instead of a blocky nearest-
    //    neighbour magnification of the 19-px native key mask (which left a hard
    //    4-px staircase). Its luminance is the coverage/alpha.
    const sil = new Uint8Array(w * h);
    const silPal = new Array(256).fill({ r: 0, g: 0, b: 0 });
    silPal[1] = { r: 255, g: 255, b: 255 };
    for (let i = 0; i < w * h; i++) sil[i] = bmp.pixels[i] === key ? 0 : 1;
    const silPng = indicesToPng(sil, silPal, w, h, work, 'matte');
    const silAiPng = join(work, 'matte_ai.png');
    upscaleFile(silPng, silAiPng);
    const matte = pngToRgb24(silAiPng, ow, oh, work);

    // 3. Combine: AI colour + AI matte (red channel = coverage). A gentle
    //    smoothstep firms the edge so the ball is solid inside with a soft ~1-px
    //    anti-aliased rim, no wide halo.
    const rgba = Buffer.allocUnsafe(ow * oh * 4);
    for (let i = 0; i < ow * oh; i++) {
      const cov = smoothstep(0.12, 0.6, matte[i * 3] / 255);
      rgba[i * 4] = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = Math.round(cov * 255);
    }
    const rgbaRaw = join(work, 'out.rgba');
    writeFileSync(rgbaRaw, rgba);
    run(`Encoding ${outName} (RGBA PNG)`, 'ffmpeg',
      ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba',
        '-video_size', `${ow}x${oh}`, '-i', rgbaRaw, dst]);
    console.log(`  wrote ${outName} (${ow}x${oh}, ${(statSync(dst).size / 1e3).toFixed(0)} KB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Build an INSET: an opaque rectangle the game blits onto the map at (x,y).
 *
 * Upscaled IN PLACE — composited onto its native background layer first, the whole
 * 640x480 frame put through the SAME model the background layer uses, and the result
 * cropped back out at (x*SCALE, y*SCALE). Upscaling the bare 192x161 crop instead
 * would give the model a different neighbourhood for the border pixels than mapa-0_ai
 * got for those same pixels, and the rectangle would show a seam against the map it
 * is blitted onto (the parchment's border IS map background, baked in).
 *
 * Its own palette, not the background's: the two BMPs have different palettes, so the
 * composite is done in RGB, after both have been palette-resolved.
 */
function buildInset(name, bmp) {
  const { out: outName, over, x, y } = ASSETS[name];
  const model = modelFor(name);
  const dst = join(menuDir, outName);
  const bg = parseBmp(new Uint8Array(readFileSync(join(menuDir, over))));
  const work = mkdtempSync(join(tmpdir(), `mapai-${name}-`));
  try {
    const frame = indicesToRgb24(bg.pixels, bg.palette, bg.w, bg.h);
    const inset = indicesToRgb24(bmp.pixels, bmp.palette, bmp.w, bmp.h);
    for (let r = 0; r < bmp.h; r++) {
      inset.copy(frame, ((y + r) * bg.w + x) * 3, r * bmp.w * 3, (r + 1) * bmp.w * 3);
    }
    const rawPath = join(work, 'in.rgb');
    const inPng = join(work, 'in.png');
    const aiPng = join(work, 'ai.png');
    writeFileSync(rawPath, frame);
    run(`Encoding ${name} on ${over} (${bg.w}x${bg.h}) -> PNG`, 'ffmpeg',
      ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
        '-video_size', `${bg.w}x${bg.h}`, '-i', rawPath, inPng]);
    upscaleFile(inPng, aiPng, model);
    const ow = bmp.w * SCALE;
    const oh = bmp.h * SCALE;
    const cropPng = join(work, 'crop.png');
    run(`Cropping ${name} (${ow}x${oh} at ${x * SCALE},${y * SCALE})`, 'ffmpeg',
      ['-y', '-v', 'error', '-i', aiPng, '-vf', `crop=${ow}:${oh}:${x * SCALE}:${y * SCALE}`, cropPng]);
    run(`Encoding ${outName} (WebP q${WEBP_Q})`, 'cwebp', ['-quiet', '-q', WEBP_Q, cropPng, '-o', dst]);
    console.log(`  wrote ${outName} (${ow}x${oh}, ${(statSync(dst).size / 1e3).toFixed(0)} KB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function buildOne(name) {
  const { src: srcName, kind } = ASSETS[name];
  const src = join(menuDir, srcName);
  if (!existsSync(src)) {
    console.error(`SKIP ${name}: source not found at ${src}`);
    return;
  }
  const bmp = parseBmp(new Uint8Array(readFileSync(src)));
  if (kind === 'layer') buildLayer(name, bmp);
  else if (kind === 'inset') buildInset(name, bmp);
  else buildSprite(name, bmp);
}

const which = process.argv.slice(2);
const names = which.length ? which : DEFAULT_NAMES;
for (const n of names) {
  if (!ASSETS[n]) {
    console.error(`unknown asset "${n}" (expected: ${Object.keys(ASSETS).join(', ')})`);
    process.exit(1);
  }
}
if (names.some((n) => ASSETS[n].kind === 'layer' || ASSETS[n].kind === 'inset')) {
  const cwebp = spawnSync('cwebp', ['-version'], { encoding: 'utf8' });
  if (cwebp.status !== 0) {
    console.error('cwebp (libwebp) not found on PATH — required to encode the .webp base layers.');
    process.exit(1);
  }
}
for (const name of names) buildOne(name);
console.log('Done.');
