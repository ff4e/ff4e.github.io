/**
 * The help pages, natively: the same ten pages the browser shows (`src/data/helpText.ts`,
 * ALTAR's text transcribed from its 1998 bitmaps, and the twelve cropped diagrams), typeset
 * here into the original's 640×480 page box, scaled to the window, in the help's own
 * colours. The browser lays the page out with HTML and the stylesheet in index.html
 * (`#help-page`, `.help-*`); this follows those rules — sizes, margins (collapsing as CSS
 * collapses them), the first-line indent, the centred intro page, page 6's diagram column
 * and its floated cylinder — with greedy word wrap on the face's advances.
 *
 * Approximate by nature: the line breaks are this wrap's, not a browser's. Two things are
 * left out: the italics (there is no italic face natively, so `*emphasis*` and the notes are
 * upright) and the monospace of the dead addresses (Mulish, a size down, as the stylesheet
 * sizes them).
 */
import { helpPages, type HelpBlock, type HelpLang, type HelpPageContent } from '../../src/data/helpText.js';
import type { Image2D } from '../../src/render/surface2d.js';
import { decodeImage } from './nativeSurface.js';
import { readBytes } from './shims.js';
import type { Ui } from './uiDraw.js';

const PAGE_W = 640;
const PAGE_H = 480;
/** The page background (helpDom.ts `HELP_BG`, #8ccec6). */
const HELP_BG = 0x8ccec6;
const INK = 0x000000;
const LINE = 1.34;

const figures = new Map<string, Image2D | null>();

/** A diagram, decoded on first use; null until it has landed (or if it cannot). */
function figure(id: string): Image2D | null {
  if (!figures.has(id)) {
    figures.set(id, null);
    void readBytes(`/help/${id}.png`).then(
      (b) => figures.set(id, decodeImage(b.slice().buffer)),
      (e: unknown) => console.warn(`help diagram ${id} did not load`, e),
    );
  }
  return figures.get(id) ?? null;
}

/** Every diagram a language's pages use, so a smoke can wait for them. */
export async function preloadHelpFigures(lang: HelpLang): Promise<void> {
  for (const p of helpPages(lang)) {
    const ids = [...(p.column ?? []), ...p.blocks.flatMap((b) => (b.kind === 'figures' ? b.ids : b.kind === 'inlineFigure' ? [b.id] : []))];
    for (const id of ids) {
      if (figures.get(id)) continue;
      figures.set(id, decodeImage((await readBytes(`/help/${id}.png`)).slice().buffer));
    }
  }
}

interface TextStyle {
  readonly px: number;
  readonly bold?: boolean;
  readonly align?: 'left' | 'center' | 'right';
  readonly left?: number;
  readonly indent?: number;
  readonly spacing?: number;
  readonly alpha?: number;
  readonly top: number;
  readonly bottom: number;
}

/** Lay out and draw one page. Coordinates are CSS px of the 640×480 page; `k` scales them. */
class PageWriter {
  y = 0;
  private marginBelow = 0;
  private first = true;
  private float: { bottom: number; w: number } | null = null;

  constructor(
    private readonly ui: Ui,
    private readonly ox: number,
    private readonly oy: number,
    private readonly k: number,
    private readonly left: number,
    private readonly right: number,
  ) {}

  /** CSS margin collapsing between siblings; the flow's first child has no top margin. */
  private open(top: number): void {
    this.y += this.first ? 0 : Math.max(this.marginBelow, top);
    this.first = false;
  }

  private close(bottom: number): void {
    this.marginBelow = bottom;
  }

  /** Word-wrap `text` and draw it. */
  text(raw: string, st: TextStyle): void {
    this.open(st.top);
    const text = raw.replace(/\*/g, ''); // emphasis: no italic face natively (see the header)
    const px = st.px * this.k;
    const lh = st.px * LINE;
    const [asc, desc] = this.ui.fonts.regular.metrics(st.px);
    const base = (lh - (asc + Math.abs(desc))) / 2 + asc;
    const x0 = this.left + (st.left ?? 0);
    const words = text.split(' ');
    let line = '';
    let indent = st.indent ?? 0;
    const width = (): number => this.right - x0 - indent - (this.float && this.y < this.float.bottom ? this.float.w : 0);
    const fits = (s: string): boolean => this.ui.measure(s, px, st.bold, (st.spacing ?? 0) * px) / this.k <= width();
    const flush = (s: string): void => {
      const w = this.ui.measure(s, px, st.bold, (st.spacing ?? 0) * px) / this.k;
      const avail = width();
      const x = st.align === 'center' ? x0 + indent + (avail - w) / 2 : st.align === 'right' ? x0 + indent + avail - w : x0 + indent;
      this.ui.text(s, this.ox + x * this.k, this.oy + (this.y + base) * this.k, px, INK, {
        bold: !!st.bold, spacing: (st.spacing ?? 0) * px, alpha: st.alpha ?? 1,
      });
      this.y += lh;
      indent = 0;
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && !fits(next)) {
        flush(line);
        line = w;
      } else line = next;
    }
    if (line) flush(line);
    this.close(st.bottom);
  }

  /** A row of framed diagrams, centred (`.help-figs`: gap 3, margin 10 -20 0). */
  figures(ids: readonly string[]): void {
    this.open(10);
    const sizes = ids.map((id): readonly [number, number] => (id === 'fig-06-steel' ? [13, 43] : [206, 206]));
    const total = sizes.reduce((a, [w]) => a + w, 0) + 3 * (ids.length - 1);
    let x = this.left - 20 + (this.right - this.left + 40 - total) / 2;
    const h = Math.max(...sizes.map(([, hh]) => hh));
    ids.forEach((id, i) => {
      const [w, hh] = sizes[i]!;
      const img = figure(id);
      if (img) this.ui.image(img, this.ox + x * this.k, this.oy + this.y * this.k, w * this.k, hh * this.k, false, 1, id);
      x += w + 3;
    });
    this.y += h;
    this.close(0);
  }

  /** The cylinder beside page 6's text (`.help-fig--inline`: float right, margin 2 0 4 12). */
  floatRight(id: string): void {
    const img = figure(id);
    const x = this.right - 13;
    if (img) this.ui.image(img, this.ox + x * this.k, this.oy + (this.y + 2) * this.k, 13 * this.k, 43 * this.k, false, 1, id);
    this.float = { bottom: this.y + 2 + 43 + 4, w: 13 + 12 };
  }

  /** A hairline across the flow (`.help-today`'s border-top). */
  rule(alpha: number): void {
    this.ui.rect(this.ox + this.left * this.k, this.oy + this.y * this.k, (this.right - this.left) * this.k, Math.max(1, this.k), INK, alpha);
  }

  skip(css: number): void {
    this.y += css;
  }
}

function writeBlock(pw: PageWriter, b: HelpBlock, intro: boolean): void {
  switch (b.kind) {
    case 'logo':
      pw.text('FILLETS', { px: 30, bold: true, align: 'center', spacing: 0.34, indent: 0.34 * 30, top: 6, bottom: 0 });
      pw.text(b.tagline, { px: 14, align: 'center', spacing: 0.06, top: 3, bottom: 0 });
      return;
    case 'title':
      pw.text(b.text, { px: 15, bold: true, align: 'center', top: 0, bottom: 10 });
      return;
    case 'heading':
      pw.text(b.text, { px: 11, bold: true, left: 24, top: 10, bottom: 4 });
      return;
    case 'display':
      pw.text(b.text, { px: 20, bold: true, align: 'center', top: 20, bottom: 20 });
      return;
    case 'para':
      pw.text(b.text, intro ? { px: 11, align: 'center', top: 26, bottom: 4 } : { px: 11, indent: b.indent ? 24 : 0, top: 0, bottom: 4 });
      return;
    case 'rule':
      pw.text(b.text, { px: 11, left: 24, top: 0, bottom: 7 });
      return;
    case 'note':
      pw.text(b.text, { px: 11, align: b.align === 'right' ? 'right' : 'left', top: 0, bottom: 6 });
      return;
    case 'list':
      b.items.forEach((it, i) => pw.text(`•  ${it}`, { px: 11, left: 4, top: i === 0 ? 2 : 0, bottom: i === b.items.length - 1 ? 4 : 0 }));
      return;
    case 'url':
      pw.text(b.text, { px: 10, alpha: 0.85, top: 0, bottom: 3 });
      return;
    case 'today':
      pw.skip(10);
      pw.rule(0.28);
      pw.skip(5);
      pw.text(b.text, { px: 10, alpha: 0.8, top: 0, bottom: 0 });
      return;
    case 'footer':
      pw.skip(148);
      for (const line of b.lines) pw.text(line, { px: 11, bold: true, align: 'center', top: 0, bottom: 8 });
      return;
    case 'figures':
      pw.figures(b.ids);
      return;
    case 'inlineFigure':
      pw.floatRight(b.id);
      return;
  }
}

/** The page box in the `w`×`h` window: the 640×480 page, as large as fits. */
export function helpBox(w: number, h: number): [number, number, number, number] {
  const k = Math.min(w / PAGE_W, h / PAGE_H);
  const pw = Math.floor(PAGE_W * k), ph = Math.floor(PAGE_H * k);
  return [Math.floor((w - pw) / 2), Math.floor((h - ph) / 2), pw, ph];
}

/** Help page `page` in `lang` over the `w`×`h` window. Returns the page's box. */
export function paintHelp(ui: Ui, w: number, h: number, lang: HelpLang, page: number): [number, number, number, number] {
  const pages = helpPages(lang);
  const content: HelpPageContent = pages[page] ?? pages[0]!;
  ui.rect(0, 0, w, h, 0x000000, 0.88);
  const [ox, oy, pw, ph] = helpBox(w, h);
  const k = Math.min(pw / PAGE_W, ph / PAGE_H);
  ui.rect(ox, oy, pw, ph, HELP_BG);
  const intro = content.blocks.some((b) => b.kind === 'logo');
  if (content.column) {
    // Page 6: a 206 px diagram column beside the text (`.help-doc--column`, padding 14 14 12 10, gap 18).
    let cy = 14;
    for (const id of content.column) {
      const img = figure(id);
      if (img) ui.image(img, ox + 10 * k, oy + cy * k, 206 * k, 206 * k, false, 1, id);
      cy += 206 + 26;
    }
    const writer = new PageWriter(ui, ox, oy + 14 * k, k, 10 + 206 + 18, PAGE_W - 14);
    for (const b of content.blocks) writeBlock(writer, b, intro);
  } else {
    const writer = new PageWriter(ui, ox, oy + 14 * k, k, 24, PAGE_W - 24);
    for (const b of content.blocks) writeBlock(writer, b, intro);
  }
  return [ox, oy, pw, ph];
}
