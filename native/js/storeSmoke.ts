/**
 * The tvOS store's gate, on a Mac: the real game over `TvStore` (`tvStore.ts`) and the host's
 * stand-ins for NSUserDefaults and iCloud (`native/host/store.c`, files in DIR), headless.
 *
 *   ff4e-native <bundle.js> --root public --headless --smoke-store --tv-store DIR --store DIR/store.json
 *
 * ZAVAL — the save slot heaviest per undo point, ~121 KB at the end of its solution — is
 * typed to its last move and saved with F2 through the real `saveGame`; NSUserDefaults must
 * hold it within the slot cap, record whole and the newest undo points kept, while the cache
 * holds it all. Then the cache is "purged" (a relaunch that finds none), the game loads what
 * NSUserDefaults kept with F3, undoes back through every point it kept and no further, and
 * finishes the room: the win must be in NSUserDefaults and in this device's iCloud copy.
 * Another device's copy arriving (`!kvs`) must reach the running game's own sets, its play
 * time adding to this device's; the worst case measured — every room solved, a heavy save
 * in 24 rooms — must stay under the budget with progress byte for byte; and the stand-ins must refuse what tvOS and iCloud refuse.
 * The store DIR is wiped first.
 */
import { decodeMoves } from '../../src/core/solutionMoves.js';
import { decodeUndoHistory } from '../../src/core/undoStack.js';
import { ROOMS } from '../../src/data/roomTable.js';
import { solutionFor } from '../../src/rooms/index.js';
import { engine, loadmode, undoHistory } from '../../src/app/gameState.js';
import { heldKeyState } from '../../src/app/movement.js';
import { undoAvailable } from '../../src/app/undo.js';
import { advance, enterRoom, initGame, keyDown, keyUp, roomReady, type LeaveReason } from './game.js';
import { loadSubtitleAssets } from './roomSubtitles.js';
import { pinRandom } from './scene.js';
import { tvHost } from './shims.js';
import { routeEvent } from './uiInput.js';
import { KVS_PREFIX, decodeCopy, encodeCopy } from './progressSync.js';
import { entryBytes, utf8Length } from './storeBudget.js';
import { PREFS_LIMIT, TV_BUDGET, TV_SLOT_CAP, TvStore } from './tvStore.js';
import { Dir } from '../../src/core/dir.js';

class StoreSmokeFailure extends Error {}

const KEY_OF: Record<'little' | 'big', Record<number, string>> = {
  little: { [Dir.up]: 'KeyI', [Dir.down]: 'KeyK', [Dir.left]: 'KeyJ', [Dir.right]: 'KeyL' },
  big: { [Dir.up]: 'KeyW', [Dir.down]: 'KeyS', [Dir.left]: 'KeyA', [Dir.right]: 'KeyD' },
};

/** The NSUserDefaults copy's items, as the host has it now. */
function defaults(): Record<string, string> {
  const raw = __native.prefsLoad(false);
  return raw ? (JSON.parse(raw) as { items: Record<string, string> }).items : {};
}
const slot = (raw: string) => JSON.parse(raw) as { rec: string; undo?: unknown };

export async function runStoreSmoke(): Promise<number> {
  const args = __native.args();
  if (!__native.tvStore || !args.includes('--tv-store') || !args.includes('--store')) {
    console.error('--smoke-store needs --tv-store DIR and --store FILE: it wipes both');
    return 2;
  }
  localStorage.clear();
  for (const k of Object.keys(JSON.parse(__native.kvsLoad()) as Record<string, string>)) __native.kvsSave(k, null);
  pinRandom(1);
  let left: { num: number; why: LeaveReason } | null = null;
  const store = initGame({ verbose: false, demo: false, onLeave: (num, why) => { left = { num, why }; } });
  await loadSubtitleAssets();
  let n = 0;
  const check = (ok: boolean, what: string): void => {
    n++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) throw new StoreSmokeFailure(what);
  };
  const t0 = __native.now();
  try {
    const num = ROOMS.findIndex((r) => r.jmeno === 'ZAVAL') + 1;
    const key = `ff.save.${num}`;
    const moves = decodeMoves(solutionFor('ZAVAL').moves!);
    await enterRoom(num);
    for (let i = 0; i < 10_000 && !roomReady(); i++) await new Promise((r) => setTimeout(r, 0));
    let ticks = 0;
    const tick = (): void => {
      if (ticks++ > 200_000) throw new StoreSmokeFailure('ran out of ticks');
      advance(80);
    };
    const until = (what: string, pred: () => boolean, max = 5000): void => {
      for (let i = 0; i < max && !pred(); i++) tick();
      check(pred(), what);
    };
    const press = (code: string): void => {
      keyDown(code);
      keyUp(code);
    };
    /** srecord after each move; [0] is the start. */
    const recs: string[] = [];
    for (let i = 0; i < 20 && undoHistory.length === 0; i++) tick();
    recs[0] = engine!.srecord;
    const play = (i: number): void => {
      const m = moves[i]!;
      const banked = undoHistory.length;
      const from = engine!.srecord;
      for (let t = 0; t < 3000 && undoHistory.length === banked && !left; t++) {
        if (heldKeyState() === 0 && engine!.phase === 'idle' && engine!.srecord === from) press(KEY_OF[m.which][m.dir]!);
        tick();
      }
      if (!left && undoHistory.length !== banked + 1) throw new StoreSmokeFailure(`move ${i + 1} was not banked`);
      recs[i + 1] = engine!.srecord;
    };
    const last = moves.length - 1;
    for (let i = 0; i < last; i++) play(i);

    // ── F2: the whole attempt in memory and in the cache, the newest of it in NSUserDefaults.
    let t = __native.now();
    press('F2');
    const saveMs = __native.now() - t;
    const full = localStorage.getItem(key)!;
    const points = decodeUndoHistory(slot(full).undo);
    check(points.length === last + 1, `F2 saves ZAVAL's whole attempt in memory: ${points.length} undo points, ${utf8Length(full)} bytes`);
    const cache = (JSON.parse(__native.storeLoad()!) as { items: Record<string, string> }).items;
    check(cache[key] === full, '...and in the cache file, whole');
    const kept = defaults()[key]!;
    const keptPoints = decodeUndoHistory(slot(kept).undo);
    check(entryBytes(key, kept) <= TV_SLOT_CAP && slot(kept).rec === recs[last],
      `NSUserDefaults keeps it in ${entryBytes(key, kept)} bytes (cap ${TV_SLOT_CAP}), its record whole; the save took ${saveMs.toFixed(0)} ms`);
    check(keptPoints.length > 1 && keptPoints.length < points.length &&
      keptPoints.every((p, i) => p.rec === recs[last + 1 - keptPoints.length + i]),
    `...with its newest ${keptPoints.length} undo points`);

    // ── A relaunch after the system emptied Caches: what NSUserDefaults kept is the save.
    const relaunched = new TvStore({ ...tvHost, cacheLoad: () => null }).load();
    check(relaunched.get(key) === kept && relaunched.get('ff.schema') === localStorage.getItem('ff.schema'),
      'a relaunch with the cache purged finds the save NSUserDefaults kept, and the progress');
    localStorage.setItem(key, kept); // what that launch's game would read
    press('F3');
    until('F3 loads the kept save', () => loadmode === null && engine!.phase === 'idle' && engine!.srecord === recs[last]);
    let undos = 0;
    while (undoAvailable() && undos < 1000) {
      press('Minus');
      undos++;
    }
    const oldest = last + 1 - keptPoints.length;
    check(undos === keptPoints.length - 1 && engine!.srecord === recs[oldest],
      `undo steps back through every kept point (${undos}) and stops at the oldest, move ${oldest}`);
    for (let i = oldest; i < moves.length && !left; i++) play(i);
    until('the win leaves the room', () => left !== null, 2000);
    const solved = JSON.parse(defaults()['ff.solved'] ?? '[]') as number[];
    check(left!.why === 'won' && solved.includes(num) && defaults()['ff.best'] !== undefined, 'the win is in NSUserDefaults');
    const kvs = JSON.parse(__native.kvsLoad()) as Record<string, string>;
    const own = Object.keys(kvs).filter((k) => k.startsWith(KVS_PREFIX));
    check(own.length === 1 && (JSON.parse(decodeCopy(kvs[own[0]!]).p['ff.solved']?.v ?? '[]') as number[]).includes(num),
      `...and in this device's iCloud copy (${own[0]})`);

    // ── Another Apple TV's progress arrives while the game runs.
    __native.kvsSave(`${KVS_PREFIX}smoke-other`, encodeCopy({
      p: { 'ff.solved': { v: '[1,2]', t: 1 }, 'ff.scores': { v: '{"1":3}', t: 1 }, 'ff.best': { v: '{"1":"abc"}', t: 1 } },
      pt: { 'smoke-other': { 1: 60_000 } },
    }));
    routeEvent('!kvs');
    const ownZaval = store.playTime.get(num) ?? 0;
    check(store.solved.has(1) && store.solved.has(2) && store.solved.has(num) && store.scores.get(1) === 3 && store.bestRecords.get(1) === 'abc',
      'another device\'s rooms reach the running game (`!kvs`), and its own stay');
    check(store.playTime.get(1) === 60_000 && store.playTime.get(num) === ownZaval && ownZaval > 0,
      '...and its play time adds to this device\'s');
    check((JSON.parse(defaults()['ff.solved']!) as number[]).includes(2), '...and NSUserDefaults');

    // ── The worst case measured: every room solved, a heavy save in 24 rooms.
    const best: Record<number, string> = {};
    ROOMS.forEach((r, i) => {
      const s = solutionFor(r.jmeno);
      if (s.known === 'ok') best[i + 1] = s.moves;
    });
    const bestJson = JSON.stringify(best);
    t = __native.now();
    localStorage.setItem('ff.best', bestJson);
    for (let r = 1; r <= 24; r++) localStorage.setItem(`ff.save.${r}`, full);
    const each = (__native.now() - t) / 25;
    const size = utf8Length(__native.prefsLoad(false)!);
    check(size <= TV_BUDGET + 2_000 && size <= PREFS_LIMIT && defaults()['ff.best'] === bestJson,
      `every room's best and 24 heavy saves: NSUserDefaults holds ${size} bytes (budget ${TV_BUDGET}), progress whole; ${each.toFixed(0)} ms a write`);

    // ── The stand-ins refuse what tvOS and iCloud refuse.
    const throws = (f: () => void): boolean => {
      try {
        f();
        return false;
      } catch {
        return true;
      }
    };
    check(throws(() => __native.prefsSave('x'.repeat(PREFS_LIMIT + 1), true)), 'NSUserDefaults refuses more than 500 000 bytes');
    check(throws(() => __native.kvsSave(`${KVS_PREFIX}${'k'.repeat(128)}`, 'v')) && throws(() => __native.kvsSave(`${KVS_PREFIX}big`, 'x'.repeat(1_000_001))),
      'iCloud refuses a key over 128 characters and a value over 1 MB');
  } catch (e) {
    if (!(e instanceof StoreSmokeFailure)) console.log(`  FAIL ${e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)}`);
    console.log(`store smoke: FAILED after ${n} checks`);
    return 1;
  }
  console.log(`store smoke: ${n} checks passed in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}
