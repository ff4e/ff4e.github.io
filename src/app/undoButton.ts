/** Hold-to-repeat for both Undo buttons; ordinary taps keep their existing click path. */
import { cutscene, loadmode, replaymode, room, showmode } from './gameState.js';
import { roomLoading } from './framePacing.js';
import { phoneMenuOpen } from './phoneControls.js';
import { ui } from './screenState.js';
import { touchOptionsOpen } from './touchOptions.js';

const HOLD_DELAY_MS = 350;
const REPEAT_MS = 80;

/** Install BEFORE the normal click listener, so releasing a hold cannot undo once more. */
export function bindUndoHold(button: HTMLButtonElement, repeat: () => void): void {
  let pointer: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let owner = room;
  let suppressClick = false;

  const available = (): boolean =>
    !document.hidden && !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
    button.getClientRects().length > 0 &&
    ui.screen === 'room' && !ui.helpOpen && !touchOptionsOpen() && !phoneMenuOpen() &&
    !roomLoading && !cutscene && !loadmode && !showmode && !replaymode;
  const inside = (e: PointerEvent): boolean => {
    const r = button.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
  };
  const stop = (cancelClick = false): void => {
    if (pointer === null) return;
    suppressClick ||= cancelClick;
    const id = pointer;
    pointer = null;
    clearTimeout(timer);
    timer = undefined;
    if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
  };
  const tick = (): void => {
    timer = undefined;
    if (pointer === null) return;
    if (!available()) {
      stop(true);
      return;
    }
    // A death auto-restart replaces the room too. Stop repeating, but keep the
    // pointer until release: a press that has not repeated still gets its normal
    // gated Undo click, unless it slides off or is cancelled in the meantime.
    if (room !== owner) return;
    suppressClick = true;
    button.blur();
    repeat();
    // Undo rebuilds the room itself. Accept that replacement, but not a later
    // restart/load/room change while this finger is still down.
    owner = room;
    if (pointer !== null) timer = setTimeout(tick, REPEAT_MS);
  };

  button.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0 || pointer !== null) return;
    suppressClick = false;
    if (!available()) return;
    pointer = e.pointerId;
    owner = room;
    button.setPointerCapture(pointer);
    timer = setTimeout(tick, HOLD_DELAY_MS);
  });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer && (!inside(e) || e.buttons === 0)) stop(true);
  }, true);
  window.addEventListener('pointerup', (e) => {
    if (e.pointerId === pointer) stop(!inside(e) || !available());
  }, true);
  window.addEventListener('pointercancel', (e) => {
    if (e.pointerId === pointer) stop(true);
  }, true);
  button.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === pointer) stop(true);
  });
  button.addEventListener('click', (e) => {
    // Keyboard and assistive activations (detail=0) remain native single clicks.
    if (e.detail === 0 || !suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  button.addEventListener('contextmenu', (e) => {
    if (pointer !== null) e.preventDefault();
  });
  window.addEventListener('blur', () => stop(true));
  window.addEventListener('pagehide', () => stop(true));
  window.addEventListener('resize', () => stop(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(true);
  });
}
