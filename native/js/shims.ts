/**
 * The handful of browser APIs the reused game modules touch, implemented over the
 * native host. Imported FIRST by the native entry, so they exist before any game module
 * is evaluated (three of those build a `TextDecoder` at module scope).
 *
 * Scope is deliberately the spike's: `fetch` reads files, `createImageBitmap` decodes
 * WebP straight to a GPU texture, and timers run on the host's frame clock. Nothing here
 * is a general browser.
 */
import { rememberBitmapSource, type NativeBitmap } from './nativeCanvas.js';
import { TvStore, type TvBackend } from './tvStore.js';

declare const __CP1250_HIGH__: string;

const g = globalThis as Record<string, unknown>;

// ── console / performance ──────────────────────────────────────────────────────────
const fmt = (a: unknown): string => {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
  try { return JSON.stringify(a); } catch { return String(a); }
};
const log = (...a: unknown[]): void => __native.print(a.map(fmt).join(' '));
g.console = { log, info: log, warn: log, error: log, debug: () => {} };
g.performance = { now: () => __native.now() };

// ── TextDecoder (utf-8 via the host; windows-1250 from a build-time table) ────────────
class TextDecoderShim {
  readonly encoding: string;
  constructor(label = 'utf-8') { this.encoding = label.toLowerCase(); }
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return '';
    const u8 = input instanceof Uint8Array ? input
      : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
    if (this.encoding === 'windows-1250') {
      let s = '';
      for (let i = 0; i < u8.length; i++) {
        const b = u8[i]!;
        s += b < 0x80 ? String.fromCharCode(b) : __CP1250_HIGH__[b - 0x80];
      }
      return s;
    }
    const copy = u8.slice().buffer;
    return __native.utf8(copy);
  }
}
g.TextDecoder = TextDecoderShim;

// ── Timers, run from the host's frame loop (see runTimers) ────────────────────────────
interface Timer { id: number; at: number; fn: () => void }
let timers: Timer[] = [];
let nextTimer = 1;
g.setTimeout = (fn: () => void, ms = 0): number => {
  const id = nextTimer++;
  timers.push({ id, at: __native.now() + ms, fn });
  return id;
};
g.clearTimeout = (id: number): void => { timers = timers.filter((t) => t.id !== id); };
export function runTimers(): void {
  const now = __native.now();
  const due = timers.filter((t) => t.at <= now);
  if (!due.length) return;
  timers = timers.filter((t) => t.at > now);
  for (const t of due) t.fn();
}

// ── AbortController (the loader arms one per request; nothing here ever aborts) ──────
class AbortSignalShim {
  aborted = false;
  reason: unknown = undefined;
  static any(signals: AbortSignalShim[]): AbortSignalShim {
    const s = new AbortSignalShim();
    s.aborted = signals.some((x) => x.aborted);
    return s;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}
g.AbortSignal = AbortSignalShim;
g.AbortController = class {
  readonly signal = new AbortSignalShim();
  abort(reason?: unknown): void { this.signal.aborted = true; this.signal.reason = reason; }
};

// ── fetch over the asset root ─────────────────────────────────────────────────────────
interface BlobShim { readonly __bytes: ArrayBuffer; readonly type: string; readonly size: number }
const TYPES: Record<string, string> = { json: 'application/json', webp: 'image/webp', png: 'image/png' };

g.fetch = async (url: string): Promise<unknown> => {
  const path = url.split('?')[0]!;
  const buf = __native.readFile(path);
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const type = TYPES[ext] ?? 'application/octet-stream';
  return {
    ok: buf !== null,
    status: buf !== null ? 200 : 404,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' && buf ? type : null) },
    arrayBuffer: async () => buf!,
    blob: async (): Promise<BlobShim> => ({ __bytes: buf!, type, size: buf!.byteLength }),
    text: async () => __native.utf8(buf!),
    json: async () => JSON.parse(__native.utf8(buf!)),
  };
};

// ── createImageBitmap: WebP → GPU texture. The "bitmap" IS the texture handle. ───────
// The WebP bytes are kept beside it: the few bitmaps a scratch canvas draws (a mirror's
// glass, LODE's wreck) are decoded again to CPU pixels when that happens.
g.createImageBitmap = async (blob: BlobShim): Promise<NativeBitmap> => {
  if (blob.type !== 'image/webp') throw new Error(`spike decodes WebP only, got ${blob.type}`);
  const t = __native.decodeWebp(blob.__bytes);
  const bmp = { id: t.id, width: t.width, height: t.height, close: () => __native.releaseTexture(t.id) };
  rememberBitmapSource(bmp, blob.__bytes);
  return bmp;
};

// ── localStorage over the host's key-value file ───────────────────────────────────────
// `persist.ts` (solved rooms, scores, best records, play time), the save slots and the save
// migration all speak localStorage. Natively it is one JSON object in a file the host owns
// (`__native.storeLoad/storeSave`: the user's app-support dir, or `--store <path>`), read on
// first use — so a run that never touches it (compare.mjs) never opens the file — and
// rewritten whole on every change. Writes are rare (a solve, a save, leaving a room) and
// small; the host writes each one durably and keeps the previous store as a backup.
//
// An unreadable store is never papered over. `persist.ts` catches storage errors (a browser
// can refuse localStorage), so a throw from here alone would let the game run on, saving
// nothing — or, worse, overwrite the damaged file with an empty one. So `loadStore()` is
// called explicitly before the game opens its save store: it falls back to the backup
// when the store is damaged, and refuses to start when both are; and a refused store is
// never written.
//
// On tvOS (and on a Mac given `--tv-store DIR`) the store is `TvStore` instead: NSUserDefaults,
// iCloud and a cache file, because tvOS keeps no file for certain (`tvStore.ts`).

/** The parsed store, or why it is not usable. */
function parseStore(raw: string | null): Map<string, string> | string {
  if (raw === null) return 'missing';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'not a JSON object';
    return new Map(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  } catch (e) {
    return raw.trim() === '' ? 'empty' : `not JSON (${(e as Error).message})`;
  }
}

/** The host's side of `TvStore`: NSUserDefaults and iCloud on tvOS, files on a Mac. */
export const tvHost: TvBackend = {
  prefsLoad: (damaged) => __native.prefsLoad(!!damaged),
  prefsSave: (json, damaged) => __native.prefsSave(json, !!damaged),
  cacheLoad: (backup) => __native.storeLoad(!!backup),
  cacheSave: (json) => __native.storeSave(json, false),
  kvsLoad: () => JSON.parse(__native.kvsLoad()) as Record<string, string>,
  kvsSave: (key, value) => __native.kvsSave(key, value),
  now: () => Date.now(),
  log: (m) => console.warn(m),
};

class StorageShim {
  private readonly tv = __native.tvStore ? new TvStore(tvHost) : null;
  private items: Map<string, string> | null = null;
  private refused: string | null = null;
  /** Running from the backup: the store on disk is the damaged one, not a backup to keep. */
  private damaged = false;
  /** Read the store (see above). Throws, and disables every later write, if it is unusable. */
  load(): void {
    if (this.items) return;
    if (this.refused) throw new Error(this.refused);
    if (this.tv) {
      this.items = this.tv.load();
      return;
    }
    const main = __native.storeLoad();
    const store = parseStore(main);
    if (typeof store !== 'string') {
      this.items = store;
      return;
    }
    const backup = parseStore(__native.storeLoad(true));
    if (typeof backup !== 'string') {
      console.warn(`store ${__native.storePath()} is ${store}: using its backup (${__native.storePath()}.bak)`);
      this.items = backup;
      this.damaged = main !== null;
      return;
    }
    if (main === null && backup === 'missing') {
      this.items = new Map(); // a first run
      return;
    }
    this.refused = `store ${__native.storePath()} is ${store} and its backup is ${backup}. ` +
      'Refusing to start rather than overwrite it: move it aside to start with no progress.';
    throw new Error(this.refused);
  }
  private map(): Map<string, string> {
    this.load();
    return this.tv ? this.tv.items : this.items!;
  }
  private flush(): void {
    __native.storeSave(JSON.stringify(Object.fromEntries(this.map())), this.damaged);
    this.damaged = false;
  }
  get length(): number { return this.map().size; }
  key(i: number): string | null { return [...this.map().keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map().get(k) ?? null; }
  setItem(k: string, v: string): void {
    if (this.tv) {
      this.load();
      this.tv.set(k, String(v)); // may refuse a save slot, as a browser's quota does
      return;
    }
    this.map().set(k, String(v));
    this.flush();
  }
  removeItem(k: string): void {
    if (this.tv) {
      this.load();
      this.tv.remove(k);
    } else if (this.map().delete(k)) this.flush();
  }
  clear(): void {
    if (this.tv) {
      this.load();
      this.tv.clear();
    } else {
      this.map().clear();
      this.flush();
    }
  }
  /** Another device's progress, taken in while running (`TvStore.pullRemote`). */
  pullRemote(): string[] {
    if (!this.tv) return [];
    this.load();
    return this.tv.pullRemote();
  }
}
const storage = new StorageShim();

/** iCloud says another device's progress changed: merge it in; the keys that changed. */
export function pullRemoteProgress(): string[] {
  return storage.pullRemote();
}

/** Open the store before anything reads it; throws (with the reason) when it is unusable. */
export function loadStore(): void {
  storage.load();
}
g.localStorage = storage;

/** Read a file through the same door `fetch` uses (for the FFR room data). */
export async function readBytes(url: string): Promise<Uint8Array> {
  const buf = __native.readFile(url);
  if (!buf) throw new Error(`missing ${url}`);
  return new Uint8Array(buf);
}
