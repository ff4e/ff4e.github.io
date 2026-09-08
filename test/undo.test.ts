/**
 * Undo: which position a press goes to, what the history costs to keep, and the one
 * property the whole approach rests on — that rebuilding a room and replaying a SHORTER
 * record reproduces the position that record was at.
 *
 * That last one is why undo can reuse the load path instead of writing an inverse for
 * every kind of move. It is asserted here against the real `StepEngine` and synthetic
 * rooms rather than through a probe, because none of it needs a browser: the browser
 * only supplies the key press, and `test-touchbar.mjs` covers that end.
 *
 * The `gspec=9` push-out half of the same property — that a replay reproduces the RECORD
 * and not merely the room — is `test/recordReplay.test.ts`, which undo depends on but
 * did not introduce.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Dir } from '../src/core/dir.js';
import { stepsOf } from '../src/core/record.js';
import { StepEngine } from '../src/core/stepEngine.js';
import type { Room } from '../src/core/room.js';
import type { ScriptSnapshot } from '../src/core/script.js';
import { captureBank } from '../src/core/scriptBank.js';
import {
  decodeUndoHistory,
  encodeUndoHistory,
  shareSnapshot,
  undoTargetIndex,
  type UndoPoint,
} from '../src/core/undoStack.js';

const point = (rec: string): UndoPoint => ({ rec, snapshot: null });

/** A flat corridor: the little fish on the floor with room to swim either way. */
function corridor(): Room {
  return makeRoom({
    w: 14,
    h: 8,
    items: [{ kind: 'little', x: 5, y: 6 }],
  });
}

const engineFor = (room: Room): StepEngine =>
  new StepEngine(room, null, null, { random: () => 0 });

/** Every item's position, as the thing to compare two room states by. */
const positions = (room: Room): string =>
  room.items.map((it) => `${it.x},${it.y},${it.spec}`).join('|');

/** Replay a record into a fresh room the way `restore` does, and hand back both. */
function replay(fresh: Room, rec: string): { room: Room; engine: StepEngine } {
  const engine = engineFor(fresh);
  fresh.clearAllDirs();
  fresh.fallToRest();
  fresh.clearAllDirs();
  for (const st of stepsOf(rec)) engine.applyRecordStep(st);
  return { room: fresh, engine };
}

describe('undoTargetIndex', () => {
  it('has nothing to undo in an empty history', () => {
    expect(undoTargetIndex([], '')).toBe(-1);
  });

  it('has nothing to undo when the only point IS the current position', () => {
    expect(undoTargetIndex([point('')], '')).toBe(-1);
  });

  it('goes one below the newest point in the ordinary case', () => {
    const h = [point(''), point('L'), point('LL')];
    expect(undoTargetIndex(h, 'LL')).toBe(1);
  });

  it('returns to the newest point when the live record has run past it', () => {
    // What a death looks like: points stop being recorded, so the record keeps growing
    // while the history does not. One press comes back, however far it ran on.
    const h = [point(''), point('L')];
    expect(undoTargetIndex(h, 'LKKK')).toBe(1);
  });
});

describe('shareSnapshot', () => {
  const snap = (globpole: number[], vars: number[][]): ScriptSnapshot => ({
    vars,
    roompole: captureBank([1, 2]),
    globpole: captureBank(globpole),
    zvykacka: false,
    gspec: 0,
  });

  it('reuses the arrays that did not change, and only those', () => {
    const prev = snap([0, 0, 7], [[1], [2]]);
    const next = shareSnapshot(prev, snap([0, 0, 7], [[1], [9]]));
    expect(next.globpole).toBe(prev.globpole); // same reference: not a second 1024-number copy
    expect(next.roompole).toBe(prev.roompole);
    expect(next.vars[0]).toBe(prev.vars[0]);
    expect(next.vars[1]).not.toBe(prev.vars[1]);
    expect(next.vars[1]).toEqual([9]);
  });

  it('keeps everything when there is no previous point to share with', () => {
    const only = snap([1], [[1]]);
    expect(shareSnapshot(null, only)).toBe(only);
  });
});

describe('replaying a shorter record', () => {
  it('reproduces the position the record was at, move for move', () => {
    // Play a run forwards, banking the position after each move — this is what
    // `sampleUndoPoint` does — then check every one against a replay of its record.
    const live = corridor();
    const engine = engineFor(live);
    const points: { rec: string; pos: string }[] = [{ rec: '', pos: positions(live) }];
    for (const dir of [Dir.right, Dir.right, Dir.left, Dir.right, Dir.left, Dir.left]) {
      expect(engine.applyMoveInstant('little', dir)).toBe(true);
      points.push({ rec: engine.srecord, pos: positions(live) });
    }
    expect(points).toHaveLength(7);
    for (const p of points) {
      const back = replay(corridor(), p.rec);
      expect(positions(back.room), `record "${p.rec}"`).toBe(p.pos);
      expect(back.engine.srecord, 'the replay reproduces the record it replayed').toBe(p.rec);
    }
  });

  it('undoes a turn as its own step, since a turn is recorded as a move', () => {
    const live = corridor();
    const engine = engineFor(live);
    engine.applyMoveInstant('little', Dir.left); // facing right → this only turns
    expect(engine.srecord).toBe('J');
    expect(live.facingRight.little).toBe(false);
    const back = replay(corridor(), '');
    expect(back.room.facingRight.little, 'undoing the turn faces the fish back').toBe(true);
  });
});

describe('a history in a save slot', () => {
  const snap = (globpole: number[], vars: number[][]): ScriptSnapshot => ({
    vars,
    roompole: {},
    globpole: captureBank(globpole),
    zvykacka: false,
    gspec: 0,
  });

  /** A history shaped like a real attempt: growing record, mostly-unchanged snapshots. */
  const attempt = (): UndoPoint[] => {
    const out: UndoPoint[] = [];
    let rec = '';
    let prev: ScriptSnapshot | null = null;
    for (let i = 0; i < 12; i++) {
      const s = shareSnapshot(prev, snap([0, 0, i < 6 ? 0 : 1], [[], [], [i]]));
      out.push({ rec, snapshot: s });
      prev = s;
      rec += 'L';
    }
    return out;
  };

  it('round-trips through JSON, values intact', () => {
    const before = attempt();
    const data = JSON.parse(JSON.stringify(encodeUndoHistory(before)));
    const after = decodeUndoHistory(data);
    expect(after).toEqual(before);
    expect(decodeUndoHistory(data, { strict: true })).toEqual(before);
  });

  it('keeps the arrays shared, so a load does not re-inflate what a save collapsed', () => {
    const after = decodeUndoHistory(JSON.parse(JSON.stringify(encodeUndoHistory(attempt()))));
    // globpole is one of two distinct values across twelve points, so eleven of the
    // twelve must come back pointing at one of two arrays, not at twelve copies.
    const distinct = new Set(after.map((p) => p.snapshot!.globpole));
    expect(distinct.size).toBe(2);
    expect(new Set(after.map((p) => p.snapshot!.roompole)).size).toBe(1);
  });

  it('stores the records as lengths, not as N copies of a growing string', () => {
    const data = encodeUndoHistory(attempt())!;
    expect(data.recs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(data.base).toBe('LLLLLLLLLLL');
  });

  it('stores nothing when there is nothing to undo to', () => {
    expect(encodeUndoHistory([])).toBeNull();
    expect(encodeUndoHistory([{ rec: '', snapshot: null }])).toBeNull();
  });

  it('gives back an empty history for a save that has none, or a broken one', () => {
    // The degradation that matters: an older save still loads, it just cannot be undone
    // through. Never a throw — that would cost the player the save, not the history.
    expect(decodeUndoHistory(undefined)).toEqual([]);
    expect(decodeUndoHistory(null)).toEqual([]);
    expect(decodeUndoHistory({ base: 'LL', recs: [0, 1] })).toEqual([]);
    expect(decodeUndoHistory({ base: 'LL', recs: [0], snaps: [null, null], pool: [] })).toEqual([]);
  });

  it('keeps a record that is not a prefix of the base, as a load leaves behind', () => {
    const odd: UndoPoint[] = [
      { rec: 'JJJ', snapshot: null },
      { rec: 'LL', snapshot: null },
    ];
    expect(decodeUndoHistory(encodeUndoHistory(odd))).toEqual(odd);
  });

  it('reads a legacy dense pool and its patches, including a timer becoming zero', () => {
    // Literal pre-v2 fixture, NOT generated by the encoder under test.
    const legacy = {
      base: 'LL', recs: [0, 1, 2],
      snaps: [
        { v: [0], r: 1, g: 2, z: true, s: 2 },
        { v: [0], r: 1, g: 3, z: false, s: 0 },
        { v: [0], r: 1, g: 4, z: false, s: 0 },
      ],
      pool: [[4, 0, 9], [0, 7], [0, -3, 8], { b: 2, d: [1, 0] }, { b: 3, d: [2, -1] }],
    };
    const history = decodeUndoHistory(JSON.parse(JSON.stringify(legacy)));
    expect(history.map((p) => p.snapshot!.globpole)).toEqual([{ 1: -3, 2: 8 }, { 2: 8 }, { 2: -1 }]);
    expect(history[0]!.snapshot).toEqual({
      vars: [[4, 0, 9]], roompole: { 1: 7 }, globpole: { 1: -3, 2: 8 }, zvykacka: true, gspec: 2,
    });
    expect(history[0]!.snapshot!.roompole).toBe(history[2]!.snapshot!.roompole);
    expect(decodeUndoHistory(legacy, { strict: true })).toEqual(history);
    expect(decodeUndoHistory(encodeUndoHistory(history))).toEqual(history);
  });

  it('rejects unknown pool versions and malformed sparse banks', () => {
    const data = encodeUndoHistory(attempt())!;
    expect(decodeUndoHistory({ ...data, version: 3 })).toEqual([]);
    for (const entries of [[1], [-1, 2], [1024, 2], [0.5, 2], [1, 2, 1, 3], [1, Infinity]]) {
      expect(decodeUndoHistory({
        version: 2, base: 'L', recs: [0, 1],
        snaps: [null, { v: [], r: 0, g: 1, z: false, s: 0 }],
        pool: [[], entries],
      })).toEqual([]);
    }
  });

  it('keeps runtime recovery of a malformed pool separate from strict migration', () => {
    const data = {
      version: 2, base: 'L', recs: [0, 1],
      snaps: [null, { v: [], r: 0, g: 1, z: false, s: 0 }],
      pool: [[], [1, 7, 2, null]],
    };
    const recovered = decodeUndoHistory(data);
    expect(recovered).toHaveLength(2);
    expect(recovered[1]!.snapshot!.globpole).toEqual({});
    expect(decodeUndoHistory(data, { strict: true })).toEqual([]);
  });
});

describe('a history from a room that writes globpole every tick', () => {
  /**
   * TRUHLA and BANKA drive per-tick animation timers through `globpole`
   * (`src/rooms/truhla.ts:136`, `src/rooms/banka.ts:450`), so no two points ever share
   * one and `shareSnapshot` has nothing to collapse. That is the case that decides
   * whether a history fits a save slot at all: measured on TRUHLA's committed solution,
   * writing each array whole cost 277 KB and patching costs 46 KB.
   */
  const ticking = (n: number): UndoPoint[] => {
    const out: UndoPoint[] = [];
    let rec = '';
    let prev: ScriptSnapshot | null = null;
    for (let i = 0; i < n; i++) {
      const globpole = new Array<number>(1024).fill(0);
      for (let g = 0; g < 10; g++) globpole[g] = i; // ten timers, moving every point
      const s = shareSnapshot(prev, {
        vars: [[], [], [i % 3]],
        roompole: {},
        globpole: captureBank(globpole),
        zvykacka: false,
        gspec: 0,
      });
      out.push({ rec, snapshot: s });
      prev = s;
      rec += 'L';
    }
    return out;
  };

  it('round-trips exactly, patches and all', () => {
    const before = ticking(120);
    const after = decodeUndoHistory(JSON.parse(JSON.stringify(encodeUndoHistory(before))));
    expect(after).toEqual(before);
  });

  it('writes the ten numbers that moved, not the 1024 that did not', () => {
    const data = encodeUndoHistory(ticking(120))!;
    // Sparse capture removes the zero baseline as well as the copies. Whether a pool
    // entry is whole or patched is an implementation detail; byte cost is the contract.
    expect(JSON.stringify(data).length).toBeLessThan(15_000);
    expect(data.pool.every((e) => !Array.isArray(e) || e.length <= 20)).toBe(true);
  });

  it('survives a patch that names a slot which does not exist', () => {
    const data = {
      base: 'L', recs: [0, 1],
      snaps: [null, { v: [], r: 0, g: 1, z: false, s: 0 }],
      pool: [[], { b: 9999, d: [1, 7] }],
    };
    const recovered = decodeUndoHistory(JSON.parse(JSON.stringify(data)));
    expect(recovered).toHaveLength(2);
    expect(recovered[1]!.snapshot!.globpole).toEqual({ 1: 7 });
    expect(decodeUndoHistory(data, { strict: true })).toEqual([]);
  });

  it('still patches a genuinely dense bank and restores every value', () => {
    const history = ticking(3);
    for (let i = 0; i < history.length; i++) {
      const bank = new Array<number>(1024).fill(-7);
      bank[500] = i + 1;
      history[i]!.snapshot!.globpole = captureBank(bank);
    }
    const data = encodeUndoHistory(history)!;
    expect(data.pool.some((e) => !Array.isArray(e))).toBe(true);
    expect(decodeUndoHistory(JSON.parse(JSON.stringify(data)))).toEqual(history);
    expect(decodeUndoHistory(JSON.parse(JSON.stringify(data)), { strict: true })).toEqual(history);
  });
});
