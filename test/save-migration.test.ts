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

function expectRejectedSlot(raw: string): void {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  storage.setItem('ff.schema', '1');
  storage.setItem('ff.save.1', raw);
  storage.setItem('ff.save.6', legacySlot());
  const write = vi.spyOn(storage, 'setItem');
  openSaveStore();
  expect(storage.getItem('ff.save.1')).toBe(raw);
  expect(JSON.parse(storage.getItem('ff.save.6')!).undo.version).toBe(2);
  expect(storage.getItem('ff.schema')).toBe('1');
  expect(write.mock.calls.filter(([key]) => key === 'ff.save.1' || key === 'ff.schema')).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1);
}

const undoSnapshot = { v: [], r: 0, g: 1, z: false, s: 0 };
const undoData = (overrides: Record<string, unknown> = {}) => ({
  base: 'L', recs: [0, 1], snaps: [null, undoSnapshot], pool: [[], [0, 7]], ...overrides,
});

const malformedUndo: [string, unknown][] = [
  ['missing patch base', undoData({ pool: [[], { b: 9999, d: [1, 7] }] })],
  ['self-referencing patch', undoData({ pool: [[], { b: 1, d: [] }] })],
  ['forward patch reference', undoData({ pool: [[], { b: 2, d: [] }, []] })],
  ['negative patch reference', undoData({ pool: [[], { b: -1, d: [] }] })],
  ['fractional patch reference', undoData({ pool: [[], { b: 0.5, d: [] }] })],
  ['string patch reference', undoData({ pool: [[], { b: '0', d: [] }] })],
  ['odd patch pairs', undoData({ pool: [[0, 0], { b: 0, d: [0, 7, 1] }] })],
  ['out-of-bounds patch index', undoData({ pool: [[], { b: 0, d: [1, 7] }] })],
  ['negative patch index', undoData({ pool: [[0], { b: 0, d: [-1, 7] }] })],
  ['fractional patch index', undoData({ pool: [[0], { b: 0, d: [0.5, 7] }] })],
  ['string patch index', undoData({ pool: [[0], { b: 0, d: ['0', 7] }] })],
  ['duplicate patch index', undoData({ pool: [[0], { b: 0, d: [0, 7, 0, 8] }] })],
  ['nonnumeric patch value', undoData({ pool: [[0], { b: 0, d: [0, null] }] })],
  ['nonnumeric legacy pool value', undoData({ pool: [[], [1, null]] })],
  ['nonnumeric sparse pool value', undoData({ version: 2, pool: [[], [1, 7, 2, null]] })],
  ['malformed unused pool entry', undoData({ pool: [[], [0, 7], ['bad']] })],
  ['invalid item pool reference', undoData({ snaps: [null, { ...undoSnapshot, v: [99] }] })],
  ['nonnumeric item pool reference', undoData({ snaps: [null, { ...undoSnapshot, v: ['0'] }] })],
  ['missing item reference array', undoData({ snaps: [null, { ...undoSnapshot, v: null }] })],
  ['invalid room bank reference', undoData({ snaps: [null, { ...undoSnapshot, r: -1 }] })],
  ['invalid global bank reference', undoData({ snaps: [null, { ...undoSnapshot, g: 2 }] })],
  ['fractional bank reference', undoData({ snaps: [null, { ...undoSnapshot, g: 1.5 }] })],
  ['string bank reference', undoData({ snaps: [null, { ...undoSnapshot, g: '1' }] })],
  ['negative prefix length', undoData({ recs: [0, -1] })],
  ['fractional prefix length', undoData({ recs: [0, 0.5] })],
  ['oversized prefix length', undoData({ recs: [0, 2] })],
  ['invalid snapshot', undoData({ snaps: [null, false] })],
  ['invalid gum flag', undoData({ snaps: [null, { ...undoSnapshot, z: 1 }] })],
  ['missing mode', undoData({ snaps: [null, { ...undoSnapshot, s: undefined }] })],
  ['invalid mode', undoData({ snaps: [null, { ...undoSnapshot, s: null }] })],
  ['too-short history', undoData({ recs: [0], snaps: [null] })],
  ['oversized legacy room bank', undoData({
    pool: [new Array<number>(101).fill(0), []],
  })],
  ['oversized legacy global bank', undoData({
    pool: [[], new Array<number>(1025).fill(0)],
  })],
  ['out-of-bounds sparse room bank', undoData({ version: 2, pool: [[100, 7], []] })],
];

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
      expectRejectedSlot(raw);
    },
  );

  it.each(malformedUndo)('preserves the entire slot and schema on %s', (_name, undo) => {
    const slot = JSON.parse(legacySlot());
    slot.undo = undo;
    expectRejectedSlot(JSON.stringify(slot));
  });

  it('retries a malformed slot after repair, leaving an already migrated sibling unchanged', () => {
    const raw = JSON.stringify({ rec: 'L', undo: undoData({ pool: [[], { b: 9999, d: [1, 7] }] }) });
    expectRejectedSlot(raw);
    const sibling = storage.getItem('ff.save.6');
    storage.setItem('ff.save.1', legacySlot());
    openSaveStore();
    expect(storage.getItem('ff.schema')).toBe('2');
    expect(storage.getItem('ff.save.1')).toBe(sibling);
    expect(storage.getItem('ff.save.6')).toBe(sibling);
  });
});
