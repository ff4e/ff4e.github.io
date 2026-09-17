import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  num: 0, tier: 'ai', loading: false, pending: false, fatal: false,
  ui: { screen: 'room' },
}));
vi.mock('../src/app/art.js', () => ({
  get curNum() { return state.num; }, roomArtPending: () => state.pending,
}));
vi.mock('../src/app/renderSettings.js', () => ({ get graphics() { return state.tier; } }));
vi.mock('../src/app/framePacing.js', () => ({ get roomLoading() { return state.loading; } }));
vi.mock('../src/app/loadingUi.js', () => ({ fatalShown: () => state.fatal }));
vi.mock('../src/app/screenState.js', () => ({ ui: state.ui }));
vi.mock('../src/platform/nativeMenuIcons.js', () => ({ applyRusticIcons: vi.fn() }));

let menu: typeof import('../src/app/nativeMenu.js');
let root: {
  setAttribute: ReturnType<typeof vi.fn>;
  style: { setProperty: ReturnType<typeof vi.fn>; removeProperty: ReturnType<typeof vi.fn> };
  dataset: Record<string, string>;
};
beforeEach(async () => {
  vi.resetModules();
  Object.assign(state, { num: 0, tier: 'ai', loading: false, pending: false, fatal: false });
  state.ui.screen = 'room';
  root = { setAttribute: vi.fn(), style: { setProperty: vi.fn(), removeProperty: vi.fn() }, dataset: {} };
  vi.stubGlobal('document', { documentElement: root });
  menu = await import('../src/app/nativeMenu.js');
});
afterEach(() => vi.unstubAllGlobals());

describe('native menu lifecycle', () => {
  it('does no work until the native initializer is called', () => {
    state.num = 6;
    menu.syncNativeMenu();
    expect(root.setAttribute).not.toHaveBeenCalled();
    expect(root.style.setProperty).not.toHaveBeenCalled();
  });
  it('can initialize before boot has loaded the first room', () => {
    expect(() => menu.initNativeMenu()).not.toThrow();
    expect(root.setAttribute).toHaveBeenCalledWith('data-native-menu', '');
    expect(root.style.setProperty).not.toHaveBeenCalled();
    state.num = 6;
    menu.syncNativeMenu();
    expect(root.dataset.nativeMenuHue).toBe('33');
  });
  it('does not rewrite styles on steady frames', () => {
    state.num = 6;
    menu.initNativeMenu();
    root.style.setProperty.mockClear();
    for (let i = 0; i < 100; i++) menu.syncNativeMenu();
    expect(root.style.setProperty).not.toHaveBeenCalled();
  });
  it('waits for room and art loading, and does not fight fatal errors', () => {
    state.num = 6;
    menu.initNativeMenu();
    state.num = 44;
    for (const hold of ['loading', 'pending', 'fatal'] as const) {
      state[hold] = true;
      menu.syncNativeMenu();
      expect(root.dataset.nativeMenuHue).toBe('33');
      state[hold] = false;
    }
    menu.syncNativeMenu();
    expect(root.dataset.nativeMenuHue).toBe('146');
  });
  it('keeps the approved hue through tier changes and revisits', () => {
    state.num = 6;
    menu.initNativeMenu();
    state.tier = 'classic';
    menu.syncNativeMenu();
    expect(root.dataset.nativeMenuHue).toBe('33');
    expect(root.dataset.nativeMenuTier).toBe('classic');
    state.num = 44;
    menu.syncNativeMenu();
    state.num = 6;
    menu.syncNativeMenu();
    expect(root.dataset.nativeMenuHue).toBe('33');
  });
  it('reports missing room metadata instead of inventing an accent', () => {
    menu.initNativeMenu();
    state.num = 73;
    expect(() => menu.syncNativeMenu()).toThrow('Missing native menu palette for room 73');
  });
});
