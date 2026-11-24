/**
 * The store on tvOS: `localStorage`'s keys kept where tvOS keeps things (`native/README.md`,
 * "Saves on tvOS").
 *
 *   NSUserDefaults  the copy that lasts: progress whole, save slots within the budget
 *                   (`storeBudget.ts`). Written first, on every change; a failure is thrown,
 *                   as the file store's is.
 *   iCloud KVS      this device's copy of the progress (`progressSync.ts`), merged with every
 *                   other device's at launch, and when one arrives (`pullRemote`). Survives a
 *                   reinstall; another Apple TV on the same account shares it.
 *   the cache file  the whole store, undo histories and all: the host's store file, which on
 *                   tvOS SDL puts in Caches (`SDL_GetPrefPath`), where the system may delete
 *                   it while the app is not running. While it is there a load resumes exactly
 *                   what was saved; when it is gone, the defaults copy is what is left.
 *
 * Both local copies carry a sequence number. At launch the cache is used only when it is
 * the SAME write as the defaults copy — the defaults are written first, so a cache from
 * before the last write (or after a crash between the two) is never trusted over them.
 *
 * The host does the I/O (`TvBackend`); everything here is pure, so the unit tests run it over
 * fakes, and on a Mac `--tv-store DIR` runs it over files that stand in for both
 * (`native/host/store.c`).
 */
import { budgetView, isSlotKey, utf8Length, type CompactCache } from './storeBudget.js';
import { KVS_PREFIX, LIVE, MIRRORED, decodeCopy, encodeCopy, isMirrored, mergeAll, mergeProgress, type Progress } from './progressSync.js';

/** The defaults copy's budget: under the 500 KB tvOS allows, with room for its wrapper. */
export const TV_BUDGET = 400_000;
/** One save slot's size before its undo history yields. */
export const TV_SLOT_CAP = 32_768;
/** NSUserDefaults' limit on tvOS, which the Mac stand-in enforces too. */
export const PREFS_LIMIT = 500_000;
/** Past this many bytes of copies in the key-value store (1 MB), dominated ones are removed. */
export const KVS_SOFT_LIMIT = 900_000;

export interface TvBackend {
  /** The NSUserDefaults copy (`damaged`: the copy set aside when it could not be read). */
  prefsLoad(damaged?: boolean): string | null;
  prefsSave(json: string, damaged?: boolean): void;
  /** The cache file, or (`backup`) its previous version; the host's `storeLoad/storeSave`. */
  cacheLoad(backup?: boolean): string | null;
  cacheSave(json: string): void;
  /** Every `ff4e.` key in the key-value store. */
  kvsLoad(): Record<string, string>;
  /** Set a key, or remove it (`null`). Throws over the store's limits. */
  kvsSave(key: string, value: string | null): void;
  now(): number;
  log(message: string): void;
}

interface Blob {
  seq: number;
  device: string;
  mtime: Record<string, number>;
  items: Map<string, string>;
}

function parseBlob(raw: string | null): Blob | null {
  if (raw === null) return null;
  try {
    const d = JSON.parse(raw) as Partial<{ v: number; seq: number; device: string; mtime: Record<string, number>; items: Record<string, unknown> }>;
    if (!d || d.v !== 1 || typeof d.seq !== 'number' || !d.items || typeof d.items !== 'object') return null;
    return {
      seq: d.seq,
      device: typeof d.device === 'string' ? d.device : '',
      mtime: d.mtime && typeof d.mtime === 'object' ? { ...d.mtime } : {},
      items: new Map(Object.entries(d.items).map(([k, v]) => [k, String(v)])),
    };
  } catch {
    return null;
  }
}

const blob = (b: Blob): string =>
  JSON.stringify({ v: 1, seq: b.seq, device: b.device, mtime: b.mtime, items: Object.fromEntries(b.items) });

export class TvStore {
  items = new Map<string, string>();
  private mtime: Record<string, number> = {};
  private seq = 0;
  private device = '';
  private readonly compact: CompactCache = new Map();
  /** What the last write persisted, for the smoke and the tests. */
  last: { bytes: number; progressBytes: number; trimmed: string[]; dropped: string[] } | null = null;

  constructor(private readonly host: TvBackend, private readonly budget = TV_BUDGET, private readonly slotCap = TV_SLOT_CAP) {}

  /** Read the copies, take in the other devices' progress, and return the store. */
  load(): Map<string, string> {
    const rawPrefs = this.host.prefsLoad();
    const prefs = parseBlob(rawPrefs);
    if (rawPrefs !== null && !prefs) {
      // Kept, not overwritten: whatever it held is set aside under its own key.
      this.host.log('store: the NSUserDefaults copy is unreadable; set aside as ff4e.store.damaged');
      this.host.prefsSave(rawPrefs, true);
    }
    const cache = parseBlob(this.host.cacheLoad()) ?? parseBlob(this.host.cacheLoad(true));
    const base = prefs && cache && cache.seq === prefs.seq ? cache : prefs ?? cache;
    if (prefs && base !== prefs && cache) this.host.log(`store: the cache (write ${cache.seq}) is not the defaults copy's (write ${prefs.seq}); using the defaults`);
    this.items = base ? base.items : new Map();
    this.mtime = { ...(prefs ?? cache)?.mtime };
    this.seq = Math.max(prefs?.seq ?? 0, cache?.seq ?? 0);
    this.device = prefs?.device || cache?.device || newDeviceId(this.host.now());
    const merged = this.adopt(mergeAll(this.local(), this.kvs()), MIRRORED);
    // Write once if anything came from elsewhere, or the defaults copy is missing or damaged.
    if (merged.length || (base && !prefs)) this.persist();
    return this.items;
  }

  set(key: string, value: string): void {
    const next = new Map(this.items);
    next.set(key, value);
    const view = budgetView(next, { budget: this.budget, slotCap: this.slotCap, writing: isSlotKey(key) ? key : undefined }, this.compact);
    this.items = next;
    if (isMirrored(key)) this.mtime[key] = this.host.now();
    this.persist(view);
  }

  remove(key: string): void {
    if (!this.items.delete(key)) return;
    delete this.mtime[key];
    this.persist();
  }

  clear(): void {
    this.items.clear();
    this.mtime = {};
    this.persist();
  }

  /**
   * Take in another device's progress while the game runs (the host's `!kvs` event, from
   * iCloud's change notification). The progress keys only: options apply at the next launch,
   * as a running game holds its own. Returns the keys that changed.
   */
  pullRemote(): string[] {
    const changed = this.adopt(mergeAll(this.local(), this.kvs()), LIVE);
    if (changed.length) this.persist();
    return changed;
  }

  private local(): Progress {
    const p: Progress = {};
    for (const k of MIRRORED) {
      const v = this.items.get(k);
      if (v !== undefined) p[k] = { v, t: this.mtime[k] ?? 0 };
    }
    return p;
  }

  private adopt(merged: Progress, keys: readonly string[]): string[] {
    const changed: string[] = [];
    for (const k of keys) {
      const m = merged[k];
      if (!m || m.v === this.items.get(k)) continue;
      this.items.set(k, m.v);
      this.mtime[k] = m.t;
      changed.push(k);
    }
    return changed;
  }

  private kvs(): Record<string, string> {
    try {
      return this.host.kvsLoad();
    } catch (e) {
      this.host.log(`store: iCloud unreadable: ${(e as Error).message}`);
      return {};
    }
  }

  private persist(view = budgetView(this.items, { budget: this.budget, slotCap: this.slotCap }, this.compact)): void {
    this.seq++;
    const prefs = blob({ seq: this.seq, device: this.device, mtime: this.mtime, items: view.items });
    const size = utf8Length(prefs);
    if (size > PREFS_LIMIT) throw new Error(`store: ${size} bytes is over the ${PREFS_LIMIT}-byte NSUserDefaults limit`);
    this.host.prefsSave(prefs);
    this.last = { bytes: size, progressBytes: view.progressBytes, trimmed: view.trimmed, dropped: view.dropped };
    if (view.dropped.length) this.host.log(`store: kept progress over save slots; left out of NSUserDefaults: ${view.dropped.join(', ')}`);
    this.push();
    try {
      this.host.cacheSave(blob({ seq: this.seq, device: this.device, mtime: this.mtime, items: this.items }));
    } catch (e) {
      this.host.log(`store: the cache was not written (${(e as Error).message}); the defaults copy was`);
    }
  }

  /** This device's copy to iCloud: the merge of every copy, so the others can be retired. */
  private push(): void {
    const kvs = this.kvs();
    const merged = mergeAll(this.local(), kvs);
    const own = encodeCopy(merged);
    const ownKey = KVS_PREFIX + this.device;
    try {
      if (kvs[ownKey] !== own) this.host.kvsSave(ownKey, own);
      // Near the 1 MB: remove the copies this one already holds everything of.
      let total = utf8Length(own);
      for (const [k, v] of Object.entries(kvs)) if (k !== ownKey) total += utf8Length(v);
      if (total <= KVS_SOFT_LIMIT) return;
      for (const [k, v] of Object.entries(kvs)) {
        if (k === ownKey || !k.startsWith(KVS_PREFIX)) continue;
        if (encodeCopy(mergeProgress(merged, decodeCopy(v))) === own) this.host.kvsSave(k, null);
      }
    } catch (e) {
      this.host.log(`store: iCloud not written (${(e as Error).message}); the local copy was`);
    }
  }
}

function newDeviceId(now: number): string {
  let s = now.toString(36);
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  return s;
}
