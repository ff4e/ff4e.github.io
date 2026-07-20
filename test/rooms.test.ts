/**
 * Whole-corpus tests over the real extracted rooms: every FFR parses, and its
 * load-time gravity settle is deterministic, terminates, stays stable, and never
 * crushes a fish on a freshly-loaded (authored, at-rest) room.
 *
 * The game data is not in the repo (copyright), so these tests SKIP cleanly when
 * it isn't present. Point $FFNG_DATA at the extracted MAINDIR to run them.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { ROOMS } from '../src/data/roomTable.js';

const DATA = process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR');
const GRAPHIC = join(DATA, 'Graphic');
const hasData = existsSync(GRAPHIC);

const ffrPath = (num: number): string => join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);

describe.skipIf(!hasData)('all rooms (real FFR data)', () => {
  it('every room parses', () => {
    for (const r of ROOMS) {
      const ffr = parseFfr(new Uint8Array(readFileSync(ffrPath(r.num))));
      expect(ffr.width).toBeGreaterThan(0);
      expect(ffr.itemCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('every room settles cleanly at load (deterministic, stable, no death)', () => {
    for (const r of ROOMS) {
      const ffr = parseFfr(new Uint8Array(readFileSync(ffrPath(r.num))));
      const room = new Room(ffr);
      room.fallToRest();
      const snap = room.items.map((it) => `${it.x},${it.y}`);
      // A second settle must be a no-op (already at rest / deterministic).
      room.fallToRest();
      const snap2 = room.items.map((it) => `${it.x},${it.y}`);
      expect(snap2, `room ${r.jmeno} not stable`).toEqual(snap);
      expect(room.anyFishDead, `room ${r.jmeno} crushed a fish at load`).toBe(false);
    }
  });
});

if (!hasData) {
  // Surface why the corpus tests were skipped, without failing the suite.
  // eslint-disable-next-line no-console
  console.warn(`[rooms.test] skipped — game data not found at ${GRAPHIC} (set $FFNG_DATA to enable)`);
}
