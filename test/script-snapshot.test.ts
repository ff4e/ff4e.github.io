import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script, type ScriptSnapshot } from '../src/core/script.js';
import { Room } from '../src/core/room.js';
import { parseFfr } from '../src/data/ffr.js';
import { roomScript } from '../src/rooms/index.js';
import { captureBank } from '../src/core/scriptBank.js';
import { decodeUndoHistory, encodeUndoHistory, type UndoPoint } from '../src/core/undoStack.js';
import { gameDataDir } from './gameData.js';
import { makeRoom } from './roomBuilder.js';
import { seedRandom } from './rng.js';

function script(): Script {
  return new Script(makeRoom({ w: 12, h: 8, items: [{ kind: 'little', x: 3, y: 6 }] }), () => 0);
}

function realScript(num: number, name: string): Script {
  const path = join(gameDataDir(), 'Graphic', `${String(num).padStart(3, '0')}.ffr`);
  const s = new Script(new Room(parseFfr(new Uint8Array(readFileSync(path)))), () => 0);
  roomScript(name)!.init(s);
  return s;
}

/** The old capture, independent of the new sparse encoder. */
function dense(s: Script): ScriptSnapshot {
  return {
    vars: s.room.items.map((it) => [...it.vars]),
    roompole: [...s.roompole], globpole: [...s.globpole],
    zvykacka: s.zvykacka, gspec: s.room.gspec,
  };
}

describe('bank capture', () => {
  it('omits zeros from dense arrays and preserves both end indices', () => {
    const bank = new Array<number>(1024).fill(0);
    expect(captureBank(bank)).toEqual({});
    bank[0] = -7;
    bank[1023] = 9;
    expect(captureBank(bank)).toEqual({ 0: -7, 1023: 9 });
  });

  it('skips array holes and inherited entries, just as key enumeration did', () => {
    const bank = new Array<number>(100);
    bank[0] = 0;
    bank[99] = -7;
    const inherited: number[] = [];
    inherited[1] = 9;
    Object.setPrototypeOf(bank, inherited);
    expect(captureBank(bank)).toEqual({ 99: -7 });
    expect(captureBank(new Array<number>(100))).toEqual({});
  });

  it('still copies sparse objects without keeping zeros or sharing mutable state', () => {
    const bank = { 0: 0, 3: -7, 99: 1 };
    const captured = captureBank(bank);
    expect(captured).toEqual({ 3: -7, 99: 1 });
    bank[3] = 5;
    expect(captured[3]).toBe(-7);
  });
});

describe('sparse script snapshots', () => {
  it('captures only non-zero bank entries without changing live arrays', () => {
    const s = script();
    s.roompole[0] = 3;
    s.roompole[99] = -9;
    s.globpole[1] = -4;
    s.globpole[1023] = 17;
    const saved = s.snapshot();
    expect(saved.roompole).toEqual({ 0: 3, 99: -9 });
    expect(saved.globpole).toEqual({ 1: -4, 1023: 17 });
    expect(s.roompole).toHaveLength(100);
    expect(s.globpole).toHaveLength(1024);
    s.roompole[0] = 0;
    s.globpole[1023] = 0;
    expect(saved.roompole[0]).toBe(3);
    expect(saved.globpole[1023]).toBe(17);
  });

  it('restores all values, clears omitted slots, and never aliases a saved array', () => {
    const s = script();
    s.vars(1, 2).splice(0, 3, 4, 0, 8);
    s.roompole[99] = 7;
    s.globpole[1023] = -2;
    s.zvykacka = true;
    s.room.gspec = 2;
    const expected = dense(s);
    const saved = s.snapshot();
    const restored = script();
    restored.roompole.fill(42);
    restored.globpole.fill(42);
    restored.applySnapshot(JSON.parse(JSON.stringify(saved)));
    expect(dense(restored)).toEqual(expected);
    restored.vars(1)[0] = 999;
    restored.globpole[1023] = 999;
    expect(saved.vars[1]).toEqual([4, 0, 8]);
    expect(saved.globpole[1023]).toBe(-2);
    restored.applySnapshot({ ...saved, roompole: {}, globpole: {} });
    expect(restored.roompole.every((n) => n === 0)).toBe(true);
    expect(restored.globpole.every((n) => n === 0)).toBe(true);
  });

  it('still restores legacy dense snapshots, even when migration could not write', () => {
    const s = script();
    s.vars(1, 1)[1] = 9;
    s.roompole[99] = -5;
    s.globpole[1023] = 7;
    const legacy = dense(s);
    const restored = script();
    restored.applySnapshot(JSON.parse(JSON.stringify(legacy)));
    expect(dense(restored)).toEqual(legacy);
    expect(restored.snapshot().globpole).toEqual({ 1023: 7 });
  });

  it('round-trips entirely populated banks as well as empty ones', () => {
    const s = script();
    for (let i = 0; i < 1024; i++) s.globpole[i] = i % 2 ? -i : i + 1;
    s.roompole.fill(-1);
    const restored = script();
    restored.applySnapshot(JSON.parse(JSON.stringify(s.snapshot())));
    expect(dense(restored)).toEqual(dense(s));
  });

  it('removes the 2246 bytes of zero-bank overhead from a real KOSTE save', () => {
    const s = realScript(6, 'KOSTE');
    const oldSlot = JSON.stringify({ rec: 'LLLLL', vars: dense(s) });
    const newSlot = JSON.stringify({ rec: 'LLLLL', vars: s.snapshot() });
    expect(s.snapshot().roompole).toEqual({});
    expect(s.snapshot().globpole).toEqual({});
    expect(oldSlot.length - newSlot.length).toBe(2246);
    expect(newSlot.length).toBeLessThan(500);
  });
});

describe.each([[61, 'TRUHLA'], [57, 'BANKA']] as const)('%s %s ticking banks', (num, name) => {
  it('preserves timer state and the next tick through saves and pooled undo', () => {
    const s = realScript(num, name);
    const def = roomScript(name)!;
    const history: UndoPoint[] = [];
    for (let tick = 1; tick <= 120; tick++) {
      s.count = tick;
      def.prog(s);
      const before = dense(s);
      const snapshot = s.snapshot();
      expect(Object.keys(snapshot.globpole).length).toBeGreaterThan(0);
      history.push({ rec: 'L'.repeat(tick), snapshot });
      s.roompole.fill(123);
      s.globpole.fill(123);
      s.applySnapshot(JSON.parse(JSON.stringify(snapshot)));
      expect(dense(s)).toEqual(before);
    }
    const restored = decodeUndoHistory(JSON.parse(JSON.stringify(encodeUndoHistory(history))));
    expect(restored).toEqual(history);
    expect(JSON.stringify(encodeUndoHistory(history)).length).toBeLessThan(80_000);

    // Same random stream and current script state, two restore encodings. The
    // oracle is the pre-change dense capture, not another call to sparse capture.
    const legacy = dense(s);
    const saved = s.snapshot();
    const runNext = (state: ScriptSnapshot) => {
      const next = realScript(num, name);
      next.applySnapshot(state);
      next.count = 121;
      seedRandom(`${name}-after-load`);
      def.prog(next);
      return {
        banks: [next.roompole, next.globpole],
        vars: next.room.items.map((it) => it.vars),
        frames: next.room.items.map((it) => it.afaze),
      };
    };
    seedRandom(`${name}-init`);
    const fromDense = runNext(legacy);
    seedRandom(`${name}-init`);
    expect(runNext(saved)).toEqual(fromDense);
    expect(captureBank(s.globpole)).toEqual(saved.globpole);
  });
});
