/**
 * M0 verification CLI: load a room's original 0NN.FFR, assert its size matches
 * the `Desc[].DFFR` integrity value from zaklad.pas, parse it with the faithful
 * loader, and print a summary. The byte-exact "reached EOF" check inside
 * parseFfr is the real proof the format reading is correct end-to-end.
 *
 * Usage:
 *   npm run dump-ffr -- UTES         # by room name
 *   npm run dump-ffr -- 7            # by room number
 *   npm run dump-ffr -- --all        # parse + validate all 72 rooms (summary only)
 *
 * Data location (extracted from the GPL ffinstallation.exe, never executed):
 *   default: ~/.cache/ffng-orig/extracted/MAINDIR
 *   override: FF_DATA_DIR=/path/to/MAINDIR
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFfr, type FfrRoom, Kind } from '../src/data/ffr.js';
import { ROOMS, roomByName, roomByNumber, type RoomDesc } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');

function ffrPath(num: number): string {
  const nn = String(num).padStart(3, '0'); // 0NN.FFR -> e.g. 007.ffr
  return join(DATA_DIR, 'Graphic', `${nn}.ffr`);
}

function resolveRoom(arg: string): RoomDesc {
  const byNum = /^\d+$/.test(arg) ? roomByNumber(Number(arg)) : roomByName(arg);
  if (!byNum) throw new Error(`unknown room: ${arg}`);
  return byNum;
}

const kindName = (k: number): string =>
  (Object.entries(Kind).find(([, v]) => v === k)?.[0]) ?? `?(${k})`;

function loadRoom(room: RoomDesc): { room: RoomDesc; size: number; parsed: FfrRoom } {
  const path = ffrPath(room.num);
  if (!existsSync(path)) throw new Error(`missing FFR: ${path}`);
  const data = readFileSync(path);
  if (data.length !== room.dffr) {
    throw new Error(`size mismatch for ${room.jmeno}: file=${data.length} DFFR=${room.dffr}`);
  }
  const parsed = parseFfr(data);
  return { room, size: data.length, parsed };
}

function dumpOne(arg: string): void {
  const room = resolveRoom(arg);
  const { size, parsed } = loadRoom(room);

  const objBmps = parsed.bitmaps.filter((b) => b !== null).length;
  const bg = parsed.bitmaps.findIndex((b, i) => i > 0 && b?.padded);
  const wallBmp = parsed.items[0]!.bmp;

  console.log(`Room ${room.num}: ${room.jmeno}  (cHud=${room.cHud})`);
  console.log(`  description : CZ="${parsed.descriptionCz}"  EN="${parsed.descriptionEn}"`);
  console.log(`  file        : ${ffrPath(room.num)}`);
  console.log(`  size        : ${size} bytes  (DFFR=${room.dffr} ✓)  consumed=${parsed.bytesConsumed} ✓`);
  console.log(`  toc         : ${parsed.toc}`);
  console.log(`  grid        : ${parsed.width} x ${parsed.height}   items=${parsed.itemCount}`);
  console.log(`  facing      : small=${parsed.startFacingRight.small ? 'right' : 'left'}  big=${parsed.startFacingRight.big ? 'right' : 'left'}`);
  console.log(`  water       : amp=${parsed.wamp} per=${parsed.wper} spd=${parsed.wspd}`);
  console.log(`  bitmaps     : numBmp=${parsed.numBmp} (loaded=${objBmps})  wallBmp=${wallBmp}  firstPadded=${bg < 0 ? 'none' : bg}`);
  console.log(`  fish frames : heads ${parsed.heads.big.length - 1}/${parsed.heads.small.length - 1}  bodies ${parsed.bodies.big.length - 1}/${parsed.bodies.small.length - 1}  (big/small)`);

  const fish = parsed.items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.kind === Kind.big || it.kind === Kind.little);
  console.log(`  fish items  : ${fish.map(({ it, idx }) => `#${idx} ${kindName(it.kind)}@(${it.xStart},${it.yStart}) cells=${it.fields.length}`).join('  ')}`);

  console.log('  first items :');
  for (let i = 0; i <= Math.min(parsed.itemCount, 5); i++) {
    const it = parsed.items[i]!;
    const tag = i === 0 ? ' [wall]' : '';
    console.log(`    #${i}${tag}: kind=${kindName(it.kind)} pos=(${it.xStart},${it.yStart}) bmp=${it.bmp} mask=${it.mask} cells=${it.fields.length}`);
  }
}

function dumpAll(): void {
  let ok = 0;
  const fails: string[] = [];
  for (const room of ROOMS) {
    try {
      const { parsed } = loadRoom(room);
      ok++;
      const objBmps = parsed.bitmaps.filter((b) => b !== null).length;
      console.log(
        `  ✓ ${String(room.num).padStart(2)} ${room.jmeno.padEnd(9)} ` +
          `${parsed.width}x${parsed.height} items=${String(parsed.itemCount).padStart(3)} ` +
          `bmps=${String(objBmps).padStart(4)} pal=256`,
      );
    } catch (e) {
      fails.push(`  ✗ ${room.num} ${room.jmeno}: ${(e as Error).message}`);
    }
  }
  if (fails.length) console.log('\nFAILURES:\n' + fails.join('\n'));
  console.log(`\n${ok}/${ROOMS.length} FFR files parsed byte-exactly (DFFR-validated).`);
  if (fails.length) process.exitCode = 1;
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: dump-ffr <room-name|room-number|--all>');
  process.exit(2);
}
if (arg === '--all') dumpAll();
else dumpOne(arg);
