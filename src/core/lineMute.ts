/**
 * Undo's view of the room's own lines; no part of the original, which has no undo.
 *
 * An undo rewinds the item Vars, and with them whatever "already said" flag a room keeps
 * there, so the rewound script would say again what the player has just heard. The flags
 * cannot simply be kept: the same Vars hold puzzle state and timers that must match the
 * position. So the state is left exactly as the script writes it and only the OUTPUT is
 * held back — a conversation `prog()` queues that contains a muted line is dropped once.
 * The bookkeeping that decides what is muted is `takeUnsaid` (`undoStack.ts`) and
 * `src/app/undo.ts`; this is the part that runs inside the Script.
 */

/**
 * The tag of a line the room's `init()` queued (an opening conversation, TRUHLA's). An
 * undo rebuilds the room and so runs init again, whatever point it lands on, so these
 * are muted on every undo once heard — no snapshot decides them.
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
 * voice, the subtitle and the time they take are skipped. Each mute is spent once, and the
 * dropped lines are logged as heard, so a deeper undo mutes them again.
 */
export function dropMutedRun<T extends QueuedLine>(
  queue: T[],
  run: number,
  muted: Set<string>,
  heard: HeardLine[],
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
      muted.delete(lineFamily(d.zvuk));
      heard.push({ name: d.zvuk, tag: d.tag! });
    }
  }
  return queue.filter((d) => d.batch !== run);
}
