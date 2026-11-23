/**
 * The native smoke gate: whole rooms played headless through the REAL flow — `roomLoad`,
 * `logicTick.step`, `movement`, `undo`, `persist` and the win's way out of the room, as
 * `game.ts` wires them — asserting each one ends won. Run by the `native-macos` CI job:
 *
 *   ff4e-native game.js --root public --headless --smoke all|1,2,19 [--smoke-player 13] --store F
 *     [--smoke-out DIR]
 *
 * Two kinds of run:
 *
 * - `--smoke N,…`: the room plays its own recorded solution through `solvemode`, the
 *   dev-only replay the browser's solution probe uses: every tick of the real loop, the
 *   moves through the real `tryStep`, the win through the real auto-return.
 * - `--smoke-player N,…`: the recorded solution is TYPED, key by key, through the same
 *   router the keyboard and the gamepad use (`game.ts` `keyDown`/`keyUp` -> `movement`'s
 *   held-key machine), with a save, undos, a load and an undo into the loaded history on
 *   the way — each landing checked against the record it must land on — and then finished.
 *
 * `--store` is required, and the store is wiped first: a smoke run must never touch the
 * player's real progress, and must not depend on it.
 *
 * The 72-room solvability net is `test/solutions.test.ts` (the step engine, in node). This
 * is the other half: the same moves through the native host's game loop, where the native
 * build can break and node cannot see it.
 */
import { decodeMoves } from '../../src/core/solutionMoves.js';
import { Dir } from '../../src/core/dir.js';
import { ROOMS } from '../../src/data/roomTable.js';
import { solutionFor } from '../../src/rooms/index.js';
import { blink, darkFlicker, engine, loadmode, setChatter, undoHistory } from '../../src/app/gameState.js';
import { step } from '../../src/app/logicTick.js';
import { heldKeyState } from '../../src/app/movement.js';
import { armSolve, setSolvemode, solveStatus } from '../../src/app/solveMode.js';
import { advance, draw, enterRoom, initGame, keyDown, keyUp, nextRoom, roomReady, saveExists, type LeaveReason } from './game.js';
import type { NativeAiScreen } from './nativeAiScreen.js';
import { pinRandom } from './scene.js';
import { LOGIC_MS } from './seams/stageGeometry.js';
import { soundTime } from './sound.js';

/** Ticks a room may take, solution and all: the longest recording is a few thousand moves. */
const MAX_TICKS = 200_000;

class SmokeFailure extends Error {}

/** `1,2,19`, or `all`: every room with a recorded solution (all but ZAVER and SCORE). */
const rooms = (spec: string | undefined): number[] =>
  spec === 'all'
    ? ROOMS.map((_, i) => i + 1).filter((n) => solutionFor(ROOMS[n - 1]!.jmeno).known === 'ok')
    : spec ? spec.split(',').filter(Boolean).map(Number) : [];
const name = (n: number): string => `#${String(n).padEnd(2)} ${(ROOMS[n - 1]?.jmeno ?? '?').padEnd(8)}`;

let left: { num: number; why: LeaveReason } | null = null;

/** Let the asset promises settle: `roomLoad` does not await the art, the frame waits for it. */
async function untilReady(num: number): Promise<void> {
  for (let i = 0; i < 10_000 && !roomReady(); i++) await new Promise((r) => setTimeout(r, 0));
  if (!roomReady()) throw new SmokeFailure(`${name(num)} never became playable`);
}

/**
 * Exercise the draw path on the real flow's state; the pixels are compare.mjs's business.
 * With `--smoke-out DIR` the composite is kept (`DIR/<room>-<what>.rgba`, as compare.mjs
 * writes them) for a look; otherwise it is submitted to no window and dropped.
 */
function drawOnce(target: NativeAiScreen, num: number, what: string): void {
  if (!draw(target, 0.5)) throw new SmokeFailure(`${name(num)} had nothing to draw in a ready room`);
  const args = __native.args();
  const dir = args.includes('--smoke-out') ? args[args.indexOf('--smoke-out') + 1] : undefined;
  if (dir) __native.saveComposite(`${dir}/${num}-${what}.rgba`);
  else __native.present();
}

function persisted(key: string): string | null {
  const raw = __native.storeLoad();
  return raw ? ((JSON.parse(raw) as Record<string, string>)[key] ?? null) : null;
}

/** The won room was left the way a win leaves, and the store on disk says it is solved. */
function checkWon(num: number): void {
  if (left?.num !== num || left.why !== 'won') throw new SmokeFailure(`${name(num)} was not left by a win (${left ? left.why : 'still in it'})`);
  const solved = JSON.parse(persisted('ff.solved') ?? '[]') as number[];
  if (!solved.includes(num)) throw new SmokeFailure(`${name(num)} won, but ff.solved on disk is [${solved.join(',')}]`);
}

async function solveRun(num: number, target: NativeAiScreen): Promise<number> {
  const jmeno = ROOMS[num - 1]?.jmeno ?? '';
  left = null;
  await enterRoom(num);
  await untilReady(num);
  const armed = armSolve(jmeno, 1);
  if ('error' in armed) throw new SmokeFailure(`${name(num)} ${armed.detail}`);
  setSolvemode(armed);
  let ticks = 0;
  for (; ticks < MAX_TICKS && !left; ticks++) {
    soundTime(LOGIC_MS); // the mixer's clock moves with game time: 80 ms a step
    step();
    if ((ticks === 1 || ticks === 240) && !left) drawOnce(target, num, `tick${ticks}`);
  }
  const st = solveStatus();
  if (st.abort) throw new SmokeFailure(`${name(num)} ${st.abort.detail}`);
  if (!st.won) throw new SmokeFailure(`${name(num)} not won after ${ticks} ticks (move ${st.idx}/${st.total})`);
  checkWon(num);
  return ticks;
}

const KEY_OF: Record<'little' | 'big', Record<number, string>> = {
  little: { [Dir.up]: 'KeyI', [Dir.down]: 'KeyK', [Dir.left]: 'KeyJ', [Dir.right]: 'KeyL' },
  big: { [Dir.up]: 'KeyW', [Dir.down]: 'KeyS', [Dir.left]: 'KeyA', [Dir.right]: 'KeyD' },
};

async function playerRun(num: number, target: NativeAiScreen): Promise<number> {
  const jmeno = ROOMS[num - 1]?.jmeno ?? '';
  const sol = solutionFor(jmeno);
  if (sol.known !== 'ok') throw new SmokeFailure(`${name(num)} has no recorded solution`);
  const moves = decodeMoves(sol.moves);
  left = null;
  await enterRoom(num);
  await untilReady(num);
  let ticks = 0;
  const tick = (): void => {
    if (ticks++ >= MAX_TICKS) throw new SmokeFailure(`${name(num)} ran out of ticks`);
    advance(80); // one 80 ms frame: exactly one step, as the interactive loop takes it
  };
  const until = (what: string, pred: () => boolean, max = 5000): void => {
    for (let i = 0; i < max && !pred(); i++) tick();
    if (!pred()) throw new SmokeFailure(`${name(num)} waited ${max} ticks for ${what}`);
  };
  /** srecord after each banked point; [0] is the start. */
  const recs: string[] = [];
  until('the start to be banked', () => undoHistory.length === 1);
  recs.push(engine!.srecord);
  /** Type move `i` (a tap: down, up) and wait until it is banked as the next undo point. */
  const play = (i: number): void => {
    const m = moves[i]!;
    const code = KEY_OF[m.which][m.dir]!;
    const banked = undoHistory.length;
    const from = engine!.srecord;
    for (let t = 0; t < 3000 && undoHistory.length === banked && !left; t++) {
      // A tap is dropped while the fish is busy talking (`dispatchHeldMove`); type it again.
      if (heldKeyState() === 0 && engine!.phase === 'idle' && engine!.srecord === from) {
        keyDown(code);
        keyUp(code);
      }
      tick();
    }
    if (left) return; // the last move won the room
    if (undoHistory.length !== banked + 1) throw new SmokeFailure(`${name(num)} move ${i + 1} was not banked as one undo point`);
    recs[i + 1] = engine!.srecord;
  };
  const landedOn = (what: string, i: number): void => {
    if (engine!.srecord !== recs[i]) throw new SmokeFailure(`${name(num)} ${what} landed on a record of ${engine!.srecord.length}, not move ${i}'s ${recs[i]!.length}`);
  };
  const press = (code: string): void => {
    keyDown(code);
    keyUp(code);
  };
  const half = Math.min(20, Math.floor(moves.length / 2));
  for (let i = 0; i < half; i++) play(i);
  press('F2');
  if (!saveExists() || persisted(`ff.save.${num}`) === null) throw new SmokeFailure(`${name(num)} F2 wrote no save to disk`);
  for (let i = half; i < half + 3; i++) play(i);
  press('Minus');
  landedOn('the first undo', half + 2);
  press('Minus');
  landedOn('the second undo', half + 1);
  drawOnce(target, num, 'player');
  press('F3');
  until('the load to finish', () => loadmode === null && engine!.phase === 'idle');
  landedOn('the load', half);
  press('Minus');
  landedOn('an undo into the loaded history', half - 1);
  for (let i = half - 1; i < moves.length && !left; i++) play(i);
  until('the win to leave the room', () => left !== null, 2000);
  checkWon(num);
  return ticks;
}

/** Returns the process exit code: 0 only if every room was won. */
export async function runSmoke(spec: string | undefined, target: NativeAiScreen): Promise<number> {
  if (!__native.args().includes('--store')) {
    console.error('--smoke needs --store <file>: it wipes the store, so it must never be the player\'s');
    return 2;
  }
  localStorage.clear();
  const store = initGame({ verbose: false, demo: false, onLeave: (num, why) => { left = { num, why }; } });
  const args = __native.args();
  const solves = rooms(spec);
  const players = args.includes('--smoke-player') ? rooms(args[args.indexOf('--smoke-player') + 1]) : [];
  let failed = 0;
  const t0 = __native.now();
  /**
   * Each run starts from the state a run of that room alone would, so `--smoke N` reproduces
   * what `--smoke all` reported for N. Math.random is reseeded per room (the rooms draw from
   * it); and what a room change carries over in the browser — the chatter timer's history,
   * the fish's blink state, whether this room was solved before — is put back to rest.
   */
  const isolate = (num: number, kind: string): void => {
    pinRandom(kind === 'solve' ? num : 1000 + num);
    setChatter(null);
    if (store.solved.delete(num)) store.saveSolved(); // and on disk, so the win must write it again
    for (const w of ['little', 'big'] as const) {
      blink[w] = 0;
      darkFlicker[w] = false;
    }
  };
  const run = async (num: number, kind: string, fn: (n: number, t: NativeAiScreen) => Promise<number>): Promise<void> => {
    const t = __native.now();
    isolate(num, kind);
    try {
      const ticks = await fn(num, target);
      console.log(`${name(num)} ${kind.padEnd(6)} won in ${String(ticks).padStart(5)} ticks, ${((__native.now() - t) / 1000).toFixed(1)} s; the game would go on to room ${nextRoom(num, store.solved, store.cheated) ?? '-'}`);
    } catch (e) {
      failed++;
      console.log(`${name(num)} ${kind.padEnd(6)} FAILED: ${e instanceof SmokeFailure ? e.message : e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)}`);
    }
  };
  for (const n of solves) await run(n, 'solve', solveRun);
  for (const n of players) await run(n, 'player', playerRun);
  const total = solves.length + players.length;
  console.log(`smoke: ${total - failed}/${total} runs won (${solves.length} rooms solved, ${players.length} typed) in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return failed || total === 0 ? 1 : 0;
}
