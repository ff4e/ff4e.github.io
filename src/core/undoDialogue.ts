import { forwardScript, INIT_TAG, shareVars } from './lineMute.js';
import type { DialogEntry, Script } from './script.js';

/** Inactive dialogue: undo may recover it only after reversing this fish's exit. */
export interface ExitDiscard {
  which: 'little' | 'big';
  entries: DialogEntry[];
}

/**
 * Step 4 of src/app/undo.ts: move what the old Script still had to say, and that the
 * rewound flags will not bring back, into the rebuilt one.
 * With no `old` (undo resuming a death-ended attempt)
 * nothing is carried, but the rebuild's own `init()` queue is still dropped. Queued `set`
 * entries are closures over the Script and the item arrays that queued them, so the old
 * Script forwards every field to the new one (`forwardScript`) and the new room adopts the
 * old item arrays (`shareVars`).
 */
export function transferPendingDialogue(old: Script | null, s: Script, idx: number, replayCut: boolean): void {
  if (old === s) return;
  const recovered: DialogEntry[] = [];
  const retained: ExitDiscard[] = [];
  for (const discard of old?.discardedOnExit ?? []) {
    if (s.room.venku[discard.which]) retained.push(discard);
    else recovered.push(...discard.entries);
  }
  const keep = old
    ? old.pendingDialogue(replayCut, recovered)
      .filter(d => d.tag === INIT_TAG || (d.tag !== undefined && d.tag <= idx))
    : [];
  // Retained queues also contain closures: an undo after the exit must forward
  // them now so a later undo across the exit still writes into the live room.
  if (old && (keep.length || retained.length)) {
    shareVars(old.room.items, s.room.items);
    forwardScript(old, s);
  }
  s.discardedOnExit.push(...retained);
  s.adoptPendingDialogue(keep);
}
