/**
 * Enhanced-mode QA sweep. For every room, load its FFR + staged enhanced art
 * (background, object sprites, shared fish sprites) and render the SAME initial
 * room state through BOTH the classic and the enhanced art source. Saves
 * out/qa/<JMENO>-{classic,enhanced}.png for review and prints a per-room report
 * flagging anomalies (render errors, missing/dim-mismatched background, or an
 * enhanced frame identical to classic — i.e. no truecolor actually applied).
 *
 * Deterministic, no browser. Needs $FF_DATA_DIR (extracted FFR data).
 *   npx tsx tools/qa-enhanced.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { renderRoomRgba } from '../src/render/renderRoom.js';
import { ClassicArtSource } from '../src/render/classicArtSource.js';
import { EnhancedArtSource, type EnhancedArt, type EnhancedObject, type EnhancedSprite, type FishSprites } from '../src/render/enhancedArtSource.js';
import { decodeEnhancedArt } from '../src/render/enhancedDecode.js';
import { decodePng } from '../src/render/pngDecode.js';
import { encodePng } from '../src/render/png.js';
import { ROOMS } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENHANCED = join(ROOT, 'public', 'enhanced');
const OUT = join(ROOT, 'out', 'qa');

function decodeSprite(path: string): EnhancedSprite {
  const d = decodePng(readFileSync(path));
  return { w: d.w, h: d.h, rgba: d.rgba };
}

/** Load the shared enhanced fish sprites once (public/enhanced/_fish). */
function loadFish(): FishSprites | null {
  const base = join(ENHANCED, '_fish');
  const manifestPath = join(base, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<'small' | 'big', Record<'left' | 'right', string[]>>;
  const build = (size: 'small' | 'big', facing: 'left' | 'right') => {
    const map = new Map<string, EnhancedSprite>();
    for (const f of m[size]?.[facing] ?? []) {
      const p = join(base, size, facing, f);
      if (existsSync(p)) map.set(f, decodeSprite(p));
    }
    return map;
  };
  return {
    small: { left: build('small', 'left'), right: build('small', 'right') },
    big: { left: build('big', 'left'), right: build('big', 'right') },
  };
}

function loadObjects(dir: string): EnhancedObject[] {
  const manifestPath = join(dir, 'objects.json');
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { objects: { item: number; frames: string[] }[] };
  const out: EnhancedObject[] = [];
  for (const o of manifest.objects) {
    const frames = o.frames.map((f) => decodeSprite(join(dir, 'obj', f))).filter((s): s is EnhancedSprite => !!s);
    if (frames.length > 0) out.push({ item: o.item, frames });
  }
  return out;
}

function loadBg(dir: string): EnhancedArt | null {
  const w = join(dir, 'w.png');
  const p = join(dir, 'p.png');
  if (!existsSync(w) || !existsSync(p)) return null;
  try {
    return decodeEnhancedArt(readFileSync(w), readFileSync(p));
  } catch {
    return null;
  }
}

const fish = loadFish();
mkdirSync(OUT, { recursive: true });

interface Report {
  jmeno: string;
  num: number;
  flags: string[];
  objects: number;
  diffPct: number;
}
const reports: Report[] = [];

for (const room of ROOMS) {
  const ffrPath = join(DATA_DIR, 'Graphic', `${String(room.num).padStart(3, '0')}.ffr`);
  if (!existsSync(ffrPath)) continue;
  const dir = join(ENHANCED, room.jmeno);
  const flags: string[] = [];
  let objects: EnhancedObject[] = [];
  let bg: EnhancedArt | null = null;
  try {
    const ffr = parseFfr(readFileSync(ffrPath));
    bg = existsSync(dir) ? loadBg(dir) : null;
    objects = existsSync(dir) ? loadObjects(dir) : [];
    if (!existsSync(dir)) flags.push('NO_ENHANCED_DIR');
    else if (!bg) flags.push('NO_BG');

    const classic = renderRoomRgba(new Room(ffr), new ClassicArtSource(ffr.palette), { count: 0 });
    if (bg && (bg.w !== classic.width || bg.h !== classic.height)) flags.push(`DIM_MISMATCH(${bg.w}x${bg.h}!=${classic.width}x${classic.height})`);
    const enh = renderRoomRgba(new Room(ffr), new EnhancedArtSource(ffr.palette, bg, objects, fish), { count: 0 });

    let diff = 0;
    const n = classic.rgba.length;
    for (let i = 0; i < n; i += 4) if (classic.rgba[i] !== enh.rgba[i] || classic.rgba[i + 1] !== enh.rgba[i + 1] || classic.rgba[i + 2] !== enh.rgba[i + 2]) diff++;
    const diffPct = Math.round((diff / (n / 4)) * 1000) / 10;
    if (diffPct === 0) flags.push('IDENTICAL_TO_CLASSIC');

    writeFileSync(join(OUT, `${room.jmeno}-classic.png`), encodePng(classic.rgba, classic.width, classic.height));
    writeFileSync(join(OUT, `${room.jmeno}-enhanced.png`), encodePng(enh.rgba, enh.width, enh.height));
    reports.push({ jmeno: room.jmeno, num: room.num, flags, objects: objects.length, diffPct });
  } catch (e) {
    flags.push('ERROR:' + (e as Error).message);
    reports.push({ jmeno: room.jmeno, num: room.num, flags, objects: objects.length, diffPct: -1 });
  }
}

reports.sort((a, b) => a.num - b.num);
console.log(`Rendered ${reports.length} rooms to ${OUT}\n`);
const flagged = reports.filter((r) => r.flags.length > 0);
console.log(`== Flagged (${flagged.length}) ==`);
for (const r of flagged) console.log(`  ${String(r.num).padStart(2)} ${r.jmeno.padEnd(10)} obj=${r.objects} diff=${r.diffPct}%  ${r.flags.join(' ')}`);
console.log(`\n== Rooms with object sprites (closest look) ==`);
for (const r of reports.filter((r) => r.objects > 0).sort((a, b) => b.objects - a.objects))
  console.log(`  ${String(r.num).padStart(2)} ${r.jmeno.padEnd(10)} obj=${r.objects} diff=${r.diffPct}%`);
