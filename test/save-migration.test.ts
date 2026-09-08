import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSaveStore } from '../src/app/persist.js';
import { decodeUndoHistory } from '../src/core/undoStack.js';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failKey: string | null = null;
  get length(): number { return this.data.size; }
  key(i: number): string | null { return [...this.data.keys()][i] ?? null; }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (key === this.failKey) throw new DOMException('Full', 'QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void { this.data.delete(key); }
  clear(): void { this.data.clear(); }
}

function legacySlot(): string {
  const roompole = new Array<number>(100).fill(0);
  const globpole = new Array<number>(1024).fill(0);
  roompole[99] = -4;
  globpole[1023] = 8;
  return JSON.stringify({
    rec: 'LL', extra: 'keep me',
    vars: { vars: [[], [1, 0, 9]], roompole, globpole, zvykacka: true, gspec: 2 },
    undo: {
      base: 'LL', recs: [0, 1, 2],
      snaps: [
        null,
        { v: [0], r: 1, g: 2, z: false, s: 0 },
        { v: [0], r: 1, g: 3, z: true, s: 2 },
      ],
      pool: [[1, 0, 9], roompole, globpole, { b: 2, d: [1023, 0, 1, -8] }],
    },
  });
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('save schema 2', () => {
  it.each([null, '0', '1', 'invalid'])('migrates %s before opening the store, preserving saves and progress', (schema) => {
    if (schema !== null) storage.setItem('ff.schema', schema);
    const old = legacySlot();
    storage.setItem('ff.save.6', old);
    storage.setItem('ff.solved', '[1,6]');
    storage.setItem('ff.best', '{"6":"LL"}');
    storage.setItem('ff.save.backup', old);
    const store = openSaveStore();
    const raw = storage.getItem('ff.save.6')!;
    const slot = JSON.parse(raw);
    expect(slot.rec).toBe('LL');
    expect(slot.extra).toBe('keep me');
    expect(slot.vars).toEqual({
      vars: [[], [1, 0, 9]], roompole: { 99: -4 }, globpole: { 1023: 8 }, zvykacka: true, gspec: 2,
    });
    expect(slot.undo.version).toBe(2);
    expect(decodeUndoHistory(slot.undo)).toEqual(decodeUndoHistory(JSON.parse(old).undo));
    expect(raw.length).toBeLessThan(old.length / 5);
    expect(storage.getItem('ff.schema')).toBe('2');
    expect(storage.getItem('ff.solved')).toBe('[1,6]');
    expect(store.bestRecord(6)).toBe('LL');
    expect(storage.getItem('ff.save.backup')).toBe(old);
    openSaveStore();
    expect(storage.getItem('ff.save.6')).toBe(raw);
  });

  it('keeps plain records, absent snapshots, and old snapshots without gspec', () => {
    storage.setItem('ff.save.1', 'LLJK');
    storage.setItem('ff.save.2', JSON.stringify({ rec: 'L', vars: null }));
    storage.setItem('ff.save.3', JSON.stringify({ rec: '' }));
    const old = JSON.parse(legacySlot());
    delete old.vars.gspec;
    delete old.undo;
    storage.setItem('ff.save.4', JSON.stringify(old));
    openSaveStore();
    expect(storage.getItem('ff.save.1')).toBe('LLJK');
    expect(JSON.parse(storage.getItem('ff.save.2')!)).toEqual({ rec: 'L', vars: null });
    expect(JSON.parse(storage.getItem('ff.save.3')!)).toEqual({ rec: '' });
    expect(JSON.parse(storage.getItem('ff.save.4')!).vars.gspec).toBeUndefined();
  });

  it('does not downgrade a future schema or touch its slots', () => {
    storage.setItem('ff.schema', '3');
    storage.setItem('ff.save.6', legacySlot());
    const before = storage.getItem('ff.save.6');
    openSaveStore();
    expect(storage.getItem('ff.schema')).toBe('3');
    expect(storage.getItem('ff.save.6')).toBe(before);
  });

  it('leaves an unwritable slot intact, migrates siblings, and retries on the next boot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const old = legacySlot();
    storage.setItem('ff.schema', '1');
    storage.setItem('ff.save.6', old);
    storage.setItem('ff.save.7', old);
    storage.failKey = 'ff.save.6';
    openSaveStore();
    const sibling = storage.getItem('ff.save.7');
    expect(storage.getItem('ff.save.6')).toBe(old);
    expect(sibling!.length).toBeLessThan(old.length);
    expect(storage.getItem('ff.schema')).toBe('1');
    expect(warn).toHaveBeenCalledTimes(1);
    storage.failKey = null;
    openSaveStore();
    expect(storage.getItem('ff.schema')).toBe('2');
    expect(storage.getItem('ff.save.7')).toBe(sibling);
    expect(storage.getItem('ff.save.6')).toBe(sibling);
  });

  it.each(['{broken', '{"rec":"L","vars":{"roompole":null}}', '{"rec":"L","undo":{"version":3}}'])(
    'reports an invalid slot without overwriting it or blocking a valid sibling: %s', (raw) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('ff.schema', '1');
      storage.setItem('ff.save.1', raw);
      storage.setItem('ff.save.6', legacySlot());
      openSaveStore();
      expect(storage.getItem('ff.save.1')).toBe(raw);
      expect(JSON.parse(storage.getItem('ff.save.6')!).undo.version).toBe(2);
      expect(storage.getItem('ff.schema')).toBe('1');
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );
});
