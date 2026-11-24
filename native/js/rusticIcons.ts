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
 * samples a pixel.
 *
 * Two symbols the web's set has no need for — Resume and Help, in the pause menu — are drawn
 * here in the same hand (uneven outline, one highlight facet, one shade facet).
 */
import iconSource from '../../src/styles/nativeMenuIcons.svg?raw';
import type { Image2D } from '../../src/render/surface2d.js';
import { coverageMask, type Ui } from './uiDraw.js';
import type { UiPalette } from './uiPalette.js';

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

/** Every icon the set has (the smoke gate checks each one rasterises). */
export const iconNames = (): string[] => [...iconSet().keys()];

// ── Rasterising ─────────────────────────────────────────────────────────────────────

/** Nonzero winding of the point against closed subpaths. */
function inside(subpaths: readonly (readonly number[])[], px: number, py: number): boolean {
  let wn = 0;
  for (const s of subpaths) {
    const n = s.length / 2;
    for (let k = 0; k < n; k++) {
      const ax = s[2 * k]!, ay = s[2 * k + 1]!;
      const b = (k + 1) % n;
      const bx = s[2 * b]!, by = s[2 * b + 1]!;
      if (ay <= py) {
        if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) wn++;
      } else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) wn--;
    }
  }
  return wn !== 0;
}

function nearLine(subpaths: readonly (readonly number[])[], px: number, py: number, half: number): boolean {
  const h2 = half * half;
  for (const s of subpaths) {
    for (let k = 0; k + 3 < s.length; k += 2) {
      const ax = s[k]!, ay = s[k + 1]!, dx = s[k + 2]! - ax, dy = s[k + 3]! - ay;
      const l = dx * dx + dy * dy;
      const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
      const ex = px - ax - dx * t, ey = py - ay - dy * t;
      if (ex * ex + ey * ey <= h2) return true;
    }
  }
  return false;
}

interface Raster {
  readonly parts: readonly { readonly role: IconRole; readonly img: Image2D }[];
  readonly shadow: Image2D;
}

const rasters = new Map<string, Raster>();

function raster(name: IconName, size: number): Raster {
  const key = `${name}|${size}`;
  const hit = rasters.get(key);
  if (hit) return hit;
  const parts = iconSet().get(name);
  if (!parts) throw new Error(`no icon ${name}`);
  const k = 24 / size;
  const union = new Float32Array(size * size);
  const out = parts.map((part) => {
    const cov = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let n = 0;
        for (let j = 0; j < 4; j++) {
          for (let i = 0; i < 4; i++) {
            const px = (x + (i + 0.5) / 4) * k, py = (y + (j + 0.5) / 4) * k;
            if (part.stroke === null ? inside(part.subpaths, px, py) : nearLine(part.subpaths, px, py, part.stroke / 2)) n++;
          }
        }
        cov[y * size + x] = n / 16;
        union[y * size + x] = Math.max(union[y * size + x]!, n / 16);
      }
    }
    return { role: part.role, img: coverageMask(size, size, cov) };
  });
  const r = { parts: out, shadow: coverageMask(size, size, union) };
  rasters.set(key, r);
  return r;
}

/** Icon `name` in the `size`×`size` box at (x, y), in `pal`'s colours, at `alpha`. */
export function drawIcon(ui: Ui, name: IconName, x: number, y: number, size: number, pal: UiPalette, alpha = 1): void {
  const s = Math.max(8, Math.round(size));
  const r = raster(name, s);
  ui.record(['icon', name, Math.round(x), Math.round(y), s]);
  // drop-shadow(0 1px 1px #000c), at the icon's scale.
  ui.mask(r.shadow, x, y + Math.max(1, s / 24), 0x000000, 0.8 * alpha);
  for (const p of r.parts) ui.mask(p.img, x, y, pal[p.role], alpha);
}
