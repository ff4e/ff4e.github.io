import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  touch: true,
  screen: 'room',
  room: { canSave: true } as { canSave: boolean } | null,
  showmode: null as object | null,
  autoplay: false,
  undo: true,
  hasSave: true,
  saves: 0,
};
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; },
  get showmode() { return state.showmode; },
}));
const panelSaveExists = vi.fn(() => state.hasSave);
vi.mock('../src/app/panel.js', () => ({ panelSaveExists }));
vi.mock('../src/app/roomActionEvent.js', () => ({ savesReported: () => state.saves }));
vi.mock('../src/app/screenState.js', () => ({ ui: state }));
vi.mock('../src/app/solveMode.js', () => ({ inAutoPlay: () => state.autoplay }));
vi.mock('../src/app/touchButtons.js', () => ({ touchUi: () => state.touch }));
vi.mock('../src/app/undo.js', () => ({ undoAvailable: () => state.undo }));

const { syncButtonAvailability } = await import('../src/app/buttonAvailability.js');

class Btn {
  attrs = new Map<string, string>();
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  setAttribute(n: string, v: string) { this.attrs.set(n, v); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  get greyed() { return this.getAttribute('aria-disabled') === 'true'; }
}
// Tablet bar and phone corners/menu each have their own Save, Load and Undo.
const els = { 12: [new Btn(), new Btn()], 13: [new Btn(), new Btn()], 24: [new Btn(), new Btn()] };
const querySelectorAll = vi.fn((sel: string) => {
  const region = Number(/data-region="(\d+)"/.exec(sel)?.[1]) as keyof typeof els;
  return els[region] ?? [];
});
vi.stubGlobal('document', { querySelectorAll });

const greyed = () => ({
  save: els[12].map((b) => b.greyed),
  load: els[13].map((b) => b.greyed),
  undo: els[24].map((b) => b.greyed),
});
const all = (v: boolean) => ({ save: [v, v], load: [v, v], undo: [v, v] });

// Each test gets a fresh room, so the throttled save read starts over.
let now = 0;
const sync = () => syncButtonAvailability(now);
beforeEach(() => {
  Object.assign(state, {
    touch: true, screen: 'room', room: { canSave: true }, showmode: null, autoplay: false, undo: true,
    hasSave: true, saves: 0,
  });
  now += 10_000;
  sync();
  panelSaveExists.mockClear();
});

describe('touch button availability', () => {
  it('leaves every button pressable when each would act', () => {
    expect(greyed()).toEqual(all(false));
  });

  it('greys Load with no save, following the original panel', () => {
    state.hasSave = false;
    state.room = { canSave: true };
    sync();
    expect(greyed()).toEqual({ save: [false, false], load: [true, true], undo: [false, false] });
  });

  it('greys Save while CanSave is false, following the original panel', () => {
    state.room = { canSave: false };
    sync();
    expect(greyed()).toEqual({ save: [true, true], load: [false, false], undo: [false, false] });
  });

  it('greys Undo with nothing to take back', () => {
    state.undo = false;
    sync();
    expect(greyed()).toEqual({ save: [false, false], load: [false, false], undo: [true, true] });
  });

  it('greys all three during a map Replay or solution playback', () => {
    state.autoplay = true;
    sync();
    expect(greyed()).toEqual(all(true));
  });

  it('greys nothing during the KUFRIK demonstration, whatever else holds', () => {
    Object.assign(state, { showmode: {}, autoplay: true, undo: false, hasSave: false, room: { canSave: false } });
    sync();
    expect(greyed()).toEqual(all(false));
  });

  it('restores a button as soon as it would act again', () => {
    state.undo = false;
    sync();
    state.undo = true;
    sync();
    expect(greyed()).toEqual(all(false));
    expect(els[24][0]!.attrs.has('aria-disabled')).toBe(false);
  });

  it('reads the save slot only on a new room, a save, or once a second', () => {
    for (let i = 0; i < 30; i++) { now += 16; sync(); }
    expect(panelSaveExists).not.toHaveBeenCalled();
    state.hasSave = false;
    state.room = { canSave: true }; // enter, restart, load or undo: a rebuilt room
    sync();
    expect(panelSaveExists).toHaveBeenCalledTimes(1);
    expect(greyed().load).toEqual([true, true]);
    state.hasSave = true;
    state.saves++;
    sync();
    expect(panelSaveExists).toHaveBeenCalledTimes(2);
    expect(greyed().load).toEqual([false, false]);
    state.hasSave = false; // cleared from outside: another tab, a probe
    now += 999;
    sync();
    expect(greyed().load).toEqual([false, false]);
    now += 1;
    sync();
    expect(panelSaveExists).toHaveBeenCalledTimes(3);
    expect(greyed().load).toEqual([true, true]);
  });

  it.each([
    ['desktop', () => { state.touch = false; }],
    ['map', () => { state.screen = 'map'; }],
  ])('leaves hidden buttons alone on %s', (_name, leave) => {
    state.autoplay = true;
    leave();
    sync();
    expect(greyed()).toEqual(all(false));
  });
});
