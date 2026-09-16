/** Phone Undo selects the fish whose most recent move was discarded, not a replay default. */
import { movesOf, type Which } from '../core/record.js';

export function phoneUndoFocus(
  currentRecord: string,
  restoredRecord: string,
  selected: Which,
  alive: Readonly<Record<Which, boolean>>,
): Which | null {
  const current = movesOf(currentRecord);
  const restored = movesOf(restoredRecord);
  const retained = current.every((move, i) =>
    move.which === restored[i]?.which && move.dir === restored[i]?.dir);
  // Decode whole records: consequence-marker payloads can themselves look like move keys.
  const moved = retained ? undefined : current.at(-1)?.which;
  for (const which of [moved, selected, 'little', 'big'] as const) {
    if (which && alive[which]) return which;
  }
  return null;
}
