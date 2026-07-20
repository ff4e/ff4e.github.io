/**
 * M5 verification: parse a room's FFT and list its subtitles (CZ + EN).
 *
 *   npm run dump-fft -- UTES
 *   npm run dump-fft -- --all   # summary: subtitle count per room
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFft } from '../src/data/fft.js';
import { ROOMS, roomByName, roomByNumber, type RoomDesc } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const fftPath = (num: number): string => join(DATA_DIR, 'Title', `${String(num).padStart(3, '0')}.fft`);

function resolveRoom(arg: string): RoomDesc {
  const r = /^\d+$/.test(arg) ? roomByNumber(Number(arg)) : roomByName(arg);
  if (!r) throw new Error(`unknown room: ${arg}`);
  return r;
}

function dumpOne(room: RoomDesc): void {
  const path = fftPath(room.num);
  if (!existsSync(path)) throw new Error(`missing FFT: ${path}`);
  const entries = parseFft(readFileSync(path));
  console.log(`Room ${room.num} ${room.jmeno} — ${entries.length} subtitle entries:\n`);
  for (const e of entries) {
    console.log(`  ${e.name}`);
    if (e.cz.text) console.log(`    CZ [${e.cz.color}] ${e.cz.text}`);
    if (e.en.text) console.log(`    EN [${e.en.color}] ${e.en.text}`);
  }
}

function dumpAll(): void {
  let ok = 0;
  for (const room of ROOMS) {
    const path = fftPath(room.num);
    if (!existsSync(path)) {
      console.log(`  ✗ ${room.num} ${room.jmeno}: missing`);
      continue;
    }
    try {
      const entries = parseFft(readFileSync(path));
      const withText = entries.filter((e) => e.cz.text || e.en.text).length;
      ok++;
      console.log(`  ✓ ${String(room.num).padStart(2)} ${room.jmeno.padEnd(9)} ${String(entries.length).padStart(3)} sounds, ${String(withText).padStart(3)} with subtitles`);
    } catch (e) {
      console.log(`  ✗ ${room.num} ${room.jmeno}: ${(e as Error).message}`);
    }
  }
  console.log(`\n${ok}/${ROOMS.length} FFT files parsed.`);
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: dump-fft <room-name|room-number|--all>');
  process.exit(2);
}
if (arg === '--all') dumpAll();
else dumpOne(resolveRoom(arg));
