/**
 * Corrective pass over the committed enhanced object manifests
 * (public/enhanced/<JMENO>/objects.json).
 *
 * The original stage-enhanced-objects.ts matched each FFNG model to an FFR item
 * by position using a last-wins Map, so when several items share the same
 * (xStart,yStart) — e.g. PARTY1's cabin interior + frame at (19,15), or its four
 * window figures at (21,16) — every co-located object collapsed onto the LAST
 * item index. That drew the cabin glass on the frame's z-layer (hiding the
 * figures) and bound all four figures to one item.
 *
 * This re-derives each object's `item` from its stored (x,y) against the room's
 * FFR, keeping ALL item indices per position (ascending) and assigning the Nth
 * object at a position to the Nth item there. Rooms with no position collisions
 * are unchanged. Needs $FF_DATA_DIR (the extracted FFR data).
 *
 *   npx tsx tools/fix-enhanced-mapping.ts          # rewrite in place
 *   npx tsx tools/fix-enhanced-mapping.ts --dry    # report only
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { roomByName } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENHANCED = join(ROOT, 'public', 'enhanced');
const dry = process.argv.includes('--dry');

interface ObjEntry {
  x: number;
  y: number;
  item?: number;
  frames: string[];
  [k: string]: unknown;
}

let changedRooms = 0;
let changedObjs = 0;
const notes: string[] = [];

for (const jmeno of readdirSync(ENHANCED).sort()) {
  const manifestPath = join(ENHANCED, jmeno, 'objects.json');
  if (!existsSync(manifestPath)) continue;
  const room = roomByName(jmeno);
  if (!room) continue;
  const ffrPath = join(DATA_DIR, 'Graphic', `${String(room.num).padStart(3, '0')}.ffr`);
  if (!existsSync(ffrPath)) {
    notes.push(`${jmeno}: no FFR at ${ffrPath} (skipped)`);
    continue;
  }
  const ffr = parseFfr(readFileSync(ffrPath));
  const posToItems = new Map<string, number[]>();
  for (let j = 1; j <= ffr.itemCount; j++) {
    const key = `${ffr.items[j]!.xStart},${ffr.items[j]!.yStart}`;
    const list = posToItems.get(key);
    if (list) list.push(j);
    else posToItems.set(key, [j]);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { objects: ObjEntry[] };
  const cursor = new Map<string, number>();
  let roomChanged = 0;
  for (const e of manifest.objects) {
    const key = `${e.x},${e.y}`;
    const items = posToItems.get(key);
    if (!items || items.length === 0) continue; // no FFR item at this position; leave as-is
    const c = cursor.get(key) ?? 0;
    const want = items[Math.min(c, items.length - 1)]!;
    cursor.set(key, c + 1);
    if (e.item !== want) {
      e.item = want;
      roomChanged++;
    }
  }

  if (roomChanged > 0) {
    changedRooms++;
    changedObjs += roomChanged;
    notes.push(`${jmeno}: remapped ${roomChanged} object(s)`);
    if (!dry) writeFileSync(manifestPath, JSON.stringify(manifest, null, 0) + '\n');
  }
}

console.log(`${dry ? '[dry] ' : ''}remapped ${changedObjs} object(s) across ${changedRooms} room(s).`);
if (notes.length) console.log('  ' + notes.join('\n  '));
