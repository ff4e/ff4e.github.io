/**
 * The briefcase demo's ✕ (src/app/cutsceneClose.ts) and the phone corners standing aside
 * for it (src/app/phoneControls.ts). The tablet bar's half is in touchButtons.test.ts.
 *
 * Units, not a probe: both are one predicate over state, and what a browser adds — that
 * the button is where it should be and a real click reaches it — is in
 * tools/test-kufrikdemo.mjs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ cutscene: null as object | null }));
const button = vi.hoisted(() => ({
  hidden: true,
  listeners: new Map<string, (e: { detail: number }) => void>(),
  addEventListener(type: string, fn: (e: { detail: number }) => void) { this.listeners.set(type, fn); },
  blur: () => {},
}));
const skipCutscene = vi.hoisted(() => vi.fn());
vi.mock('../src/app/dom.js', () => ({ cutsceneClose: button }));
vi.mock('../src/app/cutscene.js', () => ({ skipCutscene }));
vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/gameState.js', () => ({ room: null, get cutscene() { return state.cutscene; } }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => true }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => false }));

import { initCutsceneClose, syncCutsceneClose } from '../src/app/cutsceneClose.js';
import { ui } from '../src/app/screenState.js';

beforeEach(() => {
  state.cutscene = null;
  ui.screen = 'room';
  ui.helpOpen = false;
  button.hidden = true;
  skipCutscene.mockClear();
});

describe('the briefcase demo close button', () => {
  it('is up only while the demo is what the room shows', () => {
    syncCutsceneClose();
    expect(button.hidden).toBe(true);
    state.cutscene = {};
    syncCutsceneClose();
    expect(button.hidden).toBe(false);
    ui.helpOpen = true;
    syncCutsceneClose();
    expect(button.hidden).toBe(true);
    ui.helpOpen = false;
    ui.screen = 'map';
    syncCutsceneClose();
    expect(button.hidden).toBe(true);
    ui.screen = 'room';
    state.cutscene = null;
    syncCutsceneClose();
    expect(button.hidden).toBe(true);
  });

  it('skips the demo when clicked, and does nothing once it is over', () => {
    initCutsceneClose();
    const click = button.listeners.get('click')!;
    state.cutscene = {};
    click({ detail: 1 });
    expect(skipCutscene).toHaveBeenCalledTimes(1);
    state.cutscene = null;
    click({ detail: 1 });
    expect(skipCutscene).toHaveBeenCalledTimes(1);
  });
});

describe('the phone corner controls', () => {
  const controls = { hidden: true, querySelectorAll: () => [], addEventListener: vi.fn(), contains: () => false };
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    vi.stubGlobal('document', {
      getElementById: (id: string) =>
        id === 'phone-controls' ? controls : { hidden: true, addEventListener: vi.fn(), setAttribute: vi.fn() },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stand aside for the briefcase demo, whose close button takes their corner', async () => {
    const phone = await import('../src/app/phoneControls.js');
    phone.initPhoneControls({ panelAction: vi.fn() });
    phone.syncPhoneControls();
    expect(controls.hidden).toBe(false);
    state.cutscene = {};
    phone.syncPhoneControls();
    expect(controls.hidden).toBe(true);
    state.cutscene = null;
    phone.syncPhoneControls();
    expect(controls.hidden).toBe(false);
  });
});
