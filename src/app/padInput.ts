/**
 * The game played with a controller: one poll per frame, routed to what the screen is.
 *
 * ── The one decision in this file ────────────────────────────────────────────
 * The sticks move the fish by sending the SAME synthetic `keydown`/`keyup` a keyboard
 * would — IJKL for the little fish, WASD for the big one — exactly as `touchSwipe.ts`
 * sends arrows for a finger. So everything the keyboard router does around a move comes
 * with it unchanged: `hracNespi()`, the possession / finale / demo / replay / fast-load
 * guards, `beginHeldMove`'s one-input-at-a-time rule and the 1->3 release that makes a
 * flick move exactly once. A controller is not a second entry point into `movement.ts`.
 *
 * Buttons that have a key do the same (Ⓑ is Escape, Ⓨ is `-`, the confirmed Save / Load /
 * Restart are F2 / F3 / Backspace, the help pages are the arrows), so they inherit the
 * keyboard's gates too — F2 refuses mid-move and mid-replay, for instance. The few verbs
 * with no key go through `panelAction`, the table the touch buttons use.
 *
 * ── The scheme (Martin, 2026-07-21; kept for the second port, 2026-10-01) ────
 * Two sticks, no "active fish": left stick (and the d-pad) is the little fish, right stick
 * the big one. One fish still moves at a time, as in the original — the stick engaged
 * LAST owns the move, and when it centres the other one (if still held) takes over.
 *
 *   Ⓑ / View   back to the map          LB  Save      (Ⓐ to confirm)
 *   Ⓨ          take back one move       RB  Load      (Ⓐ to confirm)
 *   ☰          Options                  Ⓧ   Restart   (Ⓐ to confirm)
 *
 * Save, Load and Restart each ask first: they are one press away, under a thumb, and each
 * throws something away. Undo does not ask, because it can itself be undone by playing on.
 *
 * Elsewhere: any button starts / skips the intro and closes the story page; Ⓑ closes the credits;
 * Ⓑ skips the briefcase demo; the map and Options have their own modules (`mapSelect.ts`,
 * `padOptions.ts`).
 */
import { DirRepeat, pollPad, type PadDir, type PadSnapshot } from '../platform/gamepad.js';
import { initHostGamepad } from '../platform/hostGamepad.js';
import { intro } from './introOverlay.js';
import { ui } from './screenState.js';
import { touchOptionsOpen } from './touchOptions.js';
import { cutscene, room } from './gameState.js';
import { mapLaunching } from './roomLaunch.js';
import { tetrisModal } from './cheats.js';
import { closeMapOverlay, dismissLegImage, returnFromRoom, startMenuMusic } from './mapNav.js';
import { audio } from './audioEngine.js';
import { wake } from './frameClock.js';
import { handleMapPad, syncMapSelect } from './mapSelect.js';
import { handleOptionsPad } from './padOptions.js';
import { tvUi } from './touchButtons.js';
import { TOUCH_REGIONS } from './keyTables.js';

/** The names this module needs from `main.ts`. */
export interface PadInputHost {
  /** The panel's dispatch table (Uovl regions) — the same door the touch buttons use. */
  readonly panelAction: (region: number) => void;
  readonly saveExists: () => boolean;
}

let host!: PadInputHost;

export function initPadInput(h: PadInputHost): void {
  host = h;
  // On the console the controller arrives from the native shell, not the browser's own
  // Gamepad API (see hostGamepad.ts). A no-op in any ordinary browser.
  initHostGamepad();
}

// ── Synthetic keys ────────────────────────────────────────────────────────────

function sendKey(type: 'keydown' | 'keyup', code: string, key = code): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
}

function tapKey(code: string, key = code): void {
  sendKey('keydown', code, key);
  sendKey('keyup', code, key);
}

const LITTLE: Record<Exclude<PadDir, null>, string> = { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL' };
const BIG: Record<Exclude<PadDir, null>, string> = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };

/** The synthetic movement key currently held down, if any. */
let heldCode: string | null = null;
let owner: 'left' | 'right' | null = null;
let leftWas = false;
let rightWas = false;

function holdKey(code: string | null): void {
  if (code === heldCode) return;
  if (heldCode !== null) sendKey('keyup', heldCode);
  heldCode = code;
  if (code !== null) sendKey('keydown', code);
}

/** Let go of the fish, and forget which stick had it. */
function releaseSticks(): void {
  holdKey(null);
  owner = null;
  leftWas = rightWas = false;
}

/** Last-engaged stick wins: the one just pushed takes the move; centring hands it back. */
function driveSticks(pad: PadSnapshot): void {
  const left = pad.leftDir !== null;
  const right = pad.rightDir !== null;
  if (left && !leftWas) owner = 'left';
  if (right && !rightWas) owner = 'right';
  if (owner === 'left' && !left) owner = right ? 'right' : null;
  if (owner === 'right' && !right) owner = left ? 'left' : null;
  leftWas = left;
  rightWas = right;
  if (owner === 'left') holdKey(LITTLE[pad.leftDir!]);
  else if (owner === 'right') holdKey(BIG[pad.rightDir!]);
  else holdKey(null);
}

// ── The Ⓐ-to-confirm prompt ──────────────────────────────────────────────────

type Confirm = 'save' | 'load' | 'restart';
const CONFIRM: Record<Confirm, { title: string; key: string }> = {
  save: { title: 'Save the game?', key: 'F2' },
  load: { title: 'Load the saved game?', key: 'F3' },
  restart: { title: 'Restart the room?', key: 'Backspace' },
};
let confirming: Confirm | null = null;

function setConfirm(c: Confirm | null): void {
  confirming = c;
  const el = document.getElementById('pad-confirm');
  const title = document.getElementById('pad-confirm-title');
  if (title && c) title.textContent = CONFIRM[c].title;
  if (el) el.hidden = c === null;
  document.documentElement.toggleAttribute('data-pad-confirm', c !== null);
  wake();
}

/** Is the confirm prompt up? Read by the legend and the probes. */
export function padConfirmOpen(): Confirm | null {
  return confirming;
}

function handleConfirm(pad: PadSnapshot): void {
  if (pad.pressed('a')) {
    const c = confirming!;
    setConfirm(null);
    tapKey(CONFIRM[c].key);
  } else if (pad.pressed('b')) {
    setConfirm(null);
  }
}

// ── Routing ───────────────────────────────────────────────────────────────────

const helpRepeat = new DirRepeat();
const tetrisRepeat = new DirRepeat();
let used = false;

/** Has a controller been used this session? Turns the map selection on off a TV. */
export function padInUse(): boolean {
  return used;
}

function inRoom(pad: PadSnapshot): void {
  if (pad.pressed('b') || pad.pressed('view')) {
    releaseSticks();
    tapKey('Escape');
    return;
  }
  if (pad.pressed('menu')) {
    releaseSticks();
    host.panelAction(TOUCH_REGIONS.options);
    return;
  }
  if (pad.pressed('y')) tapKey('Minus', '-');
  else if (pad.pressed('lb')) setConfirm('save');
  else if (pad.pressed('rb')) {
    if (host.saveExists()) setConfirm('load');
  } else if (pad.pressed('x')) setConfirm('restart');
  else if (pad.pressed('a') && room?.won) returnFromRoom(); // what a click on a won room does
  if (confirming) {
    releaseSticks();
    return;
  }
  driveSticks(pad);
}

function route(pad: PadSnapshot, now: number): void {
  if (ui.feedback?.isOpen()) return; // its own dialog owns input, as for the keyboard
  if (mapLaunching() !== null) return; // a launch off the map is blocking
  if (intro.playing) {
    if (pad.anyPressed && !intro.confirmStart()) intro.skip();
    return;
  }
  // Only Ⓑ leaves the credits, and the legend says so: on a pad, Ⓐ is "go on", and the
  // credits have nowhere to go on to.
  if (ui.mapOverlay === 'credits') {
    if (pad.pressed('b')) closeMapOverlay();
    return;
  }
  if (ui.screen === 'legimage') {
    if (pad.anyPressed) dismissLegImage();
    return;
  }
  if (confirming) {
    handleConfirm(pad);
    return;
  }
  if (handleOptionsPad(pad, now)) return;
  if (ui.helpOpen) {
    const step = helpRepeat.step(pad.leftDir ?? pad.rightDir, now);
    if (pad.pressed('rb') || step === 'right') tapKey('ArrowRight');
    else if (pad.pressed('lb') || step === 'left') tapKey('ArrowLeft');
    else if (pad.pressed('b') || pad.pressed('a') || pad.pressed('menu')) tapKey('Escape');
    return;
  }
  if (tetrisModal()) {
    const step = tetrisRepeat.step(pad.leftDir, now);
    if (pad.pressed('b')) tapKey('Escape');
    else if (step === 'left') tapKey('ArrowLeft');
    else if (step === 'right') tapKey('ArrowRight');
    else if (pad.pressed('a') || step === 'up') tapKey('ArrowDown'); // Down rotates (Ttr.pas)
    else if (pad.pressed('x') || step === 'down') tapKey('Space'); // slam
    return;
  }
  if (ui.screen === 'map') {
    handleMapPad(pad, now);
    return;
  }
  if (cutscene) {
    if (pad.pressed('b') || pad.pressed('a') || pad.pressed('menu')) tapKey('Escape');
    return;
  }
  if (ui.screen === 'room') inRoom(pad);
}

/**
 * Read the controller and act on it. Called once per frame from the render loop, which
 * keeps running (throttled) while idle, so a press is noticed and wakes it.
 */
export function pollPadInput(now: number): void {
  const pad = pollPad();
  syncMapSelect(tvUi() || used);
  if (!pad.connected) {
    if (heldCode !== null || owner !== null) releaseSticks();
    return;
  }
  const active = pad.anyPressed || pad.leftDir !== null || pad.rightDir !== null;
  if (active) {
    wake();
    if (!used) {
      used = true;
      syncMapSelect(true);
      // What boot.ts does on the first real click or key. A pad press is not a user
      // gesture to a browser, so on the web this may still wait for one; the Xbox shell
      // lifts the autoplay policy (xbox/), where it is what starts the sound.
      if (pad.anyPressed) {
        audio.resume();
        if (ui.screen === 'map') startMenuMusic();
      }
    }
  }
  route(pad, now);
  // Anything that took the room away from live play takes the held fish key with it.
  const live = ui.screen === 'room' && !cutscene && !confirming && !ui.helpOpen && !touchOptionsOpen() && !tetrisModal();
  if (!live && heldCode !== null) releaseSticks();
}
