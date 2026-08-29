/**
 * The two decisions behind a single-move undo, with no game and no DOM attached.
 *
 * Undo itself is not in the 1998 original at all — there is no `URoom.pas` line to port,
 * and Backspace/`TRoom.Restart` (which throws the whole attempt away) is the only thing
 * the Delphi game offered. The trigger and the depth follow FFNG instead, the community
 * remake this port already uses as a level-data and solution reference: `-` undoes one
 * move, and it can be pressed as many times as there are moves.
 *
 * How a point is REACHED is `undo.ts`'s job (rebuild the room and replay the record, the
 * same machinery an F3 load uses). Which point to go to, how to keep a history of them
 * from costing megabytes, and how to fit one in a save slot are decisions that need no
 * browser — so they live here and are tested in milliseconds rather than through a probe.
 */
import type { ScriptSnapshot } from './script.js';

/**
 * One undoable position: the move record that reproduces it, plus the script state that
 * a move-only replay cannot re-derive (`applyRecordStep` deliberately does not run
 * `prog()`, so "already said" progress would be lost without it).
 */
export interface UndoPoint {
  rec: string;
  snapshot: ScriptSnapshot | null;
}

/**
 * The index in `history` an undo should return to, or -1 for "nothing to undo".
 *
 * The ordinary case is the obvious one: the newest point IS where the player is standing,
 * so undo goes to the one below it. The other case is what makes undo useful after a
 * death. A point is only recorded while both fish are alive (see `sampleUndoPoint`),
 * because a record that contains a death cannot be replayed faithfully — the skeleton
 * erodes over ticks that an instant replay never runs, so the survivor's later moves
 * would be re-simulated against an obstacle that was no longer there. So once a fish
 * dies the newest point stops matching the live record, and undo means "get back to that
 * point" rather than "go one below it": one press returns to the position before the
 * fatal move, however many moves the lone survivor made afterwards.
 *
 * The caller truncates the history to `idx + 1`, which both discards the position being
 * left and leaves the restored point on top, so the invariant holds again either way.
 */
export function undoTargetIndex(history: readonly UndoPoint[], currentRec: string): number {
  const top = history.length - 1;
  if (top < 0) return -1;
  if (history[top]!.rec !== currentRec) return top; // adrift (a death): come back to it
  return top - 1; // -1 when the bottom point IS the current one: nothing to undo
}

/** Shallow value equality for the flat number arrays a `ScriptSnapshot` is made of. */
function same(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Point `next` at `prev`'s arrays wherever the two hold the same values, so an undo
 * history of N moves does not hold N copies of everything.
 *
 * Worth the code because of one field: `globpole` is a fixed 1024-number array
 * (`script.ts`) that most rooms never write, and a fresh copy of it per move is ~8 KB —
 * about 8 MB across a thousand-move attempt, on hardware that may be a phone. The
 * per-item `vars` are the same argument at smaller scale: a move touches one or two
 * items, and the rest are re-copied unchanged.
 *
 * Safe because a snapshot is never mutated after capture: `Script.snapshot()` builds
 * fresh arrays, and `applySnapshot` copies OUT of them (`it.vars = [...]`, element-wise
 * writes into roompole/globpole) rather than keeping a reference.
 */
export function shareSnapshot(prev: ScriptSnapshot | null, next: ScriptSnapshot): ScriptSnapshot {
  if (!prev) return next;
  if (same(prev.roompole, next.roompole)) next.roompole = prev.roompole;
  if (same(prev.globpole, next.globpole)) next.globpole = prev.globpole;
  for (let i = 0; i < next.vars.length; i++) {
    const p = prev.vars[i];
    const n = next.vars[i];
    if (p && n && same(p, n)) next.vars[i] = p;
  }
  return next;
}

// ── Putting a history in a save slot ────────────────────────────────────────

/**
 * A history as it goes into `localStorage`. Deliberately not the plain array: written
 * straight out, an N-move history is N full copies of the record (quadratic in the
 * characters) plus N copies of a `ScriptSnapshot`, whose `globpole` alone is 1024
 * numbers. A thousand-move room would not fit the origin's storage quota, and
 * `saveGame`'s failure mode is a save that silently does not happen.
 *
 * Both halves collapse because of how a history is actually built. Every point's record
 * is a prefix of the newest one (the log only ever grows) except across a load, so the
 * records become lengths against one base string. And a move touches one or two of the
 * arrays in a snapshot and leaves the rest identical, so the arrays go in a pool and each
 * snapshot becomes a handful of indices into it.
 */
export interface UndoSaveData {
  /** The record the numeric entries in `recs` are prefix lengths of. */
  base: string;
  /** Per point: a prefix length of `base`, or a literal record that is not one. */
  recs: (number | string)[];
  /** Per point: the snapshot as pool indices, or null where the point had none. */
  snaps: ({ v: number[]; r: number; g: number; z: boolean; s: number } | null)[];
  /**
   * Every distinct number array in the history, once — written whole, or as a sparse
   * patch on an EARLIER pool entry of the same length (`b` its index, `d` a flat
   * index/value list). Always earlier, so one forward pass rebuilds them all.
   *
   * The patch form is what makes TRUHLA and BANKA affordable. Both drive per-tick
   * animation timers through `globpole` (`src/rooms/truhla.ts:136`,
   * `src/rooms/banka.ts:450`), so no two points share one — but consecutive points differ
   * in about ten of its 1024 numbers, and writing the ten costs a fortieth of writing all
   * of them. Measured on TRUHLA's committed solution: 277 KB whole, 22 KB patched.
   */
  pool: (number[] | { b: number; d: number[] })[];
}

/** Serialize a history for a save slot. Returns null for a history not worth storing. */
export function encodeUndoHistory(history: readonly UndoPoint[]): UndoSaveData | null {
  if (history.length < 2) return null; // only the position being saved: nothing to undo to
  const base = history[history.length - 1]!.rec;
  const pool: UndoSaveData['pool'] = [];
  const whole: number[][] = []; // what each pool slot means, for patching the next one
  const seen = new Map<string, number>();
  const lastOfLength = new Map<number, number>();
  // By VALUE, not by reference: `shareSnapshot` already shares the arrays a move left
  // alone, but only with the point below it. Keying on the contents also collapses the
  // empty `vars` of every item that no room program ever writes to, which is most of them.
  // Anything genuinely new is then written as a patch on the last array of its length,
  // which for a per-tick timer bank is a handful of numbers instead of 1024.
  const idx = (arr: number[]): number => {
    const key = arr.join(',');
    const hit = seen.get(key);
    if (hit !== undefined) return hit;
    const slot = pool.length;
    const baseIdx = lastOfLength.get(arr.length);
    const base = baseIdx === undefined ? null : whole[baseIdx]!;
    if (base) {
      const d: number[] = [];
      for (let i = 0; i < arr.length; i++) if (arr[i] !== base[i]) d.push(i, arr[i]!);
      // Only when it is actually smaller: a wholly different array patches to twice its
      // own size, and `vars` arrays are short enough that the indices are not worth it.
      pool.push(d.length * 2 < arr.length ? { b: baseIdx!, d } : arr);
    } else {
      pool.push(arr);
    }
    whole.push(arr);
    seen.set(key, slot);
    lastOfLength.set(arr.length, slot);
    return slot;
  };
  const recs: (number | string)[] = [];
  const snaps: UndoSaveData['snaps'] = [];
  for (const p of history) {
    recs.push(base.startsWith(p.rec) ? p.rec.length : p.rec);
    snaps.push(
      p.snapshot === null
        ? null
        : {
            v: p.snapshot.vars.map(idx),
            r: idx(p.snapshot.roompole),
            g: idx(p.snapshot.globpole),
            z: p.snapshot.zvykacka,
            s: p.snapshot.gspec ?? 0,
          },
    );
  }
  return { base, recs, snaps, pool };
}

/**
 * Rebuild a history from a save slot. Returns an empty history for anything it does not
 * recognise, so a save written by an older build — or a corrupted one — costs the player
 * their undo history and not their save.
 */
export function decodeUndoHistory(data: unknown): UndoPoint[] {
  if (typeof data !== 'object' || data === null) return [];
  const d = data as Partial<UndoSaveData>;
  if (typeof d.base !== 'string' || !Array.isArray(d.recs) || !Array.isArray(d.snaps)) return [];
  if (!Array.isArray(d.pool) || d.recs.length !== d.snaps.length) return [];
  // Rebuild the pool in one forward pass: a patch entry only ever names an earlier slot,
  // so its base is already whole by the time it is read. One array per slot, shared by
  // every snapshot that referenced it — the structural sharing `shareSnapshot` maintains
  // while playing, carried across the save.
  const mats: number[][] = [];
  for (const e of d.pool) {
    if (Array.isArray(e)) {
      mats.push(e.every((n) => typeof n === 'number') ? e : []);
      continue;
    }
    if (typeof e !== 'object' || e === null || !Array.isArray((e as { d?: unknown }).d)) return [];
    const patch = e as { b: number; d: number[] };
    const a = (mats[patch.b] ?? []).slice();
    for (let i = 0; i + 1 < patch.d.length; i += 2) {
      const at = patch.d[i]!;
      if (typeof at === 'number' && at >= 0 && at < 4096) a[at] = patch.d[i + 1]!;
    }
    mats.push(a);
  }
  const at = (i: number): number[] => mats[i] ?? [];
  const out: UndoPoint[] = [];
  for (let k = 0; k < d.recs.length; k++) {
    const r = d.recs[k]!;
    const rec = typeof r === 'number' ? d.base.slice(0, r) : typeof r === 'string' ? r : null;
    if (rec === null) return [];
    const s = d.snaps[k]!;
    out.push({
      rec,
      snapshot:
        s === null || typeof s !== 'object'
          ? null
          : {
              vars: (Array.isArray(s.v) ? s.v : []).map(at),
              roompole: at(s.r),
              globpole: at(s.g),
              zvykacka: !!s.z,
              gspec: typeof s.s === 'number' ? s.s : 0,
            },
    });
  }
  return out;
}
