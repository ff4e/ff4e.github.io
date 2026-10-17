/**
 * Rooms whose own conversation carries through undo: ZDVIZ1, ZDVIZ2, DEUTSCHE, POHON.
 * Undo rebuilds the room and restores the target point's Vars, and it used to drop the
 * dialogue queue with them, so a point banked mid-line kept a talker's flag without the
 * callback that ends it: the old man, the elk or the parrot mouthed until its next line,
 * and the prisoners kept their quarrel faces until the next quarrel. Each case lets the
 * room's own code queue the sequence, banks a point inside it, makes one more move,
 * undoes onto the point and asserts the line ends on time and is not restarted. Where a
 * sequence is the fish's doing, a case checks that undoing the move that set it off
 * takes it back. Real room data, real scripts, real undo path.
 *
 * ZDVIZ1's and ZDVIZ2's recordings hold many moves the engine refuses, which `play` cannot
 * bank, so the points are banked by turning a fish on the spot: a recorded move that
 * changes nothing else in the room.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as game from '../src/app/gameState.js';
import { undoMove } from '../src/app/undo.js';
import { Dir } from '../src/core/dir.js';
import { ZDVIZ2 } from '../src/rooms/zdviz2.js';
import { roomHarness } from './undoRoomHarness.js';
import { restoreRandom, seedRandom } from './rng.js';

vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/framePacing.js', () => ({ roomLoading: false }));
vi.mock('../src/app/phoneViewport.js', () => ({ continuePhoneRoom: vi.fn() }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => false }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => false }));
vi.mock('../src/platform/haptics.js', () => ({ hapticBlocked: vi.fn() }));

beforeEach((ctx) => seedRandom(ctx.task.name));
afterEach(() => restoreRandom());

type Harness = ReturnType<typeof roomHarness>;
type Which = 'little' | 'big';

/** One move of the recorded solution, or none if the recording's move is refused here. */
const playOn = (h: Harness): void => {
  try {
    h.play();
  } catch {
    // a refused move banks no point; the recording moves on
  }
};

/**
 * Turn a fish on the spot (`which`, or whichever is not busy talking) until that is banked
 * as an undo point: a recorded move that moves nothing.
 */
function turn(h: Harness, which?: Which): void {
  for (let i = 0; i < 10 && game.undoHistory.length === 0; i++) h.tick();
  const banked = game.undoHistory.length;
  const from = game.engine!.srecord;
  for (let i = 0; i < 3000 && game.undoHistory.length === banked; i++) {
    const room = game.room!;
    const fish: Which = which ?? (room.busy.little > 0 ? 'big' : 'little');
    if (game.engine!.phase === 'idle' && game.engine!.srecord === from && room.busy[fish] === 0) {
      game.engine!.active = fish;
      room.hracNespi();
      game.engine!.press(fish, room.facingRight[fish] ? Dir.left : Dir.right);
    }
    h.tick();
  }
  expect(game.undoHistory.length).toBe(banked + 1);
}

/**
 * Tick (calling `arm` each tick) until `mid` holds, bank a point with a turn while it still
 * does, turn once more and undo onto that point, retried until the point it lands on is
 * mid-sequence.
 */
function strandTurning(h: Harness, mid: () => boolean, arm: () => void = () => {}, which?: Which): void {
  for (let i = 0; i < 20; i++) {
    h.until(() => (arm(), mid()), 20000);
    turn(h, which);
    if (!mid()) continue;
    turn(h, which);
    expect(undoMove()).toBe(true);
    if (mid()) return;
  }
  throw new Error('never banked a point mid-sequence');
}

/** The voice playing on `prior` now, and a check that it is not started again afterwards. */
function notRestarted(h: Harness, prior: number): () => void {
  const line = h.mix.on(prior);
  const from = h.mix.started.length;
  return () => expect(h.mix.started.slice(from).some((e) => e.name === line)).toBe(false);
}

describe('ZDVIZ1', () => {
  // room (0): lastura 2, lebzna 3, jizdam 4, jizdav 5; dedek (5): mluvi 1; malar (6): jede 1
  const room = (h: Harness) => h.s().vars(0);
  const mluvi = (h: Harness) => h.s().vars(5)[1];
  const onlyHuhu = (h: Harness) => {
    room(h)[2] = 1;
    room(h)[3] = 1;
    room(h)[4] = -1;
    room(h)[5] = -1;
  };

  it('lets the old man banked mid-grumble finish, and grumble again', () => {
    const h = roomHarness('ZDVIZ1', () => 25);
    h.play();
    strandTurning(h, () => mluvi(h) === 101, () => onlyHuhu(h));
    const check = notRestarted(h, 101);
    h.until(() => mluvi(h) === 0, 40);
    check();
    h.until(() => mluvi(h) === 101, 20000);
  });

  it('takes back the ride remark the undone move set off', () => {
    const h = roomHarness('ZDVIZ1', () => 25);
    h.play();
    h.until(() => h.s().noDialog() && mluvi(h) === 0, 5000);
    const jizdam = room(h)[4];
    expect(jizdam).toBeGreaterThan(0);
    room(h)[2] = 1;
    room(h)[3] = 1;
    room(h)[4] = h.s().vars(6)[1]!; // as if the ride had just reached its count
    h.until(() => h.mix.on(1) === 'zd1-m-cesta', 100);
    turn(h, 'big');
    expect(undoMove()).toBe(true);
    expect(room(h)[4]).toBe(jizdam);
    expect(h.mix.playing(1)).toBe(false);
    expect(h.s().noDialog()).toBe(true);
  });
});

describe('ZDVIZ2', () => {
  // room (0): odedkovi 2; dedek (6): mluvi 1; malar 7, velkar 8
  const mluvi = (h: Harness) => h.s().vars(6)[1];

  it('lets the old man banked mid-shout finish, and shout again', () => {
    const h = roomHarness('ZDVIZ2', () => 25);
    for (let i = 0; i < 79; i++) playOn(h); // the big fish right by the old man
    expect(h.s().dist(8, 6)).toBeLessThanOrEqual(1);
    strandTurning(h, () => mluvi(h) !== 0, () => {}, 'little');
    const prior = mluvi(h)!;
    const check = notRestarted(h, prior);
    h.until(() => mluvi(h) === 0, 30);
    check();
    h.until(() => mluvi(h) !== 0, 20000);
  });

  it('takes back the remark on the old man the undone move set off', () => {
    const h = roomHarness('ZDVIZ2', () => 25);
    for (let i = 0; i < 175; i++) playOn(h);
    h.until(() => h.s().noDialog(), 5000);
    expect(h.s().vars(0)[2]).toBe(0);
    h.play(); // the painters take up their places by the old man
    h.until(() => h.s().vars(0)[2] === 1, 100);
    h.undo();
    expect(h.s().vars(0)[2]).toBe(0);
    expect(h.mix.playing(1)).toBe(false);
    expect(h.mix.playing(2)).toBe(false);
    expect(mluvi(h)).toBe(0);
  });

  it('takes back a shout the undone push set off, and carries the fish', () => {
    // The recorded solution never pushes him, so the live script is set up by hand: he has
    // been shifted a cell, shouts (a push rolls that, 2% a tick), and a fish line waits.
    const live = roomHarness('ZDVIZ2', () => 25).s();
    live.addd(0, 'zd2-x-krik1', 102, (val, cur) => (cur.vars(6)[1] = val));
    live.addm(0, 'zd2-m-nevid0');
    live.dialogy(live.count);
    expect(live.vars(6)[1]).toBe(102);
    live.item(6).x += 1;
    const h = roomHarness('ZDVIZ2', () => 25);
    ZDVIZ2.restorePresentation!(h.s(), live);
    expect(mluvi(h)).toBe(0);
    h.tick();
    expect(h.mix.on(1)).toBe('zd2-m-nevid0'); // the fish's line, next in the carried queue
    expect(h.mix.playing(102)).toBe(false);
    expect(mluvi(h)).toBe(0);
  });
});

describe('DEUTSCHE', () => {
  // room (0): uvod 1, olosech 2, dalsihlaska 4; papouch (1): cinnost 1; loos (3): cinnost 1
  const room = (h: Harness) => h.s().vars(0);
  const pap = (h: Harness) => h.s().vars(1)[1];
  const loos = (h: Harness) => h.s().vars(3)[1];
  const chatter = (h: Harness) => {
    room(h)[1] = 1;
    room(h)[2] = 1;
    if (h.s().noDialog() && room(h)[4]! > 1) room(h)[4] = 1;
  };

  it('lets the elk banked mid-line finish, and speak again', () => {
    const h = roomHarness('DEUTSCHE', () => 25);
    h.play();
    strandTurning(h, () => loos(h) === 101, () => chatter(h));
    const check = notRestarted(h, 101);
    h.until(() => loos(h) !== 101, 40);
    check();
    h.until(() => loos(h) === 101, 20000);
  });

  it('lets the parrot banked mid-order finish, and bark again', () => {
    const h = roomHarness('DEUTSCHE', () => 25);
    h.play();
    strandTurning(h, () => pap(h) === 111, () => chatter(h));
    const check = notRestarted(h, 111);
    h.until(() => pap(h) === 0, 40);
    check();
    h.until(() => (chatter(h), pap(h) === 111), 20000);
  });
});

describe('POHON', () => {
  // room (0): uvod 1, oprojektu 2, oforme 3, ohadce 4, obadva 5, kteraprosba 6; smutny (10): hybese 1
  const room = (h: Harness) => h.s().vars(0);
  const obadva = (h: Harness) => room(h)[5];
  const quarrel = (h: Harness) => {
    room(h)[1] = 1;
    room(h)[2] = -1;
    room(h)[3] = -1;
    if (h.s().noDialog() && room(h)[4]! > 1) room(h)[4] = 1;
  };

  it('ends the prisoners\' quarrel banked mid-way, and they quarrel again', () => {
    const h = roomHarness('POHON', () => 25);
    h.play();
    strandTurning(h, () => obadva(h) === 1, () => quarrel(h));
    const checks = [notRestarted(h, 1), notRestarted(h, 2)];
    h.until(() => obadva(h) === 0, 500);
    for (const check of checks) check();
    h.until(() => (quarrel(h), obadva(h) === 1), 20000);
  });

  it('takes back the greeting the undone move set off', () => {
    const h = roomHarness('POHON', () => 25);
    h.play();
    h.until(() => h.s().noDialog(), 5000);
    room(h)[2] = -1;
    room(h)[3] = -1;
    room(h)[4] = 10000;
    turn(h, 'little');
    expect(room(h)[6]).toBe(0);
    h.s().vars(10)[1] = 1; // as if the little fish had just shifted the sad prisoner
    h.until(() => h.mix.on(1)?.startsWith('poh-m-dobryden') ?? false, 100);
    turn(h, 'big');
    expect(undoMove()).toBe(true);
    expect(room(h)[6]).toBe(0);
    expect(h.s().vars(10)[1]).toBe(0);
    expect(h.mix.playing(1)).toBe(false);
    expect(h.s().noDialog()).toBe(true);
  });
});

describe('a load', () => {
  // [room, talker item, its talking value]
  const TALKERS: [string, number, number][] = [
    ['ZDVIZ1', 5, 101],
    ['ZDVIZ2', 6, 102],
    ['DEUTSCHE', 3, 101],
    ['DEUTSCHE', 1, 111],
  ];

  it.each(TALKERS)('leaves %s\'s talker %i quiet', (name, item, talking) => {
    const h = roomHarness(name, () => 25);
    h.s().vars(item)[1] = talking;
    game.activeScript!.def.restorePresentation!(h.s());
    expect(h.s().vars(item)[1]).toBe(0);
  });

  it('ends POHON\'s quarrel', () => {
    const h = roomHarness('POHON', () => 25);
    h.s().vars(0)[5] = 1;
    game.activeScript!.def.restorePresentation!(h.s());
    expect(h.s().vars(0)[5]).toBe(0);
  });
});
