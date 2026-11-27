/**
 * The focus tick (native/js/focusSound.ts) and when the native menus (native/js/menus.ts)
 * play it: only a focus that really moves ticks — not one at an end that does not wrap, nor
 * one whose every target that way is greyed, nor a menu opening — and the confirm prompt's
 * OK / Cancel buttons act as a classic dialog's. The top bar opens on World map, and ignores a
 * click that comes too soon after it opened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  canSave: true, saveExists: true, keys: [] as string[],
}));
vi.mock('../src/app/screenState.js', () => ({ ui: { screen: 'room' }, helpScreens: { page: 0, next: vi.fn(), prev: vi.fn() } }));
vi.mock('../src/app/solveMode.js', () => ({ inAutoPlay: () => false }));
vi.mock('../src/app/gameState.js', () => ({ cutscene: null, showmode: null }));
vi.mock('../src/app/undo.js', () => ({ undoAvailable: () => true }));
vi.mock('../native/js/game.js', () => ({
  blur: vi.fn(), setPaused: vi.fn(),
  canSave: () => state.canSave, saveExists: () => state.saveExists,
  keyDown: (k: string) => state.keys.push(k),
}));
vi.mock('../native/js/seams/audioEngine.js', () => ({ audio: { setModalPause: vi.fn() } }));
vi.mock('../native/js/mapScreen.js', () => ({ mapBlur: vi.fn() }));
vi.mock('../native/js/seams/playerSettings.js', () => ({
  settings: { volume: { effect: 11, voice: 12, music: 6 }, subtitles: 'en' }, subLang: () => 'en',
}));
vi.mock('../native/js/optionsModel.js', () => ({ setVolume: vi.fn(), setSubtitleMode: vi.fn() }));

let focus: typeof import('../native/js/focusSound.js');
let menus: typeof import('../native/js/menus.js');
let ticks = 0;

beforeEach(async () => {
  vi.resetModules();
  Object.assign(state, { canSave: true, saveExists: true, keys: [] });
  focus = await import('../native/js/focusSound.js');
  menus = await import('../native/js/menus.js');
  ticks = 0;
  focus.setFocusSound(() => ticks++);
});

const sel = (): number => (menus.topMenu() as { sel: number }).sel;
const tab = (): string => menus.BAR_ITEMS[sel()]!;

describe('focusMoved', () => {
  it('ticks only when the focus changed, and only while audible', () => {
    expect(focus.focusMoved(2, 2)).toBe(false);
    expect(focus.focusMoved('run', 'run')).toBe(false);
    expect(ticks).toBe(0);
    expect(focus.focusMoved(2, 3)).toBe(true);
    expect(focus.focusMoved(null, 'run')).toBe(true);
    expect(ticks).toBe(2);
    let audible = false;
    focus.setFocusSound(() => ticks++, () => audible);
    expect(focus.focusMoved(0, 1)).toBe(true); // it moved, silently
    expect(ticks).toBe(2);
    audible = true;
    focus.focusMoved(1, 0);
    expect(ticks).toBe(3);
  });
  it('is harmless with nothing bound to play it', () => {
    focus.setFocusSound(null);
    expect(focus.focusMoved(0, 1)).toBe(true);
  });
});

describe('focusClickPcm', () => {
  it('is a short click that starts and ends in silence, peaking at 90 % of full scale', () => {
    const pcm = focus.focusClickPcm(22050);
    expect(pcm.length).toBe(Math.round((22050 * focus.FOCUS_CLICK_MS) / 1000));
    expect(pcm[0]).toBe(0);
    expect(pcm[pcm.length - 1]).toBe(0);
    expect(Math.max(...Array.from(pcm, Math.abs))).toBe(Math.round(0.9 * 32767));
    // Most of its energy in its first 10 ms: a tick, not a tone.
    const energy = (a: Int16Array): number => a.reduce((s, v) => s + v * v, 0);
    expect(energy(pcm.subarray(0, 220)) / energy(pcm)).toBeGreaterThan(0.9);
    expect(focus.focusClickPcm(22050)).toEqual(pcm);
  });
});

describe('the top bar', () => {
  it('opens on World map without a tick, ticks per tab, and not at either end', () => {
    menus.openBar();
    expect(tab()).toBe('map');
    expect(ticks).toBe(0);
    menus.menuAct('left'); // the bar's left end: no wrap, no tick
    expect(tab()).toBe('map');
    expect(ticks).toBe(0);
    for (let i = 0; i < 5; i++) menus.menuAct('right');
    expect(tab()).toBe('help');
    expect(ticks).toBe(5);
    menus.menuAct('next');
    expect(ticks).toBe(5);
  });
  it('runs World map · Restart · Load · Save · Options · Help, and skips greyed tabs in one tick', () => {
    expect(menus.BAR_ITEMS).toEqual(['map', 'restart', 'load', 'save', 'options', 'help']);
    state.canSave = false;
    state.saveExists = false;
    menus.openBar();
    menus.menuAct('right');
    expect(tab()).toBe('restart');
    menus.menuAct('right'); // over the greyed Load and Save to Options: one move
    expect(tab()).toBe('options');
    expect(ticks).toBe(2);
    menus.menuAct('left');
    expect(tab()).toBe('restart');
    expect(ticks).toBe(3);
  });
  it('ignores a click within BAR_CLICK_GUARD_MS of opening, and takes one after', () => {
    menus.openBar(1000);
    menus.menuAct('ok', 1000);
    menus.menuAct('ok', 1000 + menus.BAR_CLICK_GUARD_MS - 1);
    expect(menus.topMenu()?.kind).toBe('bar');
    expect(state.keys).toEqual([]);
    menus.menuAct('right', 1001); // a direction is never held back
    expect(tab()).toBe('restart');
    menus.menuAct('ok', 1000 + menus.BAR_CLICK_GUARD_MS);
    expect(menus.topMenu()?.kind).toBe('confirm');
    expect(menus.BAR_CLICK_GUARD_MS).toBeGreaterThanOrEqual(250);
  });
});

describe('the confirm prompt', () => {
  it('opens focused on OK, without a tick; left and right move between OK and Cancel, ticking, and stop at the ends', () => {
    menus.openConfirm('save');
    expect(menus.topMenu()?.kind).toBe('confirm');
    expect(sel()).toBe(0);
    expect(ticks).toBe(0);
    menus.menuAct('left');
    expect([sel(), ticks]).toEqual([0, 0]);
    menus.menuAct('right');
    expect([sel(), ticks]).toEqual([1, 1]);
    menus.menuAct('right');
    expect([sel(), ticks]).toEqual([1, 1]);
    menus.menuAct('up');
    menus.menuAct('down');
    expect([sel(), ticks]).toEqual([1, 1]);
    menus.menuAct('left');
    expect([sel(), ticks]).toEqual([0, 2]);
  });
  it('OK performs the verb; Cancel and Back close the prompt without it', () => {
    menus.openConfirm('save');
    menus.menuAct('ok');
    expect(menus.menuOpen()).toBe(false);
    expect(state.keys).toEqual(['F2']);
    menus.openBar();
    for (let i = 0; i < 3; i++) menus.menuAct('right');
    menus.menuAct('ok'); // Save on the bar opens its prompt
    expect(menus.topMenu()?.kind).toBe('confirm');
    menus.menuAct('right');
    menus.menuAct('ok'); // Cancel: back on the bar
    expect(menus.topMenu()?.kind).toBe('bar');
    menus.menuAct('ok');
    menus.menuAct('back'); // Back cancels with OK focused too
    expect(menus.topMenu()?.kind).toBe('bar');
    expect(state.keys).toEqual(['F2']);
  });
  it('opens for a verb that cannot act: never', () => {
    state.saveExists = false;
    menus.openConfirm('load');
    expect(menus.menuOpen()).toBe(false);
  });
});

describe('Options', () => {
  it('ticks per row, wrapping, and not for a value change', () => {
    menus.openOptions();
    menus.menuAct('up'); // wraps to Done: a move
    expect((menus.topMenu() as { row: number }).row).toBe(menus.OPTIONS_ROWS.length - 1);
    menus.menuAct('down');
    menus.menuAct('down');
    expect(ticks).toBe(3);
    menus.menuAct('right');
    menus.menuAct('left');
    expect(ticks).toBe(3);
  });
});
