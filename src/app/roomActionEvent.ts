/**
 * The player's last Save, Load or Restart that actually happened, held until the frame
 * loop shows it (roomActionBadge.ts). Its own DOM-free module so `movement.ts`, which the
 * node-only undo tests import, can report a restart without importing the document.
 */
export type RoomAction = 'save' | 'load' | 'restart';

let pending: RoomAction | null = null;
let saves = 0;

export function reportRoomAction(action: RoomAction): void {
  pending = action;
  if (action === 'save') saves++;
}

/** How many saves have happened; buttonAvailability.ts re-reads the slot when it moves. */
export function savesReported(): number {
  return saves;
}

export function takeRoomAction(): RoomAction | null {
  const action = pending;
  pending = null;
  return action;
}
