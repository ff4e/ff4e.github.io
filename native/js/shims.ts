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
// small, and a whole-file write keeps a crash from leaving half a store behind.
class StorageShim {
  private items: Map<string, string> | null = null;
  private map(): Map<string, string> {
    if (!this.items) {
      const raw = __native.storeLoad();
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      this.items = new Map(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    }
    return this.items;
  }
  private flush(): void {
    __native.storeSave(JSON.stringify(Object.fromEntries(this.map())));
  }
  get length(): number { return this.map().size; }
  key(i: number): string | null { return [...this.map().keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map().get(k) ?? null; }
  setItem(k: string, v: string): void { this.map().set(k, String(v)); this.flush(); }
  removeItem(k: string): void { if (this.map().delete(k)) this.flush(); }
  clear(): void { this.map().clear(); this.flush(); }
}
g.localStorage = new StorageShim();

/** Read a file through the same door `fetch` uses (for the FFR room data). */
export async function readBytes(url: string): Promise<Uint8Array> {
  const buf = __native.readFile(url);
  if (!buf) throw new Error(`missing ${url}`);
  return new Uint8Array(buf);
}
