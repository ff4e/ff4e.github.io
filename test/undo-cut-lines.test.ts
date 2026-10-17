/**
 * Rooms whose own conversation an undo used to cut: BARELY, BOTTLES, JEDNICKY, BLUDISTE,
 * ZELVA and REAKTOR. Undo rebuilds the room, re-runs `init`, drops the dialogue queue and
 * restores the target point's script Vars, so a point banked mid-sequence lost the rest of
 * it: the line in progress cut short, the NPC's line and the `set` behind it never
 * delivered. Nothing was left stuck; the conversation just stopped. Each case lets the
 * room's own code queue the sequence (Vars only arm its trigger; a test-queued callback
 * would bypass the fix), banks a point inside it, makes one more move, undoes onto the
 * point and asserts the conversation plays on and a line in progress is not started over.
 * Where a sequence is the fish's doing, a case checks that undoing the move that set it
 * off takes it back. Real room data, real scripts, real undo path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { undoMove } from '../src/app/undo.js';
import { roomHarness, strand, undoOnto } from './undoRoomHarness.js';
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

/**
 * Tick (calling `arm` each tick, to put the room into its trigger condition) until `mid`
 * holds, bank a point with one solution move while it still does, make one more move and
 * undo onto that point. Unlike `strand`, the landing is not required to be mid-sequence:
 * a carried sequence may have finished during the second move, and that is the fix.
 */
function bankInside(h: Harness, mid: () => boolean, arm: () => void = () => {}): void {
  for (let i = 0; i < 20; i++) {
    h.until(() => (arm(), mid()), 20000);
    h.play();
    if (!mid()) continue;
    h.play();
    expect(undoMove()).toBe(true);
    h.back();
    return;
  }
  throw new Error('never banked a point mid-sequence');
}

/** Has a sound whose name starts with `name` been started since `from` (a `started` index)? */
const saidSince = (h: Harness, from: number, name: string): boolean =>
  h.mix.started.slice(from).some((e) => e.name.startsWith(name));

/** The fish's line sounding now, if any. */
const fishLine = (h: Harness): string | null => h.mix.on(1) ?? h.mix.on(2);

/** Assert `line` (sounding at the landing) is not started again from `from` on. */
function notRestarted(h: Harness, line: string | null, from: number): void {
  if (line) expect(h.mix.started.slice(from).some((e) => e.name === line)).toBe(false);
}

describe('BARELY', () => {
  // room (item 0): uvod 1, hl1..hl4 4..7, onoze 8, opldech 9, okukajde 10, okrabovi 11, okachne 12
  // pldik (14): cinnost 1 (201/202 while its line plays)
  const room = (h: Harness) => h.s().vars(0);
  const pldik = (h: Harness) => h.s().vars(14)[1];
  const KACHNICKA = 4;
  const KUKAJDA = 7;

  it('lets an intro banked before the slime sucks finish, slime and all', () => {
    const h = roomHarness('BARELY', () => 25);
    let from = 0;
    const arm = () => {
      if (h.s().noDialog()) {
        room(h)[1] = 0; // say the intro (again)
        from = h.mix.started.length;
      }
    };
    bankInside(h, () => room(h)[1] === 1 && h.s().isDialog() && !saidSince(h, from, 'bar-x-suckne'), arm);
    const line = fishLine(h);
    const landed = h.mix.started.length;
    h.until(() => pldik(h) === 201, 1000);
    h.until(() => pldik(h) === 202, 1000);
    h.until(() => pldik(h) !== 202, 1000);
    expect(pldik(h)).toBe(0); // the slime's line over, the slime idle again
    h.until(() => h.s().noDialog(), 1000);
    expect(saidSince(h, landed, 'bar-m-panb')).toBe(true); // the intro's last line
    notRestarted(h, line, landed);
  });

  it('takes back the remark on a fish the undone move pushed', () => {
    const h = roomHarness('BARELY', () => 25);
    h.until(() => h.s().noDialog() && room(h)[1] === 1, 5000);
    for (const k of [4, 5, 6, 7]) room(h)[k] = -1;
    for (const k of [8, 9, 11]) room(h)[k] = 1;
    room(h)[10] = 0;
    room(h)[12] = 0;
    h.play(); // banked with the room armed
    const said = () => room(h)[10] === 1 || room(h)[12] === 1;
    const at = () => [KUKAJDA, KACHNICKA].map((i) => `${h.s().item(i).x},${h.s().item(i).y}`).join();
    for (let i = 0; i < 1000 && !said(); i++) {
      h.until(() => h.s().noDialog(), 2000);
      const before = at();
      h.play();
      if (!said() && at() !== before) h.undo(); // a push the remark's dice passed over: push again
    }
    const slot = room(h)[10] === 1 ? 10 : 12; // the move set off a remark on the fish or the duck it pushed
    expect(room(h)[slot]).toBe(1);
    h.undo();
    expect(room(h)[slot]).toBe(0);
    const from = h.mix.started.length;
    h.ticks(200);
    expect(saidSince(h, from, slot === 10 ? 'bar-m-rybka' : 'bar-m-kachna')).toBe(false);
  });
});

describe('BOTTLES', () => {
  // room (item 0): uvod 1, olebce 2, odrackovi 3, osklebakovi 4, osklebu 5, opadu 6
  // sklebak (10): cinnost 1 (10 = start the laugh, 11 laughing)
  const room = (h: Harness) => h.s().vars(0);
  const sklebak = (h: Harness) => h.s().vars(10)[1];
  const quiet = (h: Harness) => {
    room(h)[1] = 0;
    for (const k of [2, 3, 6]) room(h)[k] = 1;
    room(h)[5] = 2;
  };

  it('lets the totem grin after a point banked mid-remark', () => {
    const h = roomHarness('BOTTLES', () => 25);
    h.play();
    const arm = () => {
      quiet(h);
      if (room(h)[4]! > 1 || (room(h)[4] === -1 && h.s().noDialog())) room(h)[4] = 1;
    };
    bankInside(h, () => room(h)[4] === -1 && h.s().isDialog(), arm);
    const line = fishLine(h);
    const landed = h.mix.started.length;
    h.until(() => h.s().noDialog(), 500); // the remark's last entry is the grin's `set`
    h.tick();
    expect(sklebak(h)).toBe(11);
    expect(h.mix.on(110)).toBe('bot-x-smich');
    notRestarted(h, line, landed);
  });

  it('takes back the intro the undone climb set off', () => {
    const h = roomHarness('BOTTLES', () => 25);
    for (let i = 0; i < 20; i++) h.play();
    h.until(() => h.s().noDialog(), 5000);
    quiet(h);
    room(h)[1] = 2; // the intro waits for the little fish to climb
    room(h)[4] = 10000;
    h.play(); // banked with the room armed
    expect(h.s().item(1).y).toBeGreaterThan(9);
    expect(room(h)[1]).toBe(2);
    h.play();
    h.tick(); // the room sees the climb
    expect(h.s().item(1).y).toBeLessThanOrEqual(9);
    expect(room(h)[1]).toBe(0);
    h.undo();
    expect(room(h)[1]).toBe(2);
    const from = h.mix.started.length;
    h.ticks(200);
    expect(saidSince(h, from, 'bot-m-vidis')).toBe(false);
  });
});

describe('JEDNICKY', () => {
  // room (item 0): uvod 1, fofr 2, flakat 3, jestejednu 4, otyci 5, kleopatra 6, opoteru 7
  // malar (1): fofr 1; zeva (3): cinnost 1
  const room = (h: Harness) => h.s().vars(0);
  const quiet = (h: Harness) => {
    room(h)[1] = 1;
    room(h)[3] = 1;
    for (const k of [5, 6, 7]) room(h)[k] = -1;
  };
  /** Up to the little fish facing the clam, up close. */
  const atClam = () => {
    const h = roomHarness('JEDNICKY', () => 25);
    for (let i = 0; i < 82; i++) h.play();
    expect(h.s().dist(1, 3)).toBeLessThan(3);
    expect(h.s().lookAt(1, 3)).toBe(true);
    return h;
  };
  let from = 0;
  const plead = (h: Harness) => () => {
    quiet(h);
    if (h.s().noDialog()) {
      room(h)[4] = room(h)[4]! >= 0 ? 0 : -1;
      from = h.mix.started.length;
    }
  };

  it('lets the clam answer a plea banked before its answer', () => {
    const h = atClam();
    const mid = () => h.s().isDialog() && saidSince(h, from, 'jed-m-perlorodka') && !saidSince(h, from, 'jed-x-nedam');
    bankInside(h, mid, plead(h));
    const line = fishLine(h);
    const landed = h.mix.started.length;
    h.until(() => saidSince(h, landed, 'jed-x-nedam'), 300);
    expect(saidSince(h, landed, 'jed-m-perlorodka')).toBe(false); // the answer to THAT plea, not a new one
    notRestarted(h, line, landed);
  });

  it('lets the clam finish an answer banked mid-way', () => {
    const h = atClam();
    bankInside(h, () => h.mix.on(101) === 'jed-x-nedam', plead(h));
    expect(h.mix.on(101)).toBe('jed-x-nedam');
    const landed = h.mix.started.length;
    h.until(() => !h.mix.playing(101), 100);
    expect(saidSince(h, landed, 'jed-x-nedam')).toBe(false);
    expect(h.s().vars(3)[1]).toBe(0);
  });

  it('takes back the nag the undone move set off', () => {
    const h = roomHarness('JEDNICKY', () => 25);
    h.until(() => h.s().noDialog() && room(h)[1] === 1, 5000);
    for (const k of [5, 6, 7]) room(h)[k] = -1;
    room(h)[4] = 10000;
    h.play(); // banked with the room armed
    for (let i = 0; i < 100 && room(h)[3] === 0; i++) {
      h.until(() => h.s().noDialog(), 2000);
      room(h)[2] = h.s().vars(1)[1]! + 1; // the little fish's next move tips its hustle count
      h.play();
    }
    expect(room(h)[3]).toBe(1);
    h.undo();
    expect(room(h)[3]).toBe(0);
    const from = h.mix.started.length;
    h.ticks(200);
    expect(saidSince(h, from, 'jed-m-flakas')).toBe(false);
  });
});

/**
 * Wait for `idle`, put the room into its trigger condition with `arm`, then undo onto a
 * point banked while `mid` holds; retried until the landing is mid-sequence.
 */
function strandOnce(h: Harness, idle: () => boolean, arm: () => void, mid: () => boolean, tries = 20): void {
  for (let i = 0; i < tries; i++) {
    h.until(idle, 5000);
    arm();
    if (undoOnto(h, mid)) return;
  }
  throw new Error('never banked a point mid-sequence');
}

/** The fish's lines sounding now, to check after an undo that neither is started over. */
const fishLines = (h: Harness): string[] => [h.mix.on(1), h.mix.on(2)].filter((n): n is string => n !== null);

const restarted = (h: Harness, from: number, lines: string[]): boolean =>
  h.mix.started.slice(from).some((e) => lines.includes(e.name));

describe('BLUDISTE', () => {
  // room (item 0): uvod 1, osundavani 2, otvaru 3, rikanka 4; muchoblud 1; snecek (2): zprava 1; malar 4
  const room = (h: Harness) => h.s().vars(0);
  const quiet = (h: Harness) => {
    room(h)[1] = 1;
    room(h)[2] = 2;
    room(h)[3] = 1;
  };

  it('lets the snail banked mid-rhyme answer to the end', () => {
    const h = roomHarness('BLUDISTE', () => 25);
    for (let i = 0; i < 74; i++) h.play(); // the little fish watches the snail
    let from = 0;
    strandOnce(
      h,
      () => h.s().noDialog() && h.s().lookAt(4, 2),
      () => {
        quiet(h);
        room(h)[4] = 0;
        from = h.mix.started.length;
      },
      () => room(h)[4] === -1 && saidSince(h, from, 'bl-m-snecku0') && !saidSince(h, from, 'bl-v-dost2'),
    );
    const lines = fishLines(h);
    const at = h.mix.started.length;
    h.until(() => saidSince(h, at, 'bl-v-dost2'), 3000); // the rhyme's last line
    expect(h.s().item(2).anim).not.toBe(''); // the snail answers it
    expect(restarted(h, at, lines)).toBe(false);
  });

  it('takes the remark on the plant back with the move that dragged it', () => {
    const h = roomHarness('BLUDISTE', () => 25);
    for (let i = 0; i < 62; i++) h.play();
    quiet(h);
    room(h)[2] = 0; // nothing said about the plant yet
    room(h)[4] = 100000; // no rhyme
    h.play(); // banked with those: the next move drags the plant
    for (let tries = 0; room(h)[2] !== 1; tries++) {
      expect(tries).toBeLessThan(60);
      if (tries > 0) {
        expect(undoMove()).toBe(true);
        h.back();
      }
      h.until(() => h.s().noDialog(), 5000);
      const plant = h.s().item(1).x;
      h.play();
      expect(h.s().item(1).x).not.toBe(plant);
    }
    const from = h.mix.started.length;
    expect(undoMove()).toBe(true);
    h.back();
    expect(room(h)[2]).toBe(0);
    h.ticks(300);
    for (const line of ['bl-m-koral', 'bl-v-koral', 'bl-m-visi', 'bl-v-nevim']) expect(saidSince(h, from, line)).toBe(false);
  });
});

describe('ZELVA', () => {
  // main (item 0): blbnout 1, hlouposti 3, cosedelo 6, uvod 7
  const main = (h: Harness) => h.s().vars(0);

  it('lets the fish banked mid-aftermath work out it is the turtle', () => {
    const h = roomHarness('ZELVA', () => 25);
    h.play();
    let from = 0;
    strandOnce(
      h,
      () => h.s().noDialog() && h.s().natvrdo === 0,
      () => {
        main(h)[1] = 100000; // no possession
        main(h)[3] = 100000; // no chatter
        main(h)[7] = 1;
        main(h)[6] = 5; // the little fish was seized and the turtle gave itself away
        from = h.mix.started.length;
      },
      () => main(h)[6] === 0 && !saidSince(h, from, 'zel-v-tazelva'),
    );
    const lines = fishLines(h);
    const at = h.mix.started.length;
    h.until(() => saidSince(h, at, 'zel-v-tazelva'), 3000);
    expect(saidSince(h, at, 'zel-m-tazelva')).toBe(true); // the little fish's line, cued by the set
    expect(restarted(h, at, lines)).toBe(false);
  });
});

describe('REAKTOR', () => {
  // wall (item 0): zacni 1, pldpred 2, tyce 3; tyc (1): padlo 2; pld (18): smutny 6
  const wall = (h: Harness) => h.s().vars(0);
  const smutny = (h: Harness) => h.s().vars(18)[6]!;

  it('lets the blob banked before its sad spell sulk and squelch', () => {
    const h = roomHarness('REAKTOR', () => 25);
    wall(h)[2] = 0; // the long talk first, the worry exchange queued behind it
    strand(h, () => wall(h)[2] === -1 && smutny(h) === 0 && !saidSince(h, 0, 'rea-x-pldik'));
    const lines = fishLines(h);
    const at = h.mix.started.length;
    h.until(() => smutny(h) > 0, 3000);
    h.until(() => saidSince(h, at, 'rea-x-pldik'), 100);
    expect(restarted(h, at, lines)).toBe(false);
  });

  it('takes the gulp back with the move that seated the last rod', () => {
    const h = roomHarness('REAKTOR', () => 25);
    for (let i = 0; i < 48; i++) h.play(); // the next move lands a rod
    h.until(() => h.s().noDialog() && wall(h)[1] === 1 && wall(h)[2] === -1, 20000);
    wall(h)[3] = h.s().vars(1)[2]! + 1; // that rod is the one that makes enough
    h.play();
    h.until(() => wall(h)[3] === 1000, 10);
    h.until(() => h.mix.on(1) === 'rea-m-doufam', 50);
    const from = h.mix.started.length;
    expect(undoMove()).toBe(true);
    h.back();
    expect(wall(h)[3]).not.toBe(1000);
    expect(h.mix.on(1)).toBeNull();
    h.ticks(300);
    expect(saidSince(h, from, 'rea-')).toBe(false);
  });
});
