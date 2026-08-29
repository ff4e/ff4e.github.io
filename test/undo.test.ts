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
    roompole: [1, 2],
    globpole,
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
    roompole: [0, 0],
    globpole,
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
    const after = decodeUndoHistory(JSON.parse(JSON.stringify(encodeUndoHistory(before))));
    expect(after).toEqual(before);
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
        roompole: new Array<number>(100).fill(0),
        globpole,
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
    const patched = data.pool.filter((e) => !Array.isArray(e)).length;
    expect(patched, 'the globpole arrays after the first are stored as patches').toBeGreaterThan(100);
    // The number that matters is the one a save slot sees. Whole arrays would be ~120 x
    // 1024 numbers; a tenth of a megabyte is already a generous ceiling on the patched
    // form, and this fails loudly if the patching ever stops working.
    expect(JSON.stringify(data).length).toBeLessThan(100_000);
  });

  it('survives a patch that names a slot which does not exist', () => {
    const data = encodeUndoHistory(ticking(4))!;
    (data.pool as { b: number }[])[2]!.b = 9999;
    expect(() => decodeUndoHistory(JSON.parse(JSON.stringify(data)))).not.toThrow();
  });
});
