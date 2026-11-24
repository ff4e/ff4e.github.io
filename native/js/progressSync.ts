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
 *   ff.playtime            the sum over devices of each one's OWN time per room (`PlayTimes`,
 *                          carried beside the copy): two devices playing offline add up, and
 *                          what one merged from another is never counted twice. Here, on the
 *                          stamped value alone, the highest per room — `TvStore` replaces it.
 *   ff.options             per field, the newest CHANGE: a field carries the time the player
 *                          last changed it on some device, and a first write (a new device's
 *                          first-run defaults) carries none — so it never outweighs settings
 *                          made elsewhere
 *   ff.subfont             the newest write (only ever written by the player choosing a font)
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

/**
 * A value and when it was last written (ms since the epoch; 0 when unknown). `ff.options`
 * also carries `f`: per field (`volume.music`), when the player last changed it.
 */
export interface Stamped { v: string; t: number; f?: Record<string, number> }
export type Progress = Record<string, Stamped>;
/** Play time per device, per room: each device's OWN time, which only ever grows. */
export type PlayTimes = Record<string, Record<string, number>>;
/** One device's copy: its merged progress, and every device's own play time it knows of. */
export interface Copy { p: Progress; pt: PlayTimes }

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
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stampsOf = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isPlain(v)) for (const [k, t] of Object.entries(v)) if (typeof t === 'number' && Number.isFinite(t)) out[k] = t;
  return out;
};

/** An options object's leaves by dotted path (`volume.music`), in its own key order. */
export function flatten(v: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!isPlain(v)) return out;
  for (const [k, x] of Object.entries(v)) {
    if (isPlain(x)) flatten(x, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = x;
  }
  return out;
}
function unflatten(leaves: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, x] of Object.entries(leaves)) {
    const parts = path.split('.');
    let at = out;
    for (const part of parts.slice(0, -1)) at = (isPlain(at[part]) ? at[part] : (at[part] = {})) as Record<string, unknown>;
    at[parts[parts.length - 1]!] = x;
  }
  return out;
}
/** Per field, the later of two stamps. */
const laterStamps = (a: Record<string, number> = {}, b: Record<string, number> = {}): Record<string, number> => {
  const out = { ...a };
  for (const [k, t] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, t);
  return out;
};
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
      out[key] = { v: x.v, t: Math.max(x.t, y.t), ...(x.f || y.f ? { f: laterStamps(x.f, y.f) } : {}) };
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
      case 'ff.options': {
        const [p, q] = both(x, y, (v) => (isPlain(v) ? flatten(v) : null));
        if (!p || !q) {
          out[key] = p ? x : y;
          break;
        }
        const fx = x.f ?? {};
        const fy = y.f ?? {};
        const leaves: Record<string, unknown> = {};
        const f: Record<string, number> = {};
        for (const path of new Set([...Object.keys(p), ...Object.keys(q)])) {
          const theirs = path in q && (!(path in p) || (fy[path] ?? 0) > (fx[path] ?? 0));
          leaves[path] = theirs ? q[path] : p[path];
          const t = theirs ? fy[path] : fx[path];
          if (t) f[path] = t;
        }
        out[key] = { v: JSON.stringify(unflatten(leaves)), t: Math.max(x.t, y.t), f };
        break;
      }
      default:
        out[key] = newer(x, y)!;
    }
  }
  return out;
}

/** One device's copy as it is kept in the key-value store. */
export function encodeCopy(c: Copy): string {
  return JSON.stringify({ v: 2, p: c.p, pt: c.pt });
}

/** A device's copy back from the key-value store; anything unrecognised is no copy. */
export function decodeCopy(raw: string | undefined): Copy {
  const d = json(raw) as { v?: unknown; p?: unknown; pt?: unknown } | undefined;
  const out: Copy = { p: {}, pt: {} };
  if (!d || typeof d !== 'object' || d.v !== 2 || !isPlain(d.p)) return out;
  for (const key of MIRRORED) {
    const s = d.p[key] as Partial<Stamped> | undefined;
    if (s && typeof s.v === 'string' && typeof s.t === 'number' && Number.isFinite(s.t)) {
      out.p[key] = { v: s.v, t: s.t, ...(isPlain(s.f) ? { f: stampsOf(s.f) } : {}) };
    }
  }
  if (isPlain(d.pt)) {
    for (const [dev, rooms] of Object.entries(d.pt)) {
      const r = roomMap(rooms, isCount);
      if (r) out.pt[dev] = r;
    }
  }
  return out;
}

/** Per device and room, the larger: a device's own play time only ever grows. */
export function mergePlayTimes(a: PlayTimes, b: PlayTimes): PlayTimes {
  const out: PlayTimes = {};
  for (const src of [a, b]) {
    for (const [dev, rooms] of Object.entries(src)) {
      const m = (out[dev] ??= {});
      for (const [r, n] of Object.entries(rooms)) m[r] = Math.max(m[r] ?? 0, n);
    }
  }
  return out;
}

/** Every device's copy merged, `local` first so it wins every tie. */
export function mergeAll(local: Progress, kvs: Record<string, string>): Copy {
  let p = local;
  let pt: PlayTimes = {};
  for (const k of Object.keys(kvs).sort()) {
    if (!k.startsWith(KVS_PREFIX)) continue;
    const c = decodeCopy(kvs[k]);
    p = mergeProgress(p, c.p);
    pt = mergePlayTimes(pt, c.pt);
  }
  return { p, pt };
}
