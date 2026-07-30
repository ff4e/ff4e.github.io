/**
 * Upscaler Studio — local web app to curate per-picture upscaler choices across
 * all rooms and build the final AI room graphics. Phase 1–2: asset index, room /
 * picture browsing, on-demand per-picture generation, and per-picture selection.
 * Preview (Phase 4) and build (Phase 5) endpoints are wired but may be stubs.
 *
 * Run: REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan node tools/studio/server.mjs
 *      (optional PORT, default 8109). Then open http://localhost:8109/.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { buildAndSave, writeJsonAtomic } from './lib/index.mjs';
import { MODELS, requireBins, availableModels, decodePngRgba, encodePngRgba, compositeOver, thinOutline, stretchToBBox, seamFill, smoothEdges, downscaleRgba, FSIZE, SCALE, MAX_SCALE, scaleForRoomSize, variantName } from './lib/upscale.mjs';

const studioDir = dirname(fileURLToPath(import.meta.url));
const root = join(studioDir, '..', '..');
const publicDir = join(studioDir, 'public');
const cacheDir = join(studioDir, 'cache');
const indexFile = join(studioDir, 'index.json');
const selFile = join(studioDir, 'selections.json');
const PORT = Number(process.env.PORT || 8109);
// Model used when a picture has no explicit pick (shown pre-selected in the UI
// and used as the fallback at build time). Override with STUDIO_DEFAULT_MODEL.
// Real-CUGAN conservative: keeps line art thin instead of the heavier outline
// the Real-ESRGAN anime models produce.
let DEFAULT_MODEL = process.env.STUDIO_DEFAULT_MODEL || 'cugan_c';

mkdirSync(cacheDir, { recursive: true });

// ---- state ---------------------------------------------------------------
let index = loadOrBuildIndex();
let selections = existsSync(selFile) ? JSON.parse(readFileSync(selFile, 'utf8')) : {};
// Contour-fade strength per picture: thins the dark silhouette outline by fading
// it into transparency (see fadeOutline). s=0 → untouched (default), 1 → max.
const contourFile = join(studioDir, 'contours.json');
let contour = existsSync(contourFile) ? JSON.parse(readFileSync(contourFile, 'utf8')) : { global: 0, byHash: {} };
if (typeof contour.global !== 'number') contour.global = 0;
if (!contour.byHash || typeof contour.byHash !== 'object') contour.byHash = {};
// Global net scale (supersample→downscale). SCALE (=4) = AI native, no downscale;
// smaller = downsample the ×SCALE render to a lower net scale → proportionally
// thinner, cleanly anti-aliased contours. Clamped to [1, SCALE].
if (typeof contour.superscale !== 'number') contour.superscale = SCALE;
contour.superscale = Math.max(1, Math.min(SCALE, contour.superscale));
// Edge-smoothing params (applied after thin→stretch when thinning is active).
// sigma = blur radius (0 = smoother off); crisp = how hard to re-sharpen the
// blurred alpha back toward binary (0 = soft AA, 1 = near-binary, no fringe).
if (typeof contour.smoothSigma !== 'number') contour.smoothSigma = 1.0;
if (typeof contour.smoothCrisp !== 'number') contour.smoothCrisp = 0.5;
contour.smoothSigma = Math.max(0, Math.min(4, contour.smoothSigma));
contour.smoothCrisp = Math.max(0, Math.min(1, contour.smoothCrisp));
// Seam-fill radius (ORIGINAL px): restore original artwork within this distance of
// a seam between two near-touching participants, closing the sliver contour
// thinning opens between them. Consumed only as seamFill()'s `R`. Dormant (0)
// since the contour feature was abandoned.
if (typeof contour.stretchOver !== 'number') contour.stretchOver = 0;
contour.stretchOver = Math.max(0, Math.min(4, contour.stretchOver));
// Backends actually installed on this machine — optional engines (Real-CUGAN,
// APISR) simply don't appear in the UI when their binary isn't configured.
let AVAILABLE_MODELS = MODELS;
try { AVAILABLE_MODELS = availableModels(requireBins()); } catch { /* esrgan missing: surface all, generation will error */ }
// User-defined GLOBAL display order of the algorithms (edited in the Compare
// screen). Stored as a list of model ids; ids not listed (e.g. a newly added
// backend) keep their built-in relative order and are appended at the end.
const orderFile = join(studioDir, 'modelorder.json');
let modelOrder = [];
if (existsSync(orderFile)) { try { const o = JSON.parse(readFileSync(orderFile, 'utf8')); if (Array.isArray(o.order)) modelOrder = o.order; } catch { /* ignore */ } }
/**
 * Write JSON state atomically: temp file in the SAME directory, then rename (which is
 * atomic on the same filesystem). These files hold hand-curated work — selections.json
 * alone is ~2000 per-picture decisions that cannot be regenerated — and a plain
 * writeFileSync truncates the real file first, so a crash or a full disk mid-write
 * destroys all of it.
 *
 * Re-exported from lib/index.mjs so the build tooling and the server share ONE
 * implementation (index.json used to be written non-atomically by the other path).
 */
const saveJsonAtomic = writeJsonAtomic;

function saveModelOrder() { saveJsonAtomic(orderFile, { order: modelOrder }); }
function applyModelOrder() {
  const rank = new Map(modelOrder.map((id, i) => [id, i]));
  const base = availableBase();
  AVAILABLE_MODELS = base.slice().sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : rank.size + base.indexOf(a);
    const rb = rank.has(b.id) ? rank.get(b.id) : rank.size + base.indexOf(b);
    return ra - rb;
  });
}
function availableBase() { try { return availableModels(requireBins()); } catch { return MODELS; } }applyModelOrder();
// The default must actually be generatable on this machine (its backend may not
// be installed) — otherwise fall back so previews/builds don't silently degrade.
if (!AVAILABLE_MODELS.some((m) => m.id === DEFAULT_MODEL)) {
  const fb = AVAILABLE_MODELS.find((m) => m.id === 'av3') || AVAILABLE_MODELS.find((m) => m.id !== 'orig');
  console.warn(`Default model "${DEFAULT_MODEL}" is unavailable → falling back to "${fb ? fb.id : 'orig'}".`);
  DEFAULT_MODEL = fb ? fb.id : 'orig';
}
const runningJobs = new Set(); // job keys (hash@scale) currently generating
// Current/last `ai` graphics-tier build (public/enhanced-ai). One at a time.
let buildJob = { running: false, target: null, log: [], startedAt: 0, error: null, code: null };
/** The in-flight build child, so shutdown can stop it mid-write. */
let buildChild = null;

function loadOrBuildIndex() {
  if (existsSync(indexFile)) { try { return JSON.parse(readFileSync(indexFile, 'utf8')); } catch { /* rebuild */ } }
  console.log('Building asset index…');
  const idx = buildAndSave(root, indexFile);
  console.log(`Index: ${Object.keys(idx.pictures).length} distinct pictures, ${Object.keys(idx.rooms).length} rooms.`);
  return idx;
}
function saveSelections() { saveJsonAtomic(selFile, selections); }
// Rooms deliberately EXCLUDED from the ai tier. Some rooms (TETRIS, ZX, SCHODY…)
// are built from FFNG's original indexed pixel art, which no upscaler improves —
// they read better in the enhanced render. The runtime already falls back to
// enhanced when a room's AI art is missing (loadAiRoom → null), so "skip" simply
// means: don't build it, and delete anything previously built.
const skipFile = join(studioDir, 'roomskip.json');
let roomSkip = new Set();
if (existsSync(skipFile)) {
  try { const j = JSON.parse(readFileSync(skipFile, 'utf8')); if (Array.isArray(j.rooms)) roomSkip = new Set(j.rooms); } catch { /* ignore */ }
}
function saveRoomSkip() { saveJsonAtomic(skipFile, { rooms: [...roomSkip] }); }
// Level numbers for the nav, read from the game's own room table so the Studio
// lists rooms in play order instead of alphabetically. Rooms absent from the
// table (or if it can't be read) sort last, alphabetically.
const ROOM_NUM = (() => {
  const map = new Map();
  try {
    const src = readFileSync(join(root, 'src', 'data', 'roomTable.ts'), 'utf8');
    for (const m of src.matchAll(/num:\s*(\d+)\s*,\s*jmeno:\s*"([A-Z0-9_]+)"/g)) map.set(m[2], Number(m[1]));
  } catch { /* nav just falls back to alphabetical */ }
  return map;
})();function saveContours() { saveJsonAtomic(contourFile, contour); }
// Effective contour-fade strength: per-hash override, else global default.
function effContour(hash) { const v = contour.byHash[hash]; return typeof v === 'number' ? v : contour.global; }

/** Variant files present on disk for a hash + running status. */
function variantStatus(hash, scale = SCALE) {
  const dir = join(cacheDir, hash);
  // Variants above ×4 are suffixed `@<scale>`; list only the ones for THIS scale so
  // the UI never reports a ×4 render as if it were the shipped ×8 one.
  const suffix = scale === SCALE ? '' : `@${scale}`;
  const re = new RegExp(`^(.+?)${suffix ? `@${scale}` : ''}\\.png$`);
  const have = existsSync(dir)
    ? readdirSync(dir)
      // Skip dotfiles: a worker's in-progress `.<model>@<scale>.tmp.png` must never be
      // reported as a finished variant (the rename to the real name is the commit).
      .filter((f) => !f.startsWith('.') && f.endsWith('.png'))
      .filter((f) => (suffix ? f.endsWith(`${suffix}.png`) : !/@\d+\.png$/.test(f)))
      .map((f) => (re.exec(f) || [])[1])
      .filter(Boolean)
    : [];
  let status = null;
  const sf = join(dir, scale === SCALE ? '.status.json' : `.status@${scale}.json`);
  if (existsSync(sf)) { try { status = JSON.parse(readFileSync(sf, 'utf8')); } catch { /* ignore */ } }
  // running is server-authoritative (isPending); the on-disk status.running can
  // be stale if a worker was killed, so we do NOT trust it here.
  const k = jobKey(hash, scale);
  return { have, running: isPending(hash, scale), status, queued: queued.has(k) && !runningJobs.has(k) };
}

// ---- picture / room shaping ---------------------------------------------
/**
 * Record an abnormal worker termination in the same `.status.json` the worker itself
 * writes, so the client poller sees an error and stops. Without this, a killed or
 * crashed worker just vanished: `running` went false via isPending but no error was
 * ever published, and the card polled forever.
 */
function setWorkerError(hash, scale, message) {
  const dir = join(cacheDir, hash);
  if (!existsSync(dir)) return;
  const sf = join(dir, scale === SCALE ? '.status.json' : `.status@${scale}.json`);
  let prev = {};
  if (existsSync(sf)) { try { prev = JSON.parse(readFileSync(sf, 'utf8')); } catch { /* ignore */ } }
  try { writeJsonAtomic(sf, { ...prev, running: false, error: message }); } catch { /* cache may be gone */ }
}

/**
 * The scale this room actually ships at. Same rule and same source dimensions as
 * build-ai.mjs (the room background's native size), via the shared helper, so the
 * Studio can never claim a different scale than the build produces.
 */
const roomScaleCache = new Map();
function roomScaleOf(room) {
  if (roomScaleCache.has(room)) return roomScaleCache.get(room);
  const rec = index.rooms[room];
  const bg = rec && rec.bg ? index.pictures[rec.bg] : null;
  const s = bg ? scaleForRoomSize(bg.w, bg.h) : SCALE;
  roomScaleCache.set(room, s);
  return s;
}

/** Every scale a picture is shipped at (it can appear in rooms of different sizes). */
function scalesForPicture(p) {
  const set = new Set();
  for (const u of p.uses || []) {
    // _fish/_menu aren't rooms: fish ship at EVERY room scale, menu art only at ×4.
    if (u.room === '_fish') { for (const r of Object.keys(index.rooms)) set.add(roomScaleOf(r)); continue; }
    // UI art (menu / control panel / credits / story pages / the briefcase cutscene) is
    // drawn at the stage scale, not a room scale, so it is always built at the base factor.
    if (u.room === '_menu' || u.room === '_panel' || u.room === '_credits'
      || u.room === '_story' || u.room === '_kufr') { set.add(SCALE); continue; }
    if (index.rooms[u.room]) set.add(roomScaleOf(u.room));
  }
  if (!set.size) set.add(SCALE);
  return [...set].sort((a, b) => a - b);
}

function picMeta(hash, scale = SCALE) {
  const p = index.pictures[hash];
  if (!p) return null;
  const rooms = [...new Set(p.uses.map((u) => u.room))];
  const vs = variantStatus(hash, scale);
  return {
    hash, kind: p.kind, w: p.w, h: p.h, alpha: p.alpha, sample: p.sample,
    rooms, shared: rooms.filter((r) => r !== '_fish').length + (rooms.includes('_fish') ? 0 : 0),
    roomCount: rooms.length, selected: selections[hash] || null,
    explicit: !!selections[hash], effective: selections[hash] || DEFAULT_MODEL,
    contour: effContour(hash), contourSet: typeof contour.byHash[hash] === 'number',
    have: vs.have, running: vs.running, queued: vs.queued, status: vs.status,
    scales: scalesForPicture(p), maxScale: Math.max(...scalesForPicture(p)), scale,
  };
}
// Group a flat list of hashes into object-style batch cards by animation base
// name (frames like body_rest_00/01/02 → one card whose pick applies to all).
// keyOf(picture) returns the grouping key + display name for a hash's picture.
function groupHashes(hashes, keyOf) {
  const groups = new Map();
  for (const hash of hashes) {
    const p = index.pictures[hash];
    if (!p) continue;
    const { key, name } = keyOf(p, hash);
    let g = groups.get(key);
    if (!g) { g = { name, frames: [] }; groups.set(key, g); }
    if (!g.frames.includes(hash)) g.frames.push(hash);
  }
  return [...groups.values()].map((g) => {
    const framesSelected = g.frames.filter((h) => selections[h]).length;
    return { role: 'object', object: g.name, frames: g.frames, framesSelected, ...picMeta(g.frames[0]) };
  });
}

function fishCards() {
  return groupHashes(index.fish, (p, hash) => {
    const use = p.uses.find((u) => u.room === '_fish') || p.uses[0];
    const file = (use && use.file) || hash;               // e.g. big/left/body_rest_00.png
    const key = file.replace(/_\d+\.png$/, '').replace(/\.png$/, ''); // big/left/body_rest
    return { key, name: key };
  }).sort((a, b) => a.object.localeCompare(b.object));
}

function menuCards() {
  // One card per menu picture, in the order build-map-ai.mjs composites them.
  const ORDER = ['mapa-0', 'mapa-1', 'maska', 'krokomer', 'ikonky', 'n0', 'n1', 'n2', 'n3', 'n4'];
  return groupHashes(index.menu || [], (p, hash) => {
    const use = p.uses.find((u) => u.room === '_menu') || p.uses[0];
    const key = ((use && use.file) || hash).replace(/\.png$/, '');
    return { key, name: key };
  }).sort((a, b) => {
    const ia = ORDER.indexOf(a.object), ib = ORDER.indexOf(b.object);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.object.localeCompare(b.object);
  });
}

/**
 * Cards for a flat shared set (_panel / _credits): one card per file, in filename
 * order. Unlike the fish/menu helpers these are NOT grouped into animations — each
 * panel colour-variant and each credits layer is an independent decision.
 */
function flatCards(which) {
  return (index[which] || []).map((hash) => {
    const p = index.pictures[hash];
    if (!p) return null;
    const use = (p.uses || []).find((u) => u.room === `_${which}`) || (p.uses || [])[0];
    const name = (use && use.object) || hash.slice(0, 8);
    return { role: 'object', object: name, frames: [hash], framesSelected: selections[hash] ? 1 : 0, ...picMeta(hash) };
  }).filter(Boolean);
}

function roomDetail(room) {
  const rec = index.rooms[room];
  if (!rec) return null;
  const pics = [];
  if (rec.bg) pics.push({ role: 'background', ...picMeta(rec.bg) });
  if (rec.wall) pics.push({ role: 'wall', ...picMeta(rec.wall) });
  // Collapse repeated placements of the same graphic (identical frame hashes)
  // into one card — the algo decision is content-hash keyed, so it applies to
  // every placement. `placements` records how many times it's used in the room.
  const byKey = new Map();
  for (const obj of rec.objects) {
    const key = obj.frames.join(',');
    let card = byKey.get(key);
    if (!card) {
      const h0 = obj.frames[0];
      const framesSelected = obj.frames.filter((h) => selections[h]).length;
      card = { role: 'object', object: obj.name, item: obj.item, x: obj.x, y: obj.y, frames: obj.frames, framesSelected, placements: 0, ...picMeta(h0) };
      byKey.set(key, card);
      pics.push(card);
    }
    card.placements++;
  }
  return { room, scale: roomScaleOf(room), pictures: pics };
}
function roomProgress(room) {
  const d = roomDetail(room);
  if (!d) return { total: 0, selected: 0 };
  const total = d.pictures.length;
  const selected = d.pictures.filter((p) => p.selected).length;
  return { total, selected };
}

// ---- room preview compositor --------------------------------------------
// Assemble the whole room from ALREADY-CACHED variants (each layer's effective
// model = explicit pick, else DEFAULT_MODEL), no ncnn re-run. Missing layers
// fall back to orig cache, else the source PNG nearest-scaled ×SCALE so the
// preview always renders. Returns { rgba, w, h, missing:[...] }.
function nnScale(src, w, h, s) {
  const W = w * s, H = h * s;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = (y / s) | 0;
    for (let x = 0; x < W; x++) {
      const sx = (x / s) | 0;
      const si = (sy * w + sx) * 4, di = (y * W + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return { rgba: out, w: W, h: H };
}
function resolveLayer(hash, missing, mode, scale = SCALE) {
  const p = index.pictures[hash];
  if (!p) return null;
  const srcNN = () => { const s = decodePngRgba(join(root, 'public', p.sample)); const r = nnScale(s.rgba, s.w, s.h, scale); r.orig = r.rgba; return r; };
  if (mode === 'orig') return srcNN(); // original room: raw source, nearest-scaled ×SCALE
  const dir = join(cacheDir, hash);
  const want = selections[hash] || DEFAULT_MODEL;
  const origPng = join(dir, variantName('orig', scale));
  // An explicit "orig" pick is honoured as-is (NN reference, no thinning).
  if (want === 'orig') {
    if (existsSync(origPng)) { const d = decodePngRgba(origPng); return { ...d, orig: d.rgba }; }
    return srcNN();
  }
  // Prefer the effective pick, but if it isn't generated yet fall back to ANY
  // other cached AI variant before dropping to the NN reference — otherwise
  // changing the default model visibly degrades every not-yet-regenerated
  // picture to nearest-neighbour.
  let eff = null;
  for (const id of [want, ...AVAILABLE_MODELS.map((m) => m.id)]) {
    if (id === 'orig') continue;
    if (existsSync(join(dir, variantName(id, scale)))) { eff = id; break; }
  }
  if (eff) {
    if (eff !== want) missing.push({ hash, why: `${want} not generated, used ${eff}` });
    const m = decodePngRgba(join(dir, variantName(eff, scale)));
    const s = effContour(hash);
    if (s > 0 && p.alpha) {
      const thinned = thinOutline(m.rgba, m.w, m.h, s);
      const sprite = stretchToBBox(thinned, m.rgba, m.w, m.h);
      // orig = pre-thinning silhouette so the room compositor can seam-fill contacts
      return { rgba: smoothEdges(sprite, m.w, m.h, contour.smoothSigma, contour.smoothCrisp), w: m.w, h: m.h, orig: m.rgba };
    }
    return { ...m, orig: m.rgba };
  }
  if (existsSync(origPng)) { missing.push({ hash, why: 'no variant, used orig' }); const d = decodePngRgba(origPng); return { ...d, orig: d.rgba }; }
  // Nothing cached → nearest-scale the source so the preview still assembles.
  missing.push({ hash, why: 'not generated, used NN source' });
  return srcNN();
}
function composePreview(room, mode = 'ai', scale = SCALE) {
  const rec = index.rooms[room];
  if (!rec || !rec.bg) return null;
  const missing = [];
  const bg = resolveLayer(rec.bg, missing, mode, scale);   // opaque base canvas
  const W = bg.w, H = bg.h;
  const base = bg.rgba;
  const layers = []; // object + wall layers (orig + thinned masks) for composite seam-fill
  if (rec.wall) {
    const wall = resolveLayer(rec.wall, missing, mode, scale);
    if (wall) {
      compositeOver(base, W, H, { ...wall, dx: 0, dy: 0 });
      // The wall is a seam participant too: most objects sit against the wall,
      // not against another object, so their gap is an object↔wall seam. (bg is
      // NOT a participant — it's the full canvas, so it would match every free
      // edge and thicken the whole outline back.)
      if (wall.orig) layers.push({ rgba: wall.rgba, orig: wall.orig, w: wall.w, h: wall.h, dx: 0, dy: 0 });
    }
  }
  for (const obj of rec.objects) {
    const h0 = obj.frames && obj.frames[0];
    if (!h0) continue;
    const spr = resolveLayer(h0, missing, mode, scale);
    if (!spr) continue;
    const dx = Math.round((obj.x || 0) * FSIZE * scale);
    const dy = Math.round((obj.y || 0) * FSIZE * scale);
    if (spr.orig) layers.push({ rgba: spr.rgba, orig: spr.orig, w: spr.w, h: spr.h, dx, dy });
    compositeOver(base, W, H, { ...spr, dx, dy });
  }
  // Fill the seams where a thinned object meets another object OR the wall
  // (thinning opened a bg sliver there); free outer edges stay thin. Composite-only.
  if (mode !== 'orig' && contour.stretchOver > 0) seamFill(base, W, H, layers, Math.round(contour.stretchOver * scale));
  return { rgba: base, w: W, h: H, missing };
}

// ---- HTTP ----------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml' };
function sendJson(res, obj, code = 200) { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'content-type': 'application/json', 'content-length': b.length }); res.end(b); }
function sendFile(res, abs) {
  if (!existsSync(abs) || !statSync(abs).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const b = readFileSync(abs);
  res.writeHead(200, { 'content-type': MIME[extname(abs)] || 'application/octet-stream', 'content-length': b.length, 'cache-control': 'no-cache' });
  res.end(b);
}
/**
 * Serve `rel` from under `rootDir`, refusing anything that escapes it. The request
 * path has already been percent-decoded by the caller, so `normalize()` on its own
 * is not a defence — resolve the join and require the result to stay inside the
 * root (a plain prefix test would also let `<root>-evil` through, hence the sep).
 */
function sendFileUnder(res, rootDir, rel) {
  const base = resolve(rootDir);
  const abs = resolve(base, rel.replace(/^[/\\]+/, ''));
  if (abs !== base && !abs.startsWith(base + sep)) { res.writeHead(403); res.end('forbidden'); return; }
  return sendFile(res, abs);
}
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }

// ---- generation queue (bounded concurrency) ------------------------------
// Each worker runs every configured model sequentially for one hash, so even 1
// concurrent worker keeps the GPU busy. "Generate all" on 124 fish must NOT
// spawn 124 processes at once (that overloads the machine) — so we queue.
const MAX_JOBS = Math.max(1, Number(process.env.STUDIO_CONCURRENCY || 1));
const jobQueue = [];        // { hash, scale } waiting
const queued = new Set();   // job keys in queue or running (dedupe)
const childProcs = new Map(); // job key (hash@scale) -> ChildProcess (running workers)

/** Queue identity is the picture AND the scale — the same art at ×4 and ×8 are two jobs. */
const jobKey = (hash, scale) => `${hash}@${scale}`;

function enqueueJob(hash, scale = SCALE) {
  if (!index.pictures[hash]) return;
  const key = jobKey(hash, scale);
  if (queued.has(key) || runningJobs.has(key)) return;
  queued.add(key);
  jobQueue.push({ hash, scale });
  pumpQueue();
}
function pumpQueue() {
  while (runningJobs.size < MAX_JOBS && jobQueue.length) {
    const { hash, scale } = jobQueue.shift();
    const key = jobKey(hash, scale);
    runningJobs.add(key);
    // Own process group (detached) so we can kill the worker AND its ncnn/ffmpeg
    // children together on shutdown — otherwise a restart orphans a hung ncnn.
    const child = spawn(process.execPath,
      [join(studioDir, 'lib', 'gen-worker.mjs'), indexFile, cacheDir, hash, String(scale)],
      { stdio: ['ignore', 'inherit', 'inherit'], env: process.env, detached: true });
    childProcs.set(key, child);
    // A worker that is killed or crashes before writing its own error status must still
    // resolve the job, otherwise the client's poller (public/app.js) waits for a
    // completion or an error that never arrives and the card spins "generating" forever.
    const finish = (code, signal) => {
      if (typeof code === 'number' && code !== 0) {
        setWorkerError(hash, scale, `worker exited with code ${code}`);
      } else if (signal) {
        setWorkerError(hash, scale, `worker killed (${signal})`);
      }
      runningJobs.delete(key); queued.delete(key); childProcs.delete(key); pumpQueue();
    };
    child.on('exit', (code, signal) => finish(code, signal));
    child.on('error', (err) => { setWorkerError(hash, scale, String(err?.message || err)); finish(null, null); });
  }
}
function cancelQueued() {
  const n = jobQueue.length;
  jobQueue.length = 0;
  for (const k of [...queued]) if (!runningJobs.has(k)) queued.delete(k);
  // Also hard-stop the running worker(s) so the machine frees immediately.
  killAllWorkers();
  return n;
}
/** Kill a worker and every descendant (ncnn/ffmpeg). ncnn starts its own
 *  session so a process-group kill misses it and it then hangs at 0% CPU —
 *  so we walk the live process tree (worker is still the parent at kill time)
 *  and SIGKILL every descendant by PID, then the worker itself. */
function killWorkerTree(rootPid) {
  let out = '';
  try { out = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' }).stdout || ''; } catch { /* ps missing */ }
  const kids = new Map(); // ppid -> [pid]
  for (const line of out.trim().split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const victims = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    for (const k of kids.get(pid) || []) { victims.push(k); stack.push(k); }
  }
  // children first, then the worker
  for (const pid of victims.reverse()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  try { process.kill(rootPid, 'SIGKILL'); } catch { /* gone */ }
}
/** Kill every running generation worker together with its ncnn/ffmpeg children. */
function killAllWorkers() {
  for (const [, child] of childProcs) killWorkerTree(child.pid);
}

/**
 * Shutdown-only: also stop the build. Leaving it running past shutdown would let a
 * second build start on restart and race it — but this must NOT be reachable from
 * /api/cancel, which cancels *generation*: doing so killed a build mid-write into
 * public/ and left a partially-rewritten tier behind.
 */
function killAllWorkersAndBuild() {
  killAllWorkers();
  if (buildChild) { killWorkerTree(buildChild.pid); buildChild = null; }
}
let shuttingDown = false;
function shutdown() { if (shuttingDown) return; shuttingDown = true; killAllWorkersAndBuild(); setTimeout(() => process.exit(0), 300); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
/** True if the hash is running or waiting in the queue. */
function isPending(hash, scale = SCALE) {
  const k = jobKey(hash, scale);
  return runningJobs.has(k) || queued.has(k);
}

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const path = decodeURIComponent(u.pathname);

    // --- API ---
    if (path === '/api/rooms') {
      const rooms = Object.keys(index.rooms)
        .map((r) => ({ room: r, num: ROOM_NUM.get(r) ?? null, skip: roomSkip.has(r), scale: roomScaleOf(r), ...roomProgress(r) }))
        .sort((a, b) => (a.num ?? 1e9) - (b.num ?? 1e9) || a.room.localeCompare(b.room));
      const fishSel = index.fish.filter((h) => selections[h]).length;
      const sharedSel = index.sharedObjects.filter((h) => selections[h]).length;
      const menuAll = index.menu || [];
      const menuSel = menuAll.filter((h) => selections[h]).length;
      const panelAll = index.panel || [];
      const panelSel = panelAll.filter((h) => selections[h]).length;
      const creditsAll = index.credits || [];
      const creditsSel = creditsAll.filter((h) => selections[h]).length;
      const storyAll = index.story || [];
      const storySel = storyAll.filter((h) => selections[h]).length;
      const kufrAll = index.kufr || [];
      const kufrSel = kufrAll.filter((h) => selections[h]).length;
      return sendJson(res, {
        rooms,
        shared: {
          fish: { total: index.fish.length, selected: fishSel },
          objects: { total: index.sharedObjects.length, selected: sharedSel },
          menu: { total: menuAll.length, selected: menuSel },
          panel: { total: panelAll.length, selected: panelSel },
          credits: { total: creditsAll.length, selected: creditsSel },
          story: { total: storyAll.length, selected: storySel },
          kufr: { total: kufrAll.length, selected: kufrSel },
        },
        totals: { pictures: Object.keys(index.pictures).length, selected: Object.keys(selections).length },
        models: AVAILABLE_MODELS,
        defaultModel: DEFAULT_MODEL,
        scaleRange: { min: SCALE, max: MAX_SCALE },
        contourGlobal: contour.global,
        superscale: contour.superscale,
        smoothSigma: contour.smoothSigma,
        smoothCrisp: contour.smoothCrisp,
        stretchOver: contour.stretchOver,
      });
    }
    if (path.startsWith('/api/room/')) {
      const room = path.slice('/api/room/'.length);
      const d = roomDetail(room);
      return d ? sendJson(res, d) : sendJson(res, { error: 'no such room' }, 404);
    }
    if (path.startsWith('/api/shared/')) {
      const which = path.slice('/api/shared/'.length); // 'fish' | 'objects' | 'menu'
      if (which === 'fish') return sendJson(res, { which, pictures: fishCards() });
      if (which === 'menu') return sendJson(res, { which, pictures: menuCards() });
      if (which === 'panel' || which === 'credits' || which === 'story' || which === 'kufr') {
        return sendJson(res, { which, pictures: flatCards(which) });
      }
      // NB: `.map(picMeta)` would pass the ARRAY INDEX as picMeta's `scale` argument.
      const pics = index.sharedObjects.map((h) => picMeta(h)).filter(Boolean)
        .sort((a, b) => b.roomCount - a.roomCount);
      return sendJson(res, { which, pictures: pics });
    }
    if (path.startsWith('/api/picture/')) {
      const hash = path.slice('/api/picture/'.length);
      // ?scale= reports which variants exist AT THAT SCALE — the compare grid uses it
      // to show the art a room actually ships rather than the ×4 browsing copy.
      const asked = Number(u.searchParams.get('scale'));
      const sc = Number.isInteger(asked) && asked >= SCALE && asked <= MAX_SCALE ? asked : SCALE;
      const m = picMeta(hash, sc);
      return m ? sendJson(res, m) : sendJson(res, { error: 'no such picture' }, 404);
    }
    if (path === '/api/generate' && req.method === 'POST') {
      const { hash, hashes, scale } = await readBody(req);
      const list = hashes || (hash ? [hash] : []);
      const s = Number.isInteger(scale) && scale >= SCALE && scale <= MAX_SCALE ? scale : SCALE;
      for (const h of list) enqueueJob(h, s);
      return sendJson(res, { queued: list.length, running: runningJobs.size, waiting: jobQueue.length, concurrency: MAX_JOBS });
    }
    if (path === '/api/cancel' && req.method === 'POST') {
      const cleared = cancelQueued();
      return sendJson(res, { cleared, running: runningJobs.size });
    }
    if (path === '/api/queue') {
      return sendJson(res, { running: [...runningJobs], waiting: jobQueue.length, concurrency: MAX_JOBS });
    }
    if (path === '/api/room-skip' && req.method === 'POST') {
      const { room, skip } = await readBody(req);
      if (!index.rooms[room]) return sendJson(res, { error: 'no such room' }, 404);
      if (skip) roomSkip.add(room); else roomSkip.delete(room);
      saveRoomSkip();
      return sendJson(res, { room, skip: roomSkip.has(room) });
    }
    if (path === '/api/select' && req.method === 'POST') {
      const { hash, hashes, model } = await readBody(req);
      const list = hashes || (hash ? [hash] : []);
      const applied = [];
      for (const h of list) {
        if (!index.pictures[h]) continue;
        if (model === null || model === undefined) delete selections[h];
        else selections[h] = model;
        applied.push(h);
      }
      saveSelections();
      return sendJson(res, { applied, model: model ?? null });
    }
    if (path === '/api/contour' && req.method === 'POST') {
      const { hash, hashes, strength, global } = await readBody(req);
      if (typeof global === 'number') contour.global = Math.max(0, Math.min(1, global));
      const list = hashes || (hash ? [hash] : []);
      const applied = [];
      for (const h of list) {
        if (!index.pictures[h]) continue;
        if (strength === null || strength === undefined) delete contour.byHash[h];
        else contour.byHash[h] = Math.max(0, Math.min(1, strength));
        applied.push(h);
      }
      saveContours();
      return sendJson(res, { applied, strength: strength ?? null, global: contour.global });
    }
    if (path === '/api/model-order' && req.method === 'POST') {
      const { order, reset } = await readBody(req);
      if (reset) modelOrder = [];
      else if (Array.isArray(order)) {
        const known = new Set(MODELS.map((m) => m.id));
        // keep only real ids, drop duplicates; unlisted models fall back to built-in order
        const seen = new Set();
        modelOrder = order.filter((id) => known.has(id) && !seen.has(id) && seen.add(id));
      } else return sendJson(res, { error: 'order must be an array' }, 400);
      saveModelOrder();
      applyModelOrder();
      return sendJson(res, { models: AVAILABLE_MODELS });
    }
    if (path === '/api/superscale' && req.method === 'POST') {
      const { value } = await readBody(req);
      if (typeof value === 'number') { contour.superscale = Math.max(1, Math.min(SCALE, value)); saveContours(); }
      return sendJson(res, { superscale: contour.superscale });
    }
    if (path === '/api/smooth' && req.method === 'POST') {
      const { sigma, crisp } = await readBody(req);
      if (typeof sigma === 'number') contour.smoothSigma = Math.max(0, Math.min(4, sigma));
      if (typeof crisp === 'number') contour.smoothCrisp = Math.max(0, Math.min(1, crisp));
      saveContours();
      return sendJson(res, { smoothSigma: contour.smoothSigma, smoothCrisp: contour.smoothCrisp });
    }
    if (path === '/api/overlap' && req.method === 'POST') {
      const { value } = await readBody(req);
      if (typeof value === 'number') { contour.stretchOver = Math.max(0, Math.min(4, value)); saveContours(); }
      return sendJson(res, { stretchOver: contour.stretchOver });
    }
    if (path === '/api/reveal' && req.method === 'POST') {
      const { hash, model } = await readBody(req);
      const p = index.pictures[hash];
      if (!p) return sendJson(res, { error: 'no such picture' }, 404);
      const dir = join(cacheDir, hash);
      let target;
      if (model && existsSync(join(dir, `${model}.png`))) target = join(dir, `${model}.png`);
      else if (existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.png'))) target = dir;
      else target = join(root, 'public', p.sample); // fall back to source PNG
      // `open -R` reveals a file in Finder; `open` on a dir opens the folder.
      const args = statSync(target).isDirectory() ? [target] : ['-R', target];
      spawn('open', args, { stdio: 'ignore' }).on('error', () => {});
      return sendJson(res, { opened: target });
    }
    if (path === '/api/reindex' && req.method === 'POST') {
      index = buildAndSave(root, indexFile);
      return sendJson(res, { ok: true, pictures: Object.keys(index.pictures).length });
    }
    if (path.startsWith('/api/preview/')) {
      const room = path.slice('/api/preview/'.length);
      if (!index.rooms[room]) return sendJson(res, { error: 'no such room' }, 404);
      const mode = u.searchParams.get('variant') === 'orig' ? 'orig' : 'ai';
      // Default to the scale this room actually SHIPS at, so the preview shows what
      // the build produces rather than a ×4 stand-in. ?scale= overrides for A/B.
      const asked = Number(u.searchParams.get('scale'));
      const scale = Number.isInteger(asked) && asked >= SCALE && asked <= MAX_SCALE ? asked : roomScaleOf(room);
      let out;
      try { out = composePreview(room, mode, scale); } catch (e) { return sendJson(res, { error: 'compose failed: ' + e.message }, 500); }
      if (!out) return sendJson(res, { error: 'room has no background' }, 404);
      if (mode === 'ai' && contour.superscale < SCALE) { // supersample→downscale to net scale
        const ds = downscaleRgba(out.rgba, out.w, out.h, SCALE / contour.superscale);
        out = { ...out, rgba: ds.rgba, w: ds.w, h: ds.h };
      }
      const dst = join(cacheDir, `.preview-${room}${mode === 'orig' ? '-orig' : ''}.png`);
      encodePngRgba(out.rgba, out.w, out.h, dst);
      const b = readFileSync(dst);
      res.writeHead(200, {
        'content-type': 'image/png', 'content-length': b.length, 'cache-control': 'no-store',
        'x-preview-dims': `${out.w}x${out.h}`, 'x-preview-missing': String(out.missing.length),
        'x-preview-scale': String(scale),
      });
      return res.end(b);
    }
    if (path.startsWith('/api/reveal-preview/') && req.method === 'POST') {
      const room = path.slice('/api/reveal-preview/'.length);
      const dst = join(cacheDir, `.preview-${room}.png`);
      if (!existsSync(dst)) return sendJson(res, { error: 'no preview generated yet' }, 404);
      spawn('open', ['-R', dst], { stdio: 'ignore' }).on('error', () => {});
      return sendJson(res, { opened: dst });
    }
    if (path.startsWith('/api/build-room/') || path === '/api/build-all') {
      if (req.method !== 'POST') return sendJson(res, { error: 'POST only' }, 405);
      if (buildJob.running) return sendJson(res, { error: 'a build is already running', job: buildJob }, 409);
      const all = path === '/api/build-all';
      const room = all ? null : decodeURIComponent(path.slice('/api/build-room/'.length));
      if (!all && !index.rooms[room] && room !== '_fish' && room !== '_menu') return sendJson(res, { error: 'no such room' }, 404);
      const args = [join(studioDir, 'build-ai.mjs'), ...(all ? ['--all'] : [room])];
      buildJob = { running: true, target: all ? 'all rooms' : room, log: [], startedAt: Date.now(), error: null, code: null };
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      buildChild = child;   // tracked so shutdown can kill it (it writes into public/)
      const push = (b) => { for (const ln of String(b).split('\n')) if (ln.trim()) buildJob.log.push(ln.trim()); if (buildJob.log.length > 400) buildJob.log.splice(0, buildJob.log.length - 400); };
      child.stdout.on('data', push); child.stderr.on('data', push);
      child.on('error', (e) => { buildChild = null; buildJob.running = false; buildJob.error = String(e.message || e); });
      child.on('close', (code) => { buildChild = null; buildJob.running = false; buildJob.code = code; if (code !== 0) buildJob.error = `build exited ${code}`; });
      return sendJson(res, { started: true, target: buildJob.target });
    }
    if (path === '/api/build-status') return sendJson(res, buildJob);

    // --- static + assets ---
    // Every one of these joins UNTRUSTED path text onto a root, so each must be
    // containment-checked: `normalize()` alone does NOT stop traversal (the path is
    // percent-decoded first, so `/src/..%2F..%2Fetc/hosts` escapes). sendFileUnder()
    // resolves the result and refuses anything outside its root.
    if (path.startsWith('/cache/')) return sendFileUnder(res, cacheDir, path.slice('/cache/'.length));
    if (path.startsWith('/src/')) return sendFileUnder(res, join(root, 'public'), path.slice('/src/'.length));
    const rel = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    return sendFileUnder(res, publicDir, rel);
  } catch (e) {
    sendJson(res, { error: String(e.message || e) }, 500);
  }
});

// Bind to loopback only: this is a personal curation tool that serves files off
// disk and spawns processes — it has no business being reachable from the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Upscaler Studio → http://localhost:${PORT}/  (${Object.keys(index.pictures).length} pictures, ${Object.keys(index.rooms).length} rooms)`);
  if (!process.env.REALESRGAN_NCNN) console.warn('WARNING: REALESRGAN_NCNN not set — generation will fail until you set it.');
});
