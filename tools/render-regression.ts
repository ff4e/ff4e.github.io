/**
 * P1 byte-equality regression gate (spike).
 *
 * Renders every real room via the current CPU path (renderRoomState -> toRgba)
 * at several `count` values and hashes each RGBA frame. In P1 this becomes the
 * oracle: swap the second render to the NEW RGBA compositor and assert the
 * hashes match byte-for-byte, proving classic stays pixel-identical.
 *
 * Two modes:
 *   dump    — write out/regression-goldens.json (room+count -> sha256 of RGBA)
 *   verify  — re-render and diff against out/regression-goldens.json
 *
 * FFRs come from $FF_DATA_DIR (default ~/.cache/ffng-orig/extracted/MAINDIR),
 * same source as tools/render-room.ts. Usage:
 *   npx tsx tools/render-regression.ts dump
 *   npx tsx tools/render-regression.ts verify
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseFfr } from '../src/data/ffr.js';
import { renderRoomStatic } from '../src/render/renderRoom.js';
import { ROOMS } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const GOLDEN = join(OUT_DIR, 'regression-goldens.json');
/** A spread of frame counters to exercise water-wobble / ZX band / animation phases. */
const COUNTS = [0, 1, 7, 53, 128, 499] as const;

function ffrPath(num: number): string {
  return join(DATA_DIR, 'Graphic', `${String(num).padStart(3, '0')}.ffr`);
}

function frameHash(num: number, count: number): string {
  const parsed = parseFfr(readFileSync(ffrPath(num)));
  const screen = renderRoomStatic(parsed, { count });
  // In P1: render the SAME scene via the new RGBA compositor here and compare.
  const rgba = screen.toRgba(parsed.palette);
  return createHash('sha256').update(Buffer.from(rgba)).digest('hex');
}

function computeAll(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const room of ROOMS) {
    if (!existsSync(ffrPath(room.num))) continue;
    for (const count of COUNTS) {
      try {
        out[`${room.jmeno}@${count}`] = frameHash(room.num, count);
      } catch (e) {
        out[`${room.jmeno}@${count}`] = `ERROR:${(e as Error).message}`;
      }
    }
  }
  return out;
}

const mode = process.argv[2] ?? 'verify';
const hashes = computeAll();
const n = Object.keys(hashes).length;
const errs = Object.entries(hashes).filter(([, v]) => v.startsWith('ERROR:'));

if (mode === 'dump') {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(GOLDEN, JSON.stringify(hashes, null, 0));
  console.log(`dumped ${n} frame hashes (${ROOMS.length} rooms x ${COUNTS.length} counts) -> ${GOLDEN}`);
  if (errs.length) console.log(`  ${errs.length} render errors:`, errs.map(([k]) => k).join(', '));
} else if (mode === 'verify') {
  if (!existsSync(GOLDEN)) {
    console.error(`no goldens at ${GOLDEN}; run "dump" first`);
    process.exit(2);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string>;
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(hashes)) {
    if (golden[k] !== v) diffs.push(`${k}: ${golden[k] ?? '(missing)'} != ${v}`);
  }
  if (diffs.length) {
    console.error(`REGRESSION: ${diffs.length}/${n} frames differ:`);
    for (const d of diffs.slice(0, 20)) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log(`OK: ${n} frames byte-identical to goldens`);
} else {
  console.error('usage: render-regression.ts <dump|verify>');
  process.exit(2);
}
