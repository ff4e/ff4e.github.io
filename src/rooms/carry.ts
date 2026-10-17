/**
 * For a room's `restorePresentation`: hand one object's live, time-driven state from the
 * script an instant restore replaced to the rebuilt one — its Vars, its frame and its
 * Anim cursor. Position is not part of it; that comes from the replayed record.
 */
import type { Script } from '../core/script.js';

export function carryItem(s: Script, previous: Script, i: number): void {
  const from = previous.item(i);
  const to = s.item(i);
  to.vars = [...from.vars];
  to.afaze = from.afaze;
  to.anim = from.anim;
  to.posAnim = from.posAnim;
  to.delAnim = from.delAnim;
  to.labelAnim = from.labelAnim;
}
