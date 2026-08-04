/**
 * GRAL (room 64) — pushing an item out must not break the room's physics.
 *
 * `odstran_vytlacene` (URoom.pas:24035) removes a pushed-out item by parking it at
 * (-100,-100) with `spec:=11`. That only works because EVERY physics pass then skips
 * it: `priprav_pole` (URoom.pas:26394), `zkameneni_pevnych` (:26591),
 * `zavislosti_nezkamenelych` (:26641) and the three item loops of `padani`
 * (:26690/:26705/:26739) all guard with `(gspec<>9)or(spec<>11)`.
 *
 * The port dropped every one of those guards, so the next gravity pass after a
 * push-out read the occupancy grid at (-100,-99) — far outside it — and died. In the
 * browser that kills the game loop mid-frame: it never reschedules, and the tab
 * freezes. LODE/SPUNT hid it (vytlacit=1, so the room is won and left immediately);
 * GRAL has one chalice per 4-cell item, so play continues and it hangs.
 *
 * Also pinned here: `odstran_vytlacene` removes ALL marked items in one pass (the
 * port removed only the first), `fazi_ven` is a ROOM field (URoom.pas:265 — `TItem`,
 * URoom.pas:95, has none), and the slide ends in `stav_ma_padat` (URoom.pas:24901).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { StepEngine } from '../src/core/stepEngine.js';
import { Room, ITEM_WATER } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { GRAL } from '../src/rooms/gral.js';

const W = 40;
const H = 30;
const FLOOR = 20;
const CHALICE: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];

const CHALICE_A = 3;
const CHALICE_B = 4;
const DECOR = 8;

/**
 * A GRAL-shaped room: two 4-cell chalices (so `vytlacit` = 2 and the room keeps
 * playing after the first one goes out) plus the light/aura/dark decor GRAL's script
 * indexes. Everything rests on a full-width floor so gravity can't drop scenery on a
 * fish. `bx` places the second chalice — put it at 0 to mark both in the same pass.
 */
function gralRoom(bx = 12): { s: Script; room: Room; engine: StepEngine } {
  const items: ItemSpec[] = [
    { kind: 'static', x: 35, y: FLOOR - 1 }, // 1 light
    { kind: 'static', x: 36, y: FLOOR - 1 }, // 2 aura
    { kind: 'light', x: 2, y: FLOOR - 2, cells: CHALICE }, // 3 chalice A
    { kind: 'light', x: bx, y: FLOOR - 2, cells: CHALICE }, // 4 chalice B
    { kind: 'little', x: 30, y: FLOOR - 1 }, // 5 malar
    { kind: 'big', x: 4, y: FLOOR - 2 }, // 6 velkar
    { kind: 'static', x: 37, y: FLOOR - 1 }, // 7 dark
    { kind: 'static', x: 38, y: FLOOR - 1 }, // 8
  ];
  const room = makeRoom({
    w: W,
    h: H,
    walls: Array.from({ length: W }, (_, x) => [x, FLOOR] as [number, number]),
    items,
  });
  const s = new Script(room, () => 1, () => false, { talkNow: () => 1 }, () => false);
  GRAL.init(s);
  const engine = new StepEngine(room, s, GRAL, { random: () => 0 });
  s.onWin = () => engine.triggerWin(20);
  return { s, room, engine };
}

/** Run the room until every marked item has left (or `limit` ticks pass). */
function runUntilRemoved(s: Script, engine: StepEngine, idx: number, limit = 100): number {
  let tick = 0;
  while (tick < limit && s.room.items[idx]!.spec !== 11) {
    tick++;
    engine.runScript(tick, 0);
    s.dialogy(tick);
    engine.advance();
  }
  return tick;
}

describe('GRAL push-out (odstran_vytlacene, URoom.pas:24035)', () => {
  it('keeps playing after an item is pushed out instead of hanging the room', () => {
    const { s, room, engine } = gralRoom();
    expect(room.gspec).toBe(9);
    expect(room.vytlacit).toBe(2); // two 4-cell chalices, so the room is not won yet

    // Shove chalice A against the left edge with the big fish.
    room.facingRight.big = false;
    expect(engine.applyMoveInstant('big', Dir.left)).toBe(true);
    expect(engine.applyMoveInstant('big', Dir.left)).toBe(true);
    expect(room.items[CHALICE_A]!.x, 'chalice A reached the left edge').toBe(0);

    runUntilRemoved(s, engine, CHALICE_A);
    expect(room.items[CHALICE_A]!.spec, 'chalice A was removed').toBe(11);
    expect(room.vytlacit, 'one chalice still to go').toBe(1);
    expect(engine.won, 'the room is not won until vytlacit hits 0').toBe(false);

    // The bug: this next move ran a gravity pass over the parked item and threw,
    // which in the browser stops the render loop dead (the reported "hang").
    expect(() => {
      engine.applyMoveInstant('big', Dir.right); // turn
      engine.applyMoveInstant('big', Dir.right); // step -> commitMove + fallToRest
    }, 'physics still runs after a push-out').not.toThrow();
    expect(room.alive.little && room.alive.big, 'nobody died settling the room').toBe(true);
  });

  it('takes the pushed-out item off the occupancy grid (priprav_pole, URoom.pas:26394)', () => {
    const { s, room, engine } = gralRoom();
    room.facingRight.big = false;
    engine.applyMoveInstant('big', Dir.left);
    engine.applyMoveInstant('big', Dir.left);
    runUntilRemoved(s, engine, CHALICE_A);

    expect(room.cellOccupant(0, FLOOR - 2), 'the cell the chalice left is water again').toBe(ITEM_WATER);
    expect(room.cellOccupant(1, FLOOR - 1), 'and so is the rest of its footprint').toBe(ITEM_WATER);
    // A parked item must never be looked up on the grid at all: its own cells are
    // outside it, which is what used to blow the physics up.
    expect(room.items[CHALICE_A]!.x).toBe(-100);
    expect(room.items[CHALICE_A]!.y).toBe(-100);
  });

  it('removes EVERY marked item in one pass, decrementing vytlacit for each', () => {
    // Both chalices sit at the left edge, so one prog() marks both (spec=9) and
    // odstran_vytlacene takes them out TOGETHER. The port used to take the first and
    // `break`, so the second only left on a later pass — `vytlacit` and the win
    // countdown then disagreed with the original for a whole slide's worth of ticks.
    const { s, room, engine } = gralRoom(0);
    room.items[CHALICE_A]!.x = 0;
    room.items[CHALICE_A]!.y = FLOOR - 4; // stacked above chalice B, both at the edge
    room.items[CHALICE_B]!.x = 0;
    expect(room.vytlacit).toBe(2);

    const goneAt = new Map<number, number>();
    for (let tick = 1; tick <= 100 && goneAt.size < 2; tick++) {
      engine.runScript(tick, 0);
      s.dialogy(tick);
      engine.advance();
      for (const idx of [CHALICE_A, CHALICE_B]) {
        if (room.items[idx]!.spec === 11 && !goneAt.has(idx)) goneAt.set(idx, tick);
      }
    }

    expect(goneAt.get(CHALICE_A), 'chalice A was removed').toBeDefined();
    expect(goneAt.get(CHALICE_B), 'chalice B was removed').toBeDefined();
    expect(goneAt.get(CHALICE_B), 'both left on the SAME pass').toBe(goneAt.get(CHALICE_A));
    expect(room.vytlacit, 'vytlacit is decremented once per removed item').toBe(0);
    expect(engine.won, 'clearing the last item wins the room').toBe(true);
    expect(engine.winCountdown).toBe(20); // countdown := 20 (URoom.pas:24051)
  });

  it('settles gravity when the slide ends (gstav := stav_ma_padat, URoom.pas:24901)', () => {
    const { s, room, engine } = gralRoom();
    room.facingRight.big = false;
    engine.applyMoveInstant('big', Dir.left);
    engine.applyMoveInstant('big', Dir.left);
    expect(room.items[CHALICE_A]!.x, 'chalice A reached the left edge').toBe(0);

    // Perch the (1-cell, non-chalice) decor item on top of chalice A, so removing A
    // must drop it. The original runs a padani pass the moment the slide finishes —
    // not on the player's next move.
    const perched = room.items[DECOR]!;
    perched.x = 0;
    perched.y = FLOOR - 3;

    runUntilRemoved(s, engine, CHALICE_A);
    expect(room.items[CHALICE_A]!.spec).toBe(11);
    expect(engine.phase, 'the room drops into the fall state, not idle').toBe('fall');

    for (let tick = 0; tick < 20 && engine.phase !== 'idle'; tick++) engine.advance();
    expect(perched.y, 'the perched item fell to the floor once A was gone').toBe(FLOOR - 1);
  });

  it('keeps fazi_ven on the room, not the item (URoom.pas:265 / TItem, URoom.pas:95)', () => {
    const { s, room } = gralRoom();
    room.items[CHALICE_A]!.x = 0;
    GRAL.prog(s);
    expect(room.items[CHALICE_A]!.spec).toBe(9);
    expect(room.items[CHALICE_A]!.dir).toBe(Dir.left);
    expect(room.faziVen, '3 * a for a 2-cell-wide chalice').toBe(6);
  });
});

describe('unbounded gravity loops report instead of freezing the tab', () => {
  it('throws a diagnosable error when the settle loop will not converge', () => {
    class NeverSettles extends Room {
      override padani(): boolean {
        return true; // corrupt physics: something is always still falling
      }
    }
    const room = makeRoom({ w: 10, h: 10, items: [{ kind: 'little', x: 1, y: 8 }] });
    Object.setPrototypeOf(room, NeverSettles.prototype);
    expect(() => room.fallToRest()).toThrowError(/did not settle/);
  });
});

/**
 * The same defect on the REAL room 64, driven through actual fish moves. Skips
 * cleanly when the FFR data isn't present (same convention as rooms/solutions tests).
 *
 * The move string shoves chalice 38 (item index 38, at (1,11)) against the left wall
 * with the little fish. GRAL has 25 chalices, so `vytlacit` stays far above 0 and the
 * room keeps playing after the removal — which is precisely when the port used to die.
 */
const DATA = process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR');
const hasData = existsSync(join(DATA, 'Graphic'));
const PUSH_38 = 'RRUUURRRUUUUUULLLULUUUURRURRUURRRUUUULLLLLLLL';
const DIR_OF: Record<string, number> = { L: Dir.left, R: Dir.right, U: Dir.up, D: Dir.down };

describe.skipIf(!hasData)('GRAL #64 on the real room data', () => {
  it('survives a push-out and keeps taking moves', () => {
    const ffr = parseFfr(new Uint8Array(readFileSync(join(DATA, 'Graphic/064.ffr'))));
    const room = new Room(ffr);
    const s = new Script(room, () => 1, () => false, { talkNow: () => 1 }, () => false);
    GRAL.init(s);
    room.fallToRest();
    const engine = new StepEngine(room, s, GRAL, { random: () => 0 });
    s.onWin = () => engine.triggerWin(20);
    expect(room.vytlacit, 'GRAL counts one push-out per 4-cell chalice').toBe(25);

    for (const ch of PUSH_38) {
      expect(engine.applyMoveInstant('little', DIR_OF[ch]!), `move ${ch} was blocked`).toBe(true);
    }
    expect(room.items[38]!.x, 'the chalice reached the left wall').toBe(0);

    let tick = 0;
    while (tick < 60 && room.items[38]!.spec !== 11) {
      tick++;
      engine.runScript(tick, 0);
      s.dialogy(tick);
      engine.advance();
    }
    expect(room.items[38]!.spec, 'the chalice slid out and was removed').toBe(11);
    expect(room.vytlacit).toBe(24);
    expect(engine.won, '24 chalices to go — the room is not won').toBe(false);

    for (let i = 0; i < 30 && engine.phase !== 'idle'; i++) engine.advance();
    // Pre-fix this threw out of padani and, in the browser, took the render loop
    // with it — the room simply froze a moment after the chalice left.
    expect(() => {
      engine.applyMoveInstant('little', Dir.right);
      engine.applyMoveInstant('little', Dir.right);
      engine.applyMoveInstant('little', Dir.down);
    }, 'the room still runs physics after a push-out').not.toThrow();
  });
});
