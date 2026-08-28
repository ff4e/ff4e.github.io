/**
 * The help pages, as a document instead of a bitmap.
 *
 * The original blitted twenty 640x480 bitmaps (Help.pas:TabControl1Change). Those bitmaps
 * are pictures of PROSE — six of the ten pages contain no artwork at all — so at any size
 * but 1:1 the player was reading resampled 8-bit text. This builds the same pages out of
 * `src/data/helpText.ts` and the twelve cropped diagrams instead, which are the parts that
 * really are pictures.
 *
 * ── What is deliberately unchanged ───────────────────────────────────────────
 * The paging. A click advances to the next page and wraps, any key closes the viewer
 * (Help.pas:Image1Click / FormKeyDown), and the ArrowLeft/ArrowRight the port added still
 * work. This element takes NO pointer events for exactly that reason: the handlers live on
 * `#screen` underneath (`main.ts`), and letting the page swallow a click would have been a
 * change of behaviour smuggled in as a change of medium.
 *
 * The cost of that choice is that the text cannot be selected with the mouse — a drag would
 * page the help on mousedown. It is still real text to a screen reader, to find-in-page and
 * to a translator, which it never was as pixels; only the mouse is excluded, and only
 * because click-to-page is the thing being preserved.
 *
 * ── Why the page is a fixed 640x480 box ──────────────────────────────────────
 * The same box the original used, and for the same reason: all ten pages are one size, so
 * paging does not resize the stage under the player, and the close button does not move.
 * The line breaks inside it are the browser's, though, so "it fits" is not something the
 * layout can promise on its own — `tools/test-options.mjs` measures every page in both
 * languages and fails if one overflows. Without that, a font-metric change on some other
 * platform would quietly clip somebody's last paragraph.
 *
 * Unlike the bitmap it replaces, the box may scale ABOVE 1:1. The old renderer capped
 * there because enlarging a bitmap only blurs it; text scales as text.
 *
 * Module scope is side-effect-free (see `dom.ts`): `createElement` only, nothing attached
 * and nothing measured until `main.ts` calls into this module.
 */
import { helpPages, type HelpBlock, type HelpLang, type HelpPageContent } from '../data/helpText.js';
import { canvas, ctx, helpPageEl } from './dom.js';
import { contentScaleFor } from './stageGeometry.js';

/**
 * The page background, taken from the bitmaps' palette (index 130 in the Czech files,
 * 129 in the English ones — the same colour, quantised twice). Text is the pure black
 * the pages antialias down to.
 */
export const HELP_BG = '#8ccec6';

/** The unscaled page box — the original's 640x480 (Help.pas, `helpy.txt` line 1). */
const PAGE_W = 640;
const PAGE_H = 480;

/** Which page is currently built. */
let built = '';
/** The scale last applied, so an unchanged frame writes no styles at all. */
let appliedScale = 0;

/** Split `*emphasis*` runs out of a paragraph (the only markup helpText.ts carries). */
function appendText(into: HTMLElement, text: string): void {
  for (const [i, part] of text.split('*').entries()) {
    if (!part) continue;
    if (i % 2 === 0) into.append(part);
    else {
      const em = document.createElement('em');
      em.textContent = part;
      into.appendChild(em);
    }
  }
}

function figure(id: string, alt: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = `/help/${id}.png`;
  img.alt = alt;
  img.className = 'help-fig';
  // The diagrams ARE 1998 pixel art, unlike the text around them, so they keep the
  // stylesheet's `pixelated` treatment and their native 206px size.
  img.width = id === 'fig-06-steel' ? 13 : 206;
  img.height = id === 'fig-06-steel' ? 43 : 206;
  return img;
}

function renderBlock(b: HelpBlock, into: HTMLElement): void {
  switch (b.kind) {
    case 'logo': {
      const h = document.createElement('h1');
      h.className = 'help-logo';
      h.textContent = 'FILLETS';
      const tag = document.createElement('p');
      tag.className = 'help-tagline';
      tag.textContent = b.tagline;
      into.append(h, tag);
      return;
    }
    case 'title': {
      const h = document.createElement('h2');
      h.className = 'help-title';
      h.textContent = b.text;
      into.appendChild(h);
      return;
    }
    case 'heading': {
      const h = document.createElement('h3');
      h.className = 'help-heading';
      h.textContent = b.text;
      into.appendChild(h);
      return;
    }
    case 'display': {
      const h = document.createElement('p');
      h.className = 'help-display';
      h.textContent = b.text;
      into.appendChild(h);
      return;
    }
    case 'para': {
      const p = document.createElement('p');
      p.className = b.indent ? 'help-para help-para--indent' : 'help-para';
      appendText(p, b.text);
      into.appendChild(p);
      return;
    }
    case 'rule': {
      const p = document.createElement('p');
      p.className = 'help-rule';
      appendText(p, b.text);
      into.appendChild(p);
      return;
    }
    case 'note': {
      const p = document.createElement('p');
      p.className = b.align === 'right' ? 'help-note help-note--right' : 'help-note';
      p.textContent = b.text;
      into.appendChild(p);
      return;
    }
    case 'list': {
      const ul = document.createElement('ul');
      ul.className = 'help-list';
      for (const item of b.items) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      }
      into.appendChild(ul);
      return;
    }
    case 'url': {
      // Text, never an anchor: these addresses died with ALTAR, and a link that looks
      // live and is not is a worse artefact than the words themselves.
      const p = document.createElement('p');
      p.className = 'help-url';
      p.textContent = b.text;
      into.appendChild(p);
      return;
    }
    case 'today': {
      const p = document.createElement('p');
      p.className = 'help-today';
      p.textContent = b.text;
      into.appendChild(p);
      return;
    }
    case 'footer': {
      const f = document.createElement('div');
      f.className = 'help-footer';
      for (const line of b.lines) {
        const p = document.createElement('p');
        p.textContent = line;
        f.appendChild(p);
      }
      into.appendChild(f);
      return;
    }
    case 'inlineFigure': {
      const fig = figure(b.id, b.alt);
      fig.classList.add('help-fig--inline');
      into.appendChild(fig);
      return;
    }
    case 'figures': {
      const row = document.createElement('div');
      row.className = 'help-figs';
      for (const id of b.ids) row.appendChild(figure(id, ''));
      into.appendChild(row);
      return;
    }
  }
}

/** Build one page's DOM. */
function buildPage(page: HelpPageContent): HTMLElement {
  const article = document.createElement('article');
  article.className = 'help-doc';
  // Two pages are not text pages: page 1 is a centred title page, and page 6 puts its two
  // diagrams in a left column beside the text. Both are the original's composition.
  if (page.blocks.some((b) => b.kind === 'logo')) article.classList.add('help-doc--intro');
  if (page.column) article.classList.add('help-doc--column');
  if (page.column) {
    const col = document.createElement('div');
    col.className = 'help-col';
    for (const id of page.column) col.appendChild(figure(id, ''));
    article.appendChild(col);
  }
  const flow = document.createElement('div');
  flow.className = 'help-flow';
  for (const b of page.blocks) renderBlock(b, flow);
  article.appendChild(flow);
  return article;
}

/**
 * Show `page` of the help in `lang`, sized to the stage box.
 *
 * Called every frame while the help is open (renderLoop): the DOM is rebuilt only when the
 * page or the language moves, and the scale is written only when it changes.
 */
export function renderHelp(lang: HelpLang, page: number): void {
  const pages = helpPages(lang);
  const key = `${lang}|${page}`;
  if (key !== built) {
    built = key;
    const content = pages[page] ?? pages[0]!;
    helpPageEl.replaceChildren(buildPage(content));
    helpPageEl.lang = lang === 'cz' ? 'cs' : 'en';
    helpPageEl.setAttribute('aria-label', `${content.tab} (${page + 1}/${pages.length})`);
  }

  const k = contentScaleFor(PAGE_W, PAGE_H);
  if (k === appliedScale) return;
  appliedScale = k;

  // The canvas underneath is the layout anchor and the click target, so it gets the
  // identical box — the help's pointer handling still runs through `#screen` (see header).
  // Floored, so it can never round OVER the stage box.
  const cssW = Math.floor(PAGE_W * k);
  const cssH = Math.floor(PAGE_H * k);
  if (canvas.width !== PAGE_W || canvas.height !== PAGE_H) {
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  // Scaled from the FLOORED size rather than from `k`, and by the smaller of the two axes:
  // at `k` the page is up to a pixel bigger than the canvas it covers and overhangs its
  // border on the bottom and right. Undershooting instead leaves at most a pixel of the
  // canvas showing, which is this same colour and so is nothing at all.
  helpPageEl.style.transform = `scale(${Math.min(cssW / PAGE_W, cssH / PAGE_H)})`;
  // The page is opaque, so this only guarantees that nothing of the room or map survives
  // in the sliver left by the floors above.
  ctx.fillStyle = HELP_BG;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
}

/** Show or hide the page. Hiding also drops its DOM, so nothing stale is behind the game. */
export function showHelp(open: boolean): void {
  if (helpPageEl.hidden === !open) return;
  helpPageEl.hidden = !open;
  if (!open) {
    helpPageEl.replaceChildren();
    built = '';
    appliedScale = 0;
  }
}

/** How many pages the help has in a language (Help.pas reads this from the index file). */
export function helpPageCount(lang: HelpLang): number {
  return helpPages(lang).length;
}
