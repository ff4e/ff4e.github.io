/**
 * Cut the help pages' diagrams out of the original bitmaps.
 *
 * The 1998/2002 help was twenty 640x480 bitmaps of TEXT with a few pictures in it. The
 * text is transcribed into `src/data/helpText.ts` and rendered as HTML; the pictures are
 * not redrawable — they are annotated screenshots of the real game, arrows and crosses and
 * all — so they are kept exactly as ALTAR drew them and this tool is how they get out.
 *
 * Committed, rather than a one-off manual export, so the crop is reproducible: run it
 * again and you get the same bytes, and the rectangles below are auditable against the
 * source bitmaps instead of living in someone's image editor history.
 *
 * ── Why the rectangles are what they are ──────────────────────────────────────
 * They were not eyeballed. A "picture" pixel is one whose RGB is outside the 36-colour
 * vocabulary the pure-text pages use; on the six text-only pages that detector finds
 * ZERO pixels, and on the four diagram pages it finds solid rectangles with clean gaps
 * between them. The numbers below are those spans, framing border included.
 *
 * ── Why there is one set of rectangles and not two ────────────────────────────
 * The artwork is IDENTICAL in the Czech and English bitmaps. Compared pixel for pixel the
 * panels differ by 80-234 px out of 42 436 (0.2-0.6%), and every difference is palette
 * quantisation — the two files quantise the same background to index 130 and 129. So the
 * Czech bitmap is the source for all twelve figures and both languages share them.
 *
 * The one exception is page 7, whose English panels sit 1 px lower (at dy=1 the diff drops
 * from 21 629 px to 92). That is a layout offset in the English page, not different art,
 * so it changes the rectangle and not the figure.
 *
 * Usage: `npx tsx tools/crop-help-diagrams.ts` (add `--check` to verify without writing).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseBmp, bmpToRgba, type Bmp } from '../src/data/bmp.js';
import { encodePng } from '../src/render/png.js';

const SRC = join('public', 'data', 'Help');
const OUT = join('public', 'help');

interface Figure {
  /** Output basename, referenced by `figure` blocks in src/data/helpText.ts. */
  id: string;
  /** Source bitmap (always the Czech one — see the header). */
  from: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The twelve figures, in page order. All the framed panels are 206x206. */
const FIGURES: Figure[] = [
  // Page 5 — a bottom band of three panels.
  { id: 'fig-05-1', from: 'help05.BMP', x: 7, y: 263, w: 206, h: 206 },
  { id: 'fig-05-2', from: 'help05.BMP', x: 216, y: 263, w: 206, h: 206 },
  { id: 'fig-05-3', from: 'help05.BMP', x: 425, y: 263, w: 206, h: 206 },
  // Page 6 — a left COLUMN of two panels, plus the steel cylinder that sits inline in
  // the text. The cylinder is the only figure that is not a framed panel.
  { id: 'fig-06-1', from: 'help06.BMP', x: 11, y: 17, w: 206, h: 206 },
  { id: 'fig-06-2', from: 'help06.BMP', x: 11, y: 255, w: 206, h: 206 },
  { id: 'fig-06-steel', from: 'help06.BMP', x: 571, y: 107, w: 13, h: 43 },
  // Page 7 — a bottom band of three. (The English page's band is 1 px lower; same art.)
  { id: 'fig-07-1', from: 'help07.BMP', x: 7, y: 255, w: 206, h: 206 },
  { id: 'fig-07-2', from: 'help07.BMP', x: 216, y: 255, w: 206, h: 206 },
  { id: 'fig-07-3', from: 'help07.BMP', x: 425, y: 255, w: 206, h: 206 },
  // Page 8 — a bottom band of three.
  { id: 'fig-08-1', from: 'help08.BMP', x: 11, y: 254, w: 206, h: 206 },
  { id: 'fig-08-2', from: 'help08.BMP', x: 216, y: 254, w: 206, h: 206 },
  { id: 'fig-08-3', from: 'help08.BMP', x: 424, y: 254, w: 206, h: 206 },
];

/** Copy a rectangle out of an indexed bitmap as RGBA. */
function crop(bmp: Bmp, f: Figure): Uint8Array {
  if (f.x + f.w > bmp.w || f.y + f.h > bmp.h) {
    throw new Error(`${f.id}: ${f.w}x${f.h} at ${f.x},${f.y} falls outside ${bmp.w}x${bmp.h}`);
  }
  const src = bmpToRgba(bmp);
  const out = new Uint8Array(f.w * f.h * 4);
  for (let row = 0; row < f.h; row++) {
    const from = ((f.y + row) * bmp.w + f.x) * 4;
    out.set(src.subarray(from, from + f.w * 4), row * f.w * 4);
  }
  return out;
}

const check = process.argv.includes('--check');
if (!check) mkdirSync(OUT, { recursive: true });

const cache = new Map<string, Bmp>();
let written = 0;
let bytes = 0;
let stale = 0;

for (const f of FIGURES) {
  let bmp = cache.get(f.from);
  if (!bmp) {
    bmp = parseBmp(readFileSync(join(SRC, f.from)));
    cache.set(f.from, bmp);
  }
  const png = encodePng(crop(bmp, f), f.w, f.h);
  const dest = join(OUT, `${f.id}.png`);
  bytes += png.length;
  if (check) {
    const same = existsSync(dest) && Buffer.from(png).equals(readFileSync(dest));
    if (!same) {
      stale++;
      console.error(`  STALE ${dest}`);
    }
    continue;
  }
  writeFileSync(dest, png);
  written++;
}

if (check) {
  if (stale) {
    console.error(`${stale} of ${FIGURES.length} help figures differ from the bitmaps — re-run without --check.`);
    process.exit(1);
  }
  console.log(`${FIGURES.length} help figures match the bitmaps.`);
} else {
  console.log(`wrote ${written} help figures to ${OUT}/ (${(bytes / 1024).toFixed(0)} kB)`);
}
