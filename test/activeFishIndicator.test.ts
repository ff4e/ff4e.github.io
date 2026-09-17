import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  room: { alive: { little: true, big: true } } as { alive: { little: boolean; big: boolean } } | null,
  engine: { active: 'little' } as { active: 'little' | 'big' } | null,
  loading: false, pending: false, entryHeld: false, fatal: false, solving: false,
  cutscene: false, loadmode: false, replaymode: false, showmode: false,
}));
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; }, get engine() { return state.engine; },
  get cutscene() { return state.cutscene; }, get loadmode() { return state.loadmode; },
  get replaymode() { return state.replaymode; }, get showmode() { return state.showmode; },
}));
vi.mock('../src/app/art.js', () => ({ roomArtPending: () => state.pending }));
vi.mock('../src/app/roomLoad.js', () => ({ roomEntryHeld: () => state.entryHeld }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => state.solving }));
vi.mock('../src/app/framePacing.js', () => ({ get roomLoading() { return state.loading; } }));
vi.mock('../src/app/loadingUi.js', () => ({
  fatalShown: () => state.fatal, showFatal: vi.fn(() => { state.fatal = true; }),
}));
vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));

class Element {
  id = '';
  className = '';
  hidden = true;
  complete = true;
  naturalWidth = 48;
  src = '';
  alt = '';
  draggable = true;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, () => void> = {};
  setAttribute = vi.fn((name: string, value: string) => { this.attributes[name] = value; });
  addEventListener(name: string, listener: () => void) { this.listeners[name] = listener; }
  append(...children: Element[]) { this.children.push(...children); }
}

let controls: Element;
let module: typeof import('../src/app/activeFishIndicator.js');
beforeEach(async () => {
  vi.resetModules();
  Object.assign(state, {
    room: { alive: { little: true, big: true } }, engine: { active: 'little' },
    loading: false, pending: false, entryHeld: false, fatal: false, solving: false,
    cutscene: false, loadmode: false, replaymode: false, showmode: false,
  });
  controls = new Element();
  vi.stubGlobal('document', {
    createElement: () => new Element(),
    getElementById: () => controls,
  });
  module = await import('../src/app/activeFishIndicator.js');
});
afterEach(() => vi.unstubAllGlobals());

describe('active fish badge lifecycle', () => {
  it('does nothing until explicitly initialized; initialization is idempotent', () => {
    module.syncActiveFishIndicator(true);
    expect(controls.children).toHaveLength(0);
    module.initActiveFishIndicator();
    module.initActiveFishIndicator();
    expect(controls.children).toHaveLength(1);
    expect(controls.children[0]!.className).toBe('tbtn');
    expect(controls.children[0]!.hidden).toBe(true);
  });
  it('uses distinct real fish art and follows selection without mutating it', () => {
    module.initActiveFishIndicator();
    module.syncActiveFishIndicator(true);
    const badge = controls.children[0]!;
    expect(badge.dataset).toEqual({ fish: 'little' });
    expect(badge.attributes['aria-label']).toBe('Active fish: small orange fish');
    expect(badge.children.map(p => p.hidden)).toEqual([false, true]);
    expect(badge.children[0]!.src).not.toBe(badge.children[1]!.src);
    state.engine!.active = 'big';
    state.room!.alive.little = false;
    module.syncActiveFishIndicator(true);
    expect(badge.dataset.fish).toBe('big');
    expect(badge.attributes['aria-label']).toBe('Active fish: big blue fish');
    expect(badge.children.map(p => p.hidden)).toEqual([true, false]);
    expect(state.engine!.active).toBe('big');
    expect(state.room!.alive).toEqual({ little: false, big: true });
  });
  it('does not rewrite the picture or accessible name on steady frames', () => {
    module.initActiveFishIndicator();
    module.syncActiveFishIndicator(true);
    const badge = controls.children[0]!;
    badge.setAttribute.mockClear();
    for (let i = 0; i < 50; i++) module.syncActiveFishIndicator(true);
    expect(badge.setAttribute).not.toHaveBeenCalled();
  });
  it.each(['loading', 'pending', 'entryHeld', 'fatal', 'cutscene', 'loadmode', 'replaymode', 'showmode', 'solving'] as const)(
    'hides during %s and restores the current selection afterwards', (hold) => {
      module.initActiveFishIndicator();
      module.syncActiveFishIndicator(true);
      const badge = controls.children[0]!;
      expect(badge.hidden).toBe(false);
      state[hold] = true;
      module.syncActiveFishIndicator(true);
      expect(badge.hidden).toBe(true);
      state.engine!.active = 'big';
      state[hold] = false;
      module.syncActiveFishIndicator(true);
      expect(badge.hidden).toBe(false);
      expect(badge.dataset.fish).toBe('big');
    },
  );
  it('hides with controls/menus and when the active fish is unavailable', () => {
    module.initActiveFishIndicator();
    module.syncActiveFishIndicator(false);
    const badge = controls.children[0]!;
    expect(badge.hidden).toBe(true);
    state.room!.alive.little = false;
    module.syncActiveFishIndicator(true);
    expect(badge.hidden).toBe(true);
    expect(state.engine!.active).toBe('little');
    state.room = null;
    expect(() => module.syncActiveFishIndicator(true)).not.toThrow();
    state.engine = null;
    expect(() => module.syncActiveFishIndicator(true)).not.toThrow();
  });
  it('never shows a blank picture, and surfaces decoding failures', () => {
    module.initActiveFishIndicator();
    const badge = controls.children[0]!;
    const little = badge.children[0]!;
    little.complete = false;
    module.syncActiveFishIndicator(true);
    expect(badge.hidden).toBe(true);
    little.complete = true;
    little.naturalWidth = 0;
    module.syncActiveFishIndicator(true);
    expect(badge.hidden).toBe(true);
    little.listeners.error!();
    expect(state.fatal).toBe(true);
  });
});
