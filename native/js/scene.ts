/**
 * The parity scene `compare.mjs` renders on both sides: one room, its script, the step
 * engine and the AI-tier art, built from the SAME modules the browser game runs, so the
 * native host and the browser reference (`reference.ts`) render identical state and any
 * pixel difference between them belongs to the backends, not to the scene.
 *
 * This is NOT how the native game plays (that is `game.ts`, on the game's own flow
 * modules). It is a fixed, headless, deterministic state for a pixel comparison, and it
 * runs in the browser too, where the native bundle's seams do not exist — so it stays
 * below `src/app/` except for `gameState.ts` and `fishFrame.ts`, which the shared frame
 * (`frame.ts`) reads.
 */
import { Room } from '../../src/core/room.js';
import { Script } from '../../src/core/script.js';
import { StepEngine } from '../../src/core/stepEngine.js';
import { decodeMoves } from '../../src/core/solutionMoves.js';
import { roomScript } from '../../src/rooms/index.js';
import { ROOM_SOLUTIONS } from '../../src/rooms/solutions.js';
import { parseFfr } from '../../src/data/ffr.js';
import { ROOMS } from '../../src/data/roomTable.js';
import { loadAiRoom, type AiRoom, type AiRoomFrame } from '../../src/render/roomAi.js';
import { TL_PLAV, TL_NAHORU, HL_TLACI, HL_MRK } from '../../src/render/renderRoom.js';
import { setCount, setEngine, setRoom } from '../../src/app/gameState.js';
import { aiFrame } from './frame.js';

type Which = 'little' | 'big';

export interface Scene {
  readonly num: number;
  readonly jmeno: string;
  readonly room: Room;
  readonly script: Script;
  readonly engine: StepEngine;
  readonly ai: AiRoom;
  count: number;
}

/** Deterministic RNG, the same one test/solutionsHarness.ts uses, so replays never vary. */
function makeRng(): (n: number) => number {
  let state = 0x2545f491;
  return (n: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return n > 0 ? state % n : 0;
  };
}

/**
 * Pin `Math.random` (mulberry32). Room scripts draw from it directly (`Script.random`,
 * src/core/script.ts:258 — ZAVAL colours its balls with it at init), and V8 and QuickJS
 * have different generators, so without this the native and browser runs would start
 * from different rooms. The parity harness needs identical state; the game does not.
 */
export function pinRandom(seed: number): void {
  let s = seed >>> 0;
  Math.random = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadScene(num: number, readBytes: (url: string) => Promise<Uint8Array>): Promise<Scene> {
  const desc = ROOMS[num - 1];
  if (!desc) throw new Error(`no room #${num}`);
  const jmeno = desc.jmeno;
  const ffr = await readBytes(`/data/Graphic/${String(num).padStart(3, '0')}.ffr`);
  const room = new Room(parseFfr(ffr));
  const def = roomScript(jmeno) ?? null;
  // Headless talk: a nominal line length, no audio, no subtitles (as the harness does).
  const script = new Script(room, () => 12, () => false, {}, () => false);
  const engine = new StepEngine(room, script, def, { random: makeRng() });
  script.onWin = () => engine.triggerWin();
  def?.init(script);
  if (room.padani()) engine.phase = 'fall';
  else {
    room.clearAllDirs();
    engine.phase = 'idle';
  }
  const ai = await loadAiRoom('/', jmeno);
  if (!ai) throw new Error(`room #${num} ${jmeno} has no AI art`);
  return { num, jmeno, room, script, engine, ai, count: 0 };
}

/**
 * One logic tick, in the order the solution harness uses: Programky and motion first, then
 * (only on a tick that STARTED at rest) the recorded command. Returns whether it was taken.
 */
function tick(s: Scene, cmd: { which: Which; dir: number } | null): boolean {
  s.count++;
  const idleAtStart = s.engine.phase === 'idle';
  s.engine.runScript(s.count, 0);
  s.script.dialogy(s.count);
  s.engine.advance();
  if (!cmd || s.engine.won || s.room.anyFishDead) return false;
  if (s.engine.phase !== 'idle' || !idleAtStart) return false;
  s.engine.active = cmd.which;
  s.room.hracNespi();
  return s.engine.press(cmd.which, cmd.dir) !== 'busy';
}

/** The room's recorded solution as commands, or [] when it has none. */
function solutionSteps(s: Scene): { which: Which; dir: number }[] {
  const moves = ROOM_SOLUTIONS[s.jmeno];
  return moves ? decodeMoves(moves).map((st) => ({ which: st.which, dir: st.dir })) : [];
}

/** Replay the first `ticks` logic ticks of the room's recorded solution (deterministic). */
export function replaySolution(s: Scene, ticks: number): number {
  const steps = solutionSteps(s);
  let mi = 0;
  for (let t = 0; t < ticks; t++) {
    if (tick(s, mi < steps.length ? steps[mi]! : null)) mi++;
  }
  return mi;
}

/**
 * Hand the scene to `gameState.ts`, which is where the shared frame (`frame.ts`) and the
 * game's own `fishFrameFor` read the room, the engine and the tick from.
 *
 * The rest of what `fishFrameFor` reads stays at rest here, deliberately: `blink`,
 * `darkFlicker` and `poslMluv` are the game loop's and the audio's, and this scene is a
 * fixed state for a pixel comparison, not a game. (`game.ts` runs the real loop, where
 * the fish do blink.)
 */
export function frameFor(s: Scene, alpha: number): AiRoomFrame {
  setRoom(s.room);
  setEngine(s.engine);
  setCount(s.count);
  return aiFrame(alpha);
}

/** The fixed probe frame both sides render for the parity check (mirrors __ff.aiGlParity's pose). */
export function probeFrame(s: Scene, alpha: number): AiRoomFrame {
  return {
    count: s.count,
    alpha,
    slide: 0.5,
    fishAnim: {
      little: { bodyFrame: TL_PLAV[1]!, headFrame: HL_MRK },
      big: { bodyFrame: TL_NAHORU[1]!, headFrame: HL_TLACI },
    },
  };
}

/** Backing-store size of the AI composite (native room px × the tier's scale). */
export function compositeSize(s: Scene): { w: number; h: number } {
  return { w: s.ai.nativeWidth * s.ai.scale, h: s.ai.nativeHeight * s.ai.scale };
}
