/**
 * Where each input goes: the native host's one router for the keyboard, the gamepad and the
 * TV remote (native/host/main.c tells them apart by their codes: DOM codes, `Pad…`,
 * `Remote…`). It decides, per screen, what a press means — the controller spec's A3 button
 * maps and B2's remote mapping — and hands the game the same keys the browser's router
 * reads, so every guard of that router still applies (no move mid-move, none in a replay):
 *
 *   - a menu is open (`menus.ts`): directions, OK and Back drive it, with menu repeat;
 *   - in a room: the keyboard is the browser's, except that Esc opens the pause menu; the
 *     pad's left stick and d-pad move the little fish and its right stick the big one, Ⓨ
 *     undoes, Ⓑ (or ⧉) goes to the map, LB / RB / Ⓧ ask to save / load / restart, ☰ opens
 *     the pause menu; the remote's edge clicks move the active fish, its centre click
 *     switches fish, Play/Pause undoes (held: repeats, as the touch Undo does), Back opens
 *     the pause menu, and a swipe does nothing (decided: a stray swipe must not cost a move);
 *   - on the map: directions move the selection, OK opens, the pad's ☰ and the remote's
 *     Play/Pause open Options, and Back — the keyboard's Esc, the remote's Back — closes the
 *     record panel, or, at the root, leaves the game (tvOS requires Back at the top level to
 *     go Home). The pad's Ⓑ does nothing on the plain map, on purpose (A3).
 *
 *   - the intro (`introScreen.ts`, #215's rules): on the start splash only Ⓐ — the pad's Ⓐ,
 *     the remote's click, Space or Enter — starts; during a movie any button skips it;
 *   - the credits roll over the map: any button closes it (Back included — it never leaves
 *     the game from there).
 *
 * Each event goes to the screen up when it arrives — one can change the screen. A release
 * off the room always reaches the map's router, the intro included: a direction held while
 * Ⓐ starts a movie and let go during it must not stay held on the map (`mapKeyUp` only
 * forgets a held key, so it is harmless anywhere else). The interactive loop and every smoke
 * gate route through here, so a gate sees the routing a player does.
 *
 * The last source pressed picks the legend's glyphs (`legend.ts`).
 */
import { cutscene, loadmode, replaymode, room, showmode } from '../../src/app/gameState.js';
import { ui } from '../../src/app/screenState.js';
import { DirRepeat } from './dirRepeat.js';
import { blur as roomBlur, keyDown as roomKeyDown, keyUp as roomKeyUp } from './game.js';
import { mapBlur, mapBusy, mapKeyDown, mapKeyUp, mapPanelOpen } from './mapScreen.js';
import { menuAct, menuOpen, openConfirm, openOptions, openPause, type MenuAct } from './menus.js';
import { roomLoading } from './seams/framePacing.js';
import { introKeyDown } from './introScreen.js';

export type InputSource = 'key' | 'pad' | 'remote';

let last: InputSource = 'key';

/** The source of the last press: the legend shows its glyphs. */
export function lastInput(): InputSource {
  return last;
}

/** Start as `source` before anything is pressed (tvOS and `--remote-keys` start as the remote). */
export function setLastInput(source: InputSource): void {
  last = source;
}

const sourceOf = (code: string): InputSource =>
  code.startsWith('Pad') ? 'pad' : code.startsWith('Remote') ? 'remote' : 'key';

/** What leaves the game at the map's root. The smoke gate swaps it to watch for it. */
let exitApp: () => void = () => __native.quit();
/**
 * Does the system own Back right now? On tvOS at the map's root it does — the remote's
 * Menu/Back goes Home, and a game must not quit itself (App Review) — so the game does
 * nothing with it there. Refreshed every frame (`inputFrame`).
 */
let systemOwnsBack = false;

/** The plain map: no record panel, no menu, no launch, no story page. */
function atMapRoot(): boolean {
  return ui.screen === 'map' && !menuOpen() && !mapPanelOpen() && !mapBusy() && !creditsUp();
}

/** The credits roll is over the map, or loading to be. */
const creditsUp = (): boolean => ui.mapOverlay === 'credits' || ui.creditsLoading;

export function setExitHandler(fn: () => void): void {
  exitApp = fn;
}

// ── Menus ───────────────────────────────────────────────────────────────────────────

const MENU_DIR: Readonly<Record<string, MenuAct>> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyI: 'up', KeyK: 'down', KeyJ: 'left', KeyL: 'right',
  PadUp: 'up', PadDown: 'down', PadLeft: 'left', PadRight: 'right',
  PadRUp: 'up', PadRDown: 'down', PadRLeft: 'left', PadRRight: 'right',
  RemoteUp: 'up', RemoteDown: 'down', RemoteLeft: 'left', RemoteRight: 'right',
  RemoteSwipeUp: 'up', RemoteSwipeDown: 'down', RemoteSwipeLeft: 'left', RemoteSwipeRight: 'right',
};
const MENU_PRESS: Readonly<Record<string, MenuAct>> = {
  Enter: 'ok', NumpadEnter: 'ok', Space: 'ok', Escape: 'back',
  PadA: 'ok', PadB: 'back', PadView: 'back', PadMenu: 'menu', PadLB: 'prev', PadRB: 'next',
  RemoteSelect: 'ok', RemoteBack: 'back',
};

/** Menu directions held, oldest first: the last one still held repeats. */
const menuHeld: string[] = [];
const menuRepeat = new DirRepeat<MenuAct>();

function menuSteer(now: number): void {
  const code = menuHeld[menuHeld.length - 1];
  const act = menuRepeat.step(code ? MENU_DIR[code]! : null, now);
  if (act) menuAct(act);
}

function menuKey(down: boolean, code: string, now: number): void {
  if (MENU_DIR[code]) {
    const i = menuHeld.indexOf(code);
    if (i >= 0) menuHeld.splice(i, 1);
    if (down) menuHeld.push(code);
    menuSteer(now);
    return;
  }
  if (!down) return;
  const act = MENU_PRESS[code] ?? (sourceOf(code) === 'key' ? 'other' : null);
  if (act) menuAct(act);
}

// ── The remote's held Play/Pause: undo, and repeat while held ───────────────────────

// The touch Undo's hold (undoButton.ts): a press that is released early is one undo; held,
// it undoes after HOLD_DELAY_MS and then every REPEAT_MS, and the release adds nothing. The
// pointer-down / tick / pointer-up / click-suppression of `bindUndoHold` becomes
// `undoHoldDown` / `undoHoldTick` / `undoHoldUp` below.
// restates src/app/undoButton.ts `export function bindUndoHold(` @ b86a83c33198
// restates src/app/undoButton.ts `const HOLD_DELAY_MS = 350;` @ eae3855a24a3
const HOLD_DELAY_MS = 350;
// restates src/app/undoButton.ts `const REPEAT_MS = 80;` @ cdaaf951096a
const REPEAT_MS = 80;

let undoHold: { owner: unknown; nextAt: number; repeated: boolean; stopped: boolean } | null = null;

/**
 * Can the held undo act? The touch Undo's `available`, minus what is the DOM's (the button
 * greyed or hidden, the page hidden) and with the native menus for its Options and Help.
 * restates src/app/undoButton.ts `const available = (): boolean =>` @ aff838f7776e
 */
function undoHoldAvailable(): boolean {
  return ui.screen === 'room' && !menuOpen() && !roomLoading && !cutscene && !loadmode && !showmode && !replaymode;
}

function undoOnce(): void {
  roomKeyDown('Minus');
  roomKeyUp('Minus');
}

function undoHoldDown(now: number): void {
  if (undoHold || !undoHoldAvailable()) return;
  undoHold = { owner: room, nextAt: now + HOLD_DELAY_MS, repeated: false, stopped: false };
}

function undoHoldUp(): void {
  const h = undoHold;
  undoHold = null;
  if (h && !h.repeated && !h.stopped && undoHoldAvailable()) undoOnce();
}

function undoHoldTick(now: number): void {
  const h = undoHold;
  if (!h || h.stopped || now < h.nextAt) return;
  if (!undoHoldAvailable()) {
    h.stopped = true; // and the release does nothing either
    return;
  }
  // A death auto-restart replaced the room: stop repeating, but a press that has not
  // repeated yet still undoes on release (undoButton.ts's `tick`).
  if (room !== h.owner) {
    h.nextAt = Infinity;
    return;
  }
  h.repeated = true;
  undoOnce();
  h.owner = room; // undo rebuilds the room itself; that replacement is accepted
  h.nextAt = now + REPEAT_MS;
}

// ── The room ────────────────────────────────────────────────────────────────────────

/** The pad's buttons in a room, as the keyboard keys the room's router reads. */
const PAD_ROOM: Readonly<Record<string, string>> = {
  PadUp: 'KeyI', PadDown: 'KeyK', PadLeft: 'KeyJ', PadRight: 'KeyL',
  PadRUp: 'KeyW', PadRDown: 'KeyS', PadRLeft: 'KeyA', PadRRight: 'KeyD',
  PadA: 'Space', PadY: 'Minus',
};
/** The remote's clicks in a room: an edge moves the active fish, the centre switches. */
const REMOTE_ROOM: Readonly<Record<string, string>> = {
  RemoteUp: 'ArrowUp', RemoteDown: 'ArrowDown', RemoteLeft: 'ArrowLeft', RemoteRight: 'ArrowRight',
  RemoteSelect: 'Space',
};

function roomKey(down: boolean, code: string, now: number): void {
  const key = PAD_ROOM[code] ?? REMOTE_ROOM[code];
  if (key) {
    if (down) roomKeyDown(key);
    else roomKeyUp(key);
    return;
  }
  if (code === 'RemotePlayPause') {
    if (down) undoHoldDown(now);
    else undoHoldUp();
    return;
  }
  if (sourceOf(code) === 'key' && code !== 'Escape') {
    if (down) roomKeyDown(code);
    else roomKeyUp(code);
    return;
  }
  if (!down) return;
  switch (code) {
    case 'Escape':
    case 'PadMenu':
    case 'RemoteBack':
      openPause();
      return;
    case 'PadB':
    case 'PadView':
      roomKeyDown('Escape'); // straight to the map, as on the web
      return;
    case 'PadLB':
      openConfirm('save');
      return;
    case 'PadRB':
      openConfirm('load');
      return;
    case 'PadX':
      openConfirm('restart');
      return;
    default:
      return; // swipes, and the pad's unused buttons
  }
}

// ── The map ─────────────────────────────────────────────────────────────────────────

/** The pad's and the remote's map inputs, as the keys `mapScreen.ts` reads. */
const MAP_KEYS: Readonly<Record<string, string>> = {
  PadUp: 'ArrowUp', PadDown: 'ArrowDown', PadLeft: 'ArrowLeft', PadRight: 'ArrowRight',
  PadRUp: 'KeyW', PadRDown: 'KeyS', PadRLeft: 'KeyA', PadRRight: 'KeyD',
  PadA: 'Space', PadB: 'Escape',
  RemoteUp: 'ArrowUp', RemoteDown: 'ArrowDown', RemoteLeft: 'ArrowLeft', RemoteRight: 'ArrowRight',
  RemoteSwipeUp: 'KeyI', RemoteSwipeDown: 'KeyK', RemoteSwipeLeft: 'KeyJ', RemoteSwipeRight: 'KeyL',
  RemoteSelect: 'Space',
};

function mapKey(down: boolean, code: string): void {
  if (ui.screen === 'legimage' || ui.mapOverlay === 'credits') {
    if (down) mapKeyDown(code); // any button continues, or closes the roll
    else mapKeyUp(code);
    return;
  }
  const back = code === 'RemoteBack' || code === 'Escape';
  if (back || code === 'PadMenu' || code === 'RemotePlayPause') {
    if (!down || mapBusy() || ui.creditsLoading) return;
    if (!back) openOptions();
    else if (mapPanelOpen()) mapKeyDown('Escape'); // daCancel
    else if (!systemOwnsBack) exitApp(); // Back at the root; on tvOS the system takes it Home
    return;
  }
  const key = MAP_KEYS[code] ?? (sourceOf(code) === 'key' ? code : null);
  if (!key) return;
  if (down) mapKeyDown(key);
  else mapKeyUp(key);
}

// ── The intro ───────────────────────────────────────────────────────────────────────

/** The splash's start button, from the pad and the remote (the keyboard's Space/Enter pass as they are). */
const INTRO_START: Readonly<Record<string, string>> = { PadA: 'Space', RemoteSelect: 'Space' };

// ── Entry points ────────────────────────────────────────────────────────────────────

/** One event from `__native.events()`: `+Code`, `-Code` or `!blur`. */
export function routeEvent(ev: string, now: number = __native.now()): void {
  if (ev === '!blur') {
    inputBlur();
    return;
  }
  const down = ev[0] === '+';
  const code = ev.slice(1);
  if (down) last = sourceOf(code);
  if (!down && code === 'RemotePlayPause' && undoHold) {
    undoHoldUp(); // wherever the release lands — a menu, the map — the hold ends with it
    return;
  }
  if (menuOpen() || menuHeld.includes(code)) menuKey(down, code, now);
  else if (ui.screen === 'room') roomKey(down, code, now);
  else if (ui.screen === 'intro' && down) introKeyDown(INTRO_START[code] ?? code);
  else mapKey(down, code);
}

/** Once a frame: who owns Back, menu repeat, the held undo. */
export function inputFrame(now: number): void {
  systemOwnsBack = __native.systemBack(atMapRoot());
  if (menuOpen()) menuSteer(now);
  else if (menuHeld.length) {
    menuHeld.length = 0; // the menu closed under a held direction
    menuRepeat.step(null, now);
  }
  undoHoldTick(now);
}

/** Focus lost: no held input's release will arrive. */
export function inputBlur(): void {
  roomBlur();
  mapBlur();
  menuHeld.length = 0;
  menuRepeat.step(null, 0);
  if (undoHold) undoHold.stopped = true;
  undoHold = null;
}
