/**
 * M2 verification: exercise the movement/push physics headlessly and render the
 * result, proving the ported posun_objekt/posun_ryby behave correctly.
 *
 *   npm run test-move -- UTES
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { encodePng } from '../src/render/png.js';
import { roomByName, roomByNumber } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');

const arg = process.argv[2] ?? 'UTES';
const desc = (/^\d+$/.test(arg) ? roomByNumber(Number(arg)) : roomByName(arg))!;
const ffr = parseFfr(readFileSync(join(DATA_DIR, 'Graphic', `${String(desc.num).padStart(3, '0')}.ffr`)));
const room = new Room(ffr);

const little = room.items[room.littleIdx]!;
const big = room.items[room.bigIdx]!;
console.log(`${desc.jmeno}: little@(${little.x},${little.y}) facing ${room.facingRight.little ? 'R' : 'L'}, big@(${big.x},${big.y}) facing ${room.facingRight.big ? 'R' : 'L'}`);

const DIR_NAME: Record<number, string> = { [Dir.up]: 'up', [Dir.down]: 'down', [Dir.left]: 'left', [Dir.right]: 'right' };

function step(which: 'little' | 'big', dir: number): void {
  const it = which === 'little' ? little : big;
  const before = `(${it.x},${it.y})`;
  const ok = room.tryMoveFish(which, dir);
  console.log(`  ${which} ${DIR_NAME[dir]}: ${ok ? 'moved' : 'blocked'}  ${before} -> (${it.x},${it.y})`);
}

// Drive the small fish around, then the big fish, exercising success + blocking.
step('little', Dir.left);
step('little', Dir.left);
step('little', Dir.up);
step('little', Dir.down);
step('big', Dir.left);
step('big', Dir.up);
step('big', Dir.right);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const screen = renderRoomState(room, { count: 0 });
writeFileSync(join(OUT_DIR, `${desc.jmeno}-moved.png`), encodePng(screen.toRgba(room.palette), screen.width, screen.height));
console.log(`\nrendered post-move frame -> out/${desc.jmeno}-moved.png`);
