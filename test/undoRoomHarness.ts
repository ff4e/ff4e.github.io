/**
 * A real room, its real script and the real undo path (`undoMove` -> `restore`), driven
 * headlessly. Mirrors the parts of `main.ts`'s `buildRoom` and `logicTick` that undo
 * depends on — including `audio.killVoices` on the restart-flavoured rebuild, with the
 * room's `carriedSounds` exempt — over a tick-clocked fake mixer.
 *
 * The importing test file must mock the browser-only modules `undo.ts` pulls in; see
 * `test/drakar1-undo.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { Script } from '../src/core/script.js';
import { StepEngine, type Which } from '../src/core/stepEngine.js';
import { ROOMS } from '../src/data/roomTable.js';
import { roomScript } from '../src/rooms/index.js';
import * as game from '../src/app/gameState.js';
import { initQuiet } from '../src/app/initQuiet.js';
import { initMovement } from '../src/app/movement.js';
import { ui } from '../src/app/screenState.js';
import { sampleUndoPoint, undoMove } from '../src/app/undo.js';
import { gameDataDir } from './gameData.js';

interface Voice {
  name: string;
  until: number; // tick the sound ends on; Infinity for a loop
}

/** Per-priority sounds, clocked in logic ticks. `killVoices` mirrors audio.ts. */
export class FakeMixer {
  now = 0;
  readonly sounding = new Map<number, Voice>();
  readonly started: { tick: number; name: string; prior: number }[] = [];
  constructor(private readonly ticksOf: (name: string) => number) {}

  start(name: string, prior: number, loop = false): number {
    const len = this.ticksOf(name);
    this.sounding.set(prior, { name, until: loop ? Infinity : this.now + len });
    this.started.push({ tick: this.now, name, prior });
    return len;
  }
  kill(prior: number): void {
    this.sounding.delete(prior);
  }
  killVoices(except: readonly number[] = []): void {
    for (const prior of [...this.sounding.keys()]) if (prior !== -999 && !except.includes(prior)) this.sounding.delete(prior);
  }
  playing(prior: number): boolean {
    const v = this.sounding.get(prior);
    return v !== undefined && this.now < v.until;
  }
  /** The name on `prior`, if it is still sounding. */
  on(prior: number): string | null {
    return this.playing(prior) ? this.sounding.get(prior)!.name : null;
  }
}

export function roomHarness(jmeno: string, ticksOf: (name: string) => number = () => 40) {
  const num = ROOMS.findIndex((r) => r.jmeno === jmeno) + 1;
  const ffr = parseFfr(new Uint8Array(readFileSync(join(gameDataDir(), 'Graphic', `${String(num).padStart(3, '0')}.ffr`))));
  const def = roomScript(jmeno)!;
  const mix = new FakeMixer(ticksOf);
  let count = 0;

  const buildRoom = (carryPole = false, carried: readonly number[] = []): void => {
    const savedPole = carryPole && game.activeScript ? [...game.activeScript.s.roompole] : null;
    if (carryPole) mix.killVoices(carried);
    const room = new Room(ffr);
    game.setRoom(room);
    game.setLoadmode(null);
    if (!carryPole) game.clearUndoHistory();
    count = 0;
    let initializing = true;
    const s = new Script(
      room,
      (name, prior) => mix.start(name, prior),
      (prior) => mix.playing(prior),
      initQuiet(carried, () => initializing, {
        snd: (name, prior) => void mix.start(name, prior),
        sndcyc: (name, prior) => void mix.start(name, prior, true),
        sndvol: (name, prior) => void mix.start(name, prior),
        ksnd: (prior) => mix.kill(prior),
        music: (name, prior) => void mix.start(name, prior),
        musiccyc: (name, prior) => void mix.start(name, prior, true),
      }),
      (prior) => mix.playing(prior),
    );
    if (savedPole) for (let i = 0; i < s.roompole.length; i++) s.roompole[i] = savedPole[i] ?? 0;
    const engine = new StepEngine(room, s, def, { random: (n) => Math.floor(Math.random() * n) });
    def.init(s);
    initializing = false;
    game.setEngine(engine);
    game.setActiveScript({ def, s });
    if (room.padani()) engine.phase = 'fall';
    else {
      room.clearAllDirs();
      engine.phase = 'idle';
    }
  };

  game.clearUndoHistory();
  game.setLoadmode(null);
  game.setShowmode(null);
  game.setReplaymode(null);
  game.setCutscene(null);
  ui.screen = 'room';
  initMovement({ buildRoom, endShowmode: () => {}, hracNespi: () => {}, setInfo: () => {} });
  buildRoom();

  const s = (): Script => game.activeScript!.s;
  const tick = (): void => {
    count++;
    mix.now++;
    game.engine!.runScript(count, 0);
    s().dialogy(count);
    game.engine!.advance();
    sampleUndoPoint();
  };
  const ticks = (n: number): void => {
    for (let i = 0; i < n; i++) tick();
  };
  const until = (pred: () => boolean, max = 20000): void => {
    for (let i = 0; i < max && !pred(); i++) tick();
    expect(pred()).toBe(true);
  };
  const DIRS: Record<string, Dir> = { u: Dir.up, d: Dir.down, l: Dir.left, r: Dir.right };
  /** One move of the room's recorded solution, settled. */
  let next = 0;
  const move = (): void => {
    const ch = def.solution![next++]!;
    const which: Which = ch === ch.toLowerCase() ? 'little' : 'big';
    for (let i = 0; i < 300 && game.engine!.phase !== 'idle'; i++) tick();
    expect(game.engine!.phase).toBe('idle');
    game.engine!.press(which, DIRS[ch.toLowerCase()]!);
    for (let i = 0; i < 300 && game.engine!.phase !== 'idle'; i++) tick();
    tick();
  };
  /** Undo the newest move; the solution then resumes from that move. */
  const undo = (): void => {
    expect(undoMove()).toBe(true);
    next--;
  };
  const back = (): void => void next--;
  return { mix, s, tick, ticks, until, move, undo, back };
}
