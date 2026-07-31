/**
 * Generation + compositing for the Upscaler Studio. One canonical copy of the
 * shipped padding pipeline (mirrors tools/build-room-ai.mjs buildSprite): alpha
 * sprites get a transparent ring → colour+matte upscale → crop back; opaque
 * layers get a direct pass. Also the room compositor (bg + wall + objects).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SCALE = 4;
export const SPRITE_PAD = Number(process.env.SPRITE_PAD || 12);
/**
 * Replicate-padding for OPAQUE layers, in source pixels.
 *
 * An upscaler has no context past the image border, so it darkens the outermost rows:
 * measured on a 238x24 plaque with gen_wdn, the first device row came out ~4 luminance
 * levels darker than the same pixels upscaled with 8px of replicated edge and cropped
 * back, decaying to ~0 by two source pixels in.
 *
 * That only matters where the art is COMPOSITED INTO a larger picture, because the rim
 * then reads as an outline: the world-map name plaques (24px tall, drawn straight onto
 * the map) and the briefcase cutscene frames (drawn inside the TV screen). Room
 * backgrounds and full-screen story pages meet the screen border, where there is
 * nothing for a rim to contrast against — and padding them would invalidate the whole
 * upscale cache for no visible gain.
 */
export const LAYER_PAD = Number(process.env.LAYER_PAD || 8);
/** Picture kinds whose upscale is replicate-padded (see LAYER_PAD). */
export const PADDED_KINDS = new Set(['desky', 'kufr']);
/** Padding for a picture of `kind`, in source pixels (0 = none). */
export function layerPadFor(kind) { return PADDED_KINDS.has(kind) ? LAYER_PAD : 0; }
export const FSIZE = 15;
/** Ceiling for the adaptive per-room scale (see scaleForRoomSize). */
export const MAX_SCALE = 2 * SCALE;

/**
 * Whether rooms are built at an ADAPTIVE per-room factor (×4..×8) instead of a uniform
 * ×4. Currently OFF — set STUDIO_ADAPTIVE_SCALE=1 to re-enable.
 *
 * Why off: no upscaler here reaches ×5–×8 natively (the scale is baked into the network
 * weights — 4xNomos8kSC, 4xLSDIR, RealESRGAN_General_WDN_x4_v3 … are ×4-only, and only
 * Real-CUGAN and realesr-animevideov3 offer ×2/×3). Anything above ×4 therefore has to
 * COMPOSE two passes, and the second pass sees an already-upscaled image, which is far
 * outside what these restoration models were trained on. Measured over 6 pictures / 5
 * models, that consistently looks WORSE than a single clean ×4 — softer (a denoiser like
 * Real-CUGAN compounds its smoothing) or speckled. The extra resolution did not pay for
 * the quality lost getting there.
 *
 * The machinery is deliberately kept, not deleted: generateVariantAt, the per-room scale
 * in ai.json, the per-scale fish sets and the Studio's scale controls all still work. If
 * a model appears that upscales beyond ×4 in ONE pass, flipping this flag is all that is
 * needed.
 */
export const ADAPTIVE_SCALE = process.env.STUDIO_ADAPTIVE_SCALE === '1';

/**
 * The upscale factor for a room of `w`×`h` native pixels.
 *
 * With ADAPTIVE_SCALE off this is always SCALE. With it on: rooms are drawn into an
 * 800×600 stage box and a 4K fullscreen stage is ×3.6, so a room magnified to fill the
 * box needs `min(800/w, 600/h) × 3.6` device pixels per source pixel. Small rooms are
 * magnified most and so get the highest factor; that inverse relationship also keeps the
 * supersampling intermediates bounded. Clamped to [SCALE, MAX_SCALE].
 *
 * SHARED by build-ai.mjs (what it renders), server.mjs (what the Studio reports and
 * previews) and gen-worker.mjs (what it will accept) — they must never disagree.
 */
export function scaleForRoomSize(w, h) {
  if (!ADAPTIVE_SCALE) return SCALE;
  if (!(w > 0 && h > 0)) return SCALE;
  return Math.max(SCALE, Math.min(MAX_SCALE, Math.ceil(Math.min(800 / w, 600 / h) * 3.6)));
}

/**
 * Cache/basename for one model's variant at a scale. ×4 keeps the bare historic name
 * so the existing ~9 GB cache stays valid; anything else is suffixed `@<scale>`.
 */
export function variantName(modelId, scale = SCALE, pad = 0) {
  // A padded upscale is a DIFFERENT image from an unpadded one, so it needs its own
  // cache entry — otherwise the build happily reuses whichever was generated first.
  // The pad=0 name is unchanged, so the existing room cache (hours of GPU time) stays
  // valid; only the padded kinds get the suffix.
  const p = pad ? `p${pad}` : '';
  return scale === SCALE ? `${modelId}${p}.png` : `${modelId}${p}@${scale}.png`;
}

/** Candidate models (order = display order). orig = NN reference (model null).
 *  `engine` selects the backend: 'esrgan' (default, realesrgan-ncnn-vulkan),
 *  'cugan' (realcugan-ncnn-vulkan — `model` is its model DIR, `noise` its -n
 *  level: -1 conservative, 0 no-denoise, 1..3 denoise), or 'apisr' (APISR CLI
 *  wrapper, ×4 only). Real-CUGAN and APISR are included because they preserve
 *  thin line art without the outline-thickening the Real-ESRGAN anime models do. */
export const MODELS = [
  { id: 'orig', label: 'original (NN ×4)', group: 'reference', model: null },
  { id: 'x4plus', label: 'x4plus', group: 'reference', model: 'realesrgan-x4plus' },
  { id: 'av3', label: 'animevideov3', group: 'reference', model: 'realesr-animevideov3-x4' },
  { id: 'anime', label: 'x4plus-anime', group: 'reference', model: 'realesrgan-x4plus-anime' },
  { id: 'gen', label: 'General v3 (dn0)', group: 'General v3', model: 'RealESRGAN_General_x4_v3' },
  { id: 'gen_wdn', label: 'General WDN', group: 'General v3', model: 'RealESRGAN_General_WDN_x4_v3' },
  { id: 'siax', label: '4x NMKD-Siax', group: 'illustration', model: '4x_NMKD-Siax_200k' },
  { id: 'nomos', label: '4x Nomos8kSC', group: 'illustration', model: '4xNomos8kSC' },
  { id: 'lsdir', label: '4x LSDIR', group: 'illustration', model: '4xLSDIR' },
  { id: 'hfa2k', label: '4x HFA2k', group: 'illustration', model: '4xHFA2k' },
  { id: 'cugan', label: 'Real-CUGAN (no-denoise)', group: 'line art', engine: 'cugan', model: 'models-se', noise: 0 },
  { id: 'cugan_c', label: 'Real-CUGAN (conservative)', group: 'line art', engine: 'cugan', model: 'models-se', noise: -1 },
  { id: 'apisr', label: 'APISR ×4', group: 'line art', engine: 'apisr', model: 'apisr' },
];
export const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

function run(label, cmd, args) {
  // maxBuffer: the ncnn tools print per-tile progress to stderr, and spawnSync KILLS
  // the child once the default 1 MB is exceeded (surfacing as `status === null`,
  // which looks like a crash). Give it room and report signals distinctly.
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${label} failed (${cmd}): ${r.error.message}`);
  if (r.status !== 0) {
    const how = r.signal ? `killed by ${r.signal}` : `exit ${r.status}`;
    throw new Error(`${label} failed (${cmd} ${how}): ${r.stderr?.toString().slice(0, 400)}`);
  }
}
const ENGINE_ENV = { esrgan: 'REALESRGAN_NCNN', cugan: 'REALCUGAN_NCNN', apisr: 'APISR_CLI' };
/**
 * Resolve every configured backend. Missing ones only fail when actually USED
 * (binFor throws then) — so a machine with only Real-CUGAN can still generate
 * CUGAN variants and build a tier from cache, which is why nothing is required
 * up front. Callers that need at least one backend check availableModels().
 */
export function requireBins() {
  return { esrgan: process.env.REALESRGAN_NCNN || '', cugan: process.env.REALCUGAN_NCNN || '', apisr: process.env.APISR_CLI || '' };
}
export const requireBin = requireBins; // back-compat
function binFor(engine, bins) {
  const p = bins && bins[engine];
  if (!p || !existsSync(p)) throw new Error(`${engine} backend not available — set ${ENGINE_ENV[engine]}`);
  return p;
}
/** MODELS whose backend is actually installed (so an absent optional engine
 *  simply doesn't appear instead of failing every generation). */
export function availableModels(bins) {
  return MODELS.filter((m) => {
    // `orig` is nearest-neighbour via ffmpeg, so it needs no upscaler binary at all.
    if (m.model === null) return true;
    const e = m.engine || 'esrgan';
    // esrgan used to be assumed present. On a machine with only Real-CUGAN installed
    // that made the worker start with an esrgan model, fail, and exit before reaching
    // the models it COULD have produced.
    return !!(bins[e] && existsSync(bins[e]));
  });
}
function probe(png) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png], { encoding: 'utf8' });
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return { w, h };
}
function decodeRgba(png, w, h, work, tag) {
  const raw = join(work, `${tag}.rgba`);
  run(`decode ${tag}`, 'ffmpeg', ['-y', '-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
  const buf = readFileSync(raw);
  if (buf.length !== w * h * 4) throw new Error(`decode size mismatch ${tag}: ${buf.length} != ${w * h * 4}`);
  return new Uint8Array(buf);
}
function encodeRgba(rgba, w, h, work, tag, dst) {
  const raw = join(work, `${tag}.rgba`);
  writeFileSync(raw, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
  run(`encode ${tag}`, 'ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${w}x${h}`, '-i', raw, dst]);
}
/** Run one AI upscale, dispatching to the backend named by `spec.engine`. */
// Real-CUGAN needs a minimum spatial extent; measured threshold is between 64 and 72.
const CUGAN_MIN_SIDE = 96;

function pngSizeOf(png) { const { w, h } = probe(png); return { w, h }; }

/** Replicate the outermost row/column outwards by `pad` pixels on every side. */
function padReplicate(rgba, w, h, pad) {
  const ow = w + pad * 2, oh = h + pad * 2;
  const out = new Uint8Array(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - pad));
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - pad));
      const si = (sy * w + sx) * 4, di = (y * ow + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, w: ow, h: oh };
}

/** Run cugan on an edge-padded copy, then crop the (scaled) padding away. */
function cuganPadded(inPng, outPng, spec, bins, scale, bin) {
  const src = decodePngRgba(inPng);
  const pad = Math.max(0, Math.ceil((CUGAN_MIN_SIDE - Math.min(src.w, src.h)) / 2)) + 8;
  const work = mkdtempSync(join(tmpdir(), 'studioP-'));
  try {
    const pin = join(work, 'in.png'), pout = join(work, 'out.png');
    const p = padReplicate(src.rgba, src.w, src.h, pad);
    encodePngRgba(p.rgba, p.w, p.h, pin);
    run(`AI ${spec.id}`, bin, ['-i', pin, '-o', pout, '-n', String(spec.noise ?? 0), '-s', String(scale),
      '-m', join(dirname(bin), spec.model), '-f', 'png']);
    const big = decodePngRgba(pout);
    const cw = src.w * scale, ch = src.h * scale;
    const c = cropRgba(big.rgba, big.w, pad * scale, pad * scale, cw, ch);
    encodePngRgba(c, cw, ch, outPng);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

function upscaleFile(inPng, outPng, spec, bins, scale) {
  const engine = spec.engine || 'esrgan';
  if (engine === 'cugan') {
    const b = binFor('cugan', bins);
    // Real-CUGAN segfaults outright on inputs whose smaller side is tiny — up3x dies
    // deterministically at 510×64 while 510×72 is fine. Elongated sprites (JESKYNE's
    // 255×15 "tyc") land there once padded and doubled. Grow the frame with replicated
    // edges, upscale, then crop the padding back off: same model, same pixels, just a
    // frame the network can cope with.
    if (Math.min(...Object.values(pngSizeOf(inPng))) < CUGAN_MIN_SIDE) {
      return cuganPadded(inPng, outPng, spec, bins, scale, b);
    }
    const base = ['-i', inPng, '-o', outPng, '-n', String(spec.noise ?? 0), '-s', String(scale), '-m', join(dirname(b), spec.model), '-f', 'png'];
    // Real-CUGAN's Vulkan backend SIGSEGVs intermittently, and more often on large
    // inputs — which composing passes produces a lot of. The same call frequently
    // succeeds on a retry, and shrinking the tile bounds the per-dispatch allocation,
    // so escalate: untiled, then progressively smaller tiles. Only a total failure
    // throws, because silently substituting another model would change the picture's
    // curated look.
    const attempts = [base, [...base, '-t', '256'], [...base, '-t', '128'], [...base, '-t', '64']];
    for (let i = 0; i < attempts.length; i++) {
      try { run(`AI ${spec.id}`, b, attempts[i]); return; }
      catch (e) {
        rmSync(outPng, { force: true });                    // may be a partial write
        if (i === attempts.length - 1) throw e;
        console.warn(`  ! ${spec.id} x${scale} attempt ${i + 1} failed, retrying${i ? ` with -t ${[256,128,64][i]}` : ''}`);
      }
    }
    return;
  }
  if (engine === 'apisr') {
    const b = binFor('apisr', bins);
    if (scale !== 4) throw new Error(`APISR wrapper is ×4 only (asked ${scale})`);
    run(`AI ${spec.id}`, b, [inPng, outPng]);
    return;
  }
  const b = binFor('esrgan', bins);
  run(`AI ${spec.model}`, b, ['-i', inPng, '-o', outPng, '-n', spec.model, '-s', String(scale), '-f', 'png', '-m', join(dirname(b), 'models')]);
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function bleedAlpha(rgba, w, h) {
  const out = new Uint8Array(w * h * 4);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] >= 128) { out[i * 4] = rgba[i * 4]; out[i * 4 + 1] = rgba[i * 4 + 1]; out[i * 4 + 2] = rgba[i * 4 + 2]; known[i] = 1; }
  }
  let anyKnown = known.some((v) => v === 1);
  if (!anyKnown) for (let i = 0; i < w * h; i++) out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 107;
  const maxPasses = w + h;
  for (let pass = 0; pass < maxPasses && anyKnown; pass++) {
    let filled = 0; const snap = known.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (snap[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      if (x > 0 && snap[i - 1]) { r += out[(i - 1) * 4]; g += out[(i - 1) * 4 + 1]; b += out[(i - 1) * 4 + 2]; n++; }
      if (x < w - 1 && snap[i + 1]) { r += out[(i + 1) * 4]; g += out[(i + 1) * 4 + 1]; b += out[(i + 1) * 4 + 2]; n++; }
      if (y > 0 && snap[i - w]) { r += out[(i - w) * 4]; g += out[(i - w) * 4 + 1]; b += out[(i - w) * 4 + 2]; n++; }
      if (y < h - 1 && snap[i + w]) { r += out[(i + w) * 4]; g += out[(i + w) * 4 + 1]; b += out[(i + w) * 4 + 2]; n++; }
      if (n > 0) { out[i * 4] = Math.round(r / n); out[i * 4 + 1] = Math.round(g / n); out[i * 4 + 2] = Math.round(b / n); known[i] = 1; filled++; }
    }
    if (filled === 0) break;
  }
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = 255;
  return out;
}
function alphaToGrey(rgba, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const a = rgba[i * 4 + 3]; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = a; out[i * 4 + 3] = 255; }
  return out;
}
function padTransparent(rgba, w, h, pad) {
  const W = w + 2 * pad, H = h + 2 * pad;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = ((y + pad) * W + (x + pad)) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return { rgba: out, w: W, h: H };
}
function cropRgba(rgba, w, cx, cy, cw, ch) {
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const s = ((y + cy) * w + (x + cx)) * 4, d = (y * cw + x) * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
  }
  return out;
}

/** Matted-sprite upscale WITH the padding trick → PNG at `dstPng` (scale× source).
 *  `spec` is a MODELS entry; `bins` the backend map from requireBins(). */
export function buildSprite(srcPng, dstPng, spec, bins, scale = SCALE) {
  const { w, h } = probe(srcPng);
  const work = mkdtempSync(join(tmpdir(), 'studio-'));
  try {
    const src0 = decodeRgba(srcPng, w, h, work, 'src');
    const { rgba: src, w: pw, h: ph } = padTransparent(src0, w, h, SPRITE_PAD);
    const colPng = join(work, 'col.png');
    encodeRgba(bleedAlpha(src, pw, ph), pw, ph, work, 'col', colPng);
    const colAi = join(work, 'col_ai.png');
    upscaleFile(colPng, colAi, spec, bins, scale);
    const pow = pw * scale, poh = ph * scale;
    const col = decodeRgba(colAi, pow, poh, work, 'colai');
    const mPng = join(work, 'matte.png');
    encodeRgba(alphaToGrey(src, pw, ph), pw, ph, work, 'matte', mPng);
    const mAi = join(work, 'matte_ai.png');
    upscaleFile(mPng, mAi, spec, bins, scale);
    const matte = decodeRgba(mAi, pow, poh, work, 'matteai');
    const padded = new Uint8Array(pow * poh * 4);
    for (let i = 0; i < pow * poh; i++) {
      padded[i * 4] = col[i * 4]; padded[i * 4 + 1] = col[i * 4 + 1]; padded[i * 4 + 2] = col[i * 4 + 2];
      padded[i * 4 + 3] = Math.round(smoothstep(0.12, 0.6, matte[i * 4] / 255) * 255);
    }
    const ow = w * scale, oh = h * scale;
    const out = cropRgba(padded, pow, SPRITE_PAD * scale, SPRITE_PAD * scale, ow, oh);
    encodeRgba(out, ow, oh, work, 'out', dstPng);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Direct (unmatted) upscale of an OPAQUE layer → PNG at `dstPng`. Sprites with
 * alpha go through buildSprite instead, and the NN "orig" model is intercepted by
 * generateVariant before it gets here — so `spec.model` is always a real model.
 */
export function buildLayer(srcPng, dstPng, spec, bins, scale = SCALE, pad = 0) {
  if (!pad) { upscaleFile(srcPng, dstPng, spec, bins, scale); return; }
  // Replicate the edge, upscale, crop back: the model then has context past the border
  // instead of inventing a dark rim there (see LAYER_PAD).
  const { w, h } = probe(srcPng);
  const work = mkdtempSync(join(tmpdir(), 'studio-'));
  try {
    const src = decodeRgba(srcPng, w, h, work, 'src');
    const { rgba: padded, w: pw, h: ph } = padReplicate(src, w, h, pad);
    const inPng = join(work, 'pad.png');
    encodeRgba(padded, pw, ph, work, 'pad', inPng);
    const bigPng = join(work, 'pad_ai.png');
    upscaleFile(inPng, bigPng, spec, bins, scale);
    const pow = pw * scale, poh = ph * scale;
    const big = decodeRgba(bigPng, pow, poh, work, 'padai');
    const out = cropRgba(big, pow, pad * scale, pad * scale, w * scale, h * scale);
    encodeRgba(out, w * scale, h * scale, work, 'out', dstPng);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Generate one variant of a source PNG. Alpha → padded sprite; opaque → direct;
 * spec.model=null → nearest-neighbour "original". `spec` is a MODELS entry, `bins`
 * the backend map from requireBins(). Writes `dstPng`.
 *
 * NOTE the explicit `-pix_fmt rgba` on the NN path. The enhanced masters are pal8
 * PNGs whose transparency lives in a tRNS chunk; letting ffmpeg pick the output
 * format re-encodes to pal8 and LOSES it, turning every transparent pixel opaque
 * and un-hiding the GREEN colour key (0,255,0) that sits under them. It also let
 * the scale filter negotiate a lossy YUV intermediate, which smeared flat colours
 * into palette dithering. Pinning RGBA fixes both.
 */
export function generateVariant(srcPng, dstPng, spec, alpha, bins, scale = SCALE, pad = 0) {
  if (spec.model === null) {
    // NN keeps whatever channels the source has (RGBA stays RGBA).
    run('nn', 'ffmpeg', ['-y', '-v', 'error', '-i', srcPng, '-vf', `scale=iw*${scale}:ih*${scale}:flags=neighbor`, '-pix_fmt', 'rgba', dstPng]);
    return;
  }
  if (alpha) buildSprite(srcPng, dstPng, spec, bins, scale);
  else buildLayer(srcPng, dstPng, spec, bins, scale, pad);
}

/**
/**
 * The scales the model can produce ITSELF. Scale is baked into the network weights, so
 * this is a property of the files on disk, not a parameter: `4xNomos8kSC`, `4xLSDIR`,
 * `RealESRGAN_General_WDN_x4_v3` … are ×4-only. Only Real-CUGAN (up2x/up3x/up4x in
 * models-se) and the realesr-animevideov3 family (-x2/-x3/-x4) offer anything else.
 */
function nativeScales(spec) {
  const engine = spec.engine || 'esrgan';
  if (engine === 'cugan') return [2, 3, 4];
  if (engine === 'apisr') return [4];                       // the wrapper is ×4 only
  return /realesr-animevideov3-x\d$/.test(spec.model || '') ? [2, 3, 4] : [4];
}

/** The same model, configured for another one of its native scales. */
function specAtScale(spec, k) {
  const engine = spec.engine || 'esrgan';
  if (engine === 'esrgan' && /realesr-animevideov3-x\d$/.test(spec.model || '')) {
    return { ...spec, model: spec.model.replace(/x\d$/, `x${k}`) };
  }
  return spec;   // cugan picks up<k>x from the model dir via -s; apisr is ×4 regardless
}

/**
 * Cheapest chain of native passes reaching AT LEAST `target`.
 *
 * Note ×5 and ×7 are not reachable exactly by ANY model: products of {2,3,4} are
 * 2,3,4,6,8,9,12,16… so those scales must overshoot and be resampled down. A ×4-only
 * model can only do 4, 16, 64…, so every scale in (4,8] costs it a ×16 intermediate.
 */
function passPlan(spec, target) {
  const scales = nativeScales(spec);
  let best = null;
  const walk = (seq, prod) => {
    if (prod >= target) {
      if (!best || prod < best.prod || (prod === best.prod && seq.length < best.seq.length)) {
        best = { seq: [...seq], prod };
      }
      return;
    }
    if (seq.length >= 3) return;                            // ×64 is already absurd
    for (const k of scales) { seq.push(k); walk(seq, prod * k); seq.pop(); }
  };
  walk([], 1);
  if (!best) throw new Error(`cannot reach x${target} with ${spec.id}`);
  best.seq.sort((a, b) => a - b);   // smallest pass first: keeps intermediates small, and
  return best;                      // lets the model see the true original at low scale
}

/**
 * Upscale `srcPng` to exactly `target`× its source dimensions using ONLY the picture's
 * own model — the model the user picked in the Studio is the only thing that ever
 * touches the image. Where `target` is not natively reachable the chain overshoots to
 * the nearest reachable scale and is area-resampled down.
 *
 * Composing passes of the SAME model was measured against a cheap generic ×2 second
 * pass over 6 pictures / 5 models: the generic pass is sharper and 2–7× faster, but it
 * is a different algorithm than the one that was curated, so purity wins by decision.
 */
export function generateVariantAt(srcPng, dstPng, spec, alpha, bins, target, pad = 0) {
  if (target === SCALE) { generateVariant(srcPng, dstPng, spec, alpha, bins, SCALE, pad); return; }
  if (!(target > 0)) throw new Error(`bad target scale x${target}`);
  // Nearest-neighbour ("orig") is not a network — it hits any scale directly and exactly.
  if (spec.model === null) { generateVariant(srcPng, dstPng, spec, alpha, bins, target, pad); return; }

  const { seq, prod } = passPlan(spec, target);
  if (seq.length === 1 && prod === target) { generateVariant(srcPng, dstPng, spec, alpha, bins, target, pad); return; }

  const work = mkdtempSync(join(tmpdir(), 'studioS-'));
  try {
    let cur = srcPng;
    seq.forEach((k, i) => {
      const out = join(work, `p${i}.png`);
      generateVariant(cur, out, specAtScale(spec, k), alpha, bins, k, pad);
      cur = out;
    });
    if (prod === target) { copyFileSync(cur, dstPng); return; }
    const s0 = decodePngRgba(srcPng);
    const im = decodePngRgba(cur);
    const d = resampleAreaTo(im.rgba, im.w, im.h, s0.w * target, s0.h * target);
    encodePngRgba(d.rgba, d.w, d.h, dstPng);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- compositing ---------------------------------------------------------
export function decodePngRgba(png) { const { w, h } = probe(png); const work = mkdtempSync(join(tmpdir(), 'studioc-')); try { return { rgba: decodeRgba(png, w, h, work, 'c'), w, h }; } finally { rmSync(work, { recursive: true, force: true }); } }
export function encodePngRgba(rgba, w, h, dst) { const work = mkdtempSync(join(tmpdir(), 'studioe-')); try { encodeRgba(rgba, w, h, work, 'e', dst); } finally { rmSync(work, { recursive: true, force: true }); } }
export function toWebp(srcPng, dstWebp, q = 90) { run('webp', 'cwebp', ['-quiet', '-q', String(q), srcPng, '-o', dstWebp]); }

// Chamfer (approx-Euclidean) distance transform: distance of every cell to the
// nearest source cell (src[i] truthy). Two-pass, O(w·h). With withIdx=true it
// also returns, per cell, the index of that nearest source cell (feature
// transform) so callers can sample the source pixel's colour.
function distanceTransform(src, w, h, withIdx = false) {
  const INF = 1e9, d = new Float32Array(w * h);
  const idx = withIdx ? new Int32Array(w * h) : null;
  for (let i = 0; i < w * h; i++) { if (src[i]) { d[i] = 0; if (idx) idx[i] = i; } else { d[i] = INF; if (idx) idx[i] = -1; } }
  const O = 1, D = Math.SQRT2;
  const relax = (i, n, c) => { const v = d[n] + c; if (v < d[i]) { d[i] = v; if (idx) idx[i] = idx[n]; } };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) relax(i, i - 1, O);
    if (y > 0) relax(i, i - w, O);
    if (x > 0 && y > 0) relax(i, i - w - 1, D);
    if (x < w - 1 && y > 0) relax(i, i - w + 1, D);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) relax(i, i + 1, O);
    if (y < h - 1) relax(i, i + w, O);
    if (x < w - 1 && y < h - 1) relax(i, i + w + 1, D);
    if (x > 0 && y < h - 1) relax(i, i + w - 1, D);
  }
  return withIdx ? { d, idx } : d;
}

/**
 * Thin a sprite's dark outline by a PERCENTAGE of the local contour width,
 * measured independently at every point. For each dark "ink" pixel: dOut =
 * distance to the outer (transparent/edge) side, dIn = distance to the coloured
 * "inner image" (fill); local width W = dOut + dIn. The pixel is removed (crisp,
 * alpha→0) when it lies in the OUTER s fraction of that width (dOut < s·W), so s
 * is a true fraction: s=0.5 turns a 20px outline into 10px and a 10px outline
 * into 5px. Only silhouette-adjacent dark is touched — internal detail lines and
 * textures (far from any transparent edge) never satisfy dOut < s·W and are left
 * intact, as are fill-less strokes (dIn > DIN_MAX). This SHRINKS the silhouette
 * slightly; pair with stretchToBBox() to refill the original footprint.
 * `s`∈[0,1] (0 = untouched). Returns a NEW rgba (Uint8Array). Keep in sync with
 * the client copy in public/app.js (thinOutlineClient).
 */
const DIN_MAX = 40; // upscaled px: contours whose inner boundary is farther than this are treated as fill-less
const BAND_MAX = 14; // upscaled px: dark pixels deeper than this from the edge count as inner image, not outline
export function thinOutline(rgba, w, h, s) {
  if (!(s > 0)) return rgba;
  const out = new Uint8Array(rgba); // copy; only outer ink alpha is cleared
  const N = w * h;
  const transp = new Uint8Array(N), fill = new Uint8Array(N), ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * 4, a = rgba[o + 3];
    const l = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    if (a < 40) transp[i] = 1; else if (l < 60) ink[i] = 1; else fill[i] = 1;
  }
  const dOut = distanceTransform(transp, w, h);
  // Inner boundary = bright fill OR deep dark (dark pixels far from the edge are
  // inner image, not outline). This keeps dIn — and thus the measured contour
  // width — consistent along a flat outline even where the fill behind it is
  // dark (otherwise that dark would be read as more outline and over-thinned).
  const inner = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (fill[i] || (ink[i] && dOut[i] > BAND_MAX)) inner[i] = 1;
  const dIn = distanceTransform(inner, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!ink[i]) continue;
    const border = Math.min(x, y, w - 1 - x, h - 1 - y) + 1; // just-outside canvas counts as transparent
    const dO = Math.min(dOut[i], border);
    const di = dIn[i];
    if (di > DIN_MAX) continue;         // fill-less stroke: leave intact
    const W = dO + di;                  // local contour width at this point
    if (dO < s * W) out[i * 4 + 3] = 0; // crisp-remove the outer s-fraction of the outline
  }
  return out;
}

// Opaque bounding box of an rgba buffer (alpha ≥ thr), or null if fully transparent.
function opaqueBBox(rgba, w, h, thr = 40) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] >= thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

/**
 * Non-uniformly scale `src`'s opaque content so its bounding box fills `ref`'s
 * opaque bounding box (same w×h canvas). Used after thinOutline: the thinned
 * sprite is stretched back to the ORIGINAL silhouette's bounding box so it
 * roughly refills its physical footprint. This is a GLOBAL box→box scale, so it
 * only restores the extreme-most pixels exactly; interior contact edges are
 * topped up separately at composite level by seamFill(). Bilinear,
 * premultiplied-alpha sampling. Returns a NEW rgba. Keep in sync with
 * stretchToBBoxClient in app.js.
 */
export function stretchToBBox(src, ref, w, h) {
  const sb = opaqueBBox(src, w, h), rb = opaqueBBox(ref, w, h);
  if (!sb || !rb) return src;
  const sw = sb.x1 - sb.x0, sh = sb.y1 - sb.y0;   // spans (max index - min index)
  const rw = rb.x1 - rb.x0, rh = rb.y1 - rb.y0;
  if (sb.x0 === rb.x0 && sb.y0 === rb.y0 && sw === rw && sh === rh) return src;
  const out = new Uint8Array(w * h * 4);          // transparent
  for (let oy = rb.y0; oy <= rb.y1; oy++) for (let ox = rb.x0; ox <= rb.x1; ox++) {
    const u = sb.x0 + (rw ? (ox - rb.x0) / rw * sw : 0); // map output→source within the bboxes
    const v = sb.y0 + (rh ? (oy - rb.y0) / rh * sh : 0);
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    let r = 0, g = 0, b = 0, a = 0;
    for (const [xx, yy, wgt] of [[x0, y0, (1 - fx) * (1 - fy)], [x1, y0, fx * (1 - fy)], [x0, y1, (1 - fx) * fy], [x1, y1, fx * fy]]) {
      const si = (yy * w + xx) * 4, sa = src[si + 3] / 255;
      r += src[si] * sa * wgt; g += src[si + 1] * sa * wgt; b += src[si + 2] * sa * wgt; a += src[si + 3] * wgt;
    }
    const oi = (oy * w + ox) * 4, am = a / 255;
    out[oi] = am > 0 ? Math.round(r / am) : 0;
    out[oi + 1] = am > 0 ? Math.round(g / am) : 0;
    out[oi + 2] = am > 0 ? Math.round(b / am) : 0;
    out[oi + 3] = Math.round(a);
  }
  return out;
}

/**
 * Composite-level SEAM FILL. Per-object contour thinning correctly recedes each
 * sprite's outline all the way around — good against open background, but between
 * two participants that ORIGINALLY (near-)touched (two objects, or an object and
 * the wall) it opens a background sliver (a "gap"). A sprite can't tell a contact
 * edge from a free edge, so this must run on the assembled room. Given the
 * flattened `base` (bg+wall+thinned objects) and every participant's ORIGINAL +
 * THINNED masks placed at their (dx,dy), it finds the SEAM zone = background
 * pixels (not covered by any thinned layer) lying within `R` px of TWO different
 * participants' original silhouettes — i.e. the sliver BETWEEN two near-touching
 * participants. A pixel near only ONE participant (a free outer edge) has its
 * 2nd-nearest distance large, so it is left thin. Using DISTANCE (not pixel
 * adjacency) tolerates the anti-aliased transparent margin real sprites have
 * between abutting objects.
 *
 * The seam is filled by RESTORING each participant's ORIGINAL (pre-thinning)
 * artwork there — real colour + anti-aliased alpha — composited front-to-back in
 * the same order as the room. That keeps the join clean and smooth (it IS the
 * original art) instead of the dashed patchwork a nearest-neighbour colour copy
 * produced. Only seam pixels are touched, so free outer edges stay thin.
 * Modifies `base` in place. `R` in upscaled px (0 = off). Composite-only.
 */
export function seamFill(base, W, H, layers, R) {
  if (!(R > 0) || layers.length < 2) return;
  const N = W * H;
  const thinCover = new Uint8Array(N);
  const min1 = new Float32Array(N).fill(1e9); // distance to nearest participant (orig)
  const min2 = new Float32Array(N).fill(1e9); // distance to 2nd-nearest participant
  const mask = new Uint8Array(N);
  for (let k = 0; k < layers.length; k++) {
    const { orig, rgba, w, h, dx, dy } = layers[k];
    mask.fill(0);
    for (let y = 0; y < h; y++) {
      const cy = dy + y; if (cy < 0 || cy >= H) continue;
      for (let x = 0; x < w; x++) {
        const cx = dx + x; if (cx < 0 || cx >= W) continue;
        const li = (y * w + x) * 4, p = cy * W + cx;
        if (orig[li + 3] >= 40) mask[p] = 1;
        if (rgba[li + 3] >= 40) thinCover[p] = 1;
      }
    }
    const dk = distanceTransform(mask, W, H); // distance from every pixel to participant k
    for (let p = 0; p < N; p++) {
      const d = dk[p];
      if (d < min1[p]) { min2[p] = min1[p]; min1[p] = d; }
      else if (d < min2[p]) { min2[p] = d; }
    }
  }
  const seam = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (!thinCover[p] && min2[p] <= R) seam[p] = 1; // sliver between two participants
  // Restore original artwork in the seam, front-to-back (layers[] is back→front).
  for (let k = 0; k < layers.length; k++) {
    const { orig, w, h, dx, dy } = layers[k];
    for (let y = 0; y < h; y++) {
      const cy = dy + y; if (cy < 0 || cy >= H) continue;
      for (let x = 0; x < w; x++) {
        const cx = dx + x; if (cx < 0 || cx >= W) continue;
        const p = cy * W + cx;
        if (!seam[p]) continue;
        const li = (y * w + x) * 4, a = orig[li + 3];
        if (!a) continue;
        const af = a / 255, ia = 1 - af, bo = p * 4;
        base[bo] = orig[li] * af + base[bo] * ia;
        base[bo + 1] = orig[li + 1] * af + base[bo + 1] * ia;
        base[bo + 2] = orig[li + 2] * af + base[bo + 2] * ia;
        base[bo + 3] = 255;
      }
    }
  }
}

/**
 * Smooth the jagged staircase left by crisp thinning WITHOUT leaving a
 * translucent fringe. A separable Gaussian (sigma upscaled px) on the
 * PREMULTIPLIED rgba rounds the silhouette shape (band-limited to dEdge ≤
 * radius; interior + empty areas untouched, no dark fringe). The blurred alpha
 * is then re-sharpened around 0.5 by `crisp` (0 = soft AA as-is; 1 = pushed to
 * near-binary) so the smoothed CONTOUR survives while the semi-transparent edge
 * pixels collapse to fully opaque/transparent. Returns a NEW rgba. Keep in sync
 * with smoothEdgesClient in public/app.js.
 */
export function smoothEdges(rgba, w, h, sigma = 1.0, crisp = 0.5) {
  if (!(sigma > 0)) return rgba;
  const gain = 1 + Math.max(0, Math.min(1, crisp)) * 15;
  const N = w * h, A = i => rgba[i * 4 + 3];
  const edge = new Uint8Array(N); // silhouette transition pixels
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, op = A(i) >= 128;
    if ((x > 0 && (A(i - 1) >= 128) !== op) || (x < w - 1 && (A(i + 1) >= 128) !== op) ||
        (y > 0 && (A(i - w) >= 128) !== op) || (y < h - 1 && (A(i + w) >= 128) !== op)) edge[i] = 1;
  }
  const dEdge = distanceTransform(edge, w, h);
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const K = []; let ksum = 0;
  for (let k = -radius; k <= radius; k++) { const g = Math.exp(-(k * k) / (2 * sigma * sigma)); K.push(g); ksum += g; }
  for (let k = 0; k < K.length; k++) K[k] /= ksum;
  const pr = new Float32Array(N), pg = new Float32Array(N), pb = new Float32Array(N), pa = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = rgba[i * 4 + 3] / 255; pr[i] = rgba[i * 4] * a; pg[i] = rgba[i * 4 + 1] * a; pb[i] = rgba[i * 4 + 2] * a; pa[i] = rgba[i * 4 + 3]; }
  const hr = new Float32Array(N), hg = new Float32Array(N), hb = new Float32Array(N), ha = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { // horizontal pass
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = -radius; k <= radius; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)), j = y * w + xx, wk = K[k + radius]; r += pr[j] * wk; g += pg[j] * wk; b += pb[j] * wk; a += pa[j] * wk; }
    const i = y * w + x; hr[i] = r; hg[i] = g; hb[i] = b; ha[i] = a;
  }
  const out = new Uint8Array(rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { // vertical pass, edge-band only
    const i = y * w + x; if (dEdge[i] > radius) continue;
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = -radius; k <= radius; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)), j = yy * w + x, wk = K[k + radius]; r += hr[j] * wk; g += hg[j] * wk; b += hb[j] * wk; a += ha[j] * wk; }
    const am = a / 255, o = i * 4;                            // colour from blurred (premult) → no fringe
    const as = Math.max(0, Math.min(1, (am - 0.5) * gain + 0.5)); // sharpen alpha → kill semi-transparency
    out[o] = am > 0 ? Math.round(r / am) : 0;
    out[o + 1] = am > 0 ? Math.round(g / am) : 0;
    out[o + 2] = am > 0 ? Math.round(b / am) : 0;
    out[o + 3] = Math.round(as * 255);
  }
  return out;
}

/**
 * Area-average (box) downscale by `factor` (≥1) with PREMULTIPLIED alpha, so a
 * ×SCALE AI render can be shrunk to a smaller *net* scale. Because the model's
 * outline is a roughly fixed pixel width, shrinking the image narrows the
 * contour proportionally AND anti-aliases it cleanly — the "supersample then
 * downscale" trick. Fractional factors supported (coverage-weighted box).
 * Returns { rgba, w, h }. Keep in sync with downscaleClient in public/app.js.
 */
export function downscaleRgba(rgba, w, h, factor) {
  if (!(factor > 1.0001)) return { rgba, w, h };
  return resampleAreaTo(rgba, w, h, Math.max(1, Math.round(w / factor)), Math.max(1, Math.round(h / factor)));
}

/**
 * Area-average resample to exact output dimensions, premultiplying by alpha so that
 * transparent pixels never bleed their (undefined) colour into the result. Each axis is
 * scaled independently, so this also lands on exact ×N multiples that a single scalar
 * factor could not express.
 */
export function resampleAreaTo(rgba, w, h, ow, oh) {
  if (ow === w && oh === h) return { rgba, w, h };
  const sx = w / ow, sy = h / oh;
  const out = new Uint8Array(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = oy * sy, y1 = y0 + sy, iy0 = Math.floor(y0), iy1 = Math.min(h, Math.ceil(y1));
    for (let ox = 0; ox < ow; ox++) {
      const x0 = ox * sx, x1 = x0 + sx, ix0 = Math.floor(x0), ix1 = Math.min(w, Math.ceil(x1));
      let r = 0, g = 0, b = 0, a = 0, cov = 0;
      for (let yy = iy0; yy < iy1; yy++) {
        const cy = Math.min(y1, yy + 1) - Math.max(y0, yy); if (cy <= 0) continue;
        for (let xx = ix0; xx < ix1; xx++) {
          const cx = Math.min(x1, xx + 1) - Math.max(x0, xx); if (cx <= 0) continue;
          const c = cx * cy, i = (yy * w + xx) * 4, al = rgba[i + 3] / 255 * c;
          r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += rgba[i + 3] * c; cov += c;
        }
      }
      const o = (oy * ow + ox) * 4, am = a / 255;
      out[o] = am > 0 ? Math.round(r / am) : 0;
      out[o + 1] = am > 0 ? Math.round(g / am) : 0;
      out[o + 2] = am > 0 ? Math.round(b / am) : 0;
      out[o + 3] = cov > 0 ? Math.round(a / cov) : 0;
    }
  }
  return { rgba: out, w: ow, h: oh };
}

/** Alpha-over `spr`{rgba,w,h,dx,dy} onto opaque `base`(a=255), clipped. */
export function compositeOver(base, W, H, spr) {
  const { rgba: s, w: sw, h: sh, dx, dy } = spr;
  for (let y = 0; y < sh; y++) {
    const by = y + dy; if (by < 0 || by >= H) continue;
    for (let x = 0; x < sw; x++) {
      const bx = x + dx; if (bx < 0 || bx >= W) continue;
      const si = (y * sw + x) * 4, bi = (by * W + bx) * 4;
      const fa = s[si + 3] / 255; if (fa <= 0) continue;
      base[bi] = Math.round(s[si] * fa + base[bi] * (1 - fa));
      base[bi + 1] = Math.round(s[si + 1] * fa + base[bi + 1] * (1 - fa));
      base[bi + 2] = Math.round(s[si + 2] * fa + base[bi + 2] * (1 - fa));
      base[bi + 3] = 255;
    }
  }
}
