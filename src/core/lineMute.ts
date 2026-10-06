/**
 * The Script-side pieces of undo's handling of the room's lines: tagging, muting by line
 * family, and carrying queued entries across a rebuild. The design is explained once, in
 * `src/app/undo.ts` ("What the fish have already said").
 */

/**
 * The tag of an entry the room's `init()` queued (TRUHLA's opening). Never muted: undo
 * drops the rebuild's own opening instead and carries the unfinished part of the old one.
 */
export const INIT_TAG = -1;

/**
 * What a mute matches: the name without its trailing digits. A room that says one of
 * several variants (`'kuch-v-svitek' + random(2)`) may pick a different one when the
 * rewound script fires the same event again, and that is still the same line coming back.
 */
export function lineFamily(name: string): string {
  return name.replace(/\d+$/, '');
}

/**
 * Make `old` a window onto `nu`: every field read or written on it lands on `nu`. A room
 * script's queued `set` callbacks are closures over the Script that queued them (`s`), so
 * an entry carried across undo's rebuild would otherwise write into a Script nobody reads.
 */
export function forwardScript(old: object, nu: object): void {
  for (const key of Object.keys(old)) {
    Object.defineProperty(old, key, {
      get: () => (nu as Record<string, unknown>)[key],
      set: (v: unknown) => ((nu as Record<string, unknown>)[key] = v),
    });
  }
}

/**
 * Hand the new room the old room's per-item `vars` arrays, holding the new values. The
 * same closures often capture an item's array directly (`const v = s.vars(R.room)`).
 */
export function shareVars(oldItems: readonly { vars: number[] }[], newItems: { vars: number[] }[]): void {
  for (let i = 0; i < newItems.length; i++) {
    const a = oldItems[i]?.vars;
    const b = newItems[i]!.vars;
    if (!a || a === b) continue;
    a.length = b.length;
    for (let k = 0; k < b.length; k++) a[k] = b[k]!;
    newItems[i]!.vars = a;
  }
}

/** A line the room script queued and the player then heard, with its `progTag`. */
export interface HeardLine {
  name: string;
  tag: number;
}

/** The fields of a speech-queue entry this needs (`script.ts`'s DialogEntry). */
export interface QueuedLine {
  zvuk: string;
  prior: number;
  promSet?: (val: number) => void;
  /** Queued by `prog()` (or `init()`, as INIT_TAG / run 0): the host's `progTag` then,
   *  and which run queued it. */
  tag?: number;
  batch?: number;
}

/** A queue entry that speaks, as opposed to a `set`, a pure delay or an animation. */
export function isTalk(zvuk: string): boolean {
  return zvuk !== 'set' && zvuk !== 'del' && !zvuk.startsWith('ANIM');
}

/**
 * If `prog()` run `run` queued a conversation containing a muted line, take the whole
 * conversation out of `queue` rather than one line of it (an answer without its question
 * is worse than silence) and return what is left; otherwise return `queue` untouched.
 *
 * What the dropped entries would have DONE still happens, in order: a `set` writes its
 * variable, an animation starts, a speaker's prom variable goes up and back to 0. Only the
 * voice, the subtitle and the time they take are skipped. Each mute is spent once. A line
 * that was muted — heard before — is logged in `heard` again, so a deeper undo mutes it
 * again; the rest of the conversation was never heard and is not. `heard` is null for
 * undo's carried-copy holds (`Script.adoptPendingDialogue`), which mark nothing as heard: the carried
 * copy will, when it plays.
 */
export function dropMutedRun<T extends QueuedLine>(
  queue: T[],
  run: number,
  muted: Set<string>,
  heard: HeardLine[] | null,
  setanim: (obj: number, anim: string) => void,
): T[] {
  const batch = queue.filter((d) => d.batch === run);
  if (!batch.some((d) => isTalk(d.zvuk) && muted.has(lineFamily(d.zvuk)))) return queue;
  for (const d of batch) {
    if (d.zvuk === 'set') d.promSet?.(d.prior);
    else if (d.zvuk.startsWith('ANIMWAIT')) setanim(d.prior, d.zvuk.slice(8));
    else if (d.zvuk.startsWith('ANIM')) setanim(d.prior, d.zvuk.slice(4));
    else if (isTalk(d.zvuk)) {
      d.promSet?.(d.prior);
      d.promSet?.(0);
      if (muted.delete(lineFamily(d.zvuk))) heard?.push({ name: d.zvuk, tag: d.tag! });
    }
  }
  return queue.filter((d) => d.batch !== run);
}
