/**
 * What of the store tvOS keeps for certain: the budget policy over `localStorage`'s keys.
 *
 * tvOS gives an app 500 KB of persistent local storage, through `NSUserDefaults`; anything
 * else on the device is a cache the system may empty while the app is not running (Apple,
 * "App Programming Guide for tvOS", "Local Storage for Your App Is Limited"). The game's
 * store does not fit that as it is: measured on every recorded solution (`native/README.md`,
 * "Saves on tvOS"), progress is ~52 KB with every room solved, but one save slot carries its
 * undo history and a slot at the end of ZAVAL's solution is ~121 KB — a save in every room is
 * ~1.4 MB, and a long session in one room grows without bound.
 *
 * So the persisted copy is a COMPACTED view of the store, and the game is not told:
 *   - Progress — every key that is not a save slot (`ff.solved`, `ff.best`, `ff.options`,
 *     ...) — is kept as it is, always, and before anything else.
 *   - A save slot keeps its move record and script state whole. Its undo history is what
 *     yields, as it already yields in `saveGame` when a browser refuses a write: the OLDEST
 *     points are dropped until the slot fits `slotCap`, so a load still steps back through
 *     the moves that reached the save, only not all the way.
 *   - If the whole view is still over `budget`, the other slots lose their history,
 *     largest first; only then, a write of progress drops whole slots from the persisted
 *     copy (largest first, never progress), and a write of a slot is refused — the
 *     `QuotaExceededError` a browser would throw, which `saveGame` already handles.
 *
 * Pure: no host, no globals — the unit tests run it under V8 and the store smoke under QuickJS.
 */
import { decodeUndoHistory, encodeUndoHistory } from '../../src/core/undoStack.js';

/** A save slot: `ff.save.<room>` (`saveKey` in `game.ts`, restating `main.ts`). */
export const isSlotKey = (key: string): boolean => /^ff\.save\.\d+$/.test(key);

/** UTF-8 byte length, without a TextEncoder (QuickJS has none here). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** What one entry costs inside the persisted JSON object: `"key":"value",`. */
export const entryBytes = (key: string, value: string): number =>
  utf8Length(JSON.stringify(key)) + utf8Length(JSON.stringify(value)) + 2;

export interface CompactSlot {
  /** The slot as it is persisted: the original, or with fewer (or no) undo points. */
  value: string;
  /** The slot with no undo history at all: the least it can be cut to. */
  bare: string;
  /** Undo points kept, and how many the slot had. */
  kept: number;
  points: number;
}

/**
 * Cut a slot's undo history to its newest points until the slot fits `cap` bytes (as an
 * entry of `key`). A legacy plain-record slot, or one that is not JSON, is left alone.
 */
export function compactSlot(key: string, raw: string, cap: number): CompactSlot {
  const whole = { value: raw, bare: raw, kept: 0, points: 0 };
  if (!raw.trimStart().startsWith('{')) return whole;
  let slot: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return whole;
    slot = parsed as Record<string, unknown>;
  } catch {
    return whole;
  }
  const { undo, ...rest } = slot;
  const bare = undo == null ? raw : JSON.stringify(rest);
  const history = undo == null ? [] : decodeUndoHistory(undo);
  const fits = (v: string): boolean => entryBytes(key, v) <= cap;
  if (fits(raw)) return { value: raw, bare, kept: history.length, points: history.length };
  if (history.length < 2) return { value: bare, bare, kept: 0, points: history.length };
  const withNewest = (k: number): string => JSON.stringify({ ...slot, undo: encodeUndoHistory(history.slice(-k)) });
  // The largest k that fits, by bisection: the size grows with k, if not strictly.
  let lo = 1; // 1 point is no history (encodeUndoHistory stores null): always "fits" as bare
  let hi = history.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(withNewest(mid))) lo = mid;
    else hi = mid - 1;
  }
  return lo < 2 ? { value: bare, bare, kept: 0, points: history.length }
    : { value: withNewest(lo), bare, kept: lo, points: history.length };
}

export interface BudgetOptions {
  /** The persisted copy's size limit, in bytes of its JSON (`TV_BUDGET`). */
  budget: number;
  /** One slot's size limit before its history yields (`TV_SLOT_CAP`). */
  slotCap: number;
  /** The slot being written now: refused, not dropped, if even bare it does not fit. */
  writing?: string | undefined;
}

export interface BudgetView {
  /** What to persist, in the store's own key order. */
  items: Map<string, string>;
  /** Its JSON's size in bytes (the object's braces included). */
  bytes: number;
  /** Progress alone, in bytes. */
  progressBytes: number;
  /** Slots persisted with less undo history than the store holds. */
  trimmed: string[];
  /** Slots left out of the persisted copy entirely (only ever to keep progress). */
  dropped: string[];
}

/** The slot being written does not fit even without its history: a browser's quota error. */
export class QuotaExceededError extends Error {
  override readonly name = 'QuotaExceededError';
}

/** Memo for `compactSlot`, per key and per value: a flush re-encodes only what changed. */
export type CompactCache = Map<string, { raw: string; cap: number; c: CompactSlot }>;

/**
 * The persisted view of `items` under `o.budget`. Throws `QuotaExceededError` only when
 * `o.writing` is a slot that cannot fit even without its history and with every other
 * slot cut to bare; progress is never cut and never refused.
 */
export function budgetView(items: ReadonlyMap<string, string>, o: BudgetOptions, cache: CompactCache = new Map()): BudgetView {
  let progressBytes = 2; // {}
  const slots = new Map<string, CompactSlot>();
  for (const [k, v] of items) {
    if (!isSlotKey(k)) {
      progressBytes += entryBytes(k, v);
      continue;
    }
    const hit = cache.get(k);
    const c = hit && hit.raw === v && hit.cap === o.slotCap ? hit.c : compactSlot(k, v, o.slotCap);
    cache.set(k, { raw: v, cap: o.slotCap, c });
    slots.set(k, c);
  }
  for (const k of [...cache.keys()]) if (!items.has(k)) cache.delete(k);

  const chosen = new Map<string, string>();
  let bytes = progressBytes;
  for (const [k, c] of slots) {
    chosen.set(k, c.value);
    bytes += entryBytes(k, c.value);
  }
  const size = (k: string): number => entryBytes(k, chosen.get(k)!);
  const largestFirst = (keys: string[]): string[] => keys.sort((a, b) => size(b) - size(a) || (a < b ? -1 : 1));
  // Over budget: the other slots' histories go first, largest first...
  if (bytes > o.budget) {
    for (const k of largestFirst([...slots.keys()].filter((k) => k !== o.writing))) {
      if (bytes <= o.budget) break;
      const bare = slots.get(k)!.bare;
      bytes += entryBytes(k, bare) - size(k);
      chosen.set(k, bare);
    }
  }
  // ...then the slot being written, down to bare...
  if (bytes > o.budget && o.writing && slots.has(o.writing)) {
    const bare = slots.get(o.writing)!.bare;
    bytes += entryBytes(o.writing, bare) - size(o.writing);
    chosen.set(o.writing, bare);
    if (bytes > o.budget) {
      throw new QuotaExceededError(`${o.writing} does not fit the ${o.budget}-byte store even without its undo history`);
    }
  }
  // ...and a progress write that still does not fit pushes whole slots out of this copy.
  const dropped: string[] = [];
  if (bytes > o.budget) {
    for (const k of largestFirst([...chosen.keys()])) {
      if (bytes <= o.budget) break;
      bytes -= size(k);
      chosen.delete(k);
      dropped.push(k);
    }
  }
  const out = new Map<string, string>();
  const trimmed: string[] = [];
  for (const [k, v] of items) {
    if (!isSlotKey(k)) out.set(k, v);
    else if (chosen.has(k)) {
      out.set(k, chosen.get(k)!);
      if (chosen.get(k) !== v) trimmed.push(k);
    }
  }
  // entryBytes counts a comma per entry; the JSON has one fewer.
  return { items: out, bytes: bytes - (out.size ? 1 : 0), progressBytes, trimmed, dropped };
}
