/**
 * Guards the enhanced object manifests (public/enhanced/<JMENO>/objects.json)
 * against the position-collision mismap that hid PARTY1/PARTY2 window figures:
 * the staging tool used to bind co-located objects (several FFR items sharing an
 * xStart,yStart) to the LAST item index. Each object must instead bind to an FFR
 * item that actually sits at its (x,y), and co-located objects must bind to
 * distinct items in order (the same rule tools/fix-enhanced-mapping.ts enforces).
 *
 * Needs the extracted FFR data; skips when $FF_DATA_DIR is absent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFfr } from '../src/data/ffr.js';
import { roomByName } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const ENHANCED = join(__dirname, '..', 'public', 'enhanced');

const rooms = existsSync(ENHANCED)
  ? readdirSync(ENHANCED).filter((d) => existsSync(join(ENHANCED, d, 'objects.json')))
  : [];
const haveData = existsSync(DATA_DIR) && rooms.some((d) => roomByName(d));

describe.skipIf(!haveData)('enhanced object manifests bind to FFR items at their position', () => {
  for (const jmeno of rooms) {
    const room = roomByName(jmeno);
    const ffrPath = room ? join(DATA_DIR, 'Graphic', `${String(room.num).padStart(3, '0')}.ffr`) : '';
    it.skipIf(!room || !existsSync(ffrPath))(jmeno, () => {
      const ffr = parseFfr(readFileSync(ffrPath));
      const posToItems = new Map<string, number[]>();
      for (let j = 1; j <= ffr.itemCount; j++) {
        const key = `${ffr.items[j]!.xStart},${ffr.items[j]!.yStart}`;
        (posToItems.get(key) ?? posToItems.set(key, []).get(key)!).push(j);
      }
      const manifest = JSON.parse(readFileSync(join(ENHANCED, jmeno, 'objects.json'), 'utf8')) as {
        objects: { x: number; y: number; item: number; frames: string[] }[];
      };
      const cursor = new Map<string, number>();
      for (const o of manifest.objects) {
        const items = posToItems.get(`${o.x},${o.y}`);
        if (!items) continue; // decor with no FFR item at its position: not position-bound
        const c = cursor.get(`${o.x},${o.y}`) ?? 0;
        cursor.set(`${o.x},${o.y}`, c + 1);
        const expected = items[Math.min(c, items.length - 1)];
        expect(o.item, `${jmeno} ${o.frames[0]} @ (${o.x},${o.y})`).toBe(expected);
      }
    });
  }
});
