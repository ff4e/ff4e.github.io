'use strict';
// Upscaler Studio frontend: browse rooms/shared pictures, generate per-picture
// upscaler variants on demand, compare them zoomed in a popup, and pick the best
// (object picks apply in batch to all animation frames).

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) if (k != null) n.append(k);
  return n;
};
const api = (p, opts) => fetch(p, opts).then((r) => r.json());

let MODELS = [];
// The scale the CURRENT room ships at (from /api/room), or null in the shared views
// (Fish / Shared objects / Menu) where there is NO single room and therefore no single
// scale. Drives the preview and the compare grid so what you inspect is what the build
// produces, not a ×4 stand-in.
let ROOM_SCALE = null;
let SCALE_RANGE = { min: 4, max: 8 };
let DEFAULT_MODEL = 'cugan_c'; // effective pick when a picture has no explicit selection (server overrides)
let current = null; // { type:'room'|'shared', key }
const pollers = new Map(); // hash -> interval id

async function boot() {
  const s = await api('/api/rooms');
  MODELS = s.models;
  DEFAULT_MODEL = s.defaultModel || DEFAULT_MODEL;
  if (s.scaleRange) SCALE_RANGE = s.scaleRange;
  if (typeof s.superscale === 'number') { SUPERSCALE = s.superscale; M.superscale = s.superscale; }
  if (typeof s.smoothSigma === 'number') { SMOOTH_SIGMA = s.smoothSigma; M.smoothSigma = s.smoothSigma; }
  if (typeof s.smoothCrisp === 'number') { SMOOTH_CRISP = s.smoothCrisp; M.smoothCrisp = s.smoothCrisp; }
  if (typeof s.stretchOver === 'number') { STRETCH_OVER = s.stretchOver; M.stretchOver = s.stretchOver; }
  renderNav(s);
  if (s.rooms.length) selectRoom(s.rooms[0].room);
}

// ---- nav -----------------------------------------------------------------
function renderNav(s) {
  $('#totals').textContent = `${s.totals.selected}/${s.totals.pictures} pictures picked`;
  const nav = $('#nav');
  nav.textContent = '';
  nav.append(el('div', { className: 'nav-group', textContent: 'Shared' }));
  nav.append(navItem('🐟 Fish', s.shared.fish, () => selectShared('fish'), 'shared:fish'));
  nav.append(navItem('🔗 Shared objects', s.shared.objects, () => selectShared('objects'), 'shared:objects'));
  if (s.shared.menu) nav.append(navItem('🗺 Menu / map', s.shared.menu, () => selectShared('menu'), 'shared:menu'));
  if (s.shared.panel) nav.append(navItem('🎛 Panel / options', s.shared.panel, () => selectShared('panel'), 'shared:panel'));
  if (s.shared.credits) nav.append(navItem('🎬 Credits', s.shared.credits, () => selectShared('credits'), 'shared:credits'));
  if (s.shared.story) nav.append(navItem('📖 Story pages', s.shared.story, () => selectShared('story'), 'shared:story'));
  if (s.shared.kufr) nav.append(navItem('💼 Briefcase intro', s.shared.kufr, () => selectShared('kufr'), 'shared:kufr'));
  if (s.shared.desky) nav.append(navItem('🪧 Room-name plaques', s.shared.desky, () => selectShared('desky'), 'shared:desky'));
  nav.append(el('div', { className: 'nav-group', textContent: `Rooms (${s.rooms.length})` }));
  const filter = $('#filter').value.trim().toUpperCase();
  for (const r of s.rooms) {
    if (filter && !r.room.includes(filter)) continue;
    // Level number (from the game's room table) rendered in its own column.
    nav.append(navItem(r.room, { total: r.total, selected: r.selected }, () => selectRoom(r.room), `room:${r.room}`, r.num, r.scale));
  }
  if (current) setActive(current.type === 'room' ? `room:${current.key}` : `shared:${current.key}`);
}
function navItem(name, prog, onClick, id, num = null, scale = null) {
  const cls = prog.selected >= prog.total && prog.total > 0 ? 'done' : (prog.selected > 0 ? 'partial' : '');
  const parts = [];
  // Level number in its own fixed-width cell so the room names stay aligned.
  if (num != null) parts.push(el('span', { className: 'lvl', textContent: String(num) }));
  parts.push(el('span', { className: 'name', textContent: name }));
  // The scale this room SHIPS at. Currently uniform ×4; if ADAPTIVE_SCALE is
  // re-enabled, smaller rooms ship above ×4 and get the highlighted chip.
  if (scale != null) {
    parts.push(el('span', {
      className: 'scale-chip' + (scale > 4 ? ' hi' : ''),
      textContent: `×${scale}`,
      title: `built at ×${scale}`,
    }));
  }
  parts.push(el('span', { className: `badge ${cls}`, textContent: `${prog.selected}/${prog.total}` }));
  const item = el('div', { className: 'nav-item', onclick: onClick }, parts);
  item.dataset.id = id;
  return item;
}
function setActive(id) { document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.id === id)); }
async function refreshNav() { renderNav(await api('/api/rooms')); }

// ---- views ---------------------------------------------------------------
async function selectRoom(room) {
  current = { type: 'room', key: room };
  setActive(`room:${room}`);
  $('#viewtitle').textContent = `Room ${room}`;
  $('#viewactions').textContent = '';
  const detail = await api(`/api/room/${room}`);
  const pics = detail.pictures;
  ROOM_SCALE = detail.scale || 4;
  $('#viewtitle').textContent = `Room ${room}  ·  ships ×${ROOM_SCALE}`;
  const meta = (await api('/api/rooms')).rooms.find((r) => r.room === room) || {};
  // Rooms built from FFNG's original indexed pixel art (TETRIS, ZX, SCHODY…) look
  // better untouched — the runtime falls back to the enhanced render when a room
  // has no AI art, so this just tells the build to leave the room out.
  const skipBox = el('input', { type: 'checkbox' });
  skipBox.checked = !!meta.skip;
  skipBox.addEventListener('change', async () => {
    await api('/api/room-skip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ room, skip: skipBox.checked }) });
    refreshNav();
  });
  const skipLabel = el('label', { className: 'cmp-ctrl', title: 'Exclude this room from the ai tier — the game renders it with the enhanced art instead. Takes effect on the next build.' }, [skipBox, document.createTextNode(' use enhanced (skip AI)')]);
  // Some rooms read better in the untouched original (e.g. TETRIS), and picking
  // every picture by hand leaves an inconsistent mix — so offer a one-click
  // "apply this model to the whole room".
  const sel = el('select', { className: 'room-apply' });
  sel.append(el('option', { value: '', textContent: 'set whole room to…' }));
  for (const m of MODELS) sel.append(el('option', { value: m.id, textContent: m.label }));
  sel.append(el('option', { value: '__clear', textContent: '(clear → default)' }));
  sel.addEventListener('change', async () => {
    const v = sel.value;
    if (!v) return;
    const model = v === '__clear' ? null : v;
    const hashes = [...new Set(pics.flatMap((p) => targets(p)))];
    sel.disabled = true;
    await api('/api/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hashes, model }) });
    sel.disabled = false; sel.value = '';
    await selectRoom(room); // re-render with the new picks
    refreshNav();
  });
  $('#viewactions').append(
    el('button', { textContent: 'Generate all missing', onclick: generateAll }),
    sel,
    skipLabel,
    el('button', { className: 'primary', textContent: 'Preview room ▸', onclick: () => openPreview(room) }),
  );
  renderCards(pics);
}
async function selectShared(which) {
  current = { type: 'shared', key: which };
  setActive(`shared:${which}`);
  // No room context here: shared art (above all the fish) is used across rooms of many
  // sizes and therefore ships at SEVERAL scales at once. Leaving the previously-viewed
  // room's scale in place made a fish claim it ships at that room's scale.
  ROOM_SCALE = null;
  const TITLES = {
    fish: 'Shared — Fish  ·  built at EVERY room scale (×4–×8), one pick covers them all',
    menu: 'Shared — Menu / world map  ·  ships ×4',
    panel: 'Shared — Control panel & options  ·  16 colour variants of one panel + the slider handle',
    credits: 'Shared — End credits  ·  static frame + the scrolling strip',
    story: 'Shared — Leg story pages  ·  the nine full-screen pages shown after each leg (text-heavy: check the lettering)',
    kufr: 'Shared — Briefcase intro  ·  base = the suitcase/TV canvas, anim = ONE pick for all 285 animation frames',
    desky: 'Shared — World-map name plaques  ·  72 rooms × cz/en, blitted OPAQUELY (background baked in) — pure lettering, so check legibility',
    objects: 'Shared — Objects (used in >1 room, so possibly at several scales)',
  };
  $('#viewtitle').textContent = TITLES[which] || TITLES.objects;
  $('#viewactions').textContent = '';
  $('#viewactions').append(el('button', { textContent: 'Generate all missing', onclick: generateAll }));
  if (which === 'menu') {
    // The menu tier ships to public/data/Menu/*_ai.*, so it needs its own build
    // (there is no room preview to hang a build button off).
    $('#viewactions').append(el('button', {
      textContent: '🔨 build menu art',
      title: 'Write public/data/Menu/*_ai.webp|png from the current picks',
      onclick: buildMenuArt,
    }));
    $('#viewactions').append(el('span', { id: 'menu-buildstat', className: 'cmp-sel' }));
  }
  renderCards((await api(`/api/shared/${which}`)).pictures);
}
/** Build the shipped menu/world-map art (public/data/Menu/*_ai.*) from the picks. */
async function buildMenuArt() {
  const stat = $('#menu-buildstat');
  if (stat) stat.textContent = 'building…';
  const r = await api('/api/build-room/_menu', { method: 'POST' }).catch(() => null);
  if (!r || r.error) { if (stat) stat.textContent = `not started: ${(r && r.error) || 'failed'}`; return; }
  const poll = setInterval(async () => {
    const j = await api('/api/build-status').catch(() => null);
    if (!j) return;
    const last = j.log && j.log.length ? j.log[j.log.length - 1] : '';
    if (j.running) { if (stat) stat.textContent = `building… ${last}`; return; }
    clearInterval(poll);
    if (stat) stat.textContent = j.error ? `FAILED: ${j.error}` : `✓ ${last || 'done'} — reload the game to see it`;
  }, 700);
}

function renderCards(pics) {  const wrap = $('#cards');
  wrap.textContent = '';
  if (!pics.length) { wrap.append(el('div', { className: 'empty', textContent: 'No pictures here.' })); return; }
  for (const p of pics) wrap.append(card(p));
}

/** Badge naming the effective model: explicit pick, or the global default in italics. */
function pickBadge(p) {
  const id = p.selected || p.effective || DEFAULT_MODEL;
  const model = MODELS.find((m) => m.id === id);
  return el('span', {
    className: 'pick-badge' + (p.selected ? '' : ' isdefault'),
    textContent: (model ? model.label : id) + (p.selected ? '' : ' · default'),
    title: p.selected ? `explicit pick: ${id}` : `no explicit pick — using the default (${id})`,
  });
}

// hashes a pick/generate applies to: an object → all its frames (batch); else itself
function targets(p) { return (p.role === 'object' && p.frames && p.frames.length) ? p.frames : [p.hash]; }
function frameCount(p) { return (p.frames && p.frames.length) || 1; }

// ---- card ----------------------------------------------------------------
function card(p) {
  const roleTitle = p.role === 'object' ? (p.object || 'object') : (p.role || p.kind);
  const c = el('div', { className: 'card' + (p.selected ? ' selected' : '') });
  c.dataset.hash = p.hash;
  c._pic = p;

  const nf = frameCount(p);
  const subBits = [`${p.w}×${p.h}`, p.alpha ? 'alpha' : 'opaque', p.kind];
  // A shared picture can ship at several scales at once (it appears in rooms of
  // different sizes), so list them all rather than pretending there is just one.
  if (p.scales && p.scales.length) subBits.push(`ships ${p.scales.map((x) => `×${x}`).join(' ')}`);
  if (nf > 1) subBits.push(`${nf} frames`);
  if (p.placements > 1) subBits.push(`×${p.placements} placements`);
  const head = el('div', { className: 'card-head' }, [
    el('div', {}, [
      el('div', { className: 'card-title', textContent: roleTitle }),
      el('div', { className: 'card-sub', textContent: subBits.join(' · ') }),
    ]),
  ]);
  if (p.roomCount > 1) head.append(el('span', { className: 'shared-badge', textContent: `used in ${p.roomCount} rooms` }));
  // Name the effective algorithm in TEXT. The highlighted tile in the strip is the
  // other indicator, but it only appears once that variant is cached — so on a card
  // with nothing generated yet the pick was previously invisible.
  head.append(pickBadge(p));
  c.append(head);

  const status = el('span', { className: 'gen-status' });
  const genBtn = el('button', { textContent: 'Generate', onclick: () => generate(p.hash) });
  const cmpBtn = el('button', { textContent: '⛶ Compare', onclick: () => openCompare(p) });
  const finderBtn = el('button', { textContent: '📂 Finder', title: 'Reveal in Finder', onclick: () => openFinder(p.hash) });
  c.append(el('div', { className: 'card-actions' }, [genBtn, cmpBtn, finderBtn, status]));

  const strip = el('div', { className: 'strip' });
  c.append(strip);
  renderStrip(strip, p, status, genBtn);
  return c;
}

function renderStrip(strip, p, status, genBtn) {
  strip.textContent = '';
  const have = new Set(p.have);
  const eff = p.selected || DEFAULT_MODEL; // effective pick (explicit, else default)
  for (const m of MODELS) {
    const hasVar = m.id === 'orig' ? have.has('orig') : have.has(m.id);
    if (!hasVar && m.id !== 'orig') continue;
    const src = have.has(m.id) ? `/cache/${p.hash}/${m.id}.png` : `/src/${p.sample}`;
    const isEff = m.id === eff;
    const cls = 'variant' + (isEff ? (p.selected ? ' selected' : ' default') : '') + (m.id === 'orig' ? ' orig' : '');
    const v = el('div', { className: cls });
    v.append(el('div', { className: 'thumb' }, el('img', { src, loading: 'lazy' })));
    v.append(el('div', { className: 'vlabel', textContent: m.label + (isEff && !p.selected ? ' · default' : '') }));
    v.onclick = (e) => { if (e.shiftKey || e.metaKey) openCompare(p); else selectPic(p, m.id); };
    v.oncontextmenu = (e) => { e.preventDefault(); openCompare(p); };
    strip.append(v);
  }
  const total = MODELS.length;
  const got = p.have.filter((x) => x !== 'orig').length + (p.have.includes('orig') ? 1 : 0);
  if (p.queued && !p.running) { status.textContent = `queued… ${got}/${total}`; genBtn.disabled = true; }
  else if (p.running || pollers.has(p.hash)) { status.textContent = `generating… ${got}/${total}`; genBtn.disabled = true; }
  else if (got >= total) { status.textContent = 'ready · ⛶ Compare to pick'; genBtn.textContent = 'Regenerate'; genBtn.disabled = false; }
  else if (got > 0) { status.textContent = `${got}/${total} ready`; genBtn.disabled = false; }
  else { status.textContent = frameCount(p) > 1 ? `pick applies to ${frameCount(p)} frames` : 'not generated'; genBtn.disabled = false; }
}

// ---- generation ----------------------------------------------------------
/** Cache basename for a model at a scale — mirrors variantName() in lib/upscale.mjs. */
function variantFile(modelId, scale) {
  return (!scale || scale === SCALE_RANGE.min) ? `${modelId}.png` : `${modelId}@${scale}.png`;
}

async function generate(hash, scale = null) {
  const body = scale && scale !== SCALE_RANGE.min ? { hash, scale } : { hash };
  await api('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  poll(hash, scale);
  startQueueWatch();
}
async function generateAll() {
  // Only queue pictures that still need variants, and confirm on big batches —
  // each picture runs 9 ncnn models, so 124 fish is a long, heavy job.
  const cards = [...document.querySelectorAll('.card')];
  const missing = cards.filter((c) => {
    const p = c._pic; if (!p) return true;
    const got = p.have.filter((x) => x !== 'orig').length + (p.have.includes('orig') ? 1 : 0);
    return got < MODELS.length;
  });
  if (!missing.length) { alert('All pictures here already have every variant.'); return; }
  const nModels = MODELS.length - 1; // ncnn models (orig is NN)
  if (missing.length > 6 && !confirm(
    `Generate variants for ${missing.length} pictures?\n\n`
    + `That is ~${missing.length * nModels} AI upscales, run ${'sequentially'} `
    + `(a few seconds each). They queue in the background — you can keep working `
    + `and Cancel any time from the banner.`)) return;
  const hashes = missing.map((c) => c.dataset.hash);
  await api('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hashes }) });
  startQueueWatch();
}
async function cancelQueue() {
  await api('/api/cancel', { method: 'POST' });
  startQueueWatch();
}

// global queue banner
let queueTimer = null;
function startQueueWatch() { if (!queueTimer) { queueTimer = setInterval(pollQueue, 1500); pollQueue(); } }
async function pollQueue() {
  const q = await api('/api/queue');
  const bar = $('#queuebar');
  const busy = q.running.length + q.waiting;
  if (busy > 0) {
    bar.classList.remove('hidden');
    $('#queuebar-text').textContent = `Generating… ${q.running.length} running, ${q.waiting} queued (concurrency ${q.concurrency}).`;
    refreshCurrentView(); // one request updates every visible card's status
  } else {
    bar.classList.add('hidden');
    clearInterval(queueTimer); queueTimer = null;
    refreshCurrentView();
    refreshNav();
  }
}

// Re-fetch the current room/shared list and update card status in place (cheap:
// one request for all cards, vs one poller per hash).
let refreshing = false;
async function refreshCurrentView() {
  if (refreshing || !current) return;
  refreshing = true;
  try {
    const url = current.type === 'room' ? `/api/room/${current.key}` : `/api/shared/${current.key}`;
    const d = await api(url);
    const pics = d.pictures;
    for (const p of pics) updateCard(p);
  } finally { refreshing = false; }
}
function poll(hash, scale = null) {
  // Poll per picture AND scale: a ×8 render in the compare popup must not be reported
  // as finished just because the ×4 browsing copies are already on disk.
  const key = scale && scale !== SCALE_RANGE.min ? `${hash}@${scale}` : hash;
  if (pollers.has(key)) return;
  const q = scale && scale !== SCALE_RANGE.min ? `?scale=${scale}` : '';
  const tick = async () => {
    const p = await api(`/api/picture/${hash}${q}`);
    updateCard(p);
    if (M.open && M.p.hash === hash && (M.scale || SCALE_RANGE.min) === (scale || SCALE_RANGE.min)) refreshCompareVariants(p);
    const done = (p.have.filter((x) => x !== 'orig').length + (p.have.includes('orig') ? 1 : 0)) >= MODELS.length;
    if (!p.running && (done || (p.status && p.status.error))) { clearInterval(id); pollers.delete(key); updateCard(p); }
  };
  const id = setInterval(tick, 1500);
  pollers.set(key, id);
  tick();
}
function updateCard(p) {
  const c = document.querySelector(`.card[data-hash="${p.hash}"]`);
  if (!c) return;
  if (c._pic) p = Object.assign(c._pic, p);
  c.classList.toggle('selected', !!p.selected);
  const badge = c.querySelector('.pick-badge');
  if (badge) badge.replaceWith(pickBadge(p));
  renderStrip(c.querySelector('.strip'), p, c.querySelector('.gen-status'), c.querySelector('.card-actions button'));
}

// ---- reveal in Finder ----------------------------------------------------
// Opens the cache folder for this picture (all variants), or a specific model
// PNG, or falls back to the source PNG when nothing is generated yet.
async function openFinder(hash, model) {
  try {
    await api('/api/reveal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash, model }) });
  } catch (e) { alert('Could not open Finder: ' + e.message); }
}

// ---- selection (batch-aware) ---------------------------------------------
async function selectPic(p, model) {
  const hashes = targets(p);
  await api('/api/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hashes, model }) });
  const full = await api(`/api/picture/${p.hash}`);
  full.frames = p.frames; full.role = p.role; full.object = p.object; // keep batch info
  updateCard(full);
  if (M.open && M.p.hash === p.hash) { M.p.selected = model; markSelected(); }
  refreshNav();
}

// =====================================================================
// Compare modal — synced zoom/pan grid, pick in place, 2-up A/B
// =====================================================================
const M = { open: false, p: null, z: 6, cx: 0, cy: 0, active: 0, twoup: false, tiles: [], contour: 0, superscale: 4, smoothSigma: 1.0, smoothCrisp: 0.5, stretchOver: 0 };
let SUPERSCALE = 4; // global net scale (supersample→downscale); SCALE(4)=AI native
let SMOOTH_SIGMA = 1.0, SMOOTH_CRISP = 0.5; // global edge-smoother params
let STRETCH_OVER = 0; // global seam-fill radius (original px)

// Chamfer distance transform (mirror of upscale.mjs distanceTransform). With
// withIdx=true also returns per-cell nearest source index (feature transform).
function distanceTransformClient(src, w, h, withIdx = false) {
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
// Client mirror of upscale.mjs thinOutline (must stay in sync). Removes a
// PERCENTAGE of the local contour width: for each ink pixel, dOut = distance to
// the outer edge, dIn = distance to the fill; W = dOut + dIn; crisp-remove the
// outer s·W (dOut < s·W). Only silhouette-adjacent dark is touched; internal
// textures and fill-less strokes (dIn > DIN_MAX) are left intact. This shrinks
// the silhouette slightly — pair with stretchToBBoxClient to refill the
// footprint. Returns a new buffer.
const DIN_MAX = 40;
const BAND_MAX = 14; // dark deeper than this from the edge = inner image, not outline
function thinOutlineClient(data, w, h, s) {
  if (!(s > 0)) return data;
  const out = new Uint8ClampedArray(data);
  const N = w * h;
  const transp = new Uint8Array(N), fill = new Uint8Array(N), ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * 4, a = data[o + 3];
    const l = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    if (a < 40) transp[i] = 1; else if (l < 60) ink[i] = 1; else fill[i] = 1;
  }
  const dOut = distanceTransformClient(transp, w, h);
  const inner = new Uint8Array(N); // bright fill OR deep dark = inner image (keeps width flat under dark fill)
  for (let i = 0; i < N; i++) if (fill[i] || (ink[i] && dOut[i] > BAND_MAX)) inner[i] = 1;
  const dIn = distanceTransformClient(inner, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!ink[i]) continue;
    const border = Math.min(x, y, w - 1 - x, h - 1 - y) + 1;
    const dO = Math.min(dOut[i], border);
    const di = dIn[i];
    if (di > DIN_MAX) continue;         // fill-less stroke: leave intact
    const W = dO + di;
    if (dO < s * W) out[i * 4 + 3] = 0; // crisp-remove the outer s-fraction of the outline
  }
  return out;
}
// Opaque bounding box (mirror of upscale.mjs opaqueBBox).
function opaqueBBoxClient(data, w, h, thr = 40) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] >= thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}
// Stretch src's opaque bbox to fill ref's opaque bbox (mirror of upscale.mjs stretchToBBox).
function stretchToBBoxClient(src, ref, w, h) {
  const sb = opaqueBBoxClient(src, w, h), rb = opaqueBBoxClient(ref, w, h);
  if (!sb || !rb) return src;
  const sw = sb.x1 - sb.x0, sh = sb.y1 - sb.y0, rw = rb.x1 - rb.x0, rh = rb.y1 - rb.y0;
  if (sb.x0 === rb.x0 && sb.y0 === rb.y0 && sw === rw && sh === rh) return src;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let oy = rb.y0; oy <= rb.y1; oy++) for (let ox = rb.x0; ox <= rb.x1; ox++) {
    const u = sb.x0 + (rw ? (ox - rb.x0) / rw * sw : 0);
    const v = sb.y0 + (rh ? (oy - rb.y0) / rh * sh : 0);
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
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
// Smooth the silhouette staircase then re-sharpen alpha to kill the translucent
// fringe (mirror of upscale.mjs smoothEdges): band-limited premultiplied Gaussian
// + crisp gain around 0.5. sigma=blur (0=off), crisp=0 soft AA … 1 near-binary.
function smoothEdgesClient(data, w, h, sigma = 1.0, crisp = 0.5) {
  if (!(sigma > 0)) return data;
  const gain = 1 + Math.max(0, Math.min(1, crisp)) * 15;
  const N = w * h, A = i => data[i * 4 + 3];
  const edge = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, op = A(i) >= 128;
    if ((x > 0 && (A(i - 1) >= 128) !== op) || (x < w - 1 && (A(i + 1) >= 128) !== op) ||
        (y > 0 && (A(i - w) >= 128) !== op) || (y < h - 1 && (A(i + w) >= 128) !== op)) edge[i] = 1;
  }
  const dEdge = distanceTransformClient(edge, w, h);
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const K = []; let ksum = 0;
  for (let k = -radius; k <= radius; k++) { const g = Math.exp(-(k * k) / (2 * sigma * sigma)); K.push(g); ksum += g; }
  for (let k = 0; k < K.length; k++) K[k] /= ksum;
  const pr = new Float32Array(N), pg = new Float32Array(N), pb = new Float32Array(N), pa = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = data[i * 4 + 3] / 255; pr[i] = data[i * 4] * a; pg[i] = data[i * 4 + 1] * a; pb[i] = data[i * 4 + 2] * a; pa[i] = data[i * 4 + 3]; }
  const hr = new Float32Array(N), hg = new Float32Array(N), hb = new Float32Array(N), ha = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = -radius; k <= radius; k++) { const xx = Math.min(w - 1, Math.max(0, x + k)), j = y * w + xx, wk = K[k + radius]; r += pr[j] * wk; g += pg[j] * wk; b += pb[j] * wk; a += pa[j] * wk; }
    const i = y * w + x; hr[i] = r; hg[i] = g; hb[i] = b; ha[i] = a;
  }
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (dEdge[i] > radius) continue;
    let r = 0, g = 0, b = 0, a = 0;
    for (let k = -radius; k <= radius; k++) { const yy = Math.min(h - 1, Math.max(0, y + k)), j = yy * w + x, wk = K[k + radius]; r += hr[j] * wk; g += hg[j] * wk; b += hb[j] * wk; a += ha[j] * wk; }
    const am = a / 255, o = i * 4;
    const as = Math.max(0, Math.min(1, (am - 0.5) * gain + 0.5));
    out[o] = am > 0 ? Math.round(r / am) : 0;
    out[o + 1] = am > 0 ? Math.round(g / am) : 0;
    out[o + 2] = am > 0 ? Math.round(b / am) : 0;
    out[o + 3] = Math.round(as * 255);
  }
  return out;
}
// Area-average downscale by factor (mirror of upscale.mjs downscaleRgba):
// supersample→downscale so contours narrow proportionally + anti-alias cleanly.
function downscaleClient(data, w, h, factor) {
  if (!(factor > 1.0001)) return { data, w, h };
  const ow = Math.max(1, Math.round(w / factor)), oh = Math.max(1, Math.round(h / factor));
  const sx = w / ow, sy = h / oh;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let oy = 0; oy < oh; oy++) {
    const y0 = oy * sy, y1 = y0 + sy, iy0 = Math.floor(y0), iy1 = Math.ceil(y1);
    for (let ox = 0; ox < ow; ox++) {
      const x0 = ox * sx, x1 = x0 + sx, ix0 = Math.floor(x0), ix1 = Math.ceil(x1);
      let r = 0, g = 0, b = 0, a = 0, cov = 0;
      for (let yy = iy0; yy < iy1; yy++) {
        const cy = Math.min(y1, yy + 1) - Math.max(y0, yy); if (cy <= 0) continue;
        for (let xx = ix0; xx < ix1; xx++) {
          const cx = Math.min(x1, xx + 1) - Math.max(x0, xx); if (cx <= 0) continue;
          const c = cx * cy, i = (yy * w + xx) * 4, al = data[i + 3] / 255 * c;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += data[i + 3] * c; cov += c;
        }
      }
      const o = (oy * ow + ox) * 4, am = a / 255;
      out[o] = am > 0 ? Math.round(r / am) : 0;
      out[o + 1] = am > 0 ? Math.round(g / am) : 0;
      out[o + 2] = am > 0 ? Math.round(b / am) : 0;
      out[o + 3] = cov > 0 ? Math.round(a / cov) : 0;
    }
  }
  return { data: out, w: ow, h: oh };
}
// Draw a tile's cached source pixels with contour thinning + net-scale downscale.
function renderTile(t) {
  if (!t.srcData || t.kind !== 'canvas') return;
  const w = t.srcData.width, h = t.srcData.height; // ×4 cached source dims
  const g = t.disp.getContext('2d');
  let data = t.srcData.data;
  if (t.model !== 'orig' && M.contour > 0 && M.p.alpha) {
    const thinned = thinOutlineClient(data, w, h, M.contour);
    const stretched = stretchToBBoxClient(thinned, data, w, h);
    data = smoothEdgesClient(stretched, w, h, M.smoothSigma, M.smoothCrisp);
  }
  let outW = w, outH = h, outData = data;
  if (t.model !== 'orig' && M.superscale < 4) { // supersample→downscale to net scale
    const ds = downscaleClient(data, w, h, 4 / M.superscale);
    outW = ds.w; outH = ds.h; outData = ds.data;
  }
  t.disp.width = outW; t.disp.height = outH; t.disp._natW = outW;
  g.putImageData(new ImageData(outData, outW, outH), 0, 0);
  applyTransform();
}
// Load a cache PNG into a canvas tile, caching its ImageData for re-fading.
function loadCanvasTile(t, src) {
  const im = new Image();
  im.onload = () => {
    const w = im.naturalWidth, h = im.naturalHeight;
    t.disp.width = w; t.disp.height = h; t.disp._natW = w;
    const g = t.disp.getContext('2d'); g.drawImage(im, 0, 0);
    t.srcData = g.getImageData(0, 0, w, h);
    renderTile(t); applyTransform();
  };
  im.src = src;
}

async function openCompare(p) {
  // Open at the ×4 baseline: every candidate is already cached there, so the grid is
  // instant. Rendering all 13 models at ×8 is minutes of GPU, which must be a
  // deliberate click on the scale picker — not a side effect of opening the popup.
  const opts = (p.scales && p.scales.length) ? p.scales : [SCALE_RANGE.min];
  M.scale = SCALE_RANGE.min;
  // Which scale to signpost as "as shipped". In a room, that room's scale. Outside one
  // (shared views), the picture ships at every scale in `opts`, so highlight the LARGEST
  // — it is the most demanding and the one where softness shows first.
  M.shipScale = (ROOM_SCALE && opts.includes(ROOM_SCALE)) ? ROOM_SCALE : Math.max(...opts);
  const fresh = await api(`/api/picture/${p.hash}?scale=${M.scale}`); // variants at that scale
  fresh.role = p.role; fresh.object = p.object; fresh.frames = p.frames;
  M.open = true; M.p = fresh; M.twoup = $('#cmp-2up').checked;
  M.contour = typeof fresh.contour === 'number' ? fresh.contour : 0;
  $('#cmp-blend').value = Math.round(M.contour * 100); $('#cmp-blendval').textContent = `${Math.round(M.contour * 100)}%`;
  M.superscale = SUPERSCALE;
  $('#cmp-super').value = SUPERSCALE; $('#cmp-superval').textContent = `${SUPERSCALE.toFixed(2).replace(/0$/, '')}×`;
  M.smoothSigma = SMOOTH_SIGMA; M.smoothCrisp = SMOOTH_CRISP;
  $('#cmp-smooth').value = SMOOTH_SIGMA; $('#cmp-smoothval').textContent = SMOOTH_SIGMA.toFixed(2).replace(/0$/, '');
  $('#cmp-crisp').value = Math.round(SMOOTH_CRISP * 100); $('#cmp-crispval').textContent = `${Math.round(SMOOTH_CRISP * 100)}%`;
  M.cx = p.w / 2; M.cy = p.h / 2;
  const eff = fresh.selected || DEFAULT_MODEL;
  const selIdx = MODELS.findIndex((m) => m.id === eff);
  M.active = selIdx >= 0 ? selIdx : Math.min(1, MODELS.length - 1);
  $('#compare').classList.remove('hidden');
  const nf = frameCount(p);
  $('#cmp-title').textContent = `${fresh.kind} · ${fresh.object || fresh.role || ''} · ${p.w}×${p.h} → ${p.w * M.scale}×${p.h * M.scale}`;
  $('#cmp-applies').textContent = nf > 1 ? `pick applies to all ${nf} frames` : '';
  buildCompareScalePicker(opts);
  buildCompareGrid();
  fitZoom(); applyTransform();
  const have = new Set(fresh.have);
  if (MODELS.some((m) => !have.has(m.id))) generate(p.hash, M.scale); // fill any missing tiles
}

/**
 * Scale buttons for the compare grid. Browsing stays cheap at ×4 (that is why the
 * candidate cache is ×4); switching to a higher scale renders the candidates at the
 * size the room really ships, which costs real GPU time — so it is opt-in per picture.
 */
function buildCompareScalePicker(opts) {
  const box = $('#cmp-scales');
  if (!box) return;
  box.textContent = '';
  const list = [...new Set([SCALE_RANGE.min, ...opts])].sort((a, b) => a - b);
  for (const sc of list) {
    box.append(el('button', {
      className: 'pv-scale' + (sc === M.scale ? ' on' : '') + (sc === M.shipScale && sc !== M.scale ? ' ship' : ''),
      textContent: `×${sc}`,
      title: sc === SCALE_RANGE.min
        ? 'baseline — every candidate is already cached, opens instantly'
        : `the scale this picture ships at — renders the candidates on demand (slow)`,
      onclick: () => setCompareScale(sc, list),
    }));
  }
}

async function setCompareScale(sc, opts) {
  if (M.scale === sc || !M.p) return;
  M.scale = sc;
  const fresh = await api(`/api/picture/${M.p.hash}?scale=${sc}`);
  fresh.role = M.p.role; fresh.object = M.p.object; fresh.frames = M.p.frames;
  M.p = fresh;
  $('#cmp-title').textContent = `${fresh.kind} · ${fresh.object || fresh.role || ''} · ${fresh.w}×${fresh.h} → ${fresh.w * sc}×${fresh.h * sc}`;
  buildCompareScalePicker(opts);
  buildCompareGrid();
  fitZoom(); applyTransform();
  const have = new Set(fresh.have);
  if (MODELS.some((m) => !have.has(m.id))) generate(fresh.hash, sc);
}

function fitZoom() {
  const view = M.tiles[0] && M.tiles[0].view;
  const r = view ? view.getBoundingClientRect() : { width: 240, height: 300 };
  const z = Math.min(r.width / M.p.w, r.height / M.p.h);
  M.z = Math.max(0.25, Math.min(24, z));
  $('#cmp-zoom').value = M.z.toFixed(2);
}

function buildCompareGrid() {
  const grid = $('#cmp-grid');
  grid.classList.toggle('twoup', M.twoup);
  grid.textContent = '';
  M.tiles = [];
  const have = new Set(M.p.have);
  // 2-up pins the ORIGINAL reference by id, not by index — the order is user-editable.
  const origM = MODELS.find((m) => m.id === 'orig') || MODELS[0];
  const list = M.twoup ? [origM, MODELS[M.active]].filter(Boolean) : MODELS;
  list.forEach((m) => {
    const idx = MODELS.indexOf(m);
    const tile = el('div', { className: 'cmp-tile' + (m.id === 'orig' ? ' orig' : '') });
    tile.dataset.model = m.id;
    const view = el('div', { className: 'cmp-view' });
    const t = { el: tile, view, disp: null, kind: null, srcData: null, model: m.id };
    if (have.has(m.id)) {
      // Cached variant → canvas tile so the contour fade can be applied live.
      const cv = el('canvas', {}); cv._natW = M.p.w * (M.scale || 4); view.append(cv);
      t.disp = cv; t.kind = 'canvas';
      loadCanvasTile(t, `/cache/${M.p.hash}/${variantFile(m.id, M.scale)}`);
    } else if (m.id === 'orig') {
      const img = el('img', {}); img.src = `/src/${M.p.sample}`; img._natW = M.p.w;
      view.append(img); img.onload = () => { img._natW = img.naturalWidth || img._natW; applyTransform(); };
      t.disp = img; t.kind = 'img';
    } else view.append(el('div', { className: 'cmp-gen' }, 'generating…'));
    const keyHint = (!M.twoup && idx < 10) ? `${(idx + 1) % 10}` : '';
    tile.append(view, el('div', { className: 'cmp-cap' }, [el('span', {}, m.label), el('span', { className: 'key' }, keyHint)]));
    tile.onclick = () => selectPic(M.p, m.id);
    grid.append(tile);
    M.tiles.push(t);
  });
  setTileSize(Number($('#cmp-size').value)); // apply current tile size to the new grid
  markSelected();
}

function refreshCompareVariants(p) {
  const have = new Set(p.have);
  M.p.have = p.have;
  for (const t of M.tiles) {
    if (!have.has(t.model) || t.kind === 'canvas') continue;
    // A previously-"generating…" tile now has its variant → make it a canvas.
    const genLbl = t.view.querySelector('.cmp-gen'); if (genLbl) genLbl.remove();
    // Must follow the popup's CURRENT scale, not a hardcoded ×4: at a higher scale this
    // would load the ×4 file and label it as the higher one.
    const cv = el('canvas', {}); cv._natW = M.p.w * (M.scale || SCALE_RANGE.min); t.view.append(cv);
    t.disp = cv; t.kind = 'canvas';
    loadCanvasTile(t, `/cache/${M.p.hash}/${variantFile(t.model, M.scale)}`);
  }
}

function markSelected() {
  const eff = M.p.selected || DEFAULT_MODEL;
  for (const t of M.tiles) {
    t.el.classList.toggle('selected', !!M.p.selected && t.model === M.p.selected);
    t.el.classList.toggle('default', !M.p.selected && t.model === eff);
  }
  const sel = MODELS.find((m) => m.id === M.p.selected);
  const def = MODELS.find((m) => m.id === DEFAULT_MODEL);
  $('#cmp-sel').textContent = sel ? `picked: ${sel.label}` : `default: ${def ? def.label : DEFAULT_MODEL}`;
}

function applyTransform() {
  const z = M.z;
  for (const t of M.tiles) {
    if (!t.disp) continue;
    const r = t.view.getBoundingClientRect();
    const scale = (M.p.w * z) / (t.disp._natW || M.p.w * 4);
    const tx = r.width / 2 - M.cx * z;
    const ty = r.height / 2 - M.cy * z;
    t.disp.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }
  $('#cmp-zoomval').textContent = `${z.toFixed(z < 2 ? 1 : 0)}×`;
}

// Apply contour-fade strength: re-render every canvas tile, persist per-picture.
function setContour(s, persist) {
  M.contour = s;
  $('#cmp-blendval').textContent = `${Math.round(s * 100)}%`;
  for (const t of M.tiles) renderTile(t);
  if (persist) {
    clearTimeout(setContour._t);
    setContour._t = setTimeout(() => {
      api('/api/contour', { method: 'POST', body: JSON.stringify({ hashes: targets(M.p), strength: s }) }).catch(() => {});
    }, 350);
  }
}

// Apply global net scale (supersample→downscale): re-render tiles, persist globally.
function setSuperscale(v, persist) {
  M.superscale = v; SUPERSCALE = v;
  $('#cmp-superval').textContent = `${v.toFixed(2).replace(/0$/, '')}×`;
  for (const t of M.tiles) renderTile(t);
  if (persist) {
    clearTimeout(setSuperscale._t);
    setSuperscale._t = setTimeout(() => {
      api('/api/superscale', { method: 'POST', body: JSON.stringify({ value: v }) }).catch(() => {});
    }, 350);
  }
}

// Apply edge-smoother params (blur radius + crispness): re-render, persist globally.
function setSmooth(sigma, crisp, persist) {
  M.smoothSigma = sigma; M.smoothCrisp = crisp; SMOOTH_SIGMA = sigma; SMOOTH_CRISP = crisp;
  $('#cmp-smoothval').textContent = sigma.toFixed(2).replace(/0$/, '');
  $('#cmp-crispval').textContent = `${Math.round(crisp * 100)}%`;
  for (const t of M.tiles) renderTile(t);
  if (persist) {
    clearTimeout(setSmooth._t);
    setSmooth._t = setTimeout(() => {
      api('/api/smooth', { method: 'POST', body: JSON.stringify({ sigma, crisp }) }).catch(() => {});
    }, 350);
  }
}

function setTileSize(w) {
  const grid = $('#cmp-grid');
  grid.style.setProperty('--tile-w', w + 'px');
  grid.style.setProperty('--tile-h', Math.round(w * 0.8) + 'px');
  applyTransform(); // re-center for the new viewport size
}

function closeCompare() { M.open = false; $('#compare').classList.add('hidden'); $('#order-panel').classList.add('hidden'); }

// ---- room preview (AI vs original, side by side) -------------------------
const PV = { open: false, room: null, scale: 4, urls: { ai: null, orig: null } };
async function loadPane(room, variant, imgId, onInfo, scale = null) {
  const img = $(imgId);
  img.removeAttribute('src');
  const q = scale ? `&scale=${scale}` : '';   // omitted → server uses the shipped scale
  const r = await fetch(`/api/preview/${room}?variant=${variant}${q}&t=${Date.now()}`);
  if (!r.ok) { const j = await r.json().catch(() => ({})); onInfo(null, 'error: ' + (j.error || r.status)); return; }
  const key = variant === 'orig' ? 'orig' : 'ai';
  if (PV.urls[key]) URL.revokeObjectURL(PV.urls[key]);
  PV.urls[key] = URL.createObjectURL(await r.blob());
  img.src = PV.urls[key];
  onInfo({
    dims: r.headers.get('x-preview-dims') || '',
    missing: Number(r.headers.get('x-preview-missing') || 0),
    scale: Number(r.headers.get('x-preview-scale') || 0),
  });
}
async function openPreview(room) {
  PV.open = true; PV.room = room;
  PV.scale = ROOM_SCALE || SCALE_RANGE.min;
  $('#preview').classList.remove('hidden');
  buildPreviewScalePicker();
  await renderPreview();
}

/** Scale buttons: the room's shipped scale plus ×4, so the gain is directly visible. */
function buildPreviewScalePicker() {
  const box = $('#pv-scales');
  box.textContent = '';
  const opts = [...new Set([SCALE_RANGE.min, ROOM_SCALE || SCALE_RANGE.min])].sort((a, b) => a - b);
  for (const sc of opts) {
    const b = el('button', {
      className: 'pv-scale' + (sc === PV.scale ? ' on' : ''),
      textContent: `×${sc}`,
      title: sc === ROOM_SCALE ? 'the scale this room ships at' : 'baseline for comparison',
      onclick: () => { if (PV.scale !== sc) { PV.scale = sc; buildPreviewScalePicker(); renderPreview(); } },
    });
    box.append(b);
  }
}

async function renderPreview() {
  const room = PV.room;
  $('#pv-title').textContent = `Preview — ${room} · ×${PV.scale}${PV.scale === ROOM_SCALE ? ' (shipped)' : ''}`;
  $('#pv-missing').textContent = 'composing…';
  let aiInfo = null;
  await Promise.all([
    loadPane(room, 'ai', '#pv-img-ai', (info, err) => { aiInfo = info; if (err) $('#pv-missing').textContent = err; }, PV.scale),
    loadPane(room, 'orig', '#pv-img-orig', () => {}, PV.scale),
  ]);
  setPreviewZoom(Number($('#pv-zoom').value));
  $('#pv-seam').value = STRETCH_OVER; $('#pv-seamval').textContent = `${STRETCH_OVER.toFixed(1).replace(/\.0$/, '')}px`;
  if (aiInfo) {
    $('#pv-missing').textContent = `${aiInfo.dims}`
      + (aiInfo.missing ? ` · ${aiInfo.missing} layer(s) not generated at ×${PV.scale} (NN placeholder)` : ' · all layers generated');
  }
}
// Seam fill only changes the AI composite → re-fetch just that pane (debounced).
function setPreviewSeam(value) {
  STRETCH_OVER = value; M.stretchOver = value;
  $('#pv-seamval').textContent = `${value.toFixed(1).replace(/\.0$/, '')}px`;
  clearTimeout(setPreviewSeam._t);
  setPreviewSeam._t = setTimeout(() => {
    api('/api/overlap', { method: 'POST', body: JSON.stringify({ value }) })
      .then(() => { if (PV.open && PV.room) { $('#pv-missing').textContent = 'composing…'; return loadPane(PV.room, 'ai', '#pv-img-ai', () => {}, PV.scale); } })
      .then(() => { setPreviewZoom(Number($('#pv-zoom').value)); $('#pv-missing').textContent = 'seam fill applied'; })
      .catch(() => {});
  }, 300);
}
function setPreviewZoom(pct) {
  const t = `scale(${pct / 100})`;
  $('#pv-img-ai').style.transform = t; $('#pv-img-orig').style.transform = t;
  $('#pv-zoomval').textContent = `${pct}%`;
}
function closePreview() {
  PV.open = false; $('#preview').classList.add('hidden');
  for (const k of ['ai', 'orig']) if (PV.urls[k]) { URL.revokeObjectURL(PV.urls[k]); PV.urls[k] = null; }
}
$('#pv-zoom').addEventListener('input', () => setPreviewZoom(Number($('#pv-zoom').value)));
$('#pv-seam').addEventListener('input', () => setPreviewSeam(Number($('#pv-seam').value)));
$('#pv-close').addEventListener('click', closePreview);
$('#pv-finder').addEventListener('click', () => { if (PV.room) api('/api/reveal-preview/' + PV.room, { method: 'POST' }).catch(() => {}); });

// ---- build the shipped `ai` tier (public/enhanced-ai) --------------------
// The Studio only curates; the game reads public/enhanced-ai/. This runs
// tools/studio/build-ai.mjs, which ships each picture's PICKED model (generating
// it if that variant was never cached) — so the game finally matches the picks.
let buildPoll = null;
function stopBuildPoll() { if (buildPoll) { clearInterval(buildPoll); buildPoll = null; } }
async function pollBuild() {
  const j = await api('/api/build-status').catch(() => null);
  if (!j) return;
  const last = j.log && j.log.length ? j.log[j.log.length - 1] : '';
  if (j.running) { $('#pv-buildstat').textContent = `building ${j.target}… ${last}`; return; }
  stopBuildPoll();
  $('#pv-build').disabled = false; $('#pv-build-all').disabled = false;
  $('#pv-buildstat').textContent = j.error ? `build FAILED: ${j.error}` : `✓ ${last || 'build done'}`;
  if (!j.error && PV.room) loadPane('ai'); // reflect freshly built art
}
async function startBuild(all) {
  if (!all && !PV.room) return;
  $('#pv-build').disabled = true; $('#pv-build-all').disabled = true;
  $('#pv-buildstat').textContent = 'starting build…';
  const r = await api(all ? '/api/build-all' : `/api/build-room/${PV.room}`, { method: 'POST' }).catch(() => null);
  if (!r || r.error) {
    $('#pv-build').disabled = false; $('#pv-build-all').disabled = false;
    $('#pv-buildstat').textContent = `build not started: ${(r && r.error) || 'request failed'}`;
    return;
  }
  stopBuildPoll();
  buildPoll = setInterval(pollBuild, 700);
}
$('#pv-build').addEventListener('click', () => startBuild(false));
$('#pv-build-all').addEventListener('click', () => startBuild(true));
// synced scroll between the two panes
(() => {
  let lock = false;
  const a = () => $('#pv-wrap-ai'), b = () => $('#pv-wrap-orig');
  const sync = (from, to) => { if (lock || !$('#pv-sync').checked) return; lock = true; to().scrollTop = from().scrollTop; to().scrollLeft = from().scrollLeft; lock = false; };
  document.addEventListener('scroll', (e) => {
    if (!PV.open) return;
    if (e.target === a()) sync(a, b); else if (e.target === b()) sync(b, a);
  }, true);
})();

// drag-to-pan inside either preview pane (scroll-based → scroll-sync mirrors it)
(() => {
  let wrap = null, sx = 0, sy = 0, sl = 0, st = 0;
  const onDown = (e) => {
    if (e.button !== 0) return;
    wrap = e.currentTarget;
    sx = e.clientX; sy = e.clientY; sl = wrap.scrollLeft; st = wrap.scrollTop;
    wrap.classList.add('dragging'); e.preventDefault();
  };
  const onMove = (e) => {
    if (!wrap) return;
    wrap.scrollLeft = sl - (e.clientX - sx);
    wrap.scrollTop = st - (e.clientY - sy);
  };
  const onUp = () => { if (wrap) wrap.classList.remove('dragging'); wrap = null; };
  for (const id of ['#pv-wrap-ai', '#pv-wrap-orig']) $(id).addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
})();

// controls
$('#cmp-zoom').addEventListener('input', () => { M.z = Number($('#cmp-zoom').value); applyTransform(); });
$('#cmp-size').addEventListener('input', () => { setTileSize(Number($('#cmp-size').value)); });
$('#cmp-blend').addEventListener('input', () => setContour(Number($('#cmp-blend').value) / 100, true));
$('#cmp-super').addEventListener('input', () => setSuperscale(Number($('#cmp-super').value), true));
$('#cmp-smooth').addEventListener('input', () => setSmooth(Number($('#cmp-smooth').value), M.smoothCrisp, true));
$('#cmp-crisp').addEventListener('input', () => setSmooth(M.smoothSigma, Number($('#cmp-crisp').value) / 100, true));
$('#cmp-fit').addEventListener('click', () => { M.cx = M.p.w / 2; M.cy = M.p.h / 2; fitZoom(); applyTransform(); });
$('#cmp-finder').addEventListener('click', () => { const m = MODELS[M.active]; openFinder(M.p.hash, m && m.id !== 'orig' ? m.id : undefined); });
$('#cmp-close').addEventListener('click', closeCompare);
$('#cmp-2up').addEventListener('change', () => { M.twoup = $('#cmp-2up').checked; $('#cmp-2up').blur(); buildCompareGrid(); applyTransform(); });

// ---- algorithm order editor ---------------------------------------------
// The display order of the algorithms is a GLOBAL app setting (persisted in
// modelorder.json). Edited here in Compare; every screen reads MODELS, so the
// tile order and the 1–9/0 hotkeys follow it everywhere.
function renderOrderList() {
  const box = $('#order-list');
  box.textContent = '';
  MODELS.forEach((m, i) => {
    const row = el('div', { className: 'order-row' });
    row.draggable = true; row.dataset.id = m.id;
    const up = el('button', { title: 'move up', textContent: '↑' });
    const dn = el('button', { title: 'move down', textContent: '↓' });
    up.disabled = i === 0; dn.disabled = i === MODELS.length - 1;
    up.addEventListener('click', () => moveModel(i, i - 1));
    dn.addEventListener('click', () => moveModel(i, i + 1));
    row.append(
      el('span', { className: 'grip', textContent: '⠿' }),
      el('span', { className: 'num', textContent: String(i + 1) }),
      el('span', { className: 'name', textContent: m.label }),
      up, dn,
    );
    row.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('over'); });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('over');
      const from = MODELS.findIndex((x) => x.id === e.dataTransfer.getData('text/plain'));
      if (from >= 0 && from !== i) moveModel(from, i);
    });
    box.append(row);
  });
}
async function commitOrder(body) {
  const activeId = MODELS[M.active] && MODELS[M.active].id;
  const r = await api('/api/model-order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r && Array.isArray(r.models)) MODELS = r.models;
  const ai = MODELS.findIndex((m) => m.id === activeId); // keep the same tile selected
  M.active = ai >= 0 ? ai : 0;
  renderOrderList();
  if (M.open) { buildCompareGrid(); applyTransform(); }
}
function moveModel(from, to) {
  if (to < 0 || to >= MODELS.length) return;
  const next = MODELS.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  MODELS = next;
  commitOrder({ order: MODELS.map((m) => m.id) });
}
$('#cmp-order').addEventListener('click', () => {
  const p = $('#order-panel');
  p.classList.toggle('hidden');
  if (!p.classList.contains('hidden')) renderOrderList();
});
$('#order-done').addEventListener('click', () => $('#order-panel').classList.add('hidden'));
$('#order-reset').addEventListener('click', () => commitOrder({ reset: true }));

// drag to pan + wheel zoom (synced)
(() => {
  let dragging = false, lastX = 0, lastY = 0;
  $('#cmp-grid').addEventListener('mousedown', (e) => {
    const view = e.target.closest('.cmp-view'); if (!view) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY; view.classList.add('dragging'); e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    M.cx -= (e.clientX - lastX) / M.z; M.cy -= (e.clientY - lastY) / M.z;
    lastX = e.clientX; lastY = e.clientY; applyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; document.querySelectorAll('.cmp-view.dragging').forEach((v) => v.classList.remove('dragging')); });
  $('#cmp-grid').addEventListener('wheel', (e) => {
    const view = e.target.closest('.cmp-view'); if (!view) return;
    e.preventDefault();
    const r = view.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const sx = M.cx + (px - r.width / 2) / M.z, sy = M.cy + (py - r.height / 2) / M.z;
    M.z = Math.max(0.25, Math.min(24, M.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    M.cx = sx - (px - r.width / 2) / M.z; M.cy = sy - (py - r.height / 2) / M.z;
    $('#cmp-zoom').value = M.z.toFixed(2); applyTransform();
  }, { passive: false });
})();

// keyboard: 1–9/0 pick, ←/→ cycle active (2-up), Esc close
document.addEventListener('keydown', (e) => {
  if (PV.open && e.key === 'Escape') return closePreview();
  if (!M.open) return;
  if (e.key === 'Escape') return closeCompare();
  if (e.target.tagName === 'INPUT') return;
  if (/^[0-9]$/.test(e.key)) {
    const idx = e.key === '0' ? 9 : Number(e.key) - 1;
    if (MODELS[idx]) selectPic(M.p, MODELS[idx].id);
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const d = e.key === 'ArrowRight' ? 1 : -1;
    let n = M.active;
    do { n = (n + d + MODELS.length) % MODELS.length; } while (MODELS[n].id === 'orig');
    M.active = n;
    if (M.twoup) { buildCompareGrid(); applyTransform(); }
    else document.querySelectorAll('.cmp-tile').forEach((t) => t.classList.toggle('active', t.dataset.model === MODELS[n].id));
  }
});

window.addEventListener('resize', () => { if (M.open) applyTransform(); });
$('#filter').addEventListener('input', refreshNav);
$('#queuebar-cancel').addEventListener('click', cancelQueue);
function setThumbSize(px) {
  const cards = $('#cards');
  cards.style.setProperty('--thumb', px + 'px');
  cards.style.setProperty('--card-min', Math.max(360, Math.round(px * 3 + 60)) + 'px');
}
$('#thumb-size').addEventListener('input', () => setThumbSize(Number($('#thumb-size').value)));

boot();
startQueueWatch(); // pick up any queue already running from before a reload
