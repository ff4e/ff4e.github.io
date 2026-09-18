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
vi.mock('../src/app/touchSwipe.js', () => ({ switchFishFromTouch: vi.fn() }));

class Element {
  constructor(readonly tagName = 'div') {}
  id = '';
  type = '';
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
  parentElement: Element | null = null;
  listeners: Record<string, (event: Event) => void> = {};
  blur = vi.fn(() => { if (focused === this) focused = null; });
  focus = vi.fn(() => { focused = this; });
  setAttribute = vi.fn((name: string, value: string) => { this.attributes[name] = value; });
  addEventListener(name: string, listener: (event: Event) => void) { this.listeners[name] = listener; }
  append(...children: Element[]) {
    for (const child of children) {
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter(el => el !== child);
      }
      child.parentElement = this;
      this.children.push(child);
    }
  }
}

let controls: Element;
let focused: Element | null;
let module: typeof import('../src/app/activeFishIndicator.js');
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  focused = null;
  Object.assign(state, {
    room: { alive: { little: true, big: true } }, engine: { active: 'little' },
    loading: false, pending: false, entryHeld: false, fatal: false, solving: false,
    cutscene: false, loadmode: false, replaymode: false, showmode: false,
  });
  controls = new Element();
  vi.stubGlobal('document', {
    createElement: (tagName: string) => new Element(tagName),
    getElementById: () => controls,
    get activeElement() { return focused; },
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
    expect(controls.children[0]!.tagName).toBe('button');
    expect(controls.children[0]!.type).toBe('button');
  });
  it('uses distinct real fish art and follows selection without mutating it', () => {
    module.initActiveFishIndicator();
    module.syncActiveFishIndicator(true);
    const badge = controls.children[0]!;
    expect(badge.dataset).toEqual({ fish: 'little' });
    expect(badge.attributes['aria-label']).toBe('Active fish: small orange fish. Switch fish');
    expect(badge.children.map(p => p.hidden)).toEqual([false, true]);
    expect(badge.children[0]!.src).not.toBe(badge.children[1]!.src);
    state.engine!.active = 'big';
    state.room!.alive.little = false;
    module.syncActiveFishIndicator(true);
    expect(badge.dataset.fish).toBe('big');
    expect(badge.attributes['aria-label']).toBe('Active fish: big blue fish. Switch fish');
    expect(badge.children.map(p => p.hidden)).toEqual([true, false]);
    expect(state.engine!.active).toBe('big');
    expect(state.room!.alive).toEqual({ little: false, big: true });
  });
  it('moves the same badge and loaded pictures between phone and tablet controls', () => {
    const tablet = new Element();
    vi.stubGlobal('document', {
      createElement: () => new Element(),
      getElementById: (id: string) => id === 'touchbar' ? tablet : controls,
    });
    module.initActiveFishIndicator('touchbar');
    module.syncActiveFishIndicator(true);
    const badge = tablet.children[0]!;
    const pictures = [...badge.children];
    expect(badge.dataset.fish).toBe('little');
    for (let i = 0; i < 2; i++) {
      module.initActiveFishIndicator('phone-controls');
      module.initActiveFishIndicator('phone-controls');
      expect(tablet.children).toEqual([]);
      expect(controls.children).toEqual([badge]);
      module.initActiveFishIndicator('touchbar');
      module.initActiveFishIndicator('touchbar');
      expect(controls.children).toEqual([]);
      expect(tablet.children).toEqual([badge]);
      expect(badge.children[0]).toBe(pictures[0]);
      expect(badge.children[1]).toBe(pictures[1]);
    }
  });
  it('reports a missing indicator container instead of silently dropping the display', () => {
    vi.stubGlobal('document', { getElementById: () => null });
    expect(() => module.initActiveFishIndicator('touchbar')).toThrow('requires touchbar');
  });
  it.each([0, 1])('dispatches the room-tap action once and preserves only keyboard focus (detail=%s)', async (detail) => {
    const { switchFishFromTouch } = await import('../src/app/touchSwipe.js');
    module.initActiveFishIndicator();
    module.initActiveFishIndicator();
    module.syncActiveFishIndicator(true);
    const button = controls.children[0]!;
    focused = button;
    vi.mocked(switchFishFromTouch).mockImplementationOnce(() => {
      expect(focused).toBe(null);
    });
    button.listeners.click!(Object.assign(new Event('click'), { detail }));
    expect(switchFishFromTouch).toHaveBeenCalledOnce();
    expect(focused).toBe(detail === 0 ? button : null);
  });
  it('never routes an activation while hidden', async () => {
    const { switchFishFromTouch } = await import('../src/app/touchSwipe.js');
    module.initActiveFishIndicator();
    controls.children[0]!.listeners.click!(Object.assign(new Event('click'), { detail: 0 }));
    expect(switchFishFromTouch).not.toHaveBeenCalled();
  });
  it.each(['Space', 'Enter'])('leaves %s activation to the native button without a second gameplay key', (code) => {
    module.initActiveFishIndicator();
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code });
    const stop = vi.spyOn(event, 'stopPropagation');
    controls.children[0]!.listeners.keydown!(event);
    expect(stop).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
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
    little.listeners.error!(new Event('error'));
    expect(state.fatal).toBe(true);
  });
});
