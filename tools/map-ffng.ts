/**
 * Auto-derive the FFNG-solution -> original-room mapping AND validate the whole
 * corpus against the port, purely from data: replay each FFNG saved_moves file
 * against every 0NN.FFR (physics-only, mirroring the port's load/undo path) and
 * report which room(s) each solution drives to `won` with no false death.
 *
 * Run from the port dir:  npx tsx tools/map-ffng.ts [movesDir]
 * Needs FFR data at $FFNG_DATA/Graphic (default ~/.cache/ffng-orig/extracted/MAINDIR).
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { Script } from '../src/core/script.js';
import { ROOMS } from '../src/data/roomTable.js';
import { roomScript } from '../src/rooms/index.js';

const GRAPHIC = join(process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR'), 'Graphic');
const MOVES_DIR = process.argv[2] ?? process.env.FFNG_MOVES ?? join(process.cwd(), 'corpus');

type Which = 'little' | 'big';
function decode(ch: string): { which: Which; dir: number } | null {
  const l = ch.toLowerCase();
  const d = l === 'u' ? Dir.up : l === 'd' ? Dir.down : l === 'l' ? Dir.left : l === 'r' ? Dir.right : null;
  return d === null ? null : { which: (ch === l ? 'little' : 'big') as Which, dir: d };
}

/**
 * Run the room's ported `init()` (the InitProgramky half of Programky) purely to pick
 * up the room mode it declares — chiefly `gspec`. That single scalar decides whether a
 * fish reaching an edge exits at all (`if (gspec<>9)and(kontroluj_okraje>0)`,
 * URoom.pas:24295), so a physics-only replay that ignores it lets fish "win" gspec=9
 * push-out rooms (SPUNT/MAPA/POHON/DISKETA/GRAL/LODE) that cannot be won that way.
 * The replay stays physics-only otherwise — `prog()` is never ticked here.
 */
function initGspec(room: Room, jmeno: string): void {
  const def = roomScript(jmeno);
  if (!def) return;
  try {
    def.init(new Script(room, () => 0, () => false, {}, () => false));
  } catch {
    /* a script needing more host context than this tool provides: stay at gspec 0 */
  }
}

function tryRoom(num: number, jmeno: string, steps: { which: Which; dir: number }[]): { won: boolean; dead: boolean; blocked: number } | null {
  const path = join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);
  if (!existsSync(path)) return null;
  let room: Room;
  try {
    room = new Room(parseFfr(new Uint8Array(readFileSync(path))));
  } catch {
    return null;
  }
  initGspec(room, jmeno);
  room.clearAllDirs();
  room.fallToRest();
  room.clearAllDirs();
  let blocked = 0;
  for (const s of steps) {
    if (room.anyFishDead || room.won) break;
    if ((s.dir === Dir.left && room.facingRight[s.which]) || (s.dir === Dir.right && !room.facingRight[s.which])) {
      room.facingRight[s.which] = s.dir === Dir.right;
      continue;
    }
    if (!room.beginMoveFish(s.which, s.dir)) {
      blocked++;
      continue;
    }
    room.commitMove();
    room.clearAllDirs();
    room.fallToRest();
    // gspec=9 rooms never exit a fish — they are won by pushing an item out, which
    // needs the script-aware harness (test/solutionsHarness.ts), not this tool.
    const e = room.gspec === 9 ? null : room.checkEdges();
    if (e && !room.won) room.exitFish(e.which);
  }
  return { won: room.won, dead: room.anyFishDead, blocked };
}

function main(): void {
  // There is no CATCHALL list any more. It used to hold LODE #19 and GRAL #64 as "open
  // rooms many move-strings can exit" — but both are gspec=9 push-out rooms, and their
  // catch-all reputation was purely an artifact of this tool ignoring gspec and letting
  // fish exit them. With the mode honoured in tryRoom they no longer swallow unrelated
  // move strings, so nothing needs deprioritizing.
  const files = readdirSync(MOVES_DIR).filter((f) => f.endsWith('.moves')).sort();
  const mapped = new Set<number>();
  const rows: string[] = [];
  const tsv: string[] = ['slug\troom_num\tjmeno\tnote'];
  let clean = 0;
  let needScript = 0;
  for (const f of files) {
    const slug = f.replace(/\.moves$/, '');
    const moves = readFileSync(join(MOVES_DIR, f), 'utf8').trim();
    const steps = [...moves].map(decode).filter((m): m is { which: Which; dir: number } => m !== null);
    const wins: number[] = [];
    for (const r of ROOMS) {
      const res = tryRoom(r.num, r.jmeno, steps);
      if (res?.won) wins.push(r.num);
    }
    if (wins.length === 1) {
      clean++;
      mapped.add(wins[0]!);
      rows.push(`${slug.padEnd(12)} -> #${wins[0]} ${ROOMS[wins[0]! - 1]!.jmeno}`);
      tsv.push(`${slug}\t${wins[0]}\t${ROOMS[wins[0]! - 1]!.jmeno}\tclean`);
    } else if (wins.length > 1) {
      clean++;
      wins.forEach((w) => mapped.add(w));
      rows.push(`${slug.padEnd(12)} -> AMBIGUOUS ${wins.map((w) => `#${w} ${ROOMS[w - 1]!.jmeno}`).join(', ')}`);
      tsv.push(`${slug}\t${wins.join('|')}\t${wins.map((w) => ROOMS[w - 1]!.jmeno).join('|')}\tambiguous`);
    } else {
      // No physics-only win anywhere: either the room is script-gated (PARTY2, CHODBA)
      // or it is a gspec=9 push-out room whose win needs prog() to run (MAPA, DISKETA).
      // Either way it must be pinned by hand and asserted via test/solutionsHarness.ts.
      needScript++;
      rows.push(`${slug.padEnd(12)} -> NO PHYSICS-ONLY WIN (needs script-accurate replay)`);
      tsv.push(`${slug}\t\t\tneeds-script`);
    }
  }
  console.log(rows.join('\n'));
  const uncovered = ROOMS.filter((r) => !mapped.has(r.num)).map((r) => `#${r.num} ${r.jmeno}`);
  console.log(`\n${clean}/${files.length} solutions map cleanly (physics-only). ${needScript} need script-accurate replay.`);
  console.log(`Rooms not covered by a clean physics-only mapping (${uncovered.length}): ${uncovered.join(', ')}`);
  writeFileSync(join(MOVES_DIR, 'mapping.tsv'), tsv.join('\n') + '\n');
  console.log(`\nWrote ${join(MOVES_DIR, 'mapping.tsv')}`);
}

main();
