/**
 * Build the shipped `ai` graphics tier (public/enhanced-ai/**) FROM THE STUDIO'S
 * CURATION — i.e. honouring selections.json (per-picture model pick), the
 * Studio's default model, and contours.json (per-picture contour thinning).
 *
 * This supersedes tools/build-room-ai.mjs, which hardcoded one model
 * (realesr-animevideov3-x4) and knew nothing about the Studio. The heavy AI work
 * has ALREADY been done: every distinct picture is cached at
 * tools/studio/cache/<hash>/<modelId>.png (×4). So a build is mostly file copies
 * plus optional per-sprite contour post-processing — seconds, not hours. Any
 * source PNG the index doesn't cover (e.g. STEEL's animated p1/p2/w1 layers, which
 * the indexer skips) is generated on demand with the default model.
 *
 * Room scale comes from scaleForRoomSize(). With ADAPTIVE_SCALE off (the current
 * setting) every room ships at ×4; re-enabling it makes small rooms — which the stage
 * magnifies most — ship finer. Either way the chosen scale is written to each room's
 * ai.json and read back by src/render/roomAi.ts. Menu assets stay at ×4. contours.json `superscale`
 * is a STUDIO-PREVIEW-ONLY setting and is NOT applied here (warned about).
 *
 * Output is WebP (lossy q92 + lossless alpha): visually indistinguishable from the
 * source PNGs while cutting the shipped tier by roughly an order of magnitude.
 * `seamFill` is likewise not applicable: it is a composite-level fix and the tier
 * ships individual sprites that the runtime composites itself.
 *
 * Incremental: each output room keeps .build-stamp.json recording, per file, the
 * source hash + model + contour params used. Files whose stamp is unchanged are
 * skipped, so rebuilding after changing a few picks is near-instant (--force
 * overrides).
 *
 * Usage:
 *   node tools/studio/build-ai.mjs PRVNI [ROOM…]   # specific rooms
 *   node tools/studio/build-ai.mjs --all           # every room (+ fish)
 *   node tools/studio/build-ai.mjs --fish          # shared fish set only
 *   node tools/studio/build-ai.mjs --menu          # menu / world-map art only
 *                                                  #   (public/data/Menu/*_ai.webp|png)
 *   [--force] [--dry-run]
 *
 * Env: REALESRGAN_NCNN / REALCUGAN_NCNN / APISR_CLI (only needed if something
 * must be generated on demand), STUDIO_DEFAULT_MODEL (default cugan_c).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, renameSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  MODEL_BY_ID, requireBins, availableModels, generateVariant,
  decodePngRgba, encodePngRgba, thinOutline, stretchToBBox, smoothEdges, generateVariantAt, SCALE,
  MAX_SCALE, scaleForRoomSize, variantName,
} from './lib/upscale.mjs';

const studioDir = dirname(fileURLToPath(import.meta.url));
const root = join(studioDir, '..', '..');
const srcRoot = join(root, 'public', 'enhanced');
const outRoot = join(root, 'public', 'enhanced-ai');
const cacheDir = join(studioDir, 'cache');

const index = JSON.parse(readFileSync(join(studioDir, 'index.json'), 'utf8'));
const selections = existsSync(join(studioDir, 'selections.json')) ? JSON.parse(readFileSync(join(studioDir, 'selections.json'), 'utf8')) : {};
const contour = existsSync(join(studioDir, 'contours.json')) ? JSON.parse(readFileSync(join(studioDir, 'contours.json'), 'utf8')) : {};
// Rooms deliberately excluded from the tier (Studio "use enhanced" toggle). The
// runtime falls back to the enhanced render whenever a room's AI art is absent,
// so honouring this means NOT building it and REMOVING anything already built.
const roomSkip = new Set(
  existsSync(join(studioDir, 'roomskip.json'))
    ? (JSON.parse(readFileSync(join(studioDir, 'roomskip.json'), 'utf8')).rooms || [])
    : [],
);
const DEFAULT_MODEL = process.env.STUDIO_DEFAULT_MODEL || 'cugan_c';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const FORCE = flag('force'), DRY = flag('dry-run');

const effContour = (h) => { const v = contour.byHash?.[h]; return typeof v === 'number' ? v : (contour.global || 0); };
const smoothSigma = typeof contour.smoothSigma === 'number' ? contour.smoothSigma : 1.0;
const smoothCrisp = typeof contour.smoothCrisp === 'number' ? contour.smoothCrisp : 0.5;

let bins = null;
const getBins = () => (bins ||= requireBins());
let defaultModelId = DEFAULT_MODEL;

/** room -> Map(file -> hash), inverted from every picture's `uses`. */
function invertIndex() {
  const byRoom = new Map();
  for (const [hash, pic] of Object.entries(index.pictures)) {
    for (const u of pic.uses) {
      if (!byRoom.has(u.room)) byRoom.set(u.room, new Map());
      byRoom.get(u.room).set(u.file, hash);
    }
  }
  return byRoom;
}
/** Every *.png under a room's source dir, as room-relative paths. */
function listPngs(dir, pre = '') {
  let out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const fp = join(dir, f);
    if (statSync(fp).isDirectory()) out = out.concat(listPngs(fp, `${pre}${f}/`));
    else if (f.endsWith('.png')) out.push(pre + f);
  }
  return out;
}
const hashFile = (abs) => createHash('md5').update(readFileSync(abs)).digest('hex');

/**
 * Absolute path of the cached ×4 variant to ship for `hash`, generating it if the
 * picked model isn't cached yet.
 *
 * NOTE this deliberately differs from the server's preview fallback: a preview may
 * happily substitute another cached variant, but the shipped tier tries hard to honour
 * the pick. Substituting per-file would otherwise give an object's animation frames
 * different models (picks apply to all frames, but only the frame the user opened was
 * generated) — which flickers as the animation plays. So: GENERATE first, and only fall
 * back to another cached variant if generating fails for ANY reason (no backend, or the
 * upscaler erroring/crashing on this input). That fallback is counted in
 * `report.substituted`, warned about per file, and recorded in the build stamp as the
 * model actually used, so the next build retries the real pick rather than settling.
 */
/** Cache file for a model at a given scale (×SCALE keeps the bare legacy name). */
const variantPath = (dir, model, scale) => join(dir, variantName(model, scale));
function variantFor(hash, srcAbs, alpha, report, scale = SCALE) {
  const want = selections[hash] || defaultModelId;
  const dir = join(cacheDir, hash);
  const wantPng = variantPath(dir, want, scale);
  if (existsSync(wantPng)) return { png: wantPng, model: want };
  if (want === 'orig') { // explicit NN pick
    const o = variantPath(dir, 'orig', scale);
    if (existsSync(o)) return { png: o, model: 'orig' };
  }
  const spec = MODEL_BY_ID[want] || MODEL_BY_ID[defaultModelId];
  // Dry-run reports what WOULD be generated and never writes. The returned path does not
  // exist yet, so it is flagged `planned` — callers must not try to read it (assertScaled
  // used to open it unconditionally, so --dry-run crashed with ENOENT on exactly the
  // missing-cache case it exists to report).
  if (DRY) { report.generated++; return { png: wantPng, model: spec.id, planned: true }; }
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${spec.id}@${scale}.build.png`);
    generateVariantAt(srcAbs, tmp, spec, alpha, getBins(), scale);
    const dst = variantPath(dir, spec.id, scale);
    renameSync(tmp, dst); // atomic publish into the Studio cache
    report.generated++;
    return { png: dst, model: spec.id };
  } catch (e) {
    // Can't generate (backend missing / model failed) → fall back to any cached
    // AI variant so the build still completes, but say so.
    let av = [];
    try { av = availableModels(getBins()); } catch { av = []; }
    for (const m of av.length ? av : Object.values(MODEL_BY_ID)) {
      if (m.id === 'orig') continue;
      const p = variantPath(dir, m.id, scale);
      if (existsSync(p)) {
        report.substituted++;
        console.warn(`    ! ${hash.slice(0, 8)}: wanted ${want} but could not generate (${String(e.message || e).slice(0, 80)}) → using ${m.id}`);
        return { png: p, model: m.id };
      }
    }
    throw e;
  }
}

/**
 * The stamp a file SHOULD have, derived purely from the inputs that affect its
 * bytes: source hash, picked model, contour params, and the size+mtime of the
 * cached variant (so regenerating a variant under the same model id — which does
 * happen — correctly invalidates). Compared with `===`; a previous run that had to
 * SUBSTITUTE a different model records that model instead, so the mismatch makes
 * the next build retry it.
 */
function stampFor(hash, alpha, model, scale = SCALE) {
  const s = alpha ? effContour(hash) : 0;
  const png = variantPath(join(cacheDir, hash), model, scale);
  let v = '-';
  try { const st = statSync(png); v = `${st.size}-${Math.round(st.mtimeMs)}`; } catch { /* not cached yet */ }
  return `${hash}:${model}:x${scale}:${s}:${s > 0 ? `${smoothSigma}/${smoothCrisp}` : ''}:${v}:q${WEBP_Q}`;
}

/**
 * ADAPTIVE PER-ROOM SCALE. Rooms are drawn into an 800x600 stage box, so a SMALL
 * room is magnified far more than a big one — on a 4K fullscreen the smallest
 * (MIKRO 360x210) reaches a content scale of 8.0, at which ×4 art would be
 * interpolated 2× on screen. Render each room fine enough to stay native:
 *   scale = ceil(min(800/w, 600/h) * 3.6), clamped to [SCALE, 2*SCALE]
 * That is ×4 for the 30 biggest rooms rising to ×8 for the 2 smallest, and costs
 * ~1.38× the pixels of a uniform ×4 (a uniform ×8 would cost 4× and risks the
 * 4096 GPU texture cap).
 */
const scaleCache = new Map();
function roomScale(room) {
  if (scaleCache.has(room)) return scaleCache.get(room);
  const dim = pngSize(join(srcRoot, room, 'p.png'));
  const s = dim ? scaleForRoomSize(dim.w, dim.h) : SCALE;
  scaleCache.set(room, s);
  return s;
}

/** Width/height straight out of a PNG's IHDR — 24 bytes, no ffprobe spawn. */
function pngSize(file) {
  const fd = openSync(file, 'r');
  try {
    const b = Buffer.alloc(24);
    if (readSync(fd, b, 0, 24, 0) < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } finally { closeSync(fd); }
}

/**
 * Guard the tier's hard invariant: the runtime derives a room's native size as
 * bg.width / AI_ROOM_SCALE, so shipping a variant that is not exactly ×SCALE of its
 * source would mis-size the whole room. A poisoned cache entry is otherwise invisible
 * until the game renders wrong. Source dims come from the index (free) where known,
 * and both sides are read from the PNG header rather than spawning ffprobe — this
 * runs for every emitted file.
 */
function assertScaled(srcAbs, png, hash, scale = SCALE) {
  const pic = hash ? index.pictures[hash] : null;
  const a = pic && pic.w ? { w: pic.w, h: pic.h } : pngSize(srcAbs);
  const b = pngSize(png);
  if (!a || !b) return;                       // unreadable header: leave it to decode
  if (b.w !== a.w * scale || b.h !== a.h * scale) {
    throw new Error(`${png} is ${b.w}x${b.h}, expected ${a.w * scale}x${a.h * scale} (x${scale} of ${srcAbs})`);
  }
}

/**
 * Ship one image as WebP. Lossy q92 with LOSSLESS ALPHA (-alpha_q 100): measured on
 * a room background that is 6.9 MB PNG -> 0.4 MB (mean abs error 1.05/255) and on a
 * wall 2.68 MB -> 0.23 MB with the doorway alpha bit-exact (0 differing pixels).
 * The tier is ~90 % backgrounds and walls, so this is what keeps it shippable.
 */
function toWebp(srcPng, outAbs) {
  const tmp = `${outAbs}.tmp.webp`;
  const r = spawnSync('cwebp', ['-quiet', '-q', WEBP_Q, '-alpha_q', '100', srcPng, '-o', tmp],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) { rmSync(tmp, { force: true }); throw new Error(`cwebp failed: ${r.stderr?.toString().slice(0, 200)}`); }
  renameSync(tmp, outAbs);   // atomic publish
}

/** Write one output file as WebP, post-processing the cached variant if needed. */
function emit(srcAbs, outAbs, hash, alpha, report, scale) {
  const s = alpha ? effContour(hash) : 0;
  const { png, model, planned } = variantFor(hash, srcAbs, alpha, report, scale);
  if (!planned) assertScaled(srcAbs, png, hash, scale);
  const stamp = stampFor(hash, alpha, model, scale);   // records the model ACTUALLY used
  if (DRY) return stamp;
  mkdirSync(dirname(outAbs), { recursive: true });
  let src = png;
  let tmp = null;
  if (s > 0) {
    // Same per-sprite pipeline the Studio preview applies (thin → stretch → smooth).
    const m = decodePngRgba(png);
    const thinned = thinOutline(m.rgba, m.w, m.h, s);
    const sprite = stretchToBBox(thinned, m.rgba, m.w, m.h);
    tmp = `${outAbs}.thin.png`;
    encodePngRgba(smoothEdges(sprite, m.w, m.h, smoothSigma, smoothCrisp), m.w, m.h, tmp);
    src = tmp;
    report.thinned++;
  }
  try { toWebp(src, outAbs); } finally { if (tmp) rmSync(tmp, { force: true }); }
  return stamp;
}

function buildRoom(room, byRoom, report) {
  if (roomSkip.has(room)) {
    // Excluded on purpose: remove any previously built art so the runtime's
    // "no AI art → enhanced render" fallback takes over.
    const gone = join(outRoot, room);
    if (existsSync(gone)) {
      if (!DRY) rmSync(gone, { recursive: true, force: true });
      console.log(`  ${room}: SKIPPED (use enhanced) — removed previously built art`);
    } else {
      console.log(`  ${room}: skipped (use enhanced)`);
    }
    report.skipped++;
    return true;
  }
  const srcDir = join(srcRoot, room);
  if (!existsSync(srcDir)) { console.error(`  ! no source art for ${room}`); return false; }
  const dstDir = join(outRoot, room);
  const stampFile = join(dstDir, '.build-stamp.json');
  const prev = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : {};
  const next = {};
  const covered = byRoom.get(room) || new Map();
  const files = listPngs(srcDir);
  const scale = roomScale(room);
  let wrote = 0, skipped = 0;
  for (const rel of files) {
    const srcAbs = join(srcDir, rel);
    let hash = covered.get(rel);
    let alpha;
    if (hash && index.pictures[hash]) alpha = index.pictures[hash].alpha;
    else { // not indexed (e.g. STEEL's animated p1/p2/w1) → treat as its own picture
      hash = hashFile(srcAbs);
      alpha = decodePngRgba(srcAbs).rgba.some((v, i) => i % 4 === 3 && v < 255);
      report.unindexed++;
    }
    const out = webpName(rel);
    const outAbs = join(dstDir, out);
    const want = stampFor(hash, alpha, selections[hash] || defaultModelId, scale);
    if (!FORCE && existsSync(outAbs) && prev[out] === want) { next[out] = prev[out]; skipped++; continue; }
    next[out] = emit(srcAbs, outAbs, hash, alpha, report, scale);
    wrote++;
  }
  if (!DRY) {
    mkdirSync(dstDir, { recursive: true });
    writeFileSync(join(dstDir, 'ai.json'), JSON.stringify(roomManifest(srcDir, files, scale)));
    // objects.json is still copied for anything reading the legacy layout.
    const oj = join(srcDir, 'objects.json');
    if (existsSync(oj)) copyFileSync(oj, join(dstDir, 'objects.json'));
    // Drop stale PNGs from a pre-WebP build so the room dir has one format only.
    for (const f of listPngs(dstDir)) rmSync(join(dstDir, f), { force: true });
    writeFileSync(stampFile, JSON.stringify(next));
  }
  console.log(`  ${room}: ${wrote} written, ${skipped} unchanged (${files.length} files, x${scale})`);
  return true;
}

/** Room-relative source name → shipped name (everything ships as WebP). */
const webpName = (rel) => rel.replace(/\.png$/i, '.webp');

/**
 * Per-room manifest the runtime reads instead of guessing filenames: it carries the
 * room's ADAPTIVE SCALE (which the loader can no longer assume is 4) and the shipped
 * background/wall frame lists in animation order (p.png, p1.png, … / w.png, w1.png, …).
 */
function roomManifest(srcDir, files, scale) {
  const seq = (base) => files
    .filter((f) => new RegExp(`^${base}\\d*\\.png$`, 'i').test(f))
    .sort((a, b) => (parseInt(a.slice(1), 10) || 0) - (parseInt(b.slice(1), 10) || 0))
    .map(webpName);
  const objs = [];
  const oj = join(srcDir, 'objects.json');
  if (existsSync(oj)) {
    for (const o of (JSON.parse(readFileSync(oj, 'utf8')).objects || [])) {
      if (typeof o.item !== 'number' || !Array.isArray(o.frames)) continue;
      // objects.json names frames bare, but buildRoom writes them under obj/. The
      // manifest paths are resolved relative to the room directory by the loader,
      // so they must carry that prefix.
      objs.push({ item: o.item, frames: o.frames.map((f) => `obj/${webpName(f)}`) });
    }
  }
  return { scale, bg: seq('p'), wall: seq('w'), objects: objs };
}

/**
 * The MENU / world-map tier (public/data/Menu/*_ai.*). Same idea as a room, but the
 * runtime expects the shapes tools/build-map-ai.mjs produced: opaque base layers as
 * lossy WebP (~0.5 MB vs ~10 MB PNG for a 2560×1920 layer) and the tiny keyed node
 * balls as lossless RGBA PNG. The Studio's cached variant is already the finished ×4
 * art in both cases — the sprite path applies the very same matte smoothstep — so
 * this only has to transcode, never re-upscale.
 */
/**
 * Flat UI sets: the control panel (+ options) and the end credits.
 *
 * Unlike rooms these have no per-picture layout — one directory of PNGs staged by
 * stage-ui.mjs, one WebP out per file, at the base scale (UI art is drawn at the stage
 * scale, never a room scale). `ai.json` lists what was written so the runtime does not
 * have to guess filenames or the scale, exactly like a room manifest.
 */
function buildUi(which, report) {
  const srcDir = join(srcRoot, `_${which}`);
  const dstDir = join(outRoot, `_${which}`);
  if (!existsSync(srcDir)) { console.warn(`  ! no staged art for _${which} (run tools/studio/stage-ui.mjs)`); return false; }
  const covered = new Map();
  for (const h of index[which] || []) {
    for (const u of index.pictures[h]?.uses || []) if (u.room === `_${which}`) covered.set(u.file, h);
  }
  const files = listPngs(srcDir).sort();
  const stampFile = join(dstDir, '.build-stamp.json');
  const prev = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : {};
  const next = {};
  let wrote = 0, skipped = 0;
  const written = [];
  for (const rel of files) {
    const srcAbs = join(srcDir, rel);
    let hash = covered.get(rel);
    let alpha;
    if (hash && index.pictures[hash]) alpha = index.pictures[hash].alpha;
    else { hash = hashFile(srcAbs); alpha = true; report.unindexed++; }
    const out = webpName(rel);
    const outAbs = join(dstDir, out);
    written.push(out);
    const want = stampFor(hash, alpha, selections[hash] || defaultModelId, SCALE);
    if (!FORCE && existsSync(outAbs) && prev[out] === want) { next[out] = prev[out]; skipped++; continue; }
    next[out] = emit(srcAbs, outAbs, hash, alpha, report, SCALE);
    wrote++;
  }
  if (!DRY) {
    mkdirSync(dstDir, { recursive: true });
    writeFileSync(join(dstDir, 'ai.json'), JSON.stringify({ scale: SCALE, files: written.sort() }));
    // Carry the group's geometry sidecar (e.g. _desky/plaques.json: where each plaque
    // sits on the map) into the tier, so the runtime does not have to parse the
    // original .dat files a second time to place upscaled art.
    for (const f of readdirSync(srcDir)) {
      if (f.endsWith('.json')) copyFileSync(join(srcDir, f), join(dstDir, f));
    }
    writeFileSync(stampFile, JSON.stringify(next));
    // Drop art from an earlier staging that no longer exists upstream.
    for (const f of readdirSync(dstDir)) {
      if (f.endsWith('.webp') && !written.includes(f)) rmSync(join(dstDir, f), { force: true });
    }
  }
  console.log(`  _${which}: ${wrote} written, ${skipped} unchanged (${written.length} files, x${SCALE})`);
  return true;
}

/**
 * The briefcase cutscene: the static canvas plus every materialised animation frame.
 *
 * Separate from buildUi because the frames live in a subdirectory and are deliberately
 * NOT indexed — an animation must use ONE model for all of them or it flickers between
 * styles, so the Studio curates it through the single representative `anim.png` and
 * every frame inherits that pick.
 */
function buildKufr(report) {
  const srcDir = join(srcRoot, '_kufr');
  const dstDir = join(outRoot, '_kufr');
  const framesSrc = join(srcDir, 'frames');
  if (!existsSync(framesSrc)) {
    console.warn('  ! no staged briefcase frames (run: npx tsx tools/studio/stage-kufr.ts)');
    return false;
  }
  // Resolve the two curated cards to their picks.
  const cardModel = (file) => {
    for (const h of index.kufr || []) {
      for (const u of index.pictures[h]?.uses || []) {
        if (u.room === '_kufr' && u.file === file) return { hash: h, model: selections[h] || defaultModelId };
      }
    }
    return null;
  };
  const base = cardModel('base.png');
  const anim = cardModel('anim.png');
  if (!base || !anim) { console.warn('  ! _kufr: base.png/anim.png are not indexed'); return false; }

  const stampFile = join(dstDir, '.build-stamp.json');
  const prev = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : {};
  const next = {};
  let wrote = 0, skipped = 0, failed = 0;

  const one = (srcAbs, outAbs, key, hash, model) => {
    const want = stampFor(hash, false, model, SCALE);
    if (!FORCE && existsSync(outAbs) && prev[key] === want) { next[key] = prev[key]; skipped++; return; }
    // The frames are not in selections (they are not indexed), and emit() resolves the
    // model through it — so pin this frame's model in memory for the call. NEVER saved:
    // selections.json is hand-curated state and the build only reads it.
    const had = Object.prototype.hasOwnProperty.call(selections, hash);
    const before = selections[hash];
    selections[hash] = model;
    try {
      next[key] = emit(srcAbs, outAbs, hash, false, report, SCALE);
      wrote++;
    } catch (e) {
      console.error(`  ! ${key}: ${e.message}`);
      failed++;
    } finally {
      if (had) selections[hash] = before; else delete selections[hash];
    }
  };

  if (!DRY) mkdirSync(join(dstDir, 'frames'), { recursive: true });
  one(join(srcDir, 'base.png'), join(dstDir, 'base.webp'), 'base.webp', base.hash, base.model);
  const frames = listPngs(framesSrc).sort();
  for (const f of frames) {
    const srcAbs = join(framesSrc, f);
    one(srcAbs, join(dstDir, 'frames', webpName(f)), `frames/${webpName(f)}`, hashFile(srcAbs), anim.model);
  }
  if (!DRY) {
    // The playback order + region geometry the runtime replays.
    const meta = JSON.parse(readFileSync(join(srcDir, 'frames.json'), 'utf8'));
    writeFileSync(join(dstDir, 'ai.json'), JSON.stringify({
      scale: SCALE,
      region: meta.region,
      base: meta.base,
      order: meta.order.map(webpName),
      frames: frames.map(webpName),
    }));
    writeFileSync(stampFile, JSON.stringify(next));
  }
  console.log(`  _kufr: ${wrote} written, ${skipped} unchanged${failed ? `, ${failed} FAILED` : ''} (base=${base.model}, frames=${anim.model}, x${SCALE})`);
  return failed === 0;
}

const MENU_ASSETS = [
  { name: 'mapa-0', out: 'mapa-0_ai.webp', kind: 'layer' },
  { name: 'mapa-1', out: 'mapa-1_ai.webp', kind: 'layer' },
  { name: 'krokomer', out: 'krokomer_ai.webp', kind: 'layer' },
  { name: 'ikonky', out: 'ikonky_ai.webp', kind: 'layer' },
  { name: 'n0', out: 'n0_ai.png', kind: 'sprite' },
  { name: 'n1', out: 'n1_ai.png', kind: 'sprite' },
  { name: 'n2', out: 'n2_ai.png', kind: 'sprite' },
  { name: 'n3', out: 'n3_ai.png', kind: 'sprite' },
  { name: 'n4', out: 'n4_ai.png', kind: 'sprite' },
];
const WEBP_Q = String(process.env.WEBP_Q || 92);

/**
 * The shared fish set. Rooms now render at DIFFERENT scales, and the fish are drawn
 * into the room's own ×S composite, so the set must exist at every scale in use —
 * one subdir per scale (_fish/x4, x5, …). Cheap: the whole set is ~2.8 MB at ×4.
 */
function buildFish(byRoom, report) {
  const srcDir = join(srcRoot, '_fish');
  if (!existsSync(srcDir)) { console.error('  ! no source art for _fish'); return false; }
  // Scales come from EVERY indexed room, not just the ones being built: the fish set is
  // shared, so a partial build (`--fish`, or one room) must still cover every scale the
  // game can ask for. Deriving them from `list` meant `--fish` saw no rooms at all, so
  // the stale-set cleanup below deleted every x<N> directory and wrote nothing back.
  const rooms = Object.keys(index.rooms).filter((r) => !roomSkip.has(r));
  const scales = [...new Set(rooms.map(roomScale))].sort();
  const files = listPngs(srcDir);
  const covered = byRoom.get('_fish') || new Map();
  let wrote = 0, skipped = 0;
  for (const scale of scales) {
    const dstDir = join(outRoot, '_fish', `x${scale}`);
    const stampFile = join(dstDir, '.build-stamp.json');
    const prev = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : {};
    const next = {};
    for (const rel of files) {
      const srcAbs = join(srcDir, rel);
      let hash = covered.get(rel), alpha;
      if (hash && index.pictures[hash]) alpha = index.pictures[hash].alpha;
      else { hash = hashFile(srcAbs); alpha = true; report.unindexed++; }
      const out = webpName(rel);
      const outAbs = join(dstDir, out);
      const want = stampFor(hash, alpha, selections[hash] || defaultModelId, scale);
      if (!FORCE && existsSync(outAbs) && prev[out] === want) { next[out] = prev[out]; skipped++; continue; }
      next[out] = emit(srcAbs, outAbs, hash, alpha, report, scale);
      wrote++;
    }
    if (!DRY) {
      mkdirSync(dstDir, { recursive: true });
      const mf = join(srcDir, 'manifest.json');
      if (existsSync(mf)) {
        // Same shape as the source manifest, with the shipped WebP names.
        const m = JSON.parse(readFileSync(mf, 'utf8'));
        for (const size of Object.keys(m)) for (const facing of Object.keys(m[size] || {})) {
          m[size][facing] = (m[size][facing] || []).map(webpName);
        }
        writeFileSync(join(dstDir, 'manifest.json'), JSON.stringify(m));
      }
      writeFileSync(stampFile, JSON.stringify(next));
    }
  }
  // A pre-adaptive build left the set loose in _fish/ — clear it so only x<N>/ remain.
  if (!DRY) {
    for (const f of listPngs(join(outRoot, '_fish'))) {
      if (!/^x\d+\//.test(f)) rmSync(join(outRoot, '_fish', f), { force: true });
    }
    rmSync(join(outRoot, '_fish', 'manifest.json'), { force: true });
    // Drop sets for scales no room asks for any more (e.g. after turning ADAPTIVE_SCALE
    // off): they would otherwise ship as dead weight the runtime never loads.
    const fishRoot = join(outRoot, '_fish');
    if (existsSync(fishRoot)) {
      for (const d of readdirSync(fishRoot)) {
        const m = /^x(\d+)$/.exec(d);
        if (m && !scales.includes(Number(m[1]))) rmSync(join(fishRoot, d), { recursive: true, force: true });
      }
    }
  }
  console.log(`  _fish: ${wrote} written, ${skipped} unchanged (scales ${scales.map((s) => 'x' + s).join(', ')})`);
  return true;
}

function buildMenu(byRoom, report) {
  const srcDir = join(srcRoot, '_menu');
  const dstDir = join(root, 'public', 'data', 'Menu');
  if (!existsSync(srcDir)) {
    console.error('  ! public/enhanced/_menu missing — run: node tools/studio/stage-menu.mjs');
    return false;
  }
  const covered = byRoom.get('_menu') || new Map();
  const stampFile = join(dstDir, '.build-stamp.json');
  const prev = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, 'utf8')) : {};
  const next = { ...prev };
  let wrote = 0, skipped = 0, failed = 0;
  for (const a of MENU_ASSETS) {
    const rel = `${a.name}.png`;
    const srcAbs = join(srcDir, rel);
    if (!existsSync(srcAbs)) { console.warn(`  ! ${rel} not staged, skipping`); continue; }
    const hash = covered.get(rel) || hashFile(srcAbs);
    const pic = index.pictures[hash];
    const alpha = pic ? pic.alpha : a.kind === 'sprite';
    const outAbs = join(dstDir, a.out);
    const want = stampFor(hash, alpha, selections[hash] || defaultModelId) + `:q${WEBP_Q}`;
    if (!FORCE && existsSync(outAbs) && prev[a.out] === want) { next[a.out] = want; skipped++; continue; }
    if (DRY) { report.generated += 0; next[a.out] = want; wrote++; continue; }
    const { png, model, planned } = variantFor(hash, srcAbs, alpha, report);
    if (!planned) assertScaled(srcAbs, png, hash);
    if (a.kind === 'layer') {
      // A failed encode must FAIL the target: silently continuing would leave the
      // previous (or no) asset shipped while the build still reported success.
      // It must NOT delete the previous asset, though — toWebp publishes via rename, so
      // on failure the old file is still intact and valid. Removing it turned a loud,
      // recoverable build failure into a MISSING asset, which at runtime is the silent
      // tier-fallback bug class. `next[a.out]` is left unset either way, so the next
      // build retries this target.
      try {
        toWebp(png, outAbs);
      } catch (e) {
        console.error(`  ! ${a.out}: ${e.message}`);
        failed++;
        continue;
      }
    } else {
      copyFileSync(png, outAbs); // already the matted RGBA ×4 sprite
    }
    // Record the model ACTUALLY used, so a substituted build retries next time.
    next[a.out] = stampFor(hash, alpha, model) + `:q${WEBP_Q}`;
    wrote++;
  }
  if (!DRY) writeFileSync(stampFile, JSON.stringify(next));
  console.log(`  _menu: ${wrote} written, ${skipped} unchanged${failed ? `, ${failed} FAILED` : ''} (${MENU_ASSETS.length} assets) → public/data/Menu`);
  return failed === 0;
}

function main() {
  const byRoom = invertIndex();
  const rooms = argv.filter((a) => !a.startsWith('--'));
  const all = flag('all');
  const fishOnly = flag('fish') && rooms.length === 0 && !all;
  const menuOnly = flag('menu') && rooms.length === 0 && !all;
  const uiOnly = flag('ui') && rooms.length === 0 && !all;

  // The default must be generatable — but only if we would actually have to GENERATE
  // with it. Downgrading purely because the binary is absent rebuilt already-cached
  // cugan_c pictures as nearest-neighbour `orig` art, silently changing the shipped
  // tier on any machine without the upscaler backends configured. variantFor already
  // falls back per-picture when a variant is genuinely missing and cannot be made, so
  // the safe rule here is: keep the configured default, and only warn.
  try {
    const av = availableModels(getBins());
    if (!av.some((m) => m.id === defaultModelId)) {
      console.warn(`Default model "${defaultModelId}" has no configured backend; cached variants will be used, and any picture that needs generating will fall back per-picture.`);
    }
  } catch { /* no backend configured: fine as long as everything is cached */ }

  if (typeof contour.superscale === 'number' && contour.superscale !== SCALE) {
    console.warn(`NOTE superscale=${contour.superscale} is a Studio-preview setting only; the shipped tier is ×${SCALE} (src/render/roomAi.ts AI_ROOM_SCALE).`);
  }

  let list;
  if (menuOnly) list = ['_menu'];
  else if (uiOnly) list = ['_panel', '_credits', '_story', '_desky', '_kufr'];
  else if (fishOnly) list = ['_fish'];
  else if (all) list = [...Object.keys(index.rooms), '_fish', '_menu', '_panel', '_credits', '_story', '_desky', '_kufr'];
  else if (rooms.length) list = rooms;
  else { console.error('Usage: node tools/studio/build-ai.mjs <ROOM…> | --all | --fish | --menu | --ui  [--force] [--dry-run]\n  --ui builds _panel, _credits, _story, _desky and _kufr'); process.exit(1); }

  const report = { substituted: 0, generated: 0, thinned: 0, unindexed: 0, skipped: 0 };
  const t0 = Date.now();
  console.log(`Building ${list.length} target(s) → ${outRoot}${DRY ? ' (dry run)' : ''}`);
  let okCount = 0;
  for (const r of list) {
    const ok = r === '_menu' ? buildMenu(byRoom, report)
      : r === '_kufr' ? buildKufr(report)
        : r === '_panel' || r === '_credits' || r === '_story' || r === '_desky' ? buildUi(r.slice(1), report)
          : r === '_fish' ? buildFish(byRoom, report)
            : buildRoom(r, byRoom, report);
    if (ok) okCount++;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Done: ${okCount}/${list.length} targets in ${secs}s · contour-thinned ${report.thinned} · substituted ${report.substituted} · generated ${report.generated} · unindexed ${report.unindexed} · skipped ${report.skipped}`);
  // A failed target must FAIL the process. The Studio's build endpoint reports success
  // purely from the exit status, so returning 0 here made a build with missing art look
  // like a clean run.
  if (okCount !== list.length) process.exitCode = 1;
}

main();
