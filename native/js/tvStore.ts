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
 * Both local copies carry a write number, and every write goes to the defaults first and then
 * to the cache with the same number. So at launch the cache is used whenever its number is
 * not older: the same write (it is the fuller copy), or a newer one — which can only mean
 * NSUserDefaults lost writes the cache kept (it reaches the disk asynchronously, the cache is
 * fsynced: a power cut after a save). A cache OLDER than the defaults missed a write (a
 * failed cache write, or a crash between the two) and is not trusted over them.
 *
 * The host does the I/O (`TvBackend`); everything here is pure, so the unit tests run it over
 * fakes, and on a Mac `--tv-store DIR` runs it over files that stand in for both
 * (`native/host/store.c`).
 */
import { budgetView, isSlotKey, utf8Length, type CompactCache } from './storeBudget.js';
import { KVS_PREFIX, LIVE, MIRRORED, decodeCopy, encodeCopy, flatten, isMirrored, mergeAll, mergePlayTimes, mergeProgress, type Copy, type Progress } from './progressSync.js';

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

/** What a local copy carries beside the items: see the fields of `TvStore`. */
interface Meta {
  seq: number;
  device: string;
  mtime: Record<string, number>;
  fields: Record<string, number>;
  others: Record<string, number>;
}
interface Blob extends Meta { items: Map<string, string> }

const numbers = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
};

function parseBlob(raw: string | null): Blob | null {
  if (raw === null) return null;
  try {
    const d = JSON.parse(raw) as Partial<{ v: number; seq: number; device: string; mtime: unknown; fields: unknown; others: unknown; items: Record<string, unknown> }>;
    if (!d || d.v !== 1 || typeof d.seq !== 'number' || !d.items || typeof d.items !== 'object') return null;
    return {
      seq: d.seq,
      device: typeof d.device === 'string' ? d.device : '',
      mtime: numbers(d.mtime),
      fields: numbers(d.fields),
      others: numbers(d.others),
      items: new Map(Object.entries(d.items).map(([k, v]) => [k, String(v)])),
    };
  } catch {
    return null;
  }
}

const blob = (b: Blob): string => JSON.stringify({
  v: 1, seq: b.seq, device: b.device, mtime: b.mtime, fields: b.fields, others: b.others, items: Object.fromEntries(b.items),
});

const playtimeOf = (raw: string | undefined): Record<string, number> => {
  try {
    return numbers(raw === undefined ? undefined : JSON.parse(raw));
  } catch {
    return {};
  }
};

export class TvStore {
  items = new Map<string, string>();
  /** Per mirrored key, when it was last written here. */
  private mtime: Record<string, number> = {};
  /** Per `ff.options` field (`volume.music`), when the player last changed it, here or elsewhere. */
  private fields: Record<string, number> = {};
  /** Per room, the play time `ff.playtime` holds from OTHER devices: the rest is this one's own. */
  private others: Record<string, number> = {};
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
    const base = cache && (!prefs || cache.seq >= prefs.seq) ? cache : prefs;
    if (prefs && cache && cache.seq > prefs.seq) {
      this.host.log(`store: the cache (write ${cache.seq}) is newer than NSUserDefaults (write ${prefs.seq}), which lost writes; using the cache`);
    } else if (prefs && cache && cache.seq < prefs.seq) {
      this.host.log(`store: the cache (write ${cache.seq}) is older than NSUserDefaults (write ${prefs.seq}); using NSUserDefaults`);
    }
    this.items = base ? base.items : new Map();
    this.mtime = { ...base?.mtime };
    this.fields = { ...base?.fields };
    this.others = { ...base?.others };
    this.seq = Math.max(prefs?.seq ?? 0, cache?.seq ?? 0);
    this.device = base?.device || prefs?.device || newDeviceId(this.host.now());
    const merged = this.adopt(this.merged(), MIRRORED);
    // Write once if anything came from elsewhere, or the defaults copy is missing, damaged or behind.
    if (merged.length || (base && base !== prefs && (!prefs || base.seq > prefs.seq))) {
      try {
        this.persist();
      } catch {
        /* logged by persist; the store is loaded, and the game must start */
      }
    }
    return this.items;
  }

  set(key: string, value: string): void {
    const next = new Map(this.items);
    next.set(key, value);
    const view = budgetView(next, { budget: this.budget, slotCap: this.slotCap, writing: isSlotKey(key) ? key : undefined }, this.compact);
    const now = this.host.now();
    if (key === 'ff.options') this.stampFields(this.items.get(key), value, now);
    this.items = next;
    if (isMirrored(key)) this.mtime[key] = now;
    this.persist(view);
  }

  remove(key: string): void {
    if (!this.items.delete(key)) return;
    delete this.mtime[key];
    if (key === 'ff.options') this.fields = {};
    if (key === 'ff.playtime') this.others = {};
    this.persist();
  }

  clear(): void {
    this.items.clear();
    this.mtime = {};
    this.fields = {};
    this.others = {};
    this.persist();
  }

  /**
   * Take in another device's progress while the game runs (the host's `!kvs` event, from
   * iCloud's change notification). The progress keys only: options apply at the next launch,
   * as a running game holds its own. Returns the keys that changed.
   */
  pullRemote(): string[] {
    const changed = this.adopt(this.merged(), LIVE);
    if (changed.length) this.persist();
    return changed;
  }

  /**
   * Which options fields the player changed: those that differ from the value before. A first
   * write — nothing before it, as on a new device's first-run intro — changes no field: its
   * values are the defaults, and must not outweigh settings made on another device. Nor does
   * a field the value before did not have (one a newer version adds, written as its default).
   * A change is stamped later than the field's current stamp even if this clock is behind the
   * device that stamped it: the newest change is the one made last HERE.
   */
  private stampFields(before: string | undefined, after: string, now: number): void {
    if (before === undefined) {
      this.fields = {};
      return;
    }
    let a: Record<string, unknown>;
    let b: Record<string, unknown>;
    try {
      a = flatten(JSON.parse(before));
      b = flatten(JSON.parse(after));
    } catch {
      return;
    }
    for (const path of Object.keys(b)) {
      if (path in a && JSON.stringify(a[path]) !== JSON.stringify(b[path])) this.fields[path] = Math.max(now, (this.fields[path] ?? 0) + 1);
    }
    for (const path of Object.keys(this.fields)) if (!(path in b)) delete this.fields[path];
  }

  private local(): Progress {
    const p: Progress = {};
    for (const k of MIRRORED) {
      const v = this.items.get(k);
      if (v !== undefined) p[k] = { v, t: this.mtime[k] ?? 0, ...(k === 'ff.options' ? { f: { ...this.fields } } : {}) };
    }
    return p;
  }

  /** This device's own play time per room: `ff.playtime` less what came from the others. */
  private ownPlay(): Record<string, number> {
    const own: Record<string, number> = {};
    for (const [r, n] of Object.entries(playtimeOf(this.items.get('ff.playtime')))) own[r] = Math.max(0, n - (this.others[r] ?? 0));
    return own;
  }

  /**
   * Every copy merged with this one, play time made the sum of every device's own: `ff.playtime`
   * is replaced by it, in this store's room order, with `others` what of it is not this
   * device's (taken on only if that value is adopted). A copy that knows more of this device's
   * time than the store does (a store rolled back) is believed: a device's own time only grows.
   */
  private merged(kvs = this.kvs()): Copy & { others: Record<string, number> } {
    const { p, pt } = mergeAll(this.local(), kvs);
    const mine = { ...pt[this.device] };
    for (const [r, n] of Object.entries(this.ownPlay())) mine[r] = Math.max(mine[r] ?? 0, n);
    pt[this.device] = mine;
    // Never below what the store holds: an iCloud that reads empty or lacks a device's copy
    // (signed out, another account, an error) must not take that device's time away; the
    // part it no longer accounts for stays with the others.
    const local = playtimeOf(this.items.get('ff.playtime'));
    const total: Record<string, number> = {};
    for (const r of Object.keys(local)) total[r] = 0;
    for (const rooms of Object.values(pt)) for (const [r, n] of Object.entries(rooms)) total[r] = (total[r] ?? 0) + n;
    const others: Record<string, number> = {};
    if (Object.keys(total).length) {
      for (const r of Object.keys(total)) {
        total[r] = Math.max(total[r]!, local[r] ?? 0);
        const rest = Math.max(this.others[r] ?? 0, total[r]! - (mine[r] ?? 0));
        if (rest > 0) others[r] = rest;
      }
      p['ff.playtime'] = { v: JSON.stringify(total), t: p['ff.playtime']?.t ?? 0 };
    }
    return { p, pt, others };
  }

  private adopt(merged: Copy & { others: Record<string, number> }, keys: readonly string[]): string[] {
    const changed: string[] = [];
    for (const k of keys) {
      const m = merged.p[k];
      if (!m || m.v === this.items.get(k)) continue;
      this.items.set(k, m.v);
      this.mtime[k] = m.t;
      if (k === 'ff.options') this.fields = { ...m.f };
      if (k === 'ff.playtime') this.others = merged.others;
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
    const meta: Meta = { seq: this.seq, device: this.device, mtime: this.mtime, fields: this.fields, others: this.others };
    const prefs = blob({ ...meta, items: view.items });
    const size = utf8Length(prefs);
    // A failed defaults write still writes the cache (with this write's number, so the next
    // launch trusts it over the older defaults copy) and iCloud — then throws, as the file
    // store does, so the game sees a failed write.
    let failed: unknown = null;
    try {
      if (size > PREFS_LIMIT) throw new Error(`store: ${size} bytes is over the ${PREFS_LIMIT}-byte NSUserDefaults limit`);
      this.host.prefsSave(prefs);
    } catch (e) {
      failed = e;
      this.host.log(`store: NSUserDefaults not written (${(e as Error).message}); the cache will be`);
    }
    this.last = { bytes: size, progressBytes: view.progressBytes, trimmed: view.trimmed, dropped: view.dropped };
    if (view.dropped.length) this.host.log(`store: kept progress over save slots; left out of NSUserDefaults: ${view.dropped.join(', ')}`);
    this.push();
    try {
      this.host.cacheSave(blob({ ...meta, items: this.items }));
    } catch (e) {
      this.host.log(`store: the cache was not written (${(e as Error).message})`);
    }
    if (failed) throw failed;
  }

  /** This device's copy to iCloud: the merge of every copy, so the others can be retired. */
  private push(): void {
    const kvs = this.kvs();
    const merged = this.merged(kvs);
    const own = encodeCopy({ p: merged.p, pt: merged.pt });
    const ownKey = KVS_PREFIX + this.device;
    try {
      if (kvs[ownKey] !== own) this.host.kvsSave(ownKey, own);
      // Near the 1 MB: remove the copies this one already holds everything of.
      let total = utf8Length(own);
      for (const [k, v] of Object.entries(kvs)) if (k !== ownKey) total += utf8Length(v);
      if (total <= KVS_SOFT_LIMIT) return;
      for (const [k, v] of Object.entries(kvs)) {
        if (k === ownKey || !k.startsWith(KVS_PREFIX)) continue;
        const theirs = decodeCopy(v);
        if (encodeCopy({ p: mergeProgress(merged.p, theirs.p), pt: mergePlayTimes(merged.pt, theirs.pt) }) === own) this.host.kvsSave(k, null);
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
