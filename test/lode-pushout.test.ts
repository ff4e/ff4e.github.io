/**
 * LODE (room 19) — the gspec=9 "push it out" win condition.
 *
 * `LODE_InitProgramky` (URoom.pas:7930) opens with `gspec:=9`, which makes LODE a
 * push-out room: you win by shoving one of the two gods off the room edge, and the
 * fish are NOT allowed to exit (`if (gspec<>9)and(kontroluj_okraje>0)`, URoom.pas:24295).
 * The two `Spec9` calls (URoom.pas:19488/19640) mark whichever god reaches an edge.
 *
 * This pins the whole chain: init sets gspec/vytlacit, prog marks the god, the host
 * slides it off and wins, and a fish walking off an edge does nothing.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { StepEngine } from '../src/core/stepEngine.js';
import { Dir } from '../src/core/dir.js';
import { LODE_ROOM } from '../src/rooms/lode.js';

const BUH2 = 1;
const BUH1 = 2;
const W = 30;
const H = 24;

interface Opts {
  /** buh2 (the 6x6 god) position. */
  buh2?: { x: number; y: number };
  /** buh1 (the 5x6 god) position. */
  buh1?: { x: number; y: number };
  /** little fish position (defaults mid-room, away from every edge). */
  malar?: { x: number; y: number };
}

/**
 * A LODE-shaped room (16 items, r_LODE_* order — URoom.pas:4537-4576).
 *
 * Two full-width ledges (y=13 for the gods/decor, y=17 for the fish) keep every item
 * resting, so a gravity settle can't drop the scenery onto a fish.
 */
function lodeRoom(o: Opts = {}): { s: Script; spoken: string[] } {
  const at = (x: number, y: number): ItemSpec => ({ kind: 'static', x, y });
  const items: ItemSpec[] = [
    at(o.buh2?.x ?? 3, o.buh2?.y ?? 12), // 1 buh2
    at(o.buh1?.x ?? 10, o.buh1?.y ?? 12), // 2 buh1
    at(16, 12), // 3 filler
    at(17, 12), // 4
    at(18, 12), // 5
    at(19, 12), // 6
    at(23, 12), // 7 palka
    at(20, 12), // 8
    at(21, 12), // 9
    at(22, 12), // 10
    at(24, 12), // 11 hul
    at(25, 12), // 12 kriketak
    { kind: 'little', x: o.malar?.x ?? 12, y: o.malar?.y ?? 16 }, // 13 malar
    { kind: 'big', x: 20, y: 15 }, // 14 velkar
    at(26, 12), // 15 objekty
    at(27, 12), // 16 maska
  ];
  const room = makeRoom({
    w: W,
    h: H,
    walls: [
      ...Array.from({ length: W }, (_, x) => [x, 13] as [number, number]),
      ...Array.from({ length: W }, (_, x) => [x, 17] as [number, number]),
    ],
    items,
  });
  const spoken: string[] = [];
  const s = new Script(
    room,
    (name) => (spoken.push(name), 1),
    () => false,
    { talkNow: (name) => (spoken.push(name), 1) },
    () => false, // isTalking: nothing talking, so the "jo!" cheer can fire
  );
  LODE_ROOM.init(s);
  return { s, spoken };
}

/** Silence the ambient fish commentary so it can't interleave with the assertions. */
function quiet(s: Script): void {
  const rv = s.vars(0);
  rv[1] = 1; // uvod done
  rv[2] = -1; // costim done
  rv[3] = 1; // oholi done
  rv[4] = 1; // opalce done
  rv[5] = 1_000_000; // omicich far off
}

describe('LODE init (URoom.pas:7930)', () => {
  it('is a gspec=9 push-out room with the default vytlacit=1', () => {
    const { s } = lodeRoom();
    expect(s.room.gspec).toBe(9);
    expect(s.room.vytlacit).toBe(1); // URoom.pas:1445 default; LODE never overrides it
  });
});

describe('LODE Spec9 (URoom.pas:19488/19640)', () => {
  it('marks buh1 (5x6) when it is pushed against the right edge', () => {
    const { s } = lodeRoom({ buh1: { x: W - 5, y: 12 } });
    quiet(s);
    LODE_ROOM.prog!(s);
    const it = s.item(BUH1);
    expect(it.spec).toBe(9);
    expect(it.dir).toBe(Dir.right);
    expect(s.room.faziVen).toBe(15); // 3 * a (a = 5); fazi_ven is a ROOM field (URoom.pas:265)
  });

  it('marks buh2 (6x6) when it is pushed against the left edge', () => {
    const { s } = lodeRoom({ buh2: { x: 0, y: 12 } });
    quiet(s);
    LODE_ROOM.prog!(s);
    const it = s.item(BUH2);
    expect(it.spec).toBe(9);
    expect(it.dir).toBe(Dir.left);
    expect(s.room.faziVen).toBe(18); // 3 * a (a = 6); fazi_ven is a ROOM field (URoom.pas:265)
  });

  it('cheers "jo!" from both fish when a god reaches the edge', () => {
    const { s, spoken } = lodeRoom({ buh2: { x: 0, y: 12 } });
    quiet(s);
    LODE_ROOM.prog!(s);
    expect(spoken.some((n) => n.startsWith('jo-m-'))).toBe(true);
    expect(spoken.some((n) => n.startsWith('jo-v-'))).toBe(true);
  });

  it('leaves a god away from every edge untouched', () => {
    const { s } = lodeRoom();
    quiet(s);
    LODE_ROOM.prog!(s);
    expect(s.item(BUH2).spec).toBe(0);
    expect(s.item(BUH1).spec).toBe(0);
  });
});

describe('LODE push-out win (host gspec=9 handling)', () => {
  it('slides the marked god off over its faziVen frames and wins the room', () => {
    const { s } = lodeRoom({ buh2: { x: 0, y: 12 } });
    quiet(s);
    const engine = new StepEngine(s.room, s, LODE_ROOM, { random: () => 0 });
    s.onWin = () => engine.triggerWin();

    let count = 0;
    while (!engine.won && count < 500) {
      count++;
      engine.runScript(count, 0);
      s.dialogy(count);
      engine.advance();
    }

    expect(engine.won, 'the room was won by pushing buh2 out').toBe(true);
    expect(s.room.vytlacit).toBe(0);
    expect(s.item(BUH2).spec).toBe(11); // removed from the room
    expect(count).toBeGreaterThanOrEqual(18); // took the full 3*6 slide
  });
});

describe('LODE fish exits (URoom.pas:24295)', () => {
  it('does not let a fish win by walking off the edge', () => {
    const { s } = lodeRoom({ malar: { x: 1, y: 16 } });
    quiet(s);
    const engine = new StepEngine(s.room, s, LODE_ROOM, { random: () => 0 });
    s.onWin = () => engine.triggerWin();

    // Face left, then walk the little fish into the left wall repeatedly.
    s.room.facingRight.little = false;
    for (let i = 0; i < 6; i++) engine.applyMoveInstant('little', Dir.left);

    expect(s.room.items[s.room.littleIdx]!.x, 'the fish reached the left edge').toBe(0);
    expect(s.room.alive.little, 'the fish survived the walk').toBe(true);
    expect(s.room.venku.little, 'the fish must not exit a gspec=9 room').toBe(false);
    expect(s.room.won).toBe(false);
    expect(engine.won).toBe(false);
  });
});

describe('LODE save/load (script snapshot)', () => {
  it('does not let a pre-fix save restore gspec=0 and re-break the room', () => {
    const { s } = lodeRoom();
    // A save written before gspec:=9 was restored: same shape, gspec captured as 0.
    const stale = { ...s.snapshot(), gspec: 0 };
    s.applySnapshot(stale);
    expect(s.room.gspec, 'init() stays authoritative for the static push-out mode').toBe(9);
  });

  it('still restores a runtime gspec a script does toggle (CHODBA-style darkness)', () => {
    const { s } = lodeRoom();
    s.room.gspec = 0; // pretend a room whose init leaves gspec at 0
    s.applySnapshot({ ...s.snapshot(), gspec: 2 });
    expect(s.room.gspec).toBe(2);
  });
});
