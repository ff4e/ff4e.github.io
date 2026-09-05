/**
 * The layout lab's wiring — DEV ONLY. See `tools/layout-lab.html` for what it is for.
 *
 * It holds no scaling maths: every number on screen comes from `tools/layoutPlaced.ts`,
 * which calls `src/app/layout.ts` directly. This file turns that into rectangles, runs the
 * small local probes that make a property visible at the viewport you are looking at, and
 * writes the settings block the Copy button puts on the clipboard.
 */
import {
  FIT_MODES,
  CELL_NATIVE,
  MAX_CELL_PX,
  MIN_STAGE_SCALE,
  PANEL_FOOTPRINT_W,
  PANEL_NATIVE_H,
  PANEL_NATIVE_W,
  STAGE_GAP,
  STAGE_H,
  STAGE_W,
  VIEWPORT_MARGIN,
} from '../src/app/layout.js';
import type { FitMode } from '../src/app/layout.js';
import { TARGET_DEFAULTS } from './layoutModel.js';
import type { LayoutRequest, LayoutResult, LayoutTarget, StripEdge } from './layoutModel.js';
import { layoutRoom, preferredStripEdge } from './layoutPlaced.js';
import { LAB_MAP, LAB_ROOMS } from './layoutLabRooms.js';
import { LAB_VIEWPORTS, sizeFor } from './layoutLabViewports.js';
import type { LabDevice, LabOrientation, LabSize } from './layoutLabViewports.js';
import { housingFor, housingUnmeasuredInPortrait } from './layoutLabHousings.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** `"720x585"` -> `[720, 585]`. The option values carry the size, so the picker needs no map. */
const size = (v: string): [number, number] => {
  const [w, h] = v.split('x').map(Number);
  return [w ?? 0, h ?? 0];
};

/**
 * Everything ONE target owns. Held per target rather than globally, because switching
 * target used to overwrite the sliders with that target's defaults — so tuning PC, moving
 * to Touch and coming back lost the PC values, and exporting all three was impossible.
 * These are also exactly the numbers the export prints, so a switch can no longer silently
 * turn a value you set back into a default.
 */
interface TargetSettings {
  stripLeft: number;
  stripTop: number;
  /**
   * The reserve per viewport edge, per axis. Two numbers because the TV title-safe
   * convention is asymmetric and because the two cost very different amounts — 0.56%
   * horizontally against 4.62% vertically, since the rooms are already letterboxed sideways
   * on a 16:9 screen.
   */
  marginX: number;
  marginY: number;
  /** `MAX_CELL_PX` — the ceiling on how big one 15px game cell may be drawn. */
  maxCellPx: number;
  /**
   * The fit mode.
   *
   * Per target because that is the open question: the game has ONE shared mode and forces
   * touch and TV to `fill`, since the stored value is whatever a mouse session last chose.
   * Holding one each is what lets the lab show the alternative.
   */
  mode: FitMode;
}

interface State {
  target: LayoutTarget;
  /** One settings record per target — see `TargetSettings`. */
  per: Record<LayoutTarget, TargetSettings>;
  roomW: number;
  roomH: number;
  roomName: string;
  vw: number;
  vh: number;
  /**
   * Which way up the chosen device is held. Landscape and portrait are not two sizes of the
   * same problem: in landscape HEIGHT is the scarce axis, so a left strip comes out of the
   * axis with slack and is nearly free, while in portrait that inverts — and the shipped
   * game changes rule with it (see `edgeFor`).
   */
  orient: LabOrientation;
  chrome: number;
  /**
   * The display cutout, CSS px — one number, applied to whichever edge the housing is on
   * for the orientation being shown.
   *
   * A property of the DEVICE and not of the target, so it sits beside `chrome` rather than
   * in `TargetSettings`: it is something you are looking through, not something being
   * decided. Selecting a native iPhone sets it; the slider then lets any viewport be given
   * one, which is how "would this window still prefer the left edge on a phone's housing?"
   * gets answered without inventing a device row.
   *
   * It and `chrome` are opposites in practice — a native app has a cutout and no browser
   * furniture, a browser has furniture and (already) no cutout — but nothing stops both
   * being set, because a wrong combination is more useful visible than forbidden.
   */
  inset: number;
  /** A view override, not a value being decided — so it is shared, not per target. */
  edge: 'auto' | 'left' | 'top';
  dpr: number;
  grid: boolean;
  guide: boolean;
}

/** A target's settings as they ship / are proposed today. */
function defaultsFor(t: LayoutTarget): TargetSettings {
  const d = TARGET_DEFAULTS[t];
  return {
    stripLeft: d.left,
    stripTop: d.top,
    marginX: d.marginX,
    marginY: d.marginY,
    maxCellPx: d.maxCellPx,
    mode: t === 'pc' ? 'medium' : 'fill',
  };
}

const state: State = {
  target: 'pc',
  per: { pc: defaultsFor('pc'), touch: defaultsFor('touch'), tv: defaultsFor('tv') },
  roomW: 720,
  roomH: 585,
  roomName: 'BOTTLES',
  vw: 1491,
  vh: 1114,
  orient: 'landscape',
  chrome: 0,
  inset: 0,
  edge: 'auto',
  dpr: 1,
  grid: true,
  guide: true,
};

/** The settings of the target currently on screen. */
function cur(): TargetSettings {
  return state.per[state.target];
}

/**
 * Tuning survives a reload.
 *
 * The lab is where the numbers are decided and then pasted into a conversation, so losing
 * them to a stray refresh is the same annoyance as losing them to a target switch. Only the
 * per-target settings are stored — the room and the viewport are what you are looking
 * through, not what you are deciding.
 */
const STORE_KEY = 'ff-layout-lab-v1';
function saveTuning(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.per));
  } catch {
    // A private window can refuse storage; the lab still works, it just forgets.
  }
}
function loadTuning(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const v = JSON.parse(raw) as Partial<Record<LayoutTarget, Partial<TargetSettings>>>;
    for (const t of ['pc', 'touch', 'tv'] as const) {
      if (v[t]) Object.assign(state.per[t], v[t]);
    }
  } catch {
    // Corrupt or from an older shape — the defaults are a fine answer.
  }
}

const TARGET_HINT: Record<LayoutTarget, string> = {
  pc: 'Mouse + keyboard. The faithful 155x395 panel is reserved in native px beside the room, and the player picks the fit mode.',
  touch: 'Finger. No panel, a strip on one edge, and the fit mode is forced to fill — a phone has no pixels to spare.',
  tv: 'Gamepad. Same shape as touch but a thinner strip (a legend, not touch targets) and a title-safe margin. Fixed 16:9, never resizes. Nothing in src/ builds this yet.',
};

// ── Controls ────────────────────────────────────────────────────────────────

function buildSelects(): void {
  const room = $<HTMLSelectElement>('room');
  const opt = (v: string, t: string) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    return o;
  };
  room.append(opt('640x480', 'MAP — 640x480 (not a room, same layout code)'));
  for (const r of LAB_ROOMS) {
    const ar = (r.w / r.h).toFixed(2);
    room.append(opt(`${r.w}x${r.h}`, `${String(r.n).padStart(2, ' ')} ${r.name} — ${r.w}x${r.h} (${ar}:1)`));
  }

  const preset = $<HTMLSelectElement>('preset');
  let group: HTMLOptGroupElement | null = null;
  let lastKlass = '';
  const LABELS: Record<string, string> = {
    probe: 'Where the defects were found',
    desktop: 'Desktop windows',
    tv: 'TV',
    native: 'iPhones (native app — full screen, with the cutout)',
    phone: 'Phones (Playwright)',
    tablet: 'Tablets (Playwright)',
    foldable: 'Foldables (Playwright)',
  };
  // One option per DEVICE, not per size: the orientation switch picks which of its two
  // shapes is used. A flat by-size list put a phone's two orientations dozens of entries
  // apart, which reads as two devices.
  for (const [i, d] of LAB_VIEWPORTS.entries()) {
    if (d.klass !== lastKlass) {
      group = document.createElement('optgroup');
      group.label = LABELS[d.klass] ?? d.klass;
      preset.append(group);
      lastKlass = d.klass;
    }
    const both = d.port && d.land;
    const shapes = both
      ? `${d.land!.w}x${d.land!.h} / ${d.port!.w}x${d.port!.h}`
      : `${(d.land ?? d.port)!.w}x${(d.land ?? d.port)!.h}`;
    const o = opt(String(i), `${d.name} — ${shapes}`);
    if (d.note) o.title = d.note;
    group!.append(o);
  }

  const mode = $<HTMLSelectElement>('mode');
  for (const m of FIT_MODES) mode.append(opt(m, m === 'medium' ? `${m} (shipped default)` : m));
}

function wire(): void {
  const num = (id: string, key: 'roomW' | 'roomH' | 'vw' | 'vh') => {
    const el = $<HTMLInputElement>(id);
    el.value = String(state[key]);
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if (Number.isFinite(v) && v > 0) {
        state[key] = v;
        // Typing a size is as valid a way to change orientation as the switch is.
        if (key === 'vw' || key === 'vh') {
          state.orient = state.vw >= state.vh ? 'landscape' : 'portrait';
          syncOrientButtons();
        }
        render();
      }
    });
  };
  num('roomw', 'roomW');
  num('roomh', 'roomH');
  num('vw', 'vw');
  num('vh', 'vh');

  $<HTMLSelectElement>('room').addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    const [w, h] = size(sel.value);
    state.roomW = w;
    state.roomH = h;
    const opt = sel.selectedOptions[0]?.textContent ?? '';
    state.roomName = opt.trim().split(/\s+/)[1] ?? 'room';
    if (state.roomName === '—') state.roomName = 'MAP';
    $<HTMLInputElement>('roomw').value = String(w);
    $<HTMLInputElement>('roomh').value = String(h);
    render();
  });

  $<HTMLSelectElement>('preset').addEventListener('change', (e) => {
    const d = device(Number((e.target as HTMLSelectElement).value));
    // Follow the device rather than the switch when it only exists one way up: picking a
    // 1491x1114 window and being handed it sideways is never what was meant.
    if (d.port && !d.land) state.orient = 'portrait';
    else if (d.land && !d.port) state.orient = 'landscape';
    applyDevice(d);
  });

  for (const b of $('orient').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const v = (b as HTMLElement).dataset.v;
      if (v === 'rotate') {
        // Rotate whatever is on screen, preset or hand-typed — the honest way to ask
        // "what does this layout do the other way up?" for a size no device has.
        [state.vw, state.vh] = [state.vh, state.vw];
        state.orient = state.vw >= state.vh ? 'landscape' : 'portrait';
        syncViewport();
        render();
        return;
      }
      state.orient = v as LabOrientation;
      applyDevice(currentDevice());
    });
  }

  for (const b of $('target').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      state.target = (b as HTMLElement).dataset.v as LayoutTarget;
      for (const o of $('target').querySelectorAll('button')) {
        o.setAttribute('aria-pressed', String(o === b));
      }
      // Each target brings its own proposed strip and margin — they are the numbers
      // this task exists to decide, so switching target must not silently keep the last
      // target's ones.
      // Switching RESTORES this target's settings; it does not reset them. Resetting is
      // what made tuning all three impossible — every switch quietly overwrote the sliders
      // with defaults, so the export printed a default for whichever target you had left.
      syncSliders();
      render();
    });
  }

  $<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    cur().mode = (e.target as HTMLSelectElement).value as FitMode;
    saveTuning();
    render();
  });
  $<HTMLSelectElement>('edge').addEventListener('change', (e) => {
    state.edge = (e.target as HTMLSelectElement).value as State['edge'];
    render();
  });

  /** A slider over one of the CURRENT TARGET's settings — remembered per target, and saved. */
  const targetSlider = (
    id: string,
    key: 'stripLeft' | 'stripTop' | 'marginX' | 'marginY' | 'maxCellPx',
    out: string,
  ) => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => {
      cur()[key] = Number(el.value);
      $(out).textContent = el.value;
      saveTuning();
      render();
    });
  };
  targetSlider('stripleft', 'stripLeft', 'striplefv');
  targetSlider('striptop', 'stripTop', 'striptopv');
  targetSlider('marginx', 'marginX', 'marginxv');
  targetSlider('marginy', 'marginY', 'marginyv');
  targetSlider('maxcell', 'maxCellPx', 'maxcellv');

  /** A slider over something you are looking THROUGH rather than deciding — not per target. */
  const viewSlider = (id: string, key: 'dpr' | 'chrome' | 'inset', out: string) => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => {
      state[key] = Number(el.value);
      $(out).textContent = el.value;
      // The hint says which edge this cutout is actually costing, and that changes with the
      // orientation and with nothing else on this slider.
      syncOrientButtons();
      render();
    });
  };
  viewSlider('dpr', 'dpr', 'dprv');
  viewSlider('chrome', 'chrome', 'chromev');
  viewSlider('inset', 'inset', 'insetv');

  const chk = (id: string, key: 'grid' | 'guide') => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('change', () => {
      state[key] = el.checked;
      render();
    });
  };
  chk('showgrid', 'grid');
  chk('showguide', 'guide');

  $<HTMLSelectElement>('room').value = `${state.roomW}x${state.roomH}`;

  window.addEventListener('resize', render);
}

/** The device row behind a picker index. */
function device(i: number): LabDevice {
  return LAB_VIEWPORTS[i] ?? LAB_VIEWPORTS[0]!;
}

function currentDevice(): LabDevice {
  return device(Number($<HTMLSelectElement>('preset').value) || 0);
}

/** Put a device on screen the currently-selected way up. */
function applyDevice(d: LabDevice): void {
  const s = sizeFor(d, state.orient);
  state.vw = s.w;
  state.vh = s.h;
  // The housing travels with the device: picking an iPhone has to bring its cutout, or the
  // native row would be nothing but a bigger viewport — which is the half of the truth the
  // lab already had.
  state.inset = housingFor(d, state.orient).left;
  syncViewport();
  render();
}

function syncViewport(): void {
  $<HTMLInputElement>('vw').value = String(state.vw);
  $<HTMLInputElement>('vh').value = String(state.vh);
  $<HTMLInputElement>('inset').value = String(state.inset);
  $('insetv').textContent = String(state.inset);
  syncOrientButtons();
}

/**
 * The switch and the hint, without touching the two number inputs — which is the whole
 * reason this is separate: writing them back while the user is typing in one of them moves
 * the caret to the end after every keystroke.
 */
function syncOrientButtons(): void {
  for (const b of $('orient').querySelectorAll('button')) {
    const v = (b as HTMLElement).dataset.v;
    if (v !== 'rotate') b.setAttribute('aria-pressed', String(v === state.orient));
  }
  const d = currentDevice();
  const axis =
    state.orient === 'landscape'
      ? 'Landscape: height is the scarce axis, so a LEFT strip is nearly free and a top one is not.'
      : "Portrait: the shipped game's media query owns this and always puts the bar on TOP.";
  // Once the corner has been dragged the viewport is no longer the device that is still
  // showing in the picker, and saying so is the point — a size nothing ships is exactly the
  // kind of window the two defects were found in.
  const fits = (s: LabSize | null) => !!s && s.w === state.vw && s.h === state.vh;
  const onDevice = fits(d.port) || fits(d.land);
  const transposed = !onDevice && (state.orient === 'portrait' ? !d.port : !d.land);
  // The cutout is the other half of "which device is this", and it is the half a size alone
  // cannot show — 852x393 with a 62px island and 852x393 without one are different phones as
  // far as the bar is concerned.
  const housing = state.inset
    ? state.orient === 'landscape'
      ? ` Cutout ${state.inset}px on the LEFT edge — it costs the room only when the bar is there.`
      : ` Cutout ${state.inset}px on the TOP edge, which is where the bar already is in portrait.`
    : housingUnmeasuredInPortrait(d) && state.orient === 'portrait'
      ? ` ${d.name} has a cutout, but only its landscape one was ever measured (layoutLabHousings.ts) — so this is showing 0, not a phone without one.`
      : '';
  $('orienthint').textContent = (onDevice
    ? axis
    : transposed
      ? `${axis} (${d.name} is listed ${state.orient === 'portrait' ? 'landscape' : 'portrait'} only, so this size is transposed.)`
      : `${axis} (Custom size — no longer ${d.name}.)`) + housing;
}

function syncSliders(): void {
  $<HTMLInputElement>('stripleft').value = String(cur().stripLeft);
  $('striplefv').textContent = String(cur().stripLeft);
  $<HTMLInputElement>('striptop').value = String(cur().stripTop);
  $('striptopv').textContent = String(cur().stripTop);
  $<HTMLInputElement>('marginx').value = String(cur().marginX);
  $('marginxv').textContent = String(cur().marginX);
  $<HTMLInputElement>('marginy').value = String(cur().marginY);
  $('marginyv').textContent = String(cur().marginY);
  $<HTMLInputElement>('maxcell').value = String(cur().maxCellPx);
  $('maxcellv').textContent = String(cur().maxCellPx);
}

// ── The layout ──────────────────────────────────────────────────────────────

/** The viewport actually handed to the page, once browser chrome is off the height. */
function viewport(): { w: number; h: number } {
  return { w: state.vw, h: Math.max(80, state.vh - state.chrome) };
}

function request(edge: StripEdge): LayoutRequest {
  const v = viewport();
  return {
    viewportW: v.w,
    viewportH: v.h,
    roomW: state.roomW,
    roomH: state.roomH,
    target: state.target,
    mode: cur().mode,
    // The game would force touch and TV to `fill`; the lab draws what was asked instead, so
    // "what would a phone look like on `medium`?" is answerable by looking.
    respectMode: true,
    stripEdge: edge,
    stripPx: edge === 'top' ? cur().stripTop : cur().stripLeft,
    // One slider, put on the edge the housing is physically on: in landscape the notch or
    // island is on a SIDE, in portrait it is along the top. The model prices whichever edge
    // the strip lands on, so handing it both would be claiming a phone with two cutouts.
    insetLeft: state.orient === 'landscape' ? state.inset : 0,
    insetTop: state.orient === 'landscape' ? 0 : state.inset,
    marginPx: { x: cur().marginX, y: cur().marginY },
    maxCellPx: cur().maxCellPx,
    dpr: state.dpr,
  };
}

/** Which edge the strip takes, by the shipped rule (#128), unless it is being overridden. */
function edgeFor(): StripEdge {
  if (state.target === 'pc') return 'none';
  if (state.edge !== 'auto') return state.edge;
  // **Portrait is not the room-aware rule's business.** In the shipped game a plain
  // `@media (orientation: portrait)` puts the bar along the top and `touchBarEdge.ts` is
  // never consulted — its own header says callers must have established landscape first.
  // Modelling that here matters: a portrait phone is width-bound, so the comparison would
  // often say 'left' and the lab would be showing a layout the game cannot produce.
  const v = viewport();
  if (v.h > v.w) return 'top';
  const base = request('left');
  // The strip differs per edge, so the rule has to price each edge with its own size — and
  // each model has to be asked with its OWN placement, since the whole-room test can only
  // ever fire on the pre-rework one.
  const both = (e: StripEdge) => ({
    ...base,
    stripEdge: e,
    stripPx: e === 'top' ? cur().stripTop : cur().stripLeft,
  });
  const top = layoutRoom(both('top'));
  const left = layoutRoom(both('left'));
  if (top.cut !== left.cut) return top.cut ? 'left' : 'top';
  return top.visible >= left.visible ? 'top' : 'left'; // ties go to the top (#128)
}

// ── Rendering ───────────────────────────────────────────────────────────────

const frames = $('frames');

/**
 * Which revision of `src/app/layout.ts` the left panel is actually showing.
 *
 * The lab imports the layout out of the WORKING TREE, so it shows whatever is checked out —
 * on a feature branch that is neither `main` nor what players are running. Calling it
 * "shipped" was wrong twice over, and the difference matters most exactly when it is easiest
 * to forget: comparing a reworked layout against a defect that only still exists on `main`.
 * Served by the dev-only `ff-lab-git-info` plugin in vite.config.ts.
 */
let git: { branch: string; head: string; differsFromMain: boolean; uncommitted: boolean } | null =
  null;

function gitLabel(): string {
  if (!git) return 'this working tree';
  const bits = [`branch <b>${git.branch}</b> @ ${git.head}`];
  bits.push(
    git.differsFromMain
      ? '<b style="color:#eb6">differs from origin/main</b>'
      : '<span style="color:#8d8">same as origin/main</span>',
  );
  if (git.uncommitted) bits.push('<b style="color:#eb6">uncommitted edits</b>');
  return bits.join(' · ');
}

/**
 * The scale `render()` last drew the frames at. Module-level because a drag in progress has
 * to convert screen px into viewport px with the CURRENT one, and the drag outlives every
 * DOM node `render()` makes.
 */
let zoomNow = 1;

function render(): void {
  const v = viewport();
  const zoom = Math.min(1, (frames.clientWidth - 4) / v.w, (frames.clientHeight - 78) / v.h);
  zoomNow = zoom;

  const edge = edgeFor();
  const r = layoutRoom({ ...request(edge), stripEdge: edge });

  frames.textContent = '';
  frames.append(frameFor(r, edge, zoom, v));

  $('topline').innerHTML =
    `<b>${state.roomName} ${state.roomW}x${state.roomH}</b> (${(state.roomW / state.roomH).toFixed(2)}:1)` +
    ` &nbsp;in&nbsp; <b>${v.w}x${v.h}</b> (${(v.w / v.h).toFixed(2)}:1)` +
    (state.chrome ? ` &nbsp;<span style="color:#667">${state.vh} minus ${state.chrome} of chrome</span>` : '') +
    (state.inset
      ? ` &nbsp;<span style="color:#667">${state.inset}px cutout on the ${state.orient === 'landscape' ? 'left' : 'top'}</span>`
      : '') +
    ` &nbsp;·&nbsp; drawn at <b>${(zoom * 100).toFixed(0)}%</b> here` +
    ` &nbsp;·&nbsp; <span style="color:#667">${gitLabel()}</span>`;

  $('targethint').textContent = TARGET_HINT[state.target];
  // The cell is what a player perceives — a crate, a step — so its size is reported in the
  // units the decision was made in, including whether the ceiling is actually doing anything.
  const cellPx = r.contentScale * CELL_NATIVE;
  const bound = cellPx >= cur().maxCellPx - 0.51;
  $('cellhint').textContent =
    `This cell: ${cellPx.toFixed(1)}px${bound ? ' — AT the ceiling' : ' — under the ceiling, it is not binding here'}. ` +
    `28 reproduces the 1998 original's apparent size on a desktop (an 800x600 window on a period CRT was ~31-35 arc-minutes per cell). ` +
    `A phone never reaches it; a TV wants ~45 because it is five times further away.`;
  $<HTMLSelectElement>('mode').value = cur().mode;
  $('modenote').textContent = state.target === 'pc' ? 'per the player' : 'per target — see below';
  $('modehint').textContent =
    state.target === 'pc'
      ? 'The player picks this on desktop; it is remembered.'
      : `The GAME forces ${state.target} to fill. The lab is drawing ${cur().mode} so you can see the alternative — a mode remembered per device rather than one shared with the desktop.`;
  renderChecks(r);
}

function pct(x: number): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
}

function el(cls: string, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  Object.assign(d.style, style);
  return d;
}

function frameFor(
  r: LayoutResult,
  edge: StripEdge,
  zoom: number,
  v: { w: number; h: number },
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fw';

  const outer = el('outer', { width: `${v.w * zoom}px`, height: `${v.h * zoom}px` });
  const frame = el(`frame${r.cut ? ' cut' : ''}`, {
    width: `${v.w}px`,
    height: `${v.h}px`,
    transform: `scale(${zoom})`,
  });

  // The reserve, drawn as a dashed box so a margin you cannot otherwise see is visible.
  if (state.guide && (cur().marginX > 0 || cur().marginY > 0)) {
    frame.append(
      el('guide', {
        left: `${cur().marginX}px`,
        right: `${cur().marginX}px`,
        top: `${cur().marginY}px`,
        bottom: `${cur().marginY}px`,
      }),
    );
  }

  // The strip sits INSIDE the reserve (layoutModel.ts, STRIP_INSIDE_MARGIN). It is the one
  // thing on screen a player has to aim at, so pinning it to the panel's edge — where the
  // room was already being kept away from — had it exactly the wrong way round. Costs no
  // size: the room already began at `margin + strip`.
  if (edge === 'left' && cur().stripLeft > 0) {
    const s = el('strip', {
      left: `${cur().marginX}px`,
      top: `${cur().marginY}px`,
      bottom: `${cur().marginY}px`,
      width: `${cur().stripLeft}px`,
    });
    s.innerHTML = `<span>${cur().stripLeft}</span>`;
    frame.append(s);
  } else if (edge === 'top' && cur().stripTop > 0) {
    const s = el('strip', {
      left: `${cur().marginX}px`,
      right: `${cur().marginX}px`,
      top: `${cur().marginY}px`,
      height: `${cur().stripTop}px`,
    });
    s.innerHTML = `<span>${cur().stripTop}</span>`;
    frame.append(s);
  }

  if (r.panelW > 0) {
    const p = el('panel', {
      left: `${r.panelX}px`,
      top: `${r.panelY}px`,
      width: `${r.panelW}px`,
      height: `${r.panelH}px`,
    });
    p.innerHTML = `<span>panel</span>`;
    frame.append(p);
  }

  const room = el('room', {
    left: `${r.roomX}px`,
    top: `${r.roomY}px`,
    width: `${r.drawnW}px`,
    height: `${r.drawnH}px`,
  });
  if (state.grid) {
    const c = r.contentScale * 15;
    room.append(
      el('cells', {
        backgroundImage:
          `repeating-linear-gradient(0deg,#6cc3 0 1px,transparent 1px ${c}px),` +
          `repeating-linear-gradient(90deg,#6cc3 0 1px,transparent 1px ${c}px)`,
      }),
    );
  }
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = `${r.contentScale.toFixed(4)}x`;
  room.append(tag);
  frame.append(room);

  outer.append(frame);
  outer.append(grip());
  wrap.append(outer);
  wrap.append(readout(r, edge));
  return wrap;
}

/**
 * Drag the corner to resize the modelled viewport — the method that found both defects, so
 * it is the one control here that has to be reliable.
 *
 * Two things make it less obvious than it looks:
 *
 *  - **The listeners live on `window`, not on the grip.** `render()` rebuilds `#frames`
 *    from scratch, so the grip that received the `pointerdown` is detached from the
 *    document by the time the first `pointermove` would arrive. With the listeners on the
 *    element (and `setPointerCapture` on it, which is equally void once it is detached) a
 *    drag moved the viewport by exactly one step and then stopped dead.
 *  - **The delta is applied incrementally against the CURRENT zoom.** The frame is drawn at
 *    `zoom` so a 3440px viewport fits on screen, and that zoom changes *while you drag*
 *    because the thing being scaled is what you are resizing. Anchoring to the start point
 *    with the zoom captured at `pointerdown` makes the corner run away from the cursor as
 *    soon as the zoom steps.
 */
function grip(): HTMLElement {
  const g = el('grip', {});
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    let lastX = e.clientX;
    let lastY = e.clientY;
    // Kept as floats: at a zoom of 0.39 a 1px mouse step is 2.5 viewport px, and rounding
    // each step into `state` would quantise the drag and lose ground on the way back.
    let w = state.vw;
    let h = state.vh;
    const move = (m: PointerEvent) => {
      w = Math.max(200, w + (m.clientX - lastX) / zoomNow);
      h = Math.max(150, h + (m.clientY - lastY) / zoomNow);
      lastX = m.clientX;
      lastY = m.clientY;
      state.vw = Math.round(w);
      state.vh = Math.round(h);
      state.orient = state.vw >= state.vh ? 'landscape' : 'portrait';
      syncViewport();
      render();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
    };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  return g;
}

function readout(r: LayoutResult, edge: StripEdge): HTMLElement {
  const d = document.createElement('div');
  d.className = 'read';
  const cut = r.cut
    ? `<span class="bad">CUT ${r.cutW.toFixed(1)}x${r.cutH.toFixed(1)} native px off screen</span>`
    : `<span class="good">whole room on screen</span>`;
  const overflow = r.contentScale > r.fitScale + 1e-9 ? ' (drawn past the largest scale that fits)' : '';
  d.innerHTML =
    `stage  ${r.stageScale.toFixed(4)}x   content ${r.contentScale.toFixed(4)}x   fit ${r.fitScale.toFixed(4)}x${overflow}\n` +
    `room   ${r.drawnW.toFixed(1)} x ${r.drawnH.toFixed(1)} css px   mode ${r.mode}${edge === 'none' ? '' : `   strip ${edge}`}\n` +
    `gaps   L ${fmt(r.gapLeft)}  R ${fmt(r.gapRight)}  T ${fmt(r.gapTop)}  B ${fmt(r.gapBottom)}\n` +
    `${cut}`;
  return d;
}

function fmt(x: number): string {
  const s = x.toFixed(1).padStart(6, ' ');
  return x < -0.05 ? `<span class="bad">${s}</span>` : s;
}

// ── The properties, probed at the viewport you are looking at ───────────────

/**
 * Six checks, run live around the current viewport. They are the cheap local half of
 * `tools/sweep-layout.mjs` — the sweep proves a property over millions of combinations,
 * this says whether it holds HERE, which is what you want while dragging the corner.
 *
 * Every one of them is a property a shipped defect violated, or one that was asserted in a
 * doc comment and never actually tested.
 */
function renderChecks(r: LayoutResult): void {
  const lines: string[] = [];
  {
    const v = viewport();
    const probe = (dw: number, dh: number) => {
      const edge = state.target === 'pc' ? 'none' : state.edge === 'auto' ? edgeFor() : state.edge;
      return layoutRoom({
        ...request(edge as StripEdge),
        viewportW: v.w + dw,
        viewportH: v.h + dh,
        stripEdge: edge as StripEdge,
      });
    };
    // 1. Monotonicity: a bigger window must never give a smaller room (Martin's decision,
    //    2026-08-31). Probed over the next 200px on each axis, 1px at a time.
    let worstW = 0;
    let worstH = 0;
    let atW = 0;
    let atH = 0;
    for (let d = 1; d <= 200; d++) {
      const w = probe(d, 0).contentScale / r.contentScale - 1;
      if (w < worstW) {
        worstW = w;
        atW = d;
      }
      const h = probe(0, d).contentScale / r.contentScale - 1;
      if (h < worstH) {
        worstH = h;
        atH = d;
      }
    }
    const mono =
      worstW < -1e-9 || worstH < -1e-9
        ? `<span class="bad">FAILS</span> widening +${atW} costs ${pct(worstW)}, heightening +${atH} costs ${pct(worstH)}`
        : `<span class="good">holds</span> over the next 200px on both axes`;

    // 2. The reserve is either kept at every viewport or it is not kept at all. The old
    //    `STAGE_EDGE` was 12 NATIVE px inside the box calculation and vanished the moment
    //    the box hit its floor, which is the 1491-vs-1557 case; a CSS-px constant taken off
    //    the viewport cannot do that. Both models are asked the same question now.
    // Per axis, because the reserve is: a horizontal gap is not evidence about a vertical one.
    const nearX = Math.min(r.gapLeft, r.gapRight);
    const nearY = Math.min(r.gapTop, r.gapBottom);
    const okX = nearX >= cur().marginX - 0.51;
    const okY = nearY >= cur().marginY - 0.51;
    const reserve =
      okX && okY
        ? `<span class="good">holds</span> gaps ${nearX.toFixed(1)}x${nearY.toFixed(1)} >= ${cur().marginX}x${cur().marginY}`
        : `<span class="bad">FAILS</span> gaps ${nearX.toFixed(1)}x${nearY.toFixed(1)} < ${cur().marginX}x${cur().marginY}`;

    // 3. Nothing runs off the viewport — the property the reserve used to exist for, and
    //    which nothing tested until the rework.
    const off = Math.min(nearX, nearY);
    const contained =
      off >= -0.01
        ? `<span class="good">holds</span>`
        : `<span class="bad">FAILS</span> by ${(-off).toFixed(2)}px`;

    // 4. Centred on the SCREEN, not on what the furniture left over (#126) — allowing the
    //    one-sided clamp, which is the case where the room cannot clear the strip as well.
    //    "Slack" has to count the model's own reserve: a room whose gaps ARE the margin is
    //    already against the edge of the space it is allowed.
    const centreErr = Math.abs(r.roomX + r.drawnW / 2 + (r.panelW + r.gap) / 2 - v.w / 2);
    const clamped =
      r.gapLeft <= cur().marginX + 0.51 ||
      r.gapRight <= cur().marginX + 0.51 ||
      r.gapTop <= cur().marginY + 0.51 ||
      r.gapBottom <= cur().marginY + 0.51;
    const centred =
      centreErr < 0.51
        ? `<span class="good">holds</span>`
        : clamped
          ? `<span class="warn">clamped</span> ${centreErr.toFixed(1)}px off centre, and the room has no slack`
          : `<span class="bad">FAILS</span> ${centreErr.toFixed(1)}px off centre with slack to spare`;

    lines.push(
      `  monotone (bigger window, never a smaller room)   ${mono}\n` +
        `  the reserve is uniform                           ${reserve}\n` +
        `  nothing overflows the viewport                   ${contained}\n` +
        `  the room is centred on the screen (#126)         ${centred}\n` +
        `  the whole room is on screen                      ${r.cut ? `<span class="bad">FAILS</span> ${r.cutW.toFixed(1)}x${r.cutH.toFixed(1)} native px hidden` : '<span class="good">holds</span>'}`,
    );
  }
  $('checks').innerHTML = lines.join('\n\n');
}

/**
 * Everything the lab is currently set to, as plain text you can paste into a conversation.
 *
 * All three targets, not just the one on screen, because the strip sizes are decided
 * against each other — a left strip is nearly free and a top one is not, and the numbers
 * only argue with each other when they are side by side. The viewport spread is fixed and
 * named so two exports are comparable: change a slider, copy again, and the diff is the
 * answer.
 *
 * The constants are included because they are the things being polished, and a settings
 * block that omits them describes a layout nobody can reproduce.
 */
function settingsDump(): string {
  const L: string[] = [];
  const p2 = (n: number) => n.toFixed(2);
  L.push('FISH FILLETS — layout lab settings');
  L.push(git ? `revision: branch ${git.branch} @ ${git.head}${git.differsFromMain ? ' (differs from origin/main)' : ''}${git.uncommitted ? ' + uncommitted edits' : ''}` : 'revision: unknown');
  L.push(`room on screen: ${state.roomName} ${state.roomW}x${state.roomH} native (${p2(state.roomW / state.roomH)}:1)`);
  L.push('');
  L.push('CONSTANTS (src/app/layout.ts)');
  L.push(`  STAGE_W/STAGE_H     ${STAGE_W}x${STAGE_H} native   the object-size envelope`);
  L.push(`  PANEL               ${PANEL_NATIVE_W}x${PANEL_NATIVE_H} native + ${STAGE_GAP} gap = ${PANEL_FOOTPRINT_W} footprint (PC only)`);
  L.push(`  MIN_STAGE_SCALE     ${MIN_STAGE_SCALE}`);
  L.push(`  MAX_CELL_PX         ${MAX_CELL_PX} css px per 15px cell (the shipped ceiling)`);
  L.push(`  VIEWPORT_MARGIN     ${VIEWPORT_MARGIN} css px (the shipped default; per-axis is supported)`);
  L.push('');

  // `[name, w, h, cutout]`. The cutout is the LANDSCAPE one and defaults to 0 — every
  // browser viewport, which is what all of these were until the native rows were added.
  const CASES: Record<LayoutTarget, [string, number, number, number?][]> = {
    pc: [
      ['laptop 16:10', 1280, 800],
      ['MacBook Pro 14', 1512, 860],
      ['1080p maximised', 1920, 1030],
      ['1440p maximised', 2560, 1380],
    ],
    touch: [
      ['iPhone 15 landscape', 734, 343],
      ['iPhone 15 portrait', 393, 659],
      ['Pixel 8 Pro landscape', 945, 396],
      ['iPad landscape', 1024, 696],
      // The same phone class as the first row, but as the NATIVE app gets it: the whole
      // screen, and the island it has to work around. The pair is the point — a settings
      // block tuned on the browser row alone has never seen the shipped iOS layout.
      ['iPhone 17 native landscape', 874, 402, 62],
      ['iPhone Air native landscape', 912, 420, 68],
    ],
    tv: [
      ['720p', 1280, 720],
      ['1080p', 1920, 1080],
    ],
  };

  for (const target of ['pc', 'touch', 'tv'] as const) {
    const t = state.per[target];
    const d = defaultsFor(target);
    // Every target is a live value now — they are all held and all saved, so nothing here is
    // a default standing in for something you did not get to. Only what you CHANGED is
    // flagged, which is the part worth reading.
    const changed = (['stripLeft', 'stripTop', 'marginX', 'marginY', 'maxCellPx', 'mode'] as const).filter(
      (k) => t[k] !== d[k],
    );
    L.push(
      `${target.toUpperCase()}${target === state.target ? '   <- on screen' : ''}` +
        (changed.length ? `   CHANGED: ${changed.join(', ')}` : '   (unchanged from the shipped values)'),
    );
    L.push(
      `  strip           ${target === 'pc' ? 'none — the faithful 155x395 panel instead' : `${t.stripLeft} px left / ${t.stripTop} px top`}`,
    );
    L.push(
      `  margin          ${t.marginX} css px left/right, ${t.marginY} top/bottom` +
        (target === 'tv' ? '  (title-safe inset; 0 because a TV browser already handles overscan)' : ''),
    );
    L.push(`  cell ceiling    ${t.maxCellPx} css px per 15px cell`);
    L.push(
      `  fit mode        ${t.mode}` +
        (target === 'pc'
          ? ''
          : t.mode === 'fill'
            ? '  (the game forces fill here)'
            : '  <- PREVIEW: the game would force fill'),
    );
    L.push(
      `  edge rule       ${target === 'pc' ? 'n/a' : state.edge === 'auto' ? 'auto — whichever shows more of the room' : `forced ${state.edge}`}`,
    );
    for (const [name, vw, vh, cutout = 0] of CASES[target]) {
      const base: Omit<LayoutRequest, 'stripEdge'> = {
        viewportW: vw,
        viewportH: vh,
        roomW: state.roomW,
        roomH: state.roomH,
        target,
        mode: t.mode,
        respectMode: true,
        stripPx: t.stripLeft,
        insetLeft: vw > vh ? cutout : 0,
        insetTop: vw > vh ? 0 : cutout,
        marginPx: { x: t.marginX, y: t.marginY },
        maxCellPx: t.maxCellPx,
        dpr: state.dpr,
      };
      // Portrait belongs to the media query, which always picks the top (see edgeFor).
      const edge: StripEdge =
        target === 'pc'
          ? 'none'
          : vh > vw
            ? 'top'
            : state.edge === 'auto'
              ? preferredStripEdge(base)
              : state.edge;
      const px = edge === 'top' ? t.stripTop : t.stripLeft;
      const r = layoutRoom({ ...base, stripEdge: edge, stripPx: px });
      L.push(
        `    ${name.padEnd(22)} ${`${vw}x${vh}`.padEnd(10)} bar ${edge.padEnd(5)}` +
          (cutout ? ` cut ${String(cutout).padStart(2)}` : '       ') +
          ` cell ${(r.contentScale * CELL_NATIVE).toFixed(1)}px` +
          ` scale ${r.contentScale.toFixed(4)}  room ${Math.round(r.drawnW)}x${Math.round(r.drawnH)}` +
          `  gaps L${Math.round(r.gapLeft)} R${Math.round(r.gapRight)} T${Math.round(r.gapTop)} B${Math.round(r.gapBottom)}` +
          (r.cut ? `  CUT ${r.cutW.toFixed(1)}x${r.cutH.toFixed(1)} native px` : ''),
      );
    }
    L.push('');
  }
  return L.join('\n');
}

function wireExport(): void {
  const ta = $<HTMLTextAreaElement>('dump');
  $('reset').addEventListener('click', () => {
    for (const t of ['pc', 'touch', 'tv'] as const) state.per[t] = defaultsFor(t);
    saveTuning();
    syncSliders();
    render();
    $('copyhint').textContent = 'All three targets are back to the shipped values.';
  });
  $('copy').addEventListener('click', async () => {
    const text = settingsDump();
    ta.value = text;
    ta.style.display = 'block';
    try {
      await navigator.clipboard.writeText(text);
      $('copyhint').textContent = 'Copied to the clipboard. It is also in the box below if the copy was blocked.';
    } catch {
      // A page served over plain http can be denied the clipboard; the textarea is the
      // fallback and is selected so one Cmd+C still works.
      ta.select();
      $('copyhint').textContent = 'The browser blocked the clipboard — the text is selected below, press Cmd+C.';
    }
  });
}

loadTuning();
buildSelects();
wire();
wireExport();
syncSliders();
syncViewport();
render();

// Late and non-blocking: the layout is worth looking at before git has answered, and a
// checkout without git (or without an `origin/main`) should degrade to "this working tree"
// rather than to a blank page.
fetch('/__lab/git.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    git = v;
    render();
  })
  .catch(() => {});
