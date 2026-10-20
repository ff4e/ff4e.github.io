/**
 * The player's last Save, Load or Restart that actually happened, held until the frame
 * loop shows it (roomActionBadge.ts). Its own DOM-free module so `movement.ts`, which the
 * node-only undo tests import, can report a restart without importing the document.
 */
export type RoomAction = 'save' | 'load' | 'restart';

let pending: RoomAction | null = null;

export function reportRoomAction(action: RoomAction): void {
  pending = action;
}

export function takeRoomAction(): RoomAction | null {
  const action = pending;
  pending = null;
  return action;
}
