/**
 * The native menus: the top bar, the confirm prompt, Options and the help pages — a TV's
 * replacement for the browser's panel and pointer (the controller spec's A3 "Options",
 * "Help", "Confirm prompt" and B6's top bar). This module is their state and what each press
 * does; `uiInput.ts` turns keys, the gamepad and the remote into `MenuAct`s, and
 * `menuPaint.ts` / `optionsPaint.ts` / `helpPaint.ts` draw them.
 *
 * The menus are a stack: Options opens Help over itself, the top bar opens the confirm
 * prompt, Options and Help, and Back closes the top one. The top bar (B6: TestFlight build 3
 * asked for something less invasive than a pause menu) is an Apple TV–style row of tabs
 * across the top of a room — World map · Save · Load · Restart · Options · Help — and does
 * NOT pause it: the logic steps on and the sound plays, only the input is the bar's while it
 * is up, so no fish moves. The confirm prompt does not pause either (it is the bar's, and the
 * pad's direct LB / RB / Ⓧ's, one question long). Options and Help do: they are whole panels
 * over the room, and while either is over it the room is PAUSED — the logic tick stops and
 * the sound holds its place, as the browser's help pauses (`openHelp`). Over the map only
 * Help pauses the sound, as in the browser; Options leaves the menu music playing so a volume
 * change can be heard.
 *
 * The verbs reach the game the way the keyboard's do — F2, F3, Backspace and Escape through
 * the room's router (`game.ts`'s `keyDown`) — so the browser's gates still decide: F2 is
 * refused mid-move, during a replay or in a room that cannot save, as it is there.
 */
import { helpPages } from '../../src/data/helpText.js';
import { helpScreens, ui } from '../../src/app/screenState.js';
import { inAutoPlay } from '../../src/app/solveMode.js';
import { cutscene, showmode } from '../../src/app/gameState.js';
import { undoAvailable } from '../../src/app/undo.js';
import { blur as roomBlur, canSave, keyDown, saveExists, setPaused } from './game.js';
import { audio } from './seams/audioEngine.js';
import { mapBlur } from './mapScreen.js';
import { settings, subLang } from './seams/playerSettings.js';
import { setSubtitleMode, setVolume } from './optionsModel.js';
import type { SubtitleMode, VolumeBus } from '../../src/core/settings.js';

export type Verb = 'save' | 'load' | 'restart';
export type BarItem = 'map' | 'save' | 'load' | 'restart' | 'options' | 'help';
export type OptionsRow = VolumeBus | 'subtitles' | 'help' | 'done';
/** What a press means to a menu, whatever sent it. */
export type MenuAct = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'menu' | 'prev' | 'next' | 'other';

export const BAR_ITEMS: readonly BarItem[] = ['map', 'save', 'load', 'restart', 'options', 'help'];
export const OPTIONS_ROWS: readonly OptionsRow[] = ['effect', 'voice', 'music', 'subtitles', 'help', 'done'];
const SUB_ORDER: readonly SubtitleMode[] = ['cz', 'en', 'off'];
/** The 0..12 slider range of the Options face (hud.ts `sliderIndex`). */
const SLIDER_MAX = 12;

export type Layer =
  | { readonly kind: 'bar'; sel: number }
  | { readonly kind: 'confirm'; readonly verb: Verb }
  | { readonly kind: 'options'; row: number }
  | { readonly kind: 'help' };

const stack: Layer[] = [];

/** The menu on top, or null when none is open. */
export function topMenu(): Layer | null {
  return stack[stack.length - 1] ?? null;
}

/** Every open menu, bottom first (the painter draws them in this order). */
export function openMenus(): readonly Layer[] {
  return stack;
}

export function menuOpen(): boolean {
  return stack.length > 0;
}

/**
 * May the top bar's (and the legend's) `verb` act now? Greyed when not, by the touch
 * buttons' rule: Save while CanSave, Load while this room has a save, neither during a map
 * Replay or solution playback — and nothing greyed during the KUFRIK demonstration, which is
 * teaching these very buttons. Restart is never refused.
 * restates src/app/buttonAvailability.ts `export function syncButtonAvailability(` @ b69d32fe95c0
 */
export function verbAvailable(verb: Verb | 'undo'): boolean {
  if (verb === 'restart') return true;
  const demo = showmode !== null;
  if (demo) return true;
  if (inAutoPlay()) return false;
  return verb === 'save' ? canSave() : verb === 'load' ? saveExists() : undoAvailable();
}

export function barItemEnabled(item: BarItem): boolean {
  return item === 'save' || item === 'load' || item === 'restart' ? verbAvailable(item) : true;
}

/**
 * Pause a room for as long as a whole panel — Options or Help — is over it (the top bar and
 * the confirm prompt leave it running); hold the sound under Help anywhere (the browser's
 * `openHelp` / `closeHelp`).
 */
function syncPause(): void {
  const panel = stack.some((l) => l.kind === 'options' || l.kind === 'help');
  const overRoom = panel && ui.screen === 'room';
  setPaused(overRoom);
  audio.setModalPause(overRoom || stack.some((l) => l.kind === 'help'));
}

function push(l: Layer): void {
  if (!stack.length) {
    // A direction held on the map, or a fish's held move in a room, must not go on under the
    // menu: its release will be the menu's.
    mapBlur();
    roomBlur();
  }
  stack.push(l);
  syncPause();
}

function pop(): void {
  stack.pop();
  syncPause();
}

/** Close every menu. */
export function closeMenus(): void {
  stack.length = 0;
  syncPause();
}

/**
 * Back/Menu in a room: the top bar, its focus on Save (or the next tab that can act) — never
 * on World map, which leaves the room without asking, so a click straight after Back cannot.
 */
export function openBar(): void {
  if (stack.length) return;
  const l: Layer = { kind: 'bar', sel: BAR_ITEMS.indexOf('save') - 1 };
  moveBar(l, 1);
  push(l);
}

/**
 * The room under the top bar or a confirm prompt went away — won, left for the map, or
 * KUFRIK's story began over it — while it was up (neither pauses the room): the bar, a prompt
 * the pad's LB / RB / Ⓧ opened on its own, and anything over them, go — or the prompt would
 * stand over the map taking its input, its Yes acting on no room.
 */
export function dropStrandedMenus(): void {
  const bottom = stack[0]?.kind;
  if ((bottom === 'bar' || bottom === 'confirm') && (ui.screen !== 'room' || cutscene)) closeMenus();
}

/** A destructive verb asks first (Ⓐ yes, Ⓑ no). Nothing opens for a verb that cannot act. */
export function openConfirm(verb: Verb): void {
  if (!verbAvailable(verb)) return;
  push({ kind: 'confirm', verb });
}

export function openOptions(): void {
  push({ kind: 'options', row: 0 });
}

export function openHelp(): void {
  helpScreens.page = 0; // openHelp (panel.ts): from the first page
  push({ kind: 'help' });
}

/** The confirm prompt's yes: close everything and send the verb's key down the room's router. */
function perform(verb: Verb): void {
  closeMenus();
  keyDown(verb === 'save' ? 'F2' : verb === 'load' ? 'F3' : 'Backspace');
}

/** Focus the next tab `by` that way that can act; at the bar's end it stays (no wrap, as tvOS's). */
function moveBar(l: Extract<Layer, { kind: 'bar' }>, by: 1 | -1): void {
  for (let at = l.sel + by; at >= 0 && at < BAR_ITEMS.length; at += by) {
    if (barItemEnabled(BAR_ITEMS[at]!)) {
      l.sel = at;
      return;
    }
  }
}

function pressBar(item: BarItem): void {
  switch (item) {
    case 'map':
      closeMenus();
      keyDown('Escape'); // the room router's way back to the map
      return;
    case 'save':
    case 'load':
    case 'restart':
      openConfirm(item);
      return;
    case 'options':
      openOptions();
      return;
    case 'help':
      openHelp();
      return;
  }
}

function changeOption(row: OptionsRow, by: 1 | -1): void {
  if (row === 'effect' || row === 'voice' || row === 'music') {
    setVolume(row, Math.max(0, Math.min(SLIDER_MAX, settings.volume[row] + by)));
  } else if (row === 'subtitles') {
    const i = SUB_ORDER.indexOf(settings.subtitles);
    setSubtitleMode(SUB_ORDER[(i + by + SUB_ORDER.length) % SUB_ORDER.length]!);
  }
}

/** One press on the menu on top. */
export function menuAct(act: MenuAct): void {
  const l = topMenu();
  if (!l) return;
  switch (l.kind) {
    case 'bar':
      if (act === 'left' || act === 'prev') moveBar(l, -1);
      else if (act === 'right' || act === 'next') moveBar(l, 1);
      else if (act === 'ok') pressBar(BAR_ITEMS[l.sel]!);
      else if (act === 'down' || act === 'back' || act === 'menu') closeMenus(); // back to the room
      return;
    case 'confirm':
      if (act === 'ok') perform(l.verb);
      else if (act === 'back' || act === 'menu') pop();
      return;
    case 'options': {
      const row = OPTIONS_ROWS[l.row]!;
      if (act === 'up') l.row = (l.row + OPTIONS_ROWS.length - 1) % OPTIONS_ROWS.length;
      else if (act === 'down') l.row = (l.row + 1) % OPTIONS_ROWS.length;
      else if (act === 'left' || act === 'right') changeOption(row, act === 'right' ? 1 : -1);
      else if (act === 'ok') {
        if (row === 'help') openHelp();
        else if (row === 'done') pop();
        else if (row === 'subtitles') changeOption(row, 1); // step forward
      } else if (act === 'back' || act === 'menu') pop();
      return;
    }
    case 'help': {
      // Help.pas: arrows page (wrapping), anything else closes.
      const count = helpPages(subLang()).length;
      if (act === 'right' || act === 'next') helpScreens.next(count);
      else if (act === 'left' || act === 'prev') helpScreens.prev(count);
      else if (act !== 'up' && act !== 'down') pop();
      return;
    }
  }
}

