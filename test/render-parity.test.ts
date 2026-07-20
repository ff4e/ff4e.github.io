/**
 * P1 byte-equality regression gate.
 *
 * The staged renderer refactor keeps the classic 256-colour look pixel-identical.
 * This test renders every real room via BOTH CPU paths — the legacy
 * `renderRoomState(...).toRgba(palette)` (the oracle) and the new
 * `renderRoomRgba(..., ClassicArtSource).rgba` compositor — at a spread of frame
 * counters, and asserts the RGBA output is byte-for-byte identical.
 *
 * It needs the extracted game data; when $FF_DATA_DIR (default
 * ~/.cache/ffng-orig/extracted/MAINDIR) is absent the suite skips, so CI without
 * the copyrighted assets still passes (same convention as tools/render-room.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { renderRoomState, renderRoomRgba } from '../src/render/renderRoom.js';
import { ClassicArtSource } from '../src/render/classicArtSource.js';
import { ROOMS } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
/** Frame counters exercising water-wobble, ZX bands (phase 1/52/500), animation. */
const COUNTS = [0, 1, 7, 53, 128, 499];

function ffrPath(num: number): string {
  return join(DATA_DIR, 'Graphic', `${String(num).padStart(3, '0')}.ffr`);
}

const haveData = existsSync(DATA_DIR) && ROOMS.some((r) => existsSync(ffrPath(r.num)));

describe.skipIf(!haveData)('classic RGBA compositor byte-parity vs toRgba oracle', () => {
  for (const room of ROOMS) {
    const path = ffrPath(room.num);
    it.skipIf(!existsSync(path))(`${room.jmeno} (#${room.num})`, () => {
      const parsed = parseFfr(readFileSync(path));
      const art = new ClassicArtSource(parsed.palette);
      for (const count of COUNTS) {
        // Fresh Room per path: the ZX compositor mutates per-frame band state, so
        // both paths must start from identical initial room state.
        const oracle = renderRoomState(new Room(parsed), { count }).toRgba(parsed.palette);
        const rgba = renderRoomRgba(new Room(parsed), art, { count }).rgba;
        expect(Buffer.from(rgba).equals(Buffer.from(oracle)), `${room.jmeno} @count=${count}`).toBe(true);
      }
    });
  }
});
