/**
 * M4 verification: drive a fish to a clicked target purely via the ported BFS
 * (najdi_smer), one planned step per iteration, and confirm it arrives — the
 * same loop the host runs. Also renders the path result to a PNG.
 *
 *   npm run test-path -- UTES little 10 4
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { Room, ITEM_WATER } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { encodePng } from '../src/render/png.js';
import { roomByName, roomByNumber } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const DN: Record<number, string> = { [Dir.up]: 'U', [Dir.down]: 'D', [Dir.left]: 'L', [Dir.right]: 'R' };

const [roomArg = 'UTES', whichArg = 'little', txArg, tyArg] = process.argv.slice(2);
const which = whichArg === 'big' ? 'big' : 'little';
const desc = (/^\d+$/.test(roomArg) ? roomByNumber(Number(roomArg)) : roomByName(roomArg))!;
const ffr = parseFfr(readFileSync(join(DATA_DIR, 'Graphic', `${String(desc.num).padStart(3, '0')}.ffr`)));
const room = new Room(ffr);
room.fallToRest();

const fish = room.items[which === 'little' ? room.littleIdx : room.bigIdx]!;

// Target: given, else find the farthest reachable water cell to the left on the fish's row.
let tx = txArg !== undefined ? Number(txArg) : -1;
let ty = tyArg !== undefined ? Number(tyArg) : fish.y;
if (tx < 0) {
  for (let x = fish.x - 1; x >= 1; x--) {
    if (room.cellOccupant(x, fish.y) === ITEM_WATER && room.findDir(which, x, fish.y) !== Dir.no) {
      tx = x;
      ty = fish.y;
    }
  }
}

console.log(`${desc.jmeno}: ${which} fish @(${fish.x},${fish.y}) -> target (${tx},${ty})`);
const path: string[] = [];
let steps = 0;
while (steps < 500) {
  const dir = room.findDir(which, tx, ty);
  if (dir === Dir.no) break;
  // turn-first-then-move (as the host does)
  if (dir === Dir.left && room.facingRight[which]) {
    room.facingRight[which] = false;
    path.push('turnL');
    continue;
  }
  if (dir === Dir.right && !room.facingRight[which]) {
    room.facingRight[which] = true;
    path.push('turnR');
    continue;
  }
  if (!room.beginMoveFish(which, dir)) break;
  room.finalizeStep();
  room.fallToRest();
  path.push(DN[dir]!);
  steps++;
  if (room.anyFishDead) {
    path.push('DIED');
    break;
  }
}

const arrivedAt = `(${fish.x},${fish.y})`;
const reached = fish.x === tx && fish.y === ty;
console.log(`  path: ${path.join(' ')}`);
console.log(`  arrived at ${arrivedAt}  (target ${tx},${ty})  ${reached ? '✓ reached' : room.anyFishDead ? '✗ died en route' : '· stopped (blocked/near)'}`);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const screen = renderRoomState(room, { count: 0 });
writeFileSync(join(OUT_DIR, `${desc.jmeno}-path.png`), encodePng(screen.toRgba(room.palette), screen.width, screen.height));
console.log(`  rendered -> out/${desc.jmeno}-path.png`);
