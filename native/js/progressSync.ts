/**
 * Progress in iCloud: the merge of the copies the player's Apple TVs (and reinstalls) keep.
 *
 * iCloud's key-value store (`NSUbiquitousKeyValueStore`) holds up to 1 MB in at most 1024
 * keys, and resolves a conflict on one key by keeping the newest write. So no device ever
 * writes a key another device writes: each keeps ITS copy of the progress under its own key
 * (`ff4e.progress.<device>`), every copy is read, and the merge is ours. A device that comes
 * back after a reinstall (a new id) or after a week offline cannot overwrite anything.
 *
 * What is mirrored is progress only, never a save slot (per device, and the big part):
 *   ff.solved, ff.cheated  union
 *   ff.scores              the lowest move count per room
 *   ff.best                per room, the record of the copy with the lowest score (it is the
 *                          record OF that score: `recordBest` keeps the two in step)
 *   ff.playtime            the highest per room — never the sum: each copy already holds
 *                          the time it merged from the others, so a sum would count it twice
 *   ff.options, ff.subfont the newest write
 * A value that is not what its key should hold loses to one that is.
 *
 * The web has no merge rules to mirror: a browser's store is one copy. These follow
 * `persist.ts`'s own keep-the-best guards (`recordScore`, `recordBest`).
 */

/** The keys mirrored to iCloud. */
export const MIRRORED = ['ff.solved', 'ff.cheated', 'ff.scores', 'ff.best', 'ff.playtime', 'ff.options', 'ff.subfont'] as const;
/** The ones a running game takes in when another device's copy arrives (`pullRemote`). */
export const LIVE = ['ff.solved', 'ff.cheated', 'ff.scores', 'ff.best', 'ff.playtime'] as const;
export const isMirrored = (key: string): boolean => (MIRRORED as readonly string[]).includes(key);

/** A value and when it was last written (ms since the epoch; 0 when unknown). */
export interface Stamped { v: string; t: number }
export type Progress = Record<string, Stamped>;

/** One device's key in the key-value store. */
export const KVS_PREFIX = 'ff4e.progress.';

function json(v: string | undefined): unknown {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}
const roomList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.every((n) => Number.isInteger(n)) ? (v as number[]) : null;
const roomMap = <T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, T> = {};
  for (const [k, x] of Object.entries(v)) if (/^\d+$/.test(k) && ok(x)) out[k] = x;
  return out;
};
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const isRecord = (x: unknown): x is string => typeof x === 'string';

/** The newer of two stamped values; a tie keeps `a` (the local one, by convention). */
const newer = (a: Stamped | undefined, b: Stamped | undefined): Stamped | undefined =>
  !a ? b : !b ? a : b.t > a.t ? b : a;

/** Two parsed copies of one key; whichever is unusable gives way to the other. */
function both<T>(a: Stamped | undefined, b: Stamped | undefined, parse: (v: unknown) => T | null): [T | null, T | null] {
  return [parse(json(a?.v)), parse(json(b?.v))];
}
const stamp = (v: unknown, a: Stamped | undefined, b: Stamped | undefined): Stamped =>
  ({ v: JSON.stringify(v), t: Math.max(a?.t ?? 0, b?.t ?? 0) });

/**
 * Merge two copies of the progress. `a` wins every tie, so pass the local copy first: a
 * merge of a copy with itself, or with nothing, is that copy unchanged.
 */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const out: Progress = {};
  for (const key of MIRRORED) {
    const x = a[key];
    const y = b[key];
    if (!x && !y) continue;
    if (!x || !y) {
      out[key] = (x ?? y)!;
      continue;
    }
    if (x.v === y.v) {
      out[key] = { v: x.v, t: Math.max(x.t, y.t) };
      continue;
    }
    switch (key) {
      case 'ff.solved':
      case 'ff.cheated': {
        const [p, q] = both(x, y, roomList);
        out[key] = !p || !q ? (p ? x : y) : stamp([...new Set([...p, ...q])], x, y);
        break;
      }
      case 'ff.scores':
      case 'ff.playtime': {
        const [p, q] = both(x, y, (v) => roomMap(v, isCount));
        if (!p || !q) out[key] = p ? x : y;
        else {
          const m = { ...p };
          for (const [r, n] of Object.entries(q)) {
            if (!(r in m)) m[r] = n;
            else m[r] = key === 'ff.scores' ? Math.min(m[r]!, n) : Math.max(m[r]!, n);
          }
          out[key] = stamp(m, x, y);
        }
        break;
      }
      case 'ff.best': {
        const [p, q] = both(x, y, (v) => roomMap(v, isRecord));
        if (!p || !q) {
          out[key] = p ? x : y;
          break;
        }
        const [sp, sq] = both(a['ff.scores'], b['ff.scores'], (v) => roomMap(v, isCount));
        const m = { ...p };
        for (const [r, rec] of Object.entries(q)) {
          const mine = sp?.[r];
          const theirs = sq?.[r];
          // Theirs only where it is the record of a strictly better score, or mine is absent.
          if (!(r in m) || (theirs !== undefined && (mine === undefined || theirs < mine))) m[r] = rec;
        }
        out[key] = stamp(m, x, y);
        break;
      }
      default:
        out[key] = newer(x, y)!;
    }
  }
  return out;
}

/** One device's copy as it is kept in the key-value store. */
export function encodeCopy(p: Progress): string {
  return JSON.stringify({ v: 1, p });
}

/** A device's copy back from the key-value store; anything unrecognised is no copy. */
export function decodeCopy(raw: string | undefined): Progress {
  const d = json(raw) as { v?: unknown; p?: unknown } | undefined;
  if (!d || typeof d !== 'object' || d.v !== 1 || !d.p || typeof d.p !== 'object') return {};
  const out: Progress = {};
  for (const key of MIRRORED) {
    const s = (d.p as Record<string, unknown>)[key] as Partial<Stamped> | undefined;
    if (s && typeof s.v === 'string' && typeof s.t === 'number' && Number.isFinite(s.t)) out[key] = { v: s.v, t: s.t };
  }
  return out;
}

/** Every device's copy merged, `local` first so it wins every tie. */
export function mergeAll(local: Progress, kvs: Record<string, string>): Progress {
  let merged = local;
  for (const k of Object.keys(kvs).sort()) {
    if (k.startsWith(KVS_PREFIX)) merged = mergeProgress(merged, decodeCopy(kvs[k]));
  }
  return merged;
}
