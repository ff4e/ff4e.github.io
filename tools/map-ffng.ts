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
import { ROOMS } from '../src/data/roomTable.js';

const GRAPHIC = join(process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR'), 'Graphic');
const MOVES_DIR = process.argv[2] ?? process.env.FFNG_MOVES ?? join(process.cwd(), 'corpus');

type Which = 'little' | 'big';
function decode(ch: string): { which: Which; dir: number } | null {
  const l = ch.toLowerCase();
  const d = l === 'u' ? Dir.up : l === 'd' ? Dir.down : l === 'l' ? Dir.left : l === 'r' ? Dir.right : null;
  return d === null ? null : { which: (ch === l ? 'little' : 'big') as Which, dir: d };
}

function tryRoom(num: number, steps: { which: Which; dir: number }[]): { won: boolean; dead: boolean; blocked: number } | null {
  const path = join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);
  if (!existsSync(path)) return null;
  let room: Room;
  try {
    room = new Room(parseFfr(new Uint8Array(readFileSync(path))));
  } catch {
    return null;
  }
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
    const e = room.checkEdges();
    if (e && !room.won) room.exitFish(e.which);
  }
  return { won: room.won, dead: room.anyFishDead, blocked };
}

function main(): void {
  const CATCHALL = new Set([19, 64]); // open rooms many move-strings can exit; deprioritize when mapping
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
      const res = tryRoom(r.num, steps);
      if (res?.won) wins.push(r.num);
    }
    const primary = wins.filter((w) => !CATCHALL.has(w));
    if (primary.length === 1) {
      clean++;
      mapped.add(primary[0]!);
      rows.push(`${slug.padEnd(12)} -> #${primary[0]} ${ROOMS[primary[0]! - 1]!.jmeno}`);
      tsv.push(`${slug}\t${primary[0]}\t${ROOMS[primary[0]! - 1]!.jmeno}\tclean`);
    } else if (primary.length > 1) {
      clean++;
      primary.forEach((w) => mapped.add(w));
      rows.push(`${slug.padEnd(12)} -> AMBIGUOUS ${primary.map((w) => `#${w} ${ROOMS[w - 1]!.jmeno}`).join(', ')}`);
      tsv.push(`${slug}\t${primary.join('|')}\t${primary.map((w) => ROOMS[w - 1]!.jmeno).join('|')}\tambiguous`);
    } else if (wins.length > 0) {
      needScript++;
      rows.push(`${slug.padEnd(12)} -> NEEDS SCRIPT (only catch-all rooms won: ${wins.map((w) => `#${w}`).join(',')})`);
      tsv.push(`${slug}\t\t\tneeds-script`);
    } else {
      rows.push(`${slug.padEnd(12)} -> NO WIN on any room`);
      tsv.push(`${slug}\t\t\tno-win`);
    }
  }
  console.log(rows.join('\n'));
  const uncovered = ROOMS.filter((r) => !mapped.has(r.num) && !CATCHALL.has(r.num)).map((r) => `#${r.num} ${r.jmeno}`);
  console.log(`\n${clean}/${files.length} solutions map cleanly (physics-only). ${needScript} need script-accurate replay.`);
  console.log(`Rooms not covered by a clean physics-only mapping (${uncovered.length}): ${uncovered.join(', ')}`);
  writeFileSync(join(MOVES_DIR, 'mapping.tsv'), tsv.join('\n') + '\n');
  console.log(`\nWrote ${join(MOVES_DIR, 'mapping.tsv')}`);
}

main();
