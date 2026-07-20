/**
 * M1 verification CLI: render a room's initial resting frame to a PNG so it can
 * be compared visually / pixel-wise against the original game.
 *
 * Usage:
 *   npm run render-room -- UTES            # -> out/UTES.png
 *   npm run render-room -- 7 --count 0     # by number, explicit frame counter
 *   npm run render-room -- --all           # render all 72 rooms to out/
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { renderRoomStatic } from '../src/render/renderRoom.js';
import { encodePng } from '../src/render/png.js';
import { ROOMS, roomByName, roomByNumber, type RoomDesc } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');

function ffrPath(num: number): string {
  return join(DATA_DIR, 'Graphic', `${String(num).padStart(3, '0')}.ffr`);
}

function resolveRoom(arg: string): RoomDesc {
  const r = /^\d+$/.test(arg) ? roomByNumber(Number(arg)) : roomByName(arg);
  if (!r) throw new Error(`unknown room: ${arg}`);
  return r;
}

function renderOne(room: RoomDesc, count: number): { w: number; h: number; file: string } {
  const path = ffrPath(room.num);
  if (!existsSync(path)) throw new Error(`missing FFR: ${path}`);
  const parsed = parseFfr(readFileSync(path));
  const screen = renderRoomStatic(parsed, { count });
  const rgba = screen.toRgba(parsed.palette);
  const png = encodePng(rgba, screen.width, screen.height);
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${room.jmeno}.png`);
  writeFileSync(file, png);
  return { w: screen.width, h: screen.height, file };
}

const args = process.argv.slice(2);
const countArg = args.indexOf('--count');
const count = countArg >= 0 ? Number(args[countArg + 1]) : 0;
const target = args.find((a) => !a.startsWith('--') && a !== String(count));

if (args.includes('--all')) {
  let ok = 0;
  for (const room of ROOMS) {
    try {
      const { w, h } = renderOne(room, count);
      ok++;
      console.log(`  ✓ ${String(room.num).padStart(2)} ${room.jmeno.padEnd(9)} ${w}x${h}`);
    } catch (e) {
      console.log(`  ✗ ${room.num} ${room.jmeno}: ${(e as Error).message}`);
    }
  }
  console.log(`\n${ok}/${ROOMS.length} rooms rendered to ${OUT_DIR}`);
} else if (target) {
  const room = resolveRoom(target);
  const { w, h, file } = renderOne(room, count);
  console.log(`Rendered ${room.jmeno} (${w}x${h}, count=${count}) -> ${file}`);
} else {
  console.error('usage: render-room <room-name|room-number|--all> [--count N]');
  process.exit(2);
}
