/**
 * A brief touch-only confirmation, in the middle of the room, that the player's own Save,
 * Load or Restart happened. Not in the 1998 game: on desktop the info line and the panel
 * already answer, but on touch both are hidden and Save had no visible effect at all.
 *
 * Reported only by the action itself (`saveGame`, `loadGame`, `restartRoom`, through
 * roomActionEvent.ts), after its own gates, so a refused press shows nothing — the button is greyed instead
 * (buttonAvailability.ts). The demo's recorded save/load and a death's auto-restart take
 * other paths and stay silent. Decorative: it never takes a pointer.
 */
import { wrap } from './dom.js';
import { ui } from './screenState.js';
import { touchUi } from './touchButtons.js';
import { touchOptionsOpen } from './touchOptions.js';
import { TOUCH_REGIONS } from './keyTables.js';
import { takeRoomAction, type RoomAction } from './roomActionEvent.js';
import '../styles/roomActions.css';

const LABEL: Readonly<Record<RoomAction, string>> = { save: 'Saved', load: 'Loaded', restart: 'Restarted' };
export const BADGE_MS = 1200;

let current: { el: HTMLDivElement; until: number } | null = null;

function allowed(): boolean {
  return touchUi() && ui.screen === 'room' && !ui.helpOpen && !touchOptionsOpen() && !document.hidden;
}

export function clearRoomActionBadge(): void {
  current?.el.remove();
  current = null;
}

function showRoomActionBadge(action: RoomAction): void {
  clearRoomActionBadge();
  if (!allowed()) return;
  // The tablet bar's own symbol, in whichever skin drew it. It is in the document on a
  // phone too, just hidden, so both devices show the same picture.
  const icon = document.querySelector(`#touchbar [data-region="${TOUCH_REGIONS[action]}"] svg`);
  if (!icon) throw new Error(`Missing ${action} button symbol`);
  const label = document.createElement('span');
  label.textContent = LABEL[action];
  const el = document.createElement('div');
  el.id = 'room-action-badge';
  el.dataset.action = action;
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--badge-duration', `${BADGE_MS}ms`);
  el.append(icon.cloneNode(true), label);
  wrap.appendChild(el);
  current = { el, until: performance.now() + BADGE_MS };
}

/** Beside the other touch hints in the frame loop; a restart's or load's new room keeps it. */
export function syncRoomActionBadge(now: number): void {
  const action = takeRoomAction();
  if (action) showRoomActionBadge(action);
  if (current && (!allowed() || now >= current.until)) clearRoomActionBadge();
}
