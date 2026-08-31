/**
 * The layout lab's wiring — DEV ONLY. See `tools/layout-lab.html` for what it is for.
 *
 * It holds no scaling maths: every number on screen comes from `tools/layoutShipped.ts`
 * (which calls `src/app/layout.ts` directly) or `tools/layoutCandidate.ts`. This file
 * only turns their output into rectangles, and runs the small local probes that make a
 * property visible at the viewport you are looking at rather than in a sweep's summary.
 */
import { FIT_MODES } from '../src/app/layout.js';
import type { FitMode } from '../src/app/layout.js';
import {
  TARGET_DEFAULTS,
  layoutRoom,
  preferredStripEdge,
} from './layoutCandidate.js';
import type { LayoutRequest, LayoutResult, LayoutTarget, StripEdge } from './layoutCandidate.js';
import { layoutRoomShipped, preferredStripEdgeShipped } from './layoutShipped.js';
import { LAB_MAP, LAB_ROOMS } from './layoutLabRooms.js';
import { LAB_VIEWPORTS } from './layoutLabViewports.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** `"720x585"` -> `[720, 585]`. The option values carry the size, so the picker needs no map. */
const size = (v: string): [number, number] => {
  const [w, h] = v.split('x').map(Number);
  return [w ?? 0, h ?? 0];
};

interface State {
  target: LayoutTarget;
  roomW: number;
  roomH: number;
  roomName: string;
  vw: number;
  vh: number;
  chrome: number;
  mode: FitMode;
  stripLeft: number;
  stripTop: number;
  edge: 'auto' | 'left' | 'top';
  margin: number;
  dpr: number;
  both: boolean;
  grid: boolean;
  guide: boolean;
}

const state: State = {
  target: 'pc',
  roomW: 720,
  roomH: 585,
  roomName: 'BOTTLES',
  vw: 1491,
  vh: 1114,
  chrome: 0,
  mode: 'medium',
  stripLeft: 72,
  stripTop: 66,
  edge: 'auto',
  margin: 0,
  dpr: 1,
  both: true,
  grid: true,
  guide: true,
};

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
    phone: 'Phones (Playwright)',
    tablet: 'Tablets (Playwright)',
    foldable: 'Foldables (Playwright)',
  };
  for (const v of LAB_VIEWPORTS) {
    if (v.klass !== lastKlass) {
      group = document.createElement('optgroup');
      group.label = LABELS[v.klass] ?? v.klass;
      preset.append(group);
      lastKlass = v.klass;
    }
    const o = opt(`${v.w}x${v.h}`, `${v.w}x${v.h} — ${v.name}`);
    if (v.note) o.title = v.note;
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
    const [w, h] = size((e.target as HTMLSelectElement).value);
    state.vw = w;
    state.vh = h;
    $<HTMLInputElement>('vw').value = String(w);
    $<HTMLInputElement>('vh').value = String(h);
    render();
  });

  for (const b of $('target').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      state.target = (b as HTMLElement).dataset.v as LayoutTarget;
      for (const o of $('target').querySelectorAll('button')) {
        o.setAttribute('aria-pressed', String(o === b));
      }
      // Each target brings its own proposed strip and margin — they are the numbers
      // this task exists to decide, so switching target must not silently keep the last
      // target's ones.
      const d = TARGET_DEFAULTS[state.target];
      state.margin = d.margin;
      if (state.target === 'tv') {
        state.stripLeft = d.strip;
        state.stripTop = d.strip;
      } else if (state.target === 'touch') {
        state.stripLeft = 72;
        state.stripTop = 66;
      }
      syncSliders();
      render();
    });
  }

  $<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    state.mode = (e.target as HTMLSelectElement).value as FitMode;
    render();
  });
  $<HTMLSelectElement>('edge').addEventListener('change', (e) => {
    state.edge = (e.target as HTMLSelectElement).value as State['edge'];
    render();
  });

  const slider = (id: string, key: 'stripLeft' | 'stripTop' | 'margin' | 'dpr' | 'chrome', out: string) => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => {
      state[key] = Number(el.value);
      $(out).textContent = el.value;
      render();
    });
  };
  slider('stripleft', 'stripLeft', 'striplefv');
  slider('striptop', 'stripTop', 'striptopv');
  slider('margin', 'margin', 'marginv');
  slider('dpr', 'dpr', 'dprv');
  slider('chrome', 'chrome', 'chromev');

  const chk = (id: string, key: 'both' | 'grid' | 'guide') => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('change', () => {
      state[key] = el.checked;
      render();
    });
  };
  chk('showboth', 'both');
  chk('showgrid', 'grid');
  chk('showguide', 'guide');

  $<HTMLSelectElement>('room').value = `${state.roomW}x${state.roomH}`;
  $<HTMLSelectElement>('preset').value = `${state.vw}x${state.vh}`;
  $<HTMLSelectElement>('mode').value = state.mode;
  window.addEventListener('resize', render);
}

function syncSliders(): void {
  $<HTMLInputElement>('stripleft').value = String(state.stripLeft);
  $('striplefv').textContent = String(state.stripLeft);
  $<HTMLInputElement>('striptop').value = String(state.stripTop);
  $('striptopv').textContent = String(state.stripTop);
  $<HTMLInputElement>('margin').value = String(state.margin);
  $('marginv').textContent = String(state.margin);
}

// ── The two models ──────────────────────────────────────────────────────────

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
    mode: state.mode,
    stripEdge: edge,
    stripPx: edge === 'top' ? state.stripTop : state.stripLeft,
    marginPx: state.margin,
    dpr: state.dpr,
  };
}

/**
 * The edge each model would choose. They are asked separately on purpose: the rule is the
 * same sentence in both, but it is evaluated against that model's own placement, and the
 * whole-room test can only ever fire on the shipped one.
 */
function edgeFor(model: 'shipped' | 'candidate'): StripEdge {
  if (state.target === 'pc') return 'none';
  if (state.edge !== 'auto') return state.edge;
  const base = request('left');
  const pick = model === 'shipped' ? preferredStripEdgeShipped : preferredStripEdge;
  // The strip differs per edge, so the rule has to price each edge with its own size.
  const both = (e: StripEdge) => ({ ...base, stripEdge: e, stripPx: e === 'top' ? state.stripTop : state.stripLeft });
  const top = model === 'shipped' ? layoutRoomShipped(both('top')) : layoutRoom(both('top'));
  const left = model === 'shipped' ? layoutRoomShipped(both('left')) : layoutRoom(both('left'));
  if (top.cut !== left.cut) return top.cut ? 'left' : 'top';
  if (top.visible !== left.visible) return top.visible > left.visible ? 'top' : 'left';
  return pick(both('left')); // identical scores — defer to the rule's own tie-break (top)
}

// ── Rendering ───────────────────────────────────────────────────────────────

const frames = $('frames');

function render(): void {
  const models: ('shipped' | 'candidate')[] = state.both ? ['shipped', 'candidate'] : ['candidate'];
  const v = viewport();

  const availW = frames.clientWidth - (models.length - 1) * 14;
  const availH = frames.clientHeight - 78; // title + readout
  const zoom = Math.min(1, availW / models.length / v.w, availH / v.h);

  frames.textContent = '';
  const results: Record<string, LayoutResult> = {};
  for (const m of models) {
    const edge = edgeFor(m);
    const req = { ...request(edge), stripEdge: edge };
    const r = m === 'shipped' ? layoutRoomShipped(req) : layoutRoom(req);
    results[m] = r;
    frames.append(frameFor(m, r, edge, zoom, v));
  }

  $('topline').innerHTML =
    `<b>${state.roomName} ${state.roomW}x${state.roomH}</b> (${(state.roomW / state.roomH).toFixed(2)}:1)` +
    ` &nbsp;in&nbsp; <b>${v.w}x${v.h}</b> (${(v.w / v.h).toFixed(2)}:1)` +
    (state.chrome ? ` &nbsp;<span style="color:#667">${state.vh} minus ${state.chrome} of chrome</span>` : '') +
    ` &nbsp;·&nbsp; drawn at <b>${(zoom * 100).toFixed(0)}%</b> here` +
    (results.shipped && results.candidate
      ? ` &nbsp;·&nbsp; candidate is <b>${pct(results.candidate.contentScale / results.shipped.contentScale - 1)}</b> vs shipped`
      : '');

  $('targethint').textContent = TARGET_HINT[state.target];
  $('modenote').textContent = state.target === 'pc' ? '' : 'forced to fill';
  renderChecks(results);
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
  model: string,
  r: LayoutResult,
  edge: StripEdge,
  zoom: number,
  v: { w: number; h: number },
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'fw';

  const h3 = document.createElement('h3');
  h3.innerHTML =
    model === 'shipped'
      ? 'shipped <span>— src/app/layout.ts, as relayout() calls it</span>'
      : 'candidate <span>— tools/layoutCandidate.ts, the same model written independently</span>';
  wrap.append(h3);

  const outer = el('outer', { width: `${v.w * zoom}px`, height: `${v.h * zoom}px` });
  const frame = el(`frame${r.cut ? ' cut' : ''}`, {
    width: `${v.w}px`,
    height: `${v.h}px`,
    transform: `scale(${zoom})`,
  });

  if (state.guide) {
    const m = model === 'shipped' ? 0 : state.margin;
    if (m > 0) {
      frame.append(el('guide', { left: `${m}px`, top: `${m}px`, right: `${m}px`, bottom: `${m}px` }));
    }
  }

  if (edge === 'left' && state.stripLeft > 0) {
    const s = el('strip', { left: '0', top: '0', bottom: '0', width: `${state.stripLeft}px` });
    s.innerHTML = `<span>${state.stripLeft}</span>`;
    frame.append(s);
  } else if (edge === 'top' && state.stripTop > 0) {
    const s = el('strip', { left: '0', top: '0', right: '0', height: `${state.stripTop}px` });
    s.innerHTML = `<span>${state.stripTop}</span>`;
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
  if (model !== 'shipped' || !state.both) outer.append(grip(zoom));
  else outer.append(grip(zoom));
  wrap.append(outer);
  wrap.append(readout(r, edge));
  return wrap;
}

/** Drag the corner to resize the modelled viewport — the method that found both defects. */
function grip(zoom: number): HTMLElement {
  const g = el('grip', {});
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    g.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const y0 = e.clientY;
    const w0 = state.vw;
    const h0 = state.vh;
    const move = (m: PointerEvent) => {
      state.vw = Math.max(200, Math.round(w0 + (m.clientX - x0) / zoom));
      state.vh = Math.max(150, Math.round(h0 + (m.clientY - y0) / zoom));
      $<HTMLInputElement>('vw').value = String(state.vw);
      $<HTMLInputElement>('vh').value = String(state.vh);
      render();
    };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
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
function renderChecks(results: Record<string, LayoutResult>): void {
  const lines: string[] = [];
  for (const [name, r] of Object.entries(results)) {
    const v = viewport();
    const probe = (dw: number, dh: number) => {
      const edge = state.target === 'pc' ? 'none' : (state.edge === 'auto' ? edgeFor(name as 'shipped') : state.edge);
      const req: LayoutRequest = {
        ...request(edge as StripEdge),
        viewportW: v.w + dw,
        viewportH: v.h + dh,
        stripEdge: edge as StripEdge,
      };
      return name === 'shipped' ? layoutRoomShipped(req) : layoutRoom(req);
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
    const near = Math.min(r.gapLeft, r.gapRight, r.gapTop, r.gapBottom);
    const reserve =
      near >= state.margin - 0.51
        ? `<span class="good">holds</span> smallest gap ${near.toFixed(1)}px >= ${state.margin}`
        : `<span class="bad">FAILS</span> smallest gap ${near.toFixed(1)}px < ${state.margin}`;

    // 3. Nothing runs off the viewport — the property the reserve used to exist for, and
    //    which nothing tested until the rework.
    const off = near;
    const contained =
      off >= -0.01
        ? `<span class="good">holds</span>`
        : `<span class="bad">FAILS</span> by ${(-off).toFixed(2)}px`;

    // 4. Centred on the SCREEN, not on what the furniture left over (#126) — allowing the
    //    one-sided clamp, which is the case where the room cannot clear the strip as well.
    //    "Slack" has to count the model's own reserve: a room whose gaps ARE the margin is
    //    already against the edge of the space it is allowed.
    const slackFloor = (name === 'shipped' ? 0 : state.margin) + 0.51;
    const centreErr = Math.abs(r.roomX + r.drawnW / 2 + (r.panelW + r.gap) / 2 - v.w / 2);
    const clamped =
      r.gapLeft <= slackFloor ||
      r.gapRight <= slackFloor ||
      r.gapTop <= slackFloor ||
      r.gapBottom <= slackFloor;
    const centred =
      centreErr < 0.51
        ? `<span class="good">holds</span>`
        : clamped
          ? `<span class="warn">clamped</span> ${centreErr.toFixed(1)}px off centre, and the room has no slack`
          : `<span class="bad">FAILS</span> ${centreErr.toFixed(1)}px off centre with slack to spare`;

    lines.push(
      `<b>${name}</b>\n` +
        `  monotone (bigger window, never a smaller room)   ${mono}\n` +
        `  the reserve is uniform                           ${reserve}\n` +
        `  nothing overflows the viewport                   ${contained}\n` +
        `  the room is centred on the screen (#126)         ${centred}\n` +
        `  the whole room is on screen                      ${r.cut ? `<span class="bad">FAILS</span> ${r.cutW.toFixed(1)}x${r.cutH.toFixed(1)} native px hidden` : '<span class="good">holds</span>'}`,
    );
  }
  $('checks').innerHTML = lines.join('\n\n');
}

buildSelects();
wire();
syncSliders();
render();
