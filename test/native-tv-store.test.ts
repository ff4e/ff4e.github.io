/**
 * The tvOS store (native/js/tvStore.ts, storeBudget.ts, progressSync.ts) over fake
 * NSUserDefaults / iCloud / cache backends: the worst case found by measuring every recorded
 * solution stays under the budget, progress survives every cut, and the iCloud merge keeps
 * the best of every device. Real save slots: ZAVAL's undo history is the heaviest per point
 * (~121 KB at the end of its 156-move solution), played through the real undo sampler.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as game from '../src/app/gameState.js';
import { undoHistoryForSave } from '../src/app/undo.js';
import { decodeUndoHistory, type UndoPoint } from '../src/core/undoStack.js';
import { decodeMoves } from '../src/core/solutionMoves.js';
import { solutionFor } from '../src/rooms/index.js';
import { ROOMS } from '../src/data/roomTable.js';
import { Dir } from '../src/core/dir.js';
import { roomHarness } from './undoRoomHarness.js';
import { PREFS_LIMIT, TV_BUDGET, TV_SLOT_CAP, TvStore, type TvBackend } from '../native/js/tvStore.js';
import { QuotaExceededError, compactSlot, entryBytes, utf8Length } from '../native/js/storeBudget.js';
import { KVS_PREFIX, decodeCopy, encodeCopy, mergeProgress, type Progress } from '../native/js/progressSync.js';

vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/framePacing.js', () => ({ roomLoading: false }));
vi.mock('../src/app/phoneViewport.js', () => ({ continuePhoneRoom: vi.fn() }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => false }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => false }));
vi.mock('../src/platform/haptics.js', () => ({ hapticBlocked: vi.fn() }));

/** NSUserDefaults, the Caches file and iCloud, in memory, with tvOS's limits. */
class FakeTv implements TvBackend {
  prefs: string | null = null;
  damaged: string | null = null;
  cache: string | null = null;
  cacheBak: string | null = null;
  kvs: Record<string, string> = {};
  clock = 1_000;
  logs: string[] = [];
  prefsLoad(damaged?: boolean): string | null { return damaged ? this.damaged : this.prefs; }
  prefsSave(json: string, damaged?: boolean): void {
    if (utf8Length(json) > PREFS_LIMIT) throw new RangeError('over NSUserDefaults');
    if (damaged) this.damaged = json;
    else this.prefs = json;
  }
  cacheLoad(backup?: boolean): string | null { return backup ? this.cacheBak : this.cache; }
  cacheSave(json: string): void {
    this.cacheBak = this.cache;
    this.cache = json;
  }
  kvsLoad(): Record<string, string> { return { ...this.kvs }; }
  kvsSave(key: string, value: string | null): void {
    const next = { ...this.kvs };
    if (value === null) delete next[key];
    else next[key] = value;
    const bytes = Object.values(next).reduce((n, v) => n + utf8Length(v), 0);
    if (Object.keys(next).length > 1024 || bytes > 1_000_000 || key.length > 128) throw new RangeError('over iCloud');
    this.kvs = next;
  }
  now(): number { return this.clock++; }
  log(m: string): void { this.logs.push(m); }
  /** The system empties Caches while the app is not running. */
  purge(): void { this.cache = this.cacheBak = null; }
  /** A new Apple TV, or this one after a reinstall: only iCloud is shared. */
  sibling(): FakeTv {
    const t = new FakeTv();
    Object.defineProperty(t, 'kvs', { get: () => this.kvs, set: (v) => { this.kvs = v; } });
    return t;
  }
}

const persisted = (tv: FakeTv): Record<string, string> => (JSON.parse(tv.prefs!) as { items: Record<string, string> }).items;
const slotOf = (raw: string) => JSON.parse(raw) as { rec: string; vars: unknown; undo?: unknown };
const recs = (points: UndoPoint[]): string[] => points.map((p) => p.rec);

/** ZAVAL to its last move, plus `wiggle` moves back and forth: a real save slot. */
function zavalSlot(wiggle = 0): string {
  const h = roomHarness('ZAVAL');
  const steps = decodeMoves(solutionFor('ZAVAL').moves!);
  for (let i = 0; i < steps.length - 1; i++) h.play();
  for (let k = 0; k < wiggle; k++) {
    const from = game.engine!.srecord;
    for (const which of ['little', 'big'] as const) {
      for (let t = 0; t < 400 && game.engine!.phase !== 'idle'; t++) h.tick();
      if (game.engine!.srecord !== from) break;
      game.engine!.press(which, k % 2 ? Dir.left : Dir.right);
      for (let t = 0; t < 400 && game.engine!.phase !== 'idle'; t++) h.tick();
    }
    h.tick();
  }
  return JSON.stringify({ rec: game.engine!.srecord, vars: h.s().snapshot(), undo: undoHistoryForSave() });
}

/** Every room solved: the solutions stand in for the best records (they are what a solve logs). */
function fullProgress(): Record<string, string> {
  const best: Record<number, string> = {};
  const scores: Record<number, number> = {};
  const time: Record<number, number> = {};
  ROOMS.forEach((r, i) => {
    const s = solutionFor(r.jmeno);
    if (s.known !== 'ok') return;
    best[i + 1] = s.moves;
    scores[i + 1] = decodeMoves(s.moves).length;
    time[i + 1] = 9_876_543;
  });
  return {
    'ff.schema': '2',
    'ff.solved': JSON.stringify(Object.keys(best).map(Number)),
    'ff.scores': JSON.stringify(scores),
    'ff.best': JSON.stringify(best),
    'ff.playtime': JSON.stringify(time),
    'ff.options': JSON.stringify({ volume: { effect: 7, voice: 7, music: 5 }, subtitles: 'cz', titDef: 'cz', introSeen: true, fitMode: 'medium' }),
    'ff.subfont': 'Mulish',
  };
}

let heavy: string;
let long: string;
beforeAll(() => {
  heavy = zavalSlot();
  long = zavalSlot(2000);
});

describe('the tvOS store budget', () => {
  it('measures what it is sized for', () => {
    expect(utf8Length(heavy)).toBeGreaterThan(100_000); // the heaviest slot found
    expect(utf8Length(long)).toBeGreaterThan(utf8Length(heavy));
    const p = fullProgress();
    const bytes = Object.entries(p).reduce((n, [k, v]) => n + entryBytes(k, v), 0);
    expect(bytes).toBeGreaterThan(40_000);
    expect(bytes).toBeLessThan(80_000);
  });

  it('cuts a slot to its newest undo points, keeping its record and script state whole', () => {
    const full = slotOf(long);
    const c = compactSlot('ff.save.17', long, TV_SLOT_CAP);
    expect(entryBytes('ff.save.17', c.value)).toBeLessThanOrEqual(TV_SLOT_CAP);
    const cut = slotOf(c.value);
    expect(cut.rec).toBe(full.rec);
    expect(cut.vars).toEqual(full.vars);
    const before = decodeUndoHistory(full.undo);
    const after = decodeUndoHistory(cut.undo);
    expect(after.length).toBe(c.kept);
    expect(after.length).toBeGreaterThan(10);
    expect(after.length).toBeLessThan(before.length);
    expect(recs(after)).toEqual(recs(before.slice(-after.length)));
    expect(after.map((p) => p.snapshot)).toEqual(before.slice(-after.length).map((p) => p.snapshot));
  });

  // 24 heavy saves are 2.9 MB, seven times the budget: past the point where every other slot
  // is already bare, more slots change nothing but the time this takes.
  it('keeps every room solved and a heavy save in 24 rooms under the budget', () => {
    const tv = new FakeTv();
    const store = new TvStore(tv);
    store.load();
    for (const [k, v] of Object.entries(fullProgress())) store.set(k, v);
    const slots = ROOMS.slice(0, 24).map((_, i) => `ff.save.${i + 1}`);
    for (const k of slots) store.set(k, k === 'ff.save.24' ? long : heavy);
    expect(utf8Length(tv.prefs!)).toBeLessThanOrEqual(TV_BUDGET + 2_000); // + the wrapper and its mtimes
    const kept = persisted(tv);
    for (const [k, v] of Object.entries(fullProgress())) expect(kept[k]).toBe(v);
    for (const k of slots) {
      const full = slotOf(store.items.get(k)!);
      const cut = slotOf(kept[k]!);
      expect(cut.rec).toBe(full.rec);
      expect(cut.vars).toEqual(full.vars);
      const a = decodeUndoHistory(cut.undo);
      const b = decodeUndoHistory(full.undo);
      expect(recs(a)).toEqual(recs(b.slice(b.length - a.length)));
    }
    // The newest save keeps its history; the ones that made room for it gave theirs.
    expect(decodeUndoHistory(slotOf(kept['ff.save.24']!).undo).length).toBeGreaterThan(10);
    const bare = slots.filter((k) => slotOf(kept[k]!).undo === undefined).length;
    expect(bare).toBeGreaterThan(10);
    expect(bare).toBeLessThan(24);
    expect(store.last!.trimmed.length).toBe(24);
    expect(store.last!.dropped).toEqual([]);
    // In memory, and in the cache, the whole thing.
    expect(store.items.get('ff.save.24')).toBe(long);
    expect((JSON.parse(tv.cache!) as { items: Record<string, string> }).items['ff.save.1']).toBe(heavy);
  });

  it('resumes the whole save while the cache lasts, and the defaults copy when it is purged', () => {
    const tv = new FakeTv();
    const a = new TvStore(tv);
    a.load();
    a.set('ff.solved', '[1,2]');
    a.set('ff.save.5', long);
    expect(new TvStore(tv).load().get('ff.save.5')).toBe(long);
    tv.purge();
    const after = new TvStore(tv).load();
    expect(after.get('ff.solved')).toBe('[1,2]');
    expect(after.get('ff.save.5')).not.toBe(long);
    expect(slotOf(after.get('ff.save.5')!).rec).toBe(slotOf(long).rec);
    // A cache from before the last write is not the defaults copy's: never trusted over it.
    const b = new TvStore(tv);
    b.load();
    b.set('ff.save.5', heavy);
    const stale = tv.cache;
    const small = JSON.stringify({ rec: 'lr', vars: null });
    b.set('ff.save.5', small);
    tv.cache = stale;
    expect(new TvStore(tv).load().get('ff.save.5')).toBe(small);
  });

  it('refuses a slot that cannot fit even bare, as a browser quota does, and never refuses progress', () => {
    const tv = new FakeTv();
    const store = new TvStore(tv, 3_000, 1_000);
    store.load();
    store.set('ff.solved', '[1]');
    const big = JSON.stringify({ rec: 'r'.repeat(5_000), vars: null });
    expect(() => store.set('ff.save.3', big)).toThrow(QuotaExceededError);
    expect(store.items.has('ff.save.3')).toBe(false);
    store.set('ff.save.4', JSON.stringify({ rec: 'r'.repeat(1_500), vars: null }));
    // Progress grows past what is left: the slot leaves the defaults copy, progress does not.
    store.set('ff.best', JSON.stringify({ 1: 'x'.repeat(2_000) }));
    expect(persisted(tv)['ff.best']).toBeDefined();
    expect(persisted(tv)['ff.save.4']).toBeUndefined();
    expect(store.last!.dropped).toEqual(['ff.save.4']);
    expect(store.items.has('ff.save.4')).toBe(true); // still in memory and in the cache
  });

  it('starts from the cache when the defaults copy is unreadable, and keeps the damaged one', () => {
    const tv = new FakeTv();
    const a = new TvStore(tv);
    a.load();
    a.set('ff.solved', '[4]');
    tv.prefs = '{"v":1,"seq":';
    expect(new TvStore(tv).load().get('ff.solved')).toBe('[4]');
    expect(tv.damaged).toBe('{"v":1,"seq":');
    expect(persisted(tv)['ff.solved']).toBe('[4]');
  });
});

describe('progress in iCloud', () => {
  const p = (o: Record<string, [unknown, number]>): Progress =>
    Object.fromEntries(Object.entries(o).map(([k, [v, t]]) => [k, { v: typeof v === 'string' ? v : JSON.stringify(v), t }]));

  it('merges: union of rooms, best of records, the newest options', () => {
    const mine = p({
      'ff.solved': [[1, 2], 5], 'ff.cheated': [[9], 5], 'ff.scores': [{ 1: 100, 2: 50 }, 5],
      'ff.best': [{ 1: 'a'.repeat(100), 2: 'b'.repeat(50) }, 5], 'ff.playtime': [{ 1: 10, 2: 99 }, 5],
      'ff.options': [{ subtitles: 'en' }, 50], 'ff.subfont': ['Mulish', 10],
    });
    const theirs = p({
      'ff.solved': [[2, 3], 7], 'ff.scores': [{ 1: 90, 3: 30 }, 7],
      'ff.best': [{ 1: 'c'.repeat(90), 3: 'd'.repeat(30) }, 7], 'ff.playtime': [{ 1: 20, 3: 5 }, 7],
      'ff.options': [{ subtitles: 'cz' }, 40], 'ff.subfont': ['Kalam', 20],
    });
    const m = mergeProgress(mine, theirs);
    const v = (k: string): unknown => JSON.parse(m[k]!.v);
    expect(v('ff.solved')).toEqual([1, 2, 3]);
    expect(v('ff.cheated')).toEqual([9]);
    expect(v('ff.scores')).toEqual({ 1: 90, 2: 50, 3: 30 });
    expect(v('ff.best')).toEqual({ 1: 'c'.repeat(90), 2: 'b'.repeat(50), 3: 'd'.repeat(30) });
    expect(v('ff.playtime')).toEqual({ 1: 20, 2: 99, 3: 5 });
    expect(v('ff.options')).toEqual({ subtitles: 'en' }); // mine is newer
    expect(m['ff.subfont']!.v).toBe('Kalam'); // theirs is newer
    // A tie in score keeps mine; a copy that is not what the key should hold loses.
    const tie = mergeProgress(p({ 'ff.scores': [{ 1: 5 }, 1], 'ff.best': [{ 1: 'mine' }, 1] }),
      p({ 'ff.scores': [{ 1: 5 }, 2], 'ff.best': [{ 1: 'theirs' }, 2], 'ff.solved': ['oops', 9] }));
    expect(JSON.parse(tie['ff.best']!.v)).toEqual({ 1: 'mine' });
    expect(mergeProgress(p({ 'ff.solved': [[1], 1] }), p({ 'ff.solved': ['{', 9] }))['ff.solved']!.v).toBe('[1]');
    expect(mergeProgress(mine, {})).toEqual(mine);
  });

  it('two Apple TVs: each writes only its own copy, and each launch takes in the other', () => {
    const one = new FakeTv();
    const two = one.sibling();
    const a = new TvStore(one);
    a.load();
    a.set('ff.solved', '[1,2]');
    a.set('ff.scores', '{"1":40,"2":60}');
    const b = new TvStore(two);
    b.load();
    expect(b.items.get('ff.solved')).toBe('[1,2]');
    b.set('ff.solved', '[1,2,7]');
    b.set('ff.scores', '{"1":40,"2":55,"7":9}');
    a.set('ff.solved', '[1,2,3]'); // a still runs on what it loaded
    expect(Object.keys(one.kvs).filter((k) => k.startsWith(KVS_PREFIX)).length).toBe(2);
    // a's push merged b's copy in, so a's own key carries everything.
    const aCopy = decodeCopy(one.kvs[KVS_PREFIX + (JSON.parse(one.prefs!) as { device: string }).device]);
    expect(JSON.parse(aCopy['ff.solved']!.v)).toEqual([1, 2, 3, 7]);
    // While running, a takes in b's progress (the `!kvs` path) — but not its options.
    b.set('ff.options', '{"subtitles":"cz"}');
    b.set('ff.playtime', '{"7":1000}');
    expect(a.pullRemote().sort()).toEqual(['ff.playtime', 'ff.scores', 'ff.solved']);
    expect(a.items.get('ff.scores')).toBe('{"1":40,"2":55,"7":9}');
    expect(a.items.has('ff.options')).toBe(false);
    // Next launch, the options too.
    expect(new TvStore(one).load().get('ff.options')).toBe('{"subtitles":"cz"}');
  });

  it('a reinstall gets every room back from iCloud', () => {
    const old = new FakeTv();
    const a = new TvStore(old);
    a.load();
    for (const [k, v] of Object.entries(fullProgress())) a.set(k, v);
    const fresh = old.sibling(); // nothing local survives
    const items = new TvStore(fresh).load();
    for (const k of ['ff.solved', 'ff.scores', 'ff.best', 'ff.playtime', 'ff.options', 'ff.subfont']) {
      expect(items.get(k)).toBe(fullProgress()[k]);
    }
    expect(persisted(fresh)['ff.best']).toBe(fullProgress()['ff.best']); // and keeps it locally at once
    expect(utf8Length(encodeCopy(decodeCopy(Object.values(fresh.kvs)[0])))).toBeLessThan(100_000);
  });
});
