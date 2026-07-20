/**
 * Compose QA review sheets from the out/qa/*.png that qa-enhanced.ts produced:
 * each room becomes a row "classic | enhanced" (downscaled), several rooms per
 * sheet, ordered by object count (highest bug-risk first). Output: out/qa/sheet-N.png.
 *
 *   npx tsx tools/qa-sheet.ts [roomsPerSheet]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/render/pngDecode.js';
import { encodePng } from '../src/render/png.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'qa');
const perSheet = Number(process.argv[2] ?? 8);
const CELL_W = 240; // downscaled room width
const GAP = 6;

// Room order (by object count desc) — the qa-enhanced report's "closest look" list.
const ORDER = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ['ZAVAL','BANKA','SLOUPY','KNIHOVNA','GRAL','SMETAK','WIN','BOTTLES','PUCLIK','BATHROOM','CHODBA','ZELVA','MAPA','STEEL','NCP','JEDNICKY','VLADOVA','TRUHLA','DIRY','WARCR2','POHON','KORALY','KANKAN','KUCHYNE','ZX','VRAK','SVATBA','DRAKAR','SECRET','SPUNT','BARELY','PUZZLE','PARTY1','PARTY2','UFO','PYRAMIDA','DELA','VITEJTE1','VES','REAKTOR','PRAVIDLA','LODE','TETRIS','MOTOR','DISKETA','DRAKAR1','KOSTE','BATYSKAF','MIKRO','POCITAC','ODPADKY','JESKYNE','LETADLO','KUFRIK'];

interface Img { w: number; h: number; rgba: Uint8Array; }
function load(p: string): Img | null { return existsSync(p) ? decodePng(readFileSync(p)) : null; }

/** Box-downscale to a target width, preserving aspect. */
function scaleToW(src: Img, tw: number): Img {
  const th = Math.max(1, Math.round((src.h / src.w) * tw));
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = Math.min(src.w - 1, Math.floor((x / tw) * src.w));
    const sy = Math.min(src.h - 1, Math.floor((y / th) * src.h));
    const so = (sy * src.w + sx) * 4, doo = (y * tw + x) * 4;
    out[doo] = src.rgba[so]!; out[doo+1] = src.rgba[so+1]!; out[doo+2] = src.rgba[so+2]!; out[doo+3] = 255;
  }
  return { w: tw, h: th, rgba: out };
}

function paste(dst: Img, src: Img, ox: number, oy: number) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const so = (y * src.w + x) * 4, doo = ((oy + y) * dst.w + (ox + x)) * 4;
    dst.rgba[doo] = src.rgba[so]!; dst.rgba[doo+1] = src.rgba[so+1]!; dst.rgba[doo+2] = src.rgba[so+2]!; dst.rgba[doo+3] = 255;
  }
}

let sheetNo = 0;
for (let start = 0; start < ORDER.length; start += perSheet) {
  const batch = ORDER.slice(start, start + perSheet);
  const rows = batch.map((jm) => {
    const c = load(join(OUT, `${jm}-classic.png`));
    const e = load(join(OUT, `${jm}-enhanced.png`));
    if (!c || !e) return null;
    return { jm, c: scaleToW(c, CELL_W), e: scaleToW(e, CELL_W) };
  }).filter((r): r is NonNullable<typeof r> => !!r);
  if (rows.length === 0) continue;
  const sheetW = CELL_W * 2 + GAP * 3;
  const sheetH = rows.reduce((a, r) => a + Math.max(r.c.h, r.e.h) + GAP, GAP);
  const sheet: Img = { w: sheetW, h: sheetH, rgba: new Uint8Array(sheetW * sheetH * 4).fill(40) };
  for (let i = 3; i < sheet.rgba.length; i += 4) sheet.rgba[i] = 255;
  let y = GAP;
  for (const r of rows) { paste(sheet, r.c, GAP, y); paste(sheet, r.e, GAP * 2 + CELL_W, y); y += Math.max(r.c.h, r.e.h) + GAP; }
  const path = join(OUT, `sheet-${sheetNo}.png`);
  writeFileSync(path, encodePng(sheet.rgba, sheet.w, sheet.h));
  console.log(`sheet-${sheetNo}: ${batch.join(', ')}`);
  sheetNo++;
}
