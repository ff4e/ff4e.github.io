/**
 * Greys the touch Save, Load and Undo while a press could not do anything, so a refused
 * press is not a silent guess. Restart, Map and Options are never refused.
 *
 *  - Save and Load follow the original panel's own grey (`panelState`): Save while
 *    CanSave is false, Load while this room has no save. The 1998 panel already told the
 *    player this; the touch buttons did not.
 *  - Undo follows `undoAvailable()`: nothing to take back.
 *  - A map Replay or solution playback greys all three; the input lockout keeps them
 *    from reaching the room, and these buttons are now inert there as well.
 *  - The KUFRIK demonstration greys nothing. It is teaching these very buttons, with an
 *    arrow pointing at them (dialogueHints.ts), and `panelAction` already ignores them.
 *
 * Refusals that pass with the next tick — a fish still moving, a load still replaying —
 * stay pressable, or the buttons would flicker on every move.
 *
 * `aria-disabled`, not `disabled`: the button keeps its focus and its place in the tab
 * order. Every click path checks the attribute (touchButtons.ts, phoneControls.ts,
 * undoButton.ts), and buttonHaptics.ts keeps a greyed press silent.
 */
import { room, showmode } from './gameState.js';
import { panelSaveExists } from './panel.js';
import { savesReported } from './roomActionEvent.js';
import { ui } from './screenState.js';
import { inAutoPlay } from './solveMode.js';
import { touchUi } from './touchButtons.js';
import { undoAvailable } from './undo.js';
import { TOUCH_REGIONS } from './keyTables.js';

let buttons: { save: HTMLElement[]; load: HTMLElement[]; undo: HTMLElement[] } | null = null;

// Reading the slot copies the whole saved attempt, undo history and all, so it is not done
// every frame: again when the room is rebuilt (enter, restart, load, undo) or a save
// happens, and otherwise once a second, which still notices a slot changed from outside
// (another tab, a probe clearing it).
const SAVE_REREAD_MS = 1000;
let saveRead: { room: typeof room; saves: number; at: number; exists: boolean } | null = null;

function saveExists(now: number): boolean {
  const saves = savesReported();
  if (!saveRead || saveRead.room !== room || saveRead.saves !== saves || now - saveRead.at >= SAVE_REREAD_MS) {
    saveRead = { room, saves, at: now, exists: panelSaveExists() };
  }
  return saveRead.exists;
}

function find(region: number): HTMLElement[] {
  const found = [...document.querySelectorAll<HTMLElement>(
    `#touchbar [data-region="${region}"], #phone-controls [data-region="${region}"]`)];
  if (found.length === 0) throw new Error(`Missing touch button for region ${region}`);
  return found;
}

function mark(els: readonly HTMLElement[], unavailable: boolean): void {
  for (const el of els) {
    if ((el.getAttribute('aria-disabled') === 'true') === unavailable) continue;
    if (unavailable) el.setAttribute('aria-disabled', 'true');
    else el.removeAttribute('aria-disabled');
  }
}

/** From the frame loop. Off a room the buttons are hidden, so they are left as they were. */
export function syncButtonAvailability(now: number): void {
  if (!touchUi() || ui.screen !== 'room') return;
  buttons ??= {
    save: find(TOUCH_REGIONS.save), load: find(TOUCH_REGIONS.load), undo: find(TOUCH_REGIONS.undo),
  };
  const demo = showmode !== null;
  const playback = !demo && inAutoPlay();
  // `panelState()`'s own two tests, with the slot read throttled.
  mark(buttons.save, !demo && (playback || !room?.canSave));
  mark(buttons.load, !demo && (playback || !saveExists(now)));
  mark(buttons.undo, !demo && (playback || !undoAvailable()));
}
