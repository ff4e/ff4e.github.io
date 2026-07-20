/**
 * PoC: replay Fish Fillets NG "saved_moves" solutions against the ported engine.
 *
 * FFNG records a solution as a plain string where each char is one fish step:
 *   little fish (lowercase): u=up d=down l=left r=right
 *   big fish   (uppercase):  U=up D=down L=left R=right
 * These map onto the port's own move directions. We replay each step through the
 * same physics-only path the port uses for load/undo (applyMoveInstant): push +
 * settle gravity + edge-exit, then assert the room reaches `won` with no death.
 *
 * Run from the port dir:  npx tsx tools/replay-ffng.ts [movesDir]
 * Needs original FFR data (set $FFNG_DATA to the extracted MAINDIR, default
 * ~/.cache/ffng-orig/extracted/MAINDIR).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { roomByName } from '../src/data/roomTable.js';
import { Script } from '../src/core/script.js';
import { roomScript } from '../src/rooms/index.js';

/** Run the room script per tick during replay? (SCRIPT=1) — needed for rooms with autonomous objects. */
const RUN_SCRIPT = process.env.SCRIPT === '1';

const DATA = process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR');
const GRAPHIC = join(DATA, 'Graphic');
const MOVES_DIR = process.argv[2] ?? process.env.FFNG_MOVES ?? join(process.cwd(), 'corpus');

/** FFNG solution slug -> original room Jmeno (only the unambiguous subset here). */
const SLUG_TO_JMENO: Record<string, string> = {
  start: 'PRVNI',
  briefcase: 'KUFRIK',
  cellar: 'PRAVIDLA',
  wreck: 'VRAK',
  stairs: 'SCHODY',
  reef: 'UTES',
  wc: 'WC',
  submarine: 'ZRC',
  party1: 'PARTY1',
};

type Which = 'little' | 'big';
function decode(ch: string): { which: Which; dir: number } | null {
  const lower = ch.toLowerCase();
  const dir =
    lower === 'u' ? Dir.up : lower === 'd' ? Dir.down : lower === 'l' ? Dir.left : lower === 'r' ? Dir.right : null;
  if (dir === null) return null;
  const which: Which = ch === lower ? 'little' : 'big';
  return { which, dir };
}

/** Mirror of the port's applyMoveInstant (main.ts): physics-only replay of one step. */
function applyMoveInstant(room: Room, which: Which, dir: number): 'moved' | 'turned' | 'blocked' {
  if ((dir === Dir.left && room.facingRight[which]) || (dir === Dir.right && !room.facingRight[which])) {
    room.facingRight[which] = dir === Dir.right;
    return 'turned';
  }
  if (!room.beginMoveFish(which, dir)) return 'blocked';
  room.commitMove();
  room.clearAllDirs();
  room.fallToRest();
  const edge = room.checkEdges();
  if (edge && !room.won) {
    room.exitFish(edge.which);
    if (edge.dir === Dir.left) room.facingRight[edge.which] = false;
    else if (edge.dir === Dir.right) room.facingRight[edge.which] = true;
  }
  return 'moved';
}

function ffrPath(num: number): string {
  return join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);
}

function replay(slug: string, moves: string): string {
  const jmeno = SLUG_TO_JMENO[slug];
  if (!jmeno) return `SKIP  ${slug} (no room mapping)`;
  const desc = roomByName(jmeno);
  if (!desc) return `SKIP  ${slug} (${jmeno} not in table)`;
  const path = ffrPath(desc.num);
  if (!existsSync(path)) return `SKIP  ${slug} -> ${jmeno} #${desc.num} (no FFR at ${path})`;

  const room = new Room(parseFfr(new Uint8Array(readFileSync(path))));
  room.clearAllDirs();
  room.fallToRest();
  room.clearAllDirs();

  // Optionally attach the ported room script (autonomous objects, mechanisms).
  const noop = () => 0;
  let script: Script | null = null;
  const def = roomScript(jmeno);
  if (RUN_SCRIPT && def) {
    script = new Script(room, noop, () => false, { snd: noop, sndcyc: noop, ksnd: noop, music: noop, talkNow: noop });
    def.init(script);
  }
  const tickScript = (): void => {
    if (!script || !def || room.won) return;
    room.idle.little++;
    room.idle.big++;
    def.prog(script);
  };

  let blocked = 0;
  let stepAtWin = -1;
  const steps = [...moves].map(decode).filter((m): m is { which: Which; dir: number } => m !== null);
  for (let i = 0; i < steps.length; i++) {
    if (room.anyFishDead) return `DEAD  ${slug} -> ${jmeno} #${desc.num}: fish crushed at step ${i}/${steps.length}`;
    if (room.won) {
      stepAtWin = i;
      break;
    }
    room.aktivni = steps[i]!.which;
    const r = applyMoveInstant(room, steps[i]!.which, steps[i]!.dir);
    if (r === 'blocked') blocked++;
    tickScript();
    room.fallToRest();
  }
  if (room.won) stepAtWin = stepAtWin < 0 ? steps.length : stepAtWin;

  const status = room.won ? 'WIN ' : room.anyFishDead ? 'DEAD' : 'NOWIN';
  return `${status} ${slug} -> ${jmeno} #${desc.num}: steps=${steps.length} blocked=${blocked} won=${room.won} dead=${room.anyFishDead}${stepAtWin >= 0 ? ` (won@${stepAtWin})` : ''}`;
}

function main(): void {
  if (!existsSync(GRAPHIC)) {
    console.error(`No FFR data at ${GRAPHIC} (set $FFNG_DATA).`);
    process.exit(2);
  }
  const files = readdirSync(MOVES_DIR).filter((f) => f.endsWith('.moves'));
  if (files.length === 0) {
    console.error(`No .moves files in ${MOVES_DIR}`);
    process.exit(2);
  }
  let wins = 0;
  const lines: string[] = [];
  for (const f of files.sort()) {
    const slug = f.replace(/\.moves$/, '');
    const moves = readFileSync(join(MOVES_DIR, f), 'utf8').trim();
    const line = replay(slug, moves);
    if (line.startsWith('WIN')) wins++;
    lines.push(line);
  }
  console.log(lines.join('\n'));
  console.log(`\n${wins}/${files.length} rooms solved by replay.`);
}

main();
