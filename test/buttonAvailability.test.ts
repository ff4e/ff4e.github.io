import { beforeEach, describe, expect, it, vi } from 'vitest';

const SEDY = 0;
const ORANZOVY = 1;
const state = {
  touch: true,
  screen: 'room',
  showmode: null as object | null,
  autoplay: false,
  undo: true,
  panel: { save: ORANZOVY, load: ORANZOVY },
};
vi.mock('../src/render/hud.js', () => ({ SEDY }));
vi.mock('../src/app/gameState.js', () => ({ get showmode() { return state.showmode; } }));
vi.mock('../src/app/panel.js', () => ({ panelState: () => state.panel }));
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

beforeEach(() => {
  Object.assign(state, {
    touch: true, screen: 'room', showmode: null, autoplay: false, undo: true,
    panel: { save: ORANZOVY, load: ORANZOVY },
  });
  syncButtonAvailability();
});

describe('touch button availability', () => {
  it('leaves every button pressable when each would act', () => {
    expect(greyed()).toEqual(all(false));
  });

  it('greys Load with no save, following the original panel', () => {
    state.panel = { save: ORANZOVY, load: SEDY };
    syncButtonAvailability();
    expect(greyed()).toEqual({ save: [false, false], load: [true, true], undo: [false, false] });
  });

  it('greys Save while CanSave is false, following the original panel', () => {
    state.panel = { save: SEDY, load: ORANZOVY };
    syncButtonAvailability();
    expect(greyed()).toEqual({ save: [true, true], load: [false, false], undo: [false, false] });
  });

  it('greys Undo with nothing to take back', () => {
    state.undo = false;
    syncButtonAvailability();
    expect(greyed()).toEqual({ save: [false, false], load: [false, false], undo: [true, true] });
  });

  it('greys all three during a map Replay or solution playback', () => {
    state.autoplay = true;
    syncButtonAvailability();
    expect(greyed()).toEqual(all(true));
  });

  it('greys nothing during the KUFRIK demonstration, whatever else holds', () => {
    Object.assign(state, { showmode: {}, autoplay: true, undo: false, panel: { save: SEDY, load: SEDY } });
    syncButtonAvailability();
    expect(greyed()).toEqual(all(false));
  });

  it('restores a button as soon as it would act again', () => {
    state.undo = false;
    syncButtonAvailability();
    state.undo = true;
    syncButtonAvailability();
    expect(greyed()).toEqual(all(false));
    expect(els[24][0]!.attrs.has('aria-disabled')).toBe(false);
  });

  it.each([
    ['desktop', () => { state.touch = false; }],
    ['map', () => { state.screen = 'map'; }],
  ])('leaves hidden buttons alone on %s', (_name, leave) => {
    state.autoplay = true;
    leave();
    syncButtonAvailability();
    expect(greyed()).toEqual(all(false));
  });
});
