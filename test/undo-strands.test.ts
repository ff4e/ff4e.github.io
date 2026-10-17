/**
 * Rooms an undo used to strand. Undo rebuilds the room, re-runs `init`, drops the dialogue
 * queue and restores the target point's script Vars, so a point banked while a sequence was
 * pending restored Vars that wait for a queued `set` which no longer exists: a talker left
 * mouthing for ever, a lock never released, a performance never started. Each case puts
 * the room into its trigger condition, lets the room's own code queue the sequence (a
 * test-queued callback would bypass the fix), banks a point inside it, makes one more move,
 * undoes onto the point, and asserts the room's machine moves on. Where a sequence is the
 * fish's doing, a case also checks that undoing the move that started it takes it back.
 * Found by `test/undo-stuck-scan.test.ts`. Real room data, real scripts, real undo path.
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

describe('DISKETA', () => {
  const VIR = [5, 12]; // vir1, vir2; vir_stav is Var 1, 110 while chittering
  const talking = (h: Harness) => VIR.some((i) => h.s().vars(i)[1] === 110);

  it('lets a virus banked mid-chitter finish, and chitter again', () => {
    const h = roomHarness('DISKETA', () => 25);
    h.play();
    for (const i of VIR) h.s().vars(i)[1] = 0; // awake, as a push leaves them
    strand(h, () => talking(h));
    h.until(() => !talking(h), 400);
    h.until(() => talking(h), 20000);
  });
});

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

describe('PARTY1', () => {
  const PASSENGERS: [number, number][] = [[5, 3], [6, 4], [7, 4], [8, 4]]; // item, cinnost slot
  const uvod2 = (h: Harness) => h.s().vars(0)[2];
  const locked = (h: Harness) => h.s().globpole[1] === 1 && h.s().globpole[2] === 1;

  it('lets the passengers come to the windows after a point banked mid-intro', () => {
    const h = roomHarness('PARTY1', () => 25);
    bankInside(h, () => uvod2(h) === 1 && locked(h));
    h.until(() => PASSENGERS.some(([i, slot]) => h.s().vars(i)[slot]! > 0), 3000);
  });
});

describe('MIKRO', () => {
  const CRABS = [12, 10, 9, 8];
  const DRZEJ = 1;
  const v = (h: Harness) => h.s().vars(0); // okrikla=1, vsichni=7
  const hushed = (h: Harness) => CRABS.every((c) => h.s().vars(c)[DRZEJ] === 0);

  it('lets the crabs chatter again after a point banked mid-shush', () => {
    const h = roomHarness('MIKRO', () => 25);
    const arm = () => {
      if (v(h)[1] === 0 && v(h)[7] === 0 && !hushed(h)) v(h)[7] = 1; // all four at once
    };
    bankInside(h, () => hushed(h), arm);
    h.until(() => CRABS.some((c) => h.s().vars(c)[DRZEJ]! >= 1), 400);
    const before = h.mix.started.length;
    h.until(() => h.mix.started.slice(before).some((e) => e.prior >= 101 && e.prior <= 104), 3000);
  });
});

describe('WIN', () => {
  const NOTEPAD = 12;
  // navrhy=3, odire=5, onotepadu=6, ooknech=7, obonusu=8, obordelu=9, hlasky=11
  const v = (h: Harness) => h.s().vars(0);
  const napsano = (h: Harness) => h.s().vars(NOTEPAD)[1]!;

  it('finishes writing the notepad after a point banked mid-way', () => {
    const h = roomHarness('WIN', () => 25);
    const arm = () => {
      const r = v(h);
      for (const said of [5, 7, 8, 9]) r[said] = 1; // only the notepad is left to say
      r[3] = 9999;
      if (r[6] === 1 && napsano(h) === 4) {
        r[6] = 0; // written already: let the room start it again
        h.s().vars(NOTEPAD)[1] = 0;
      }
      if (r[6] === 0 && r[11]! > 1) r[11] = 1;
    };
    bankInside(h, () => v(h)[6] === 1 && napsano(h) < 4, arm);
    h.until(() => napsano(h) === 4, 1000);
  });
});

describe('SECRET', () => {
  const DRZKA = 2;
  const v = (h: Harness) => h.s().vars(0); // osose=8
  const cinnost = (h: Harness) => h.s().vars(DRZKA)[1];

  it('lets the stone mouth perform after a point banked before its set', () => {
    const h = roomHarness('SECRET', () => 25);
    const arm = () => {
      if (v(h)[8]! > 1) v(h)[8] = 1;
      if (v(h)[8] === -1 && cinnost(h) === 2 && h.s().item(DRZKA).anim === '') {
        v(h)[8] = 1; // performed already: let the room start it again
        h.s().vars(DRZKA)[1] = 0;
      }
    };
    bankInside(h, () => v(h)[8] === -1 && cinnost(h) === 0, arm);
    h.until(() => cinnost(h) === 2, 1000);
    h.until(() => h.s().item(DRZKA).anim === '', 1000);
    expect(h.s().item(DRZKA).afaze).toBe(9);
  });
});

describe('ODPADKY', () => {
  const VELKAR = 2;
  const v = (h: Harness) => h.s().vars(0); // oanim=4
  const xichtit = (h: Harness) => h.s().vars(VELKAR)[1];

  it('stops the big fish pulling faces after a point banked mid-faces', () => {
    const h = roomHarness('ODPADKY', () => 25);
    const arm = () => {
      if (v(h)[4] !== 1 && xichtit(h) === 0 && h.s().noDialog()) v(h)[4] = 1;
    };
    bankInside(h, () => xichtit(h) === 1, arm);
    h.until(() => xichtit(h) === 0, 400);
    h.tick();
    expect(h.s().xicht('big')).toBe(0);
  });
});

/** `strand`, re-arming the trigger (Vars only; the room queues the sequence) before each try. */
function strandArmed(h: Harness, arm: () => void, mid: () => boolean, tries = 20): void {
  for (let i = 0; i < tries; i++) {
    arm();
    if (undoOnto(h, mid, 2000)) return;
  }
  throw new Error('never banked a point mid-sequence');
}

describe('BATYSKAF', () => {
  // main = 0: aktivni Var 1, halo Var 4; zluty 9 / ztel 12 / modry 11; readout voice 49
  const halo = (h: Harness) => h.s().vars(0)[4];
  const aktivni = (h: Harness) => h.s().vars(0)[1];
  const lift = (h: Harness) => {
    h.s().vars(0)[1] = 12; // what ringPhone does as the phone leaves its cradle
    h.s().vars(0)[4] = 1;
  };

  it('lets a readout banked mid-way finish, and the phones ring again', () => {
    const h = roomHarness('BATYSKAF', () => 25);
    h.play();
    strandArmed(h, () => lift(h), () => halo(h) === 2);
    h.until(() => halo(h) === 0, 1000);
    h.until(() => aktivni(h) === 9 || aktivni(h) === 11, 20000);
  });

  it('drops the readout of a phone the undone move lifted', () => {
    const h = roomHarness('BATYSKAF', () => 25);
    h.play();
    expect(halo(h)).toBe(0);
    lift(h);
    h.until(() => halo(h) === 2, 10);
    h.play();
    h.undo();
    expect(halo(h)).toBe(0);
    for (let i = 0; i < 300; i++) {
      h.tick();
      expect(h.mix.playing(49)).toBe(false);
    }
    h.until(() => aktivni(h) === 9 || aktivni(h) === 11, 20000);
  });
});

describe('PUCLIK', () => {
  // prvni = 1: hotovo Var 1, faze Var 2
  const pr = (h: Harness) => h.s().vars(1);

  it('lets a picture banked between the remarks and the reveal still reveal', () => {
    const h = roomHarness('PUCLIK', () => 25);
    h.play();
    strandArmed(
      h,
      () => {
        pr(h)[1] = 1; // assembled: the room queues the remarks and the reveal
        pr(h)[2] = 0;
      },
      () => pr(h)[1] === 2 && pr(h)[2] === 0,
    );
    h.until(() => pr(h)[2] === 4, 2000);
  });

  it('drops the remarks and the reveal of a picture the undone move assembled', () => {
    const h = roomHarness('PUCLIK', () => 25);
    h.play();
    expect(pr(h)[1]).toBe(0);
    pr(h)[1] = 1;
    h.until(() => pr(h)[1] === 2, 2000);
    h.play();
    h.undo();
    for (let i = 0; i < 1000; i++) {
      h.tick();
      expect(pr(h)[1]).toBe(0);
      expect(pr(h)[2]).toBe(0);
    }
  });
});

describe('KAJUTA1', () => {
  // papouch = 2: stav Var 2 (101/102 mid-heckle); room = 0: mov Var 6
  const stav = (h: Harness) => h.s().vars(2)[2]!;
  const heckling = (h: Harness) => stav(h) >= 101;

  it('lets the parrot banked mid-heckle finish, and heckle again', () => {
    const h = roomHarness('KAJUTA1', () => 25);
    h.play();
    strand(h, () => heckling(h));
    h.until(() => stav(h) === 0, 400);
    h.until(() => heckling(h), 20000);
  });

  it('does not carry the death squawk of a fish the undo brings back', () => {
    const h = roomHarness('KAJUTA1', () => 25);
    h.play();
    h.until(() => h.s().noDialog() && stav(h) === 0, 5000);
    h.s().room.killFish('little');
    h.until(() => h.mix.on(101) === 'k1-pap-karamba', 100);
    expect(undoMove()).toBe(true);
    expect(h.s().room.anyFishDead).toBe(false);
    expect(h.mix.playing(101)).toBe(false);
    expect(stav(h)).toBe(0);
    expect(h.s().vars(0)[7]).toBe(0); // nekro: a second death squawks again
    h.s().room.killFish('big');
    h.until(() => h.mix.on(101) === 'k1-pap-karamba', 100);
  });

  it('lets the screen-shove reaction banked mid-way end the shove', () => {
    const h = roomHarness('KAJUTA1', () => 25);
    h.play();
    const reacting = () => h.s().vars(0)[6] === 1 && h.s().room.gspec !== 0;
    strandArmed(
      h,
      () => {
        h.until(() => h.s().noDialog(), 5000); // a shove met by a busy room only re-arms
        h.s().vars(0)[6] = 0;
        h.s().room.gspec = 4; // what the host does as the big fish shoves a wall
      },
      reacting,
    );
    h.until(() => h.s().room.gspec === 0, 1000);
    for (let i = 0; i < 2000; i++) {
      h.tick();
      expect(h.s().room.gspec).toBe(0);
    }
  });
});

describe('KAJUTA2', () => {
  // papouch = 2: stav Var 1 (101 mid-squawk)
  const talking = (h: Harness) => h.s().vars(2)[1] === 101;

  it('lets the parrot banked mid-squawk finish, and squawk again', () => {
    const h = roomHarness('KAJUTA2', () => 25);
    h.play();
    strand(h, () => talking(h));
    h.until(() => !talking(h), 400);
    h.until(() => talking(h), 20000);
  });
});

/**
 * `strand` for a sequence the room plays once: wait until the room is `idle`, `arm` its
 * trigger, and retry until the point undone onto is `mid` the sequence the room queued.
 */
function strandOnce(h: Harness, idle: () => boolean, arm: () => void, mid: () => boolean, tries = 20): void {
  for (let i = 0; i < tries; i++) {
    h.until(idle, 5000);
    arm();
    if (undoOnto(h, mid)) return;
  }
  throw new Error('never banked a point mid-sequence');
}

/** Has a sound whose name starts with `name` been started since `from` (a `started` index)? */
const saidSince = (h: Harness, from: number, name: string): boolean =>
  h.mix.started.slice(from).some((e) => e.name.startsWith(name));

describe('CHODBA', () => {
  // room (item 0): tma 2, oci 3, rpesvelka 6, nerusit 7, pesmluvi 9
  const room = (h: Harness) => h.s().vars(0);

  it('lets the robot dogs banked mid-line finish their banter', () => {
    const h = roomHarness('CHODBA', () => 25);
    while (h.s().item(5).y < 20) h.play(); // the big fish down by the dogs
    h.ticks(20);
    expect(h.s().item(5).y).toBeGreaterThanOrEqual(20);
    let from = 0;
    strandOnce(
      h,
      () => h.s().noDialog() && room(h)[7] === 0 && room(h)[9] === 0,
      () => {
        room(h)[6] = 0;
        room(h)[2] = 10000; // no remark in the dark first
        room(h)[3] = 0;
        from = h.mix.started.length;
      },
      () => room(h)[9] === 10,
    );
    h.until(() => room(h)[9] === 0 && room(h)[7] === 0 && h.s().noDialog(), 2000);
    expect(saidSince(h, from, 'ch-r-anavic')).toBe(true); // the banter's last line
  });
});

describe('PUZZLE', () => {
  // room (item 0): uvod 1, hlaska 2, oldwamp 3, oldwper 4, mluveni 5, nudise 6, nepas 7
  const room = (h: Harness) => h.s().vars(0);

  it('lets the computer banked mid-line finish, and the water settle', () => {
    const h = roomHarness('PUZZLE', () => 25);
    h.play();
    strandOnce(
      h,
      () => h.s().noDialog() && room(h)[5] === 0,
      () => {
        room(h)[1] = 1;
        room(h)[2] = 1;
        room(h)[6] = 1;
        room(h)[7] = 1;
      },
      () => room(h)[5] === 5,
    );
    h.until(() => room(h)[5] === 0, 200);
    h.tick();
    expect(h.s().wamp).toBe(room(h)[3]);
    expect(h.s().wper).toBe(room(h)[4]);
  });
});

describe('SMETAK', () => {
  // room (item 0): uvod 1, obudikovi 2, okramech 3, olodi 4, sbirka 5; meduza (1): keca 1
  const room = (h: Harness) => h.s().vars(0);
  const keca = (h: Harness) => h.s().vars(1)[1];

  it('lets the jellyfish banked mid-line finish, and bob the ball again', () => {
    const h = roomHarness('SMETAK', () => 25);
    h.play();
    strandOnce(
      h,
      () => h.s().noDialog() && keca(h) === 0,
      () => {
        room(h)[1] = 1;
        room(h)[2] = 1;
        room(h)[3] = 10000;
        room(h)[4] = 1;
        room(h)[5] = 1;
      },
      () => keca(h) === 101,
    );
    expect(h.mix.playing(940)).toBe(true); // the clock ticks on
    h.until(() => keca(h) === 0, 200);
    h.tick();
    expect(h.s().vars(2)[1]).toBe(1); // mic_beha: the jellyfish bobs the ball again
  });
});

describe('VLADOVA', () => {
  // room (item 0): uvod 1, kecdel1..4 6..9, ohaku 10, ooku 11; lebkic (14) / hakahak (16): cinnost 1
  const room = (h: Harness) => h.s().vars(0);
  const lebkic = (h: Harness) => h.s().vars(14)[1];
  const hak = (h: Harness) => h.s().vars(16)[1];
  const quiet = (h: Harness) => {
    room(h)[1] = 1;
    for (const k of [6, 7, 8, 9]) room(h)[k] = -1;
    room(h)[10] = 1;
    room(h)[11] = 1;
  };

  it('lets the skull banked mid-line finish, and speak again', () => {
    const h = roomHarness('VLADOVA', () => 25);
    h.play();
    const idle = () => h.s().noDialog() && lebkic(h) === 0;
    const arm = () => {
      quiet(h);
      room(h)[6] = 1;
    };
    strandOnce(h, idle, arm, () => lebkic(h) !== 0);
    h.until(() => lebkic(h) === 0, 200);
    h.until(idle, 200);
    arm();
    h.until(() => lebkic(h) !== 0, 200);
  });

  it('lets the hook banked mid-line finish', () => {
    const h = roomHarness('VLADOVA', () => 25);
    for (let i = 0; i < 159; i++) h.play(); // the little fish faces the hook, close by
    strandOnce(
      h,
      () => h.s().noDialog() && hak(h) === 0,
      () => {
        quiet(h);
        room(h)[10] = 0;
      },
      () => hak(h) === 301,
    );
    h.until(() => hak(h) === 0 && h.s().noDialog(), 200);
  });
});

describe('VITEJTE1', () => {
  // vladce (item 1): ksichty 1, cinnost 2, delay 4, obecne 6
  const vl = (h: Harness) => h.s().vars(1);

  it('lets the ruler banked mid-speech finish it, and speak again', () => {
    const h = roomHarness('VITEJTE1', () => 25);
    h.play();
    const talking = () => h.mix.playing(302);
    for (let i = 0; i < 20; i++) if (undoOnto(h, talking)) break;
    const line = h.mix.on(302);
    expect(line).not.toBeNull();
    const from = h.mix.started.length;
    h.until(() => !talking(), 200);
    expect(h.mix.started.slice(from).some((e) => e.name === line)).toBe(false); // not restarted
    h.until(() => saidSince(h, from, 'vit-'), 5000);
  });

  it('brings the dining speech its second half after the fish banked mid-answer', () => {
    const h = roomHarness('VITEJTE1', () => 25);
    h.play();
    let from = 0;
    strandOnce(
      h,
      () => h.s().noDialog() && vl(h)[2] === 0 && vl(h)[1] === 0 && !h.mix.playing(302),
      () => {
        vl(h)[2] = 6;
        vl(h)[6]! |= 16;
        from = h.mix.started.length;
      },
      // the fish answering the first half (cinnost past 61), the second not yet begun
      () => vl(h)[2] !== 6 && vl(h)[2] !== 61 && saidSince(h, from, 'vit-hs-jidelna1') && !saidSince(h, from, 'vit-hs-jidelna2'),
    );
    h.until(() => saidSince(h, from, 'vit-hs-jidelna2'), 2000);
  });
});
