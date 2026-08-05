/**
 * The move-record command log (srecord, URoom.pas:1964-1988). Every accepted
 * player action appends one character; the log is replayed against the
 * deterministic physics to restore state (load) or step back (undo).
 *
 * Move chars match the original's counted set (URoom.pas:1984) and the host keys:
 *   little fish (mala): I=up K=down J=left L=right
 *   big fish   (velka): W=up S=down A=left D=right
 * Consequence markers the engine may append after a move (skipped when counting
 * moves): 'q'+3 (an object pushed out of the room), 'x'/'o'/'b'+1 (other state).
 */
import { Dir } from './dir.js';

export type Which = 'little' | 'big';

const MOVE_TO_CHAR: Record<Which, Record<number, string>> = {
  little: { [Dir.up]: 'I', [Dir.down]: 'K', [Dir.left]: 'J', [Dir.right]: 'L' },
  big: { [Dir.up]: 'W', [Dir.down]: 'S', [Dir.left]: 'A', [Dir.right]: 'D' },
};

const CHAR_TO_MOVE: Record<string, { which: Which; dir: number }> = {
  I: { which: 'little', dir: Dir.up },
  K: { which: 'little', dir: Dir.down },
  J: { which: 'little', dir: Dir.left },
  L: { which: 'little', dir: Dir.right },
  W: { which: 'big', dir: Dir.up },
  S: { which: 'big', dir: Dir.down },
  A: { which: 'big', dir: Dir.left },
  D: { which: 'big', dir: Dir.right },
};

/** The record char for a fish move, or null for a non-cardinal direction. */
export function moveChar(which: Which, dir: number): string | null {
  return MOVE_TO_CHAR[which][dir] ?? null;
}

/** Decode a move char to (fish, dir), or null if it isn't a move char. */
export function parseMoveChar(ch: string): { which: Which; dir: number } | null {
  return CHAR_TO_MOVE[ch] ?? null;
}

/** One entry of a replayed record: a fish move, or a consequence to re-apply. */
export type RecordStep =
  | { kind: 'move'; which: Which; dir: number }
  | { kind: 'pushOut'; idx: number };

/** The marker odstran_vytlacene writes for a pushed-out item (URoom.pas:24044-24047):
 *  'q' then the item index as three decimal digits. */
export function pushOutMarker(idx: number): string {
  return 'q' + String(idx).padStart(3, '0');
}

/**
 * Walk a record (the `FromSave` case dispatch, URoom.pas:24150-24200): the moves in
 * order, plus the consequences that a move-only replay cannot re-derive. This is the
 * one place the record's encoding is decoded.
 */
export function stepsOf(record: string): RecordStep[] {
  const out: RecordStep[] = [];
  for (let i = 0; i < record.length; i++) {
    const ch = record[i]!;
    if (ch === 'x' || ch === 'o' || ch === 'b') i += 1; // marker + 1 payload byte
    else if (ch === 'q') {
      // 'q' + 3 index bytes: an item pushed out of a gspec=9 room (URoom.pas:24184).
      const idx = Number(record.slice(i + 1, i + 4));
      if (Number.isInteger(idx)) out.push({ kind: 'pushOut', idx });
      i += 3;
    } else {
      const m = CHAR_TO_MOVE[ch];
      if (m) out.push({ kind: 'move', ...m });
    }
  }
  return out;
}

/** LengthOfRecord (URoom.pas:1974): count of moves (turns/steps) in a record. */
export function lengthOfRecord(record: string): number {
  let n = 0;
  for (const st of stepsOf(record)) if (st.kind === 'move') n++;
  return n;
}

/**
 * The sequence of move (fish, dir) commands in a record, dropping consequences.
 * For a replay that re-derives them by running the real game loop (the map's
 * best-solution playback); a move-only re-simulation wants `stepsOf` instead.
 */
export function movesOf(record: string): { which: Which; dir: number }[] {
  return stepsOf(record)
    .filter((st) => st.kind === 'move')
    .map((st) => ({ which: st.which, dir: st.dir }));
}
