/**
 * The web's rustic carved icons (`src/styles/nativeMenuIcons.svg`, the touch/native menu's
 * symbols) drawn natively. The SVG is bundled as text and rasterised here, once per icon and
 * size: each painted part (a path's fill, then its stroke, in document order — as SVG paints
 * them) becomes its own coverage mask, keyed by the colour role the SVG gives it
 * (`currentColor` → the room's symbol, `var(--menu-shade, …)` → shade, and so on), so a room's
 * palette tints it as the stylesheet tints the web's. Under it goes the stylesheet's
 * `drop-shadow(0 1px 1px #000c)`, as the union of the parts.
 *
 * The rasteriser covers what the file uses: M/L/H/V/C/S/A/Z (absolute and relative), nonzero
 * fill, and strokes as their distance to the path (round joins, as the file asks), at 4×4
 * samples a pixel. The menus' sizes follow the window's height, so a 4K TV's are big: the UI
 * layer rehearses the menus, icons and all, before one is first opened (`uiLayer.ts`).
 *
 * Two symbols the web's set has no need for — Resume and Help, in the pause menu — are drawn
 * here in the same hand (uneven outline, one highlight facet, one shade facet).
 */
import iconSource from '../../src/styles/nativeMenuIcons.svg?raw';
import type { Image2D } from '../../src/render/surface2d.js';
import { countMask, type Ui } from './uiDraw.js';
import type { NativeImage } from './nativeSurface.js';
import type { UiPalette } from './uiPalette.js';
import { costed } from './uiCost.js';

const NATIVE_ONLY = `
  <g id="resume" stroke="var(--menu-outline, #243039)" stroke-width=".8" stroke-linejoin="round">
    <path fill="currentColor" d="M6.2 3.1 8.9 3.6 20.4 10.9 20.9 12.9 9.3 20.5 6.1 21 5.3 19.1 5.7 4.8Z"/>
    <path fill="none" stroke="var(--menu-highlight, #fff8dc)" stroke-width=".85" d="m7 5.3-.2 13.4M9 4.9l10.4 6.6"/>
    <path fill="none" stroke="var(--menu-shade, #aba48e)" stroke-width="1" d="m9.4 18.8 10-6.3"/>
  </g>
  <g id="help" stroke="var(--menu-outline, #243039)" stroke-width=".8" stroke-linejoin="round">
    <path fill="currentColor" d="M6.9 7C7.6 3.8 10 2.2 12.6 2.3c3.2.1 5.4 2.1 5.3 4.8-.1 2.4-1.6 3.5-3.2 4.6-1.1.8-1.5 1.4-1.4 2.9l-3.5.1c-.3-2.5.4-3.7 2.1-5 1.2-.9 2.2-1.5 2.2-2.8.1-1.3-.9-2.1-2.2-2.1-1.4 0-2.3.8-2.7 2.4ZM10.1 16.4l3.7-.3.4 3.6-3.7.4Z"/>
    <path fill="none" stroke="var(--menu-highlight, #fff8dc)" stroke-width=".85" d="M8.4 6.2c.9-2 3.6-2.8 5.7-1.8M10.9 17.2l2.1-.1"/>
    <path fill="none" stroke="var(--menu-shade, #aba48e)" stroke-width="1" d="m10.8 14.2 2.3-.1m-2.1 5.1 2.6-.2"/>
  </g>`;

export type IconRole = 'symbol' | 'highlight' | 'shade' | 'detail' | 'outline';

interface Part {
  readonly role: IconRole;
  /** Subpaths, each a flat list of x,y in the 24-unit box. */
  readonly subpaths: readonly (readonly number[])[];
  /** A fill (nonzero), or a stroke this wide. */
  readonly stroke: number | null;
}

const ROLE: Readonly<Record<string, IconRole>> = {
  currentColor: 'symbol', '--menu-highlight': 'highlight', '--menu-shade': 'shade',
  '--menu-detail': 'detail', '--menu-outline': 'outline',
};

function roleOf(paint: string | undefined): IconRole | null {
  if (!paint || paint === 'none') return null;
  if (paint === 'currentColor') return 'symbol';
  const v = /^var\((--menu-[a-z]+)/.exec(paint);
  const role = v ? ROLE[v[1]!] : undefined;
  if (!role) throw new Error(`unknown icon paint ${paint}`);
  return role;
}

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// ── Paths ───────────────────────────────────────────────────────────────────────────

/** Flatten an SVG path's `d` into subpaths of points. */
export function flattenPath(d: string): number[][] {
  const tok = d.match(/[MmLlHhVvCcSsAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: number[][] = [];
  let cur: number[] = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx2 = 0, cy2 = 0;
  const num = (): number => Number(tok[i++]);
  const isNum = (): boolean => i < tok.length && !/^[A-Za-z]$/.test(tok[i]!);
  const lineTo = (nx: number, ny: number): void => {
    cur.push(nx, ny);
    x = nx;
    y = ny;
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, ex: number, ey: number): void => {
    const x0 = x, y0 = y;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12, u = 1 - t;
      lineTo(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
    }
    cx2 = x2;
    cy2 = y2;
  };
  const arc = (rx: number, ry: number, rot: number, large: number, sweep: number, ex: number, ey: number): void => {
    // SVG's endpoint-to-centre conversion (SVG 1.1, F.6.5).
    const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x - ex) / 2, dy = (y - ey) / 2;
    const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const sign = large === sweep ? -1 : 1;
    const co = sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1) / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
    const ccx = cos * cxp - sin * cyp + (x + ex) / 2, ccy = sin * cxp + cos * cyp + (y + ey) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    for (let k = 1; k <= 16; k++) {
      const t = t1 + (dt * k) / 16;
      lineTo(ccx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, ccy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos);
    }
  };
  while (i < tok.length) {
    if (!isNum()) cmd = tok[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        if (cur.length > 2) out.push(cur);
        const nx = ox + num(), ny = oy + num();
        cur = [nx, ny];
        x = sx = nx;
        y = sy = ny;
        cmd = rel ? 'l' : 'L'; // further pairs are lines
        break;
      }
      case 'L': lineTo(ox + num(), oy + num()); break;
      case 'H': lineTo(ox + num(), y); break;
      case 'V': lineTo(x, oy + num()); break;
      case 'C': {
        const a = [num(), num(), num(), num(), num(), num()];
        cubic(ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!, ox + a[4]!, oy + a[5]!);
        break;
      }
      case 'S': {
        const a = [num(), num(), num(), num()];
        cubic(2 * x - cx2, 2 * y - cy2, ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!);
        break;
      }
      case 'A': {
        const a = [num(), num(), num(), num(), num(), num(), num()];
        arc(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, ox + a[5]!, oy + a[6]!);
        break;
      }
      case 'Z':
        if (cur.length > 2) cur.push(sx, sy);
        x = sx;
        y = sy;
        if (cur.length > 2) out.push(cur);
        cur = [sx, sy];
        break;
      default: throw new Error(`unsupported path command ${cmd}`);
    }
    if (cmd.toUpperCase() !== 'C' && cmd.toUpperCase() !== 'S') {
      cx2 = x;
      cy2 = y;
    }
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

// ── The icon set ────────────────────────────────────────────────────────────────────

let icons: Map<string, readonly Part[]> | null = null;

function iconSet(): Map<string, readonly Part[]> {
  if (icons) return icons;
  icons = new Map();
  for (const g of (iconSource + NATIVE_ONLY).matchAll(/<g\s([^>]*)>([\s\S]*?)<\/g>/g)) {
    const id = attr(` ${g[1]}`, 'id');
    if (!id) continue;
    const gStroke = attr(` ${g[1]}`, 'stroke');
    const gWidth = Number(attr(` ${g[1]}`, 'stroke-width') ?? 1);
    const parts: Part[] = [];
    for (const p of g[2]!.matchAll(/<path\s([^>]*)\/>/g)) {
      const tag = ` ${p[1]}`;
      const subpaths = flattenPath(attr(tag, 'd') ?? '');
      const fill = roleOf(attr(tag, 'fill') ?? 'black');
      const stroke = roleOf(attr(tag, 'stroke') ?? gStroke);
      if (fill) parts.push({ role: fill, subpaths, stroke: null });
      if (stroke) parts.push({ role: stroke, subpaths, stroke: Number(attr(tag, 'stroke-width') ?? gWidth) });
    }
    icons.set(id, parts);
  }
  return icons;
}

export type IconName = 'map' | 'undo' | 'more' | 'save' | 'load' | 'options' | 'restart' | 'close' | 'resume' | 'help';

/** Every icon the set has (the menu smoke checks each one rasterises, ink in every part). */
export const iconNames = (): string[] => [...iconSet().keys()];

// ── Rasterising ─────────────────────────────────────────────────────────────────────
//
// Each pixel takes 4×4 samples at (x + (i + .5)/4, y + (j + .5)/4), and a part covers a
// sample by nonzero winding (a fill) or by lying within half the width of one of its
// segments (a stroke). This runs in the host's interpreter, so it must not test every
// segment at every sample (at a 4K TV's 80 px icons that took seconds): a fill walks each
// sample row once, through the edges that cross it, and a stroke tests each segment only at
// the samples near it. The samples and their tests are the ones testing everything would
// make, so the masks are the same.

/** Sample `J` (of 4 a pixel) along an axis, in the 24-unit box at `k` units a pixel. */
const at = (J: number, k: number): number => ((J >> 2) + ((J & 3) + 0.5) / 4) * k;

/** The first sample past `v`: the least `I` in 0..`side` with `at(I, k) > v`. */
function firstAbove(v: number, k: number, side: number): number {
  let I = Math.max(0, Math.min(side, Math.floor((v / k) * 4 - 0.5)));
  while (I > 0 && at(I - 1, k) > v) I--;
  while (I < side && at(I, k) <= v) I++;
  return I;
}

/** Add samples `a`..`b`-1 of a row to the counts of the pixels they fall in, from `base`. */
function addRun(n: Uint8Array, base: number, a: number, b: number): void {
  while (a < b) {
    const e = Math.min(b, ((a >> 2) + 1) << 2);
    n[base + (a >> 2)]! += e - a;
    a = e;
  }
}

/** Nonzero winding at (px, py) of the edges `e` (ax, ay, bx, by, …). */
function winding(e: readonly number[], px: number, py: number): number {
  let wn = 0;
  for (let q = 0; q < e.length; q += 4) {
    const ax = e[q]!, ay = e[q + 1]!, bx = e[q + 2]!, by = e[q + 3]!;
    if (ay <= py) {
      if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) wn++;
    } else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) wn--;
  }
  return wn;
}

/** Count into `n` (per pixel) the samples a nonzero fill of the closed `subpaths` covers. */
function fillSamples(subpaths: readonly (readonly number[])[], size: number, k: number, n: Uint8Array): void {
  const side = 4 * size;
  // Each edge with the sample rows it may cross (a row or so either side, for safety).
  const edges: { e: readonly number[]; from: number; to: number }[] = [];
  for (const s of subpaths) {
    const m = s.length / 2;
    for (let q = 0; q < m; q++) {
      const b = (q + 1) % m;
      const ay = s[2 * q + 1]!, by = s[2 * b + 1]!;
      if (ay === by) continue; // a level edge crosses no row
      edges.push({
        e: [s[2 * q]!, ay, s[2 * b]!, by],
        from: Math.max(0, Math.floor((Math.min(ay, by) / k) * 4) - 1),
        to: Math.min(side - 1, Math.ceil((Math.max(ay, by) / k) * 4) + 1),
      });
    }
  }
  edges.sort((a, b) => a.from - b.from);
  const EPS = 1e-9;
  let next = 0;
  let live: (typeof edges)[number][] = [];
  const row: number[] = [], xs: number[] = [], ds: number[] = [];
  for (let J = edges.length ? edges[0]!.from : side; J < side; J++) {
    while (next < edges.length && edges[next]!.from <= J) live.push(edges[next++]!);
    live = live.filter((x) => x.to >= J);
    if (!live.length) {
      if (next === edges.length) break;
      continue;
    }
    const py = at(J, k);
    row.length = xs.length = ds.length = 0;
    for (const { e } of live) {
      const ax = e[0]!, ay = e[1]!, bx = e[2]!, by = e[3]!;
      const d = ay <= py ? (by > py ? 1 : 0) : by <= py ? -1 : 0;
      if (!d) continue;
      row.push(ax, ay, bx, by);
      const x = ax + ((bx - ax) * (py - ay)) / (by - ay);
      let p = xs.length; // insertion sort: a row crosses a handful of edges
      while (p > 0 && xs[p - 1]! > x) {
        xs[p] = xs[p - 1]!;
        ds[p] = ds[p - 1]!;
        p--;
      }
      xs[p] = x;
      ds[p] = d;
    }
    // Between crossings the winding is constant: left of all of them it is their sum (0,
    // the edges closing), and past each it loses that edge's direction. A sample within a
    // hair of a crossing, where rounding could put it on the wrong side, takes the exact test.
    const base = (J >> 2) * size;
    let w = ds.reduce((a, b) => a + b, 0);
    let I = 0;
    for (let c = 0; c < xs.length; c++) {
      const lo = firstAbove(xs[c]! - EPS, k, side), hi = firstAbove(xs[c]! + EPS, k, side);
      if (w !== 0 && I < lo) addRun(n, base, I, lo);
      for (I = Math.max(I, lo); I < hi; I++) if (winding(row, at(I, k), py) !== 0) n[base + (I >> 2)]!++;
      w -= ds[c]!;
    }
    if (w !== 0) addRun(n, base, I, side);
  }
}

/** Count into `n` (per pixel) the samples within `half` of a segment of `subpaths`. */
function strokeSamples(subpaths: readonly (readonly number[])[], half: number, size: number, k: number, n: Uint8Array): void {
  const side = 4 * size;
  const hit = new Uint8Array(side * side);
  const h2 = half * half;
  // The samples that may lie within `half` of [lo, hi] along an axis (a sample spare each side).
  const from = (lo: number): number => Math.max(0, Math.floor(((lo - half) / k) * 4) - 1);
  const to = (hi: number): number => Math.min(side - 1, Math.ceil(((hi + half) / k) * 4) + 1);
  for (const s of subpaths) {
    for (let q = 0; q + 3 < s.length; q += 2) {
      const ax = s[q]!, ay = s[q + 1]!, dx = s[q + 2]! - ax, dy = s[q + 3]! - ay;
      const l = dx * dx + dy * dy;
      const j1 = to(Math.max(ay, ay + dy));
      for (let J = from(Math.min(ay, ay + dy)); J <= j1; J++) {
        const py = at(J, k);
        // The part of the segment within `half` of this row, and so its samples' span — a
        // sample's width wider, as the ranges are, so rounding cannot drop a sample lying at
        // exactly `half` (the exact test below still decides each one).
        let t0 = 0, t1 = 1;
        if (dy !== 0) {
          const reach = half + k / 4;
          const ta = (py - reach - ay) / dy, tb = (py + reach - ay) / dy;
          t0 = Math.max(0, Math.min(ta, tb));
          t1 = Math.min(1, Math.max(ta, tb));
          if (t0 > t1) continue;
        }
        const xa = ax + dx * t0, xb = ax + dx * t1;
        const i1 = to(Math.max(xa, xb)), r = J * side, base = (J >> 2) * size;
        // The interpreter pays for every call: `at` and the clamp are written out here.
        for (let I = from(Math.min(xa, xb)); I <= i1; I++) {
          if (hit[r + I]) continue;
          const px = ((I >> 2) + ((I & 3) + 0.5) / 4) * k;
          let t = 0;
          if (l) {
            t = ((px - ax) * dx + (py - ay) * dy) / l;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
          }
          const ex = px - ax - dx * t, ey = py - ay - dy * t;
          if (ex * ex + ey * ey <= h2) {
            hit[r + I] = 1;
            n[base + (I >> 2)]!++;
          }
        }
      }
    }
  }
}

interface Raster {
  readonly parts: readonly { readonly role: IconRole; readonly img: Image2D; readonly ink: number }[];
  readonly shadow: Image2D;
}

/**
 * The rasters, by size and then icon. A window shows the icons at two sizes (the pause
 * menu's and the confirm prompt's); a size it no longer uses — the window was resized — is
 * released when a newer one pushes it out.
 */
const rasters = new Map<number, Map<string, Raster>>();
const KEEP_SIZES = 2;

function release(r: Raster): void {
  for (const img of [r.shadow, ...r.parts.map((p) => p.img)]) __native.releaseTexture((img as NativeImage).id);
}

/** Drop every raster (the next draw makes them again). */
export function releaseIcons(): void {
  for (const bySize of rasters.values()) for (const r of bySize.values()) release(r);
  rasters.clear();
}

/** The cache for `size`, made the most recently used. */
function sizeCache(size: number): Map<string, Raster> {
  let bySize = rasters.get(size);
  if (bySize) rasters.delete(size);
  else bySize = new Map();
  rasters.set(size, bySize); // a Map iterates in insertion order: oldest first
  for (const [old, gone] of rasters) {
    if (rasters.size <= KEEP_SIZES) break;
    for (const r of gone.values()) release(r);
    rasters.delete(old);
  }
  return bySize;
}

/**
 * Each painted part of icon `name` at `size` px: per pixel, how many of its 16 samples the
 * part covers. `exhaustive` tests every sample against every edge instead — the obvious way,
 * far too slow for a frame, which the smoke gate holds the fast one to.
 */
export function partCounts(name: string, size: number, exhaustive = false): Uint8Array[] {
  const parts = iconSet().get(name);
  if (!parts) throw new Error(`no icon ${name}`);
  const k = 24 / size;
  return parts.map((part) => {
    const n = new Uint8Array(size * size);
    if (exhaustive) exhaustiveSamples(part, size, k, n);
    else if (part.stroke === null) fillSamples(part.subpaths, size, k, n);
    else strokeSamples(part.subpaths, part.stroke / 2, size, k, n);
    return n;
  });
}

function exhaustiveSamples(part: Part, size: number, k: number, n: Uint8Array): void {
  const edges: number[] = [];
  for (const s of part.subpaths) {
    const m = s.length / 2;
    for (let q = 0; q < m; q++) edges.push(s[2 * q]!, s[2 * q + 1]!, s[2 * ((q + 1) % m)]!, s[2 * ((q + 1) % m) + 1]!);
  }
  const h2 = part.stroke === null ? 0 : (part.stroke / 2) ** 2;
  const near = (px: number, py: number): boolean => part.subpaths.some((s) => {
    for (let q = 0; q + 3 < s.length; q += 2) {
      const ax = s[q]!, ay = s[q + 1]!, dx = s[q + 2]! - ax, dy = s[q + 3]! - ay;
      const l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
      const ex = px - ax - dx * t, ey = py - ay - dy * t;
      if (ex * ex + ey * ey <= h2) return true;
    }
    return false;
  });
  for (let J = 0; J < 4 * size; J++) {
    for (let I = 0; I < 4 * size; I++) {
      const px = at(I, k), py = at(J, k);
      if (part.stroke === null ? winding(edges, px, py) !== 0 : near(px, py)) n[(J >> 2) * size + (I >> 2)]!++;
    }
  }
}

function raster(name: string, size: number): Raster {
  const bySize = sizeCache(size);
  const hit = bySize.get(name);
  if (hit) return hit;
  const roles = iconSet().get(name)!;
  const union = new Uint8Array(size * size);
  const out = partCounts(name, size).map((n, i) => {
    let ink = 0;
    for (let p = 0; p < n.length; p++) {
      ink += n[p]!;
      if (n[p]! > union[p]!) union[p] = n[p]!;
    }
    return { role: roles[i]!.role, img: countMask(size, size, n, 16), ink: ink / 16 };
  });
  const r = { parts: out, shadow: countMask(size, size, union, 16) };
  bySize.set(name, r);
  return r;
}

/** The box `drawIcon` draws a `size` icon in. */
const iconPx = (size: number): number => Math.max(8, Math.round(size));

/**
 * Rasterise icon `name` for `size` now, as its first `drawIcon` would, and return each
 * painted part's ink (its coverage summed, in pixels): to have it ready before a menu
 * needs it, and for the smoke gate.
 */
export function warmIcon(name: string, size: number): number[] {
  return raster(name, iconPx(size)).parts.map((p) => p.ink);
}

/** Whether icon `name` for `size` is rasterised already. */
export const iconReady = (name: string, size: number): boolean => !!rasters.get(iconPx(size))?.has(name);

/** Icon `name` in the `size`×`size` box at (x, y), in `pal`'s colours, at `alpha`. */
export function drawIcon(ui: Ui, name: IconName, x: number, y: number, size: number, pal: UiPalette, alpha = 1): void {
  const s = iconPx(size);
  const r = iconReady(name, s) ? raster(name, s) : costed('icons', () => raster(name, s));
  ui.record(['icon', name, Math.round(x), Math.round(y), s]);
  // drop-shadow(0 1px 1px #000c), at the icon's scale.
  ui.mask(r.shadow, x, y + Math.max(1, s / 24), 0x000000, 0.8 * alpha);
  for (const p of r.parts) ui.mask(p.img, x, y, pal[p.role], alpha);
}
