import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mode = vi.hoisted(() => ({ touch: true, phone: false }));
const dom = vi.hoisted(() => {
  const home = { append: vi.fn() };
  return { home, panelCol: { parentElement: home, style: { display: '' } } };
});
vi.mock('../src/app/dom.js', () => ({ panelCol: dom.panelCol }));
vi.mock('../src/app/touchButtons.js', () => ({
  touchUi: () => mode.touch, phoneUi: () => mode.phone,
}));
vi.mock('../src/app/playerSettings.js', () => ({
  settings: { volume: { effect: 6, voice: 7, music: 8 }, subtitles: 'en' },
}));
import { O_NORMAL, O_OPTIONS, SCMAX, SCMIN, ui } from '../src/app/screenState.js';
import {
  canvasTouchOptionsOpen, closeTouchOptions, openTouchOptions, syncTouchOptions,
  toggleTouchOptions, touchOptionsOpen,
} from '../src/app/touchOptions.js';

const overlay = { hidden: true, prepend: vi.fn(), toggleAttribute: vi.fn() };

beforeEach(() => {
  vi.stubGlobal('document', {
    getElementById: (id: string) => id === 'touchopts' ? overlay : null,
    querySelectorAll: () => [],
    documentElement: { toggleAttribute: vi.fn() },
  });
  mode.touch = true;
  mode.phone = false;
  ui.screen = 'room';
  ui.helpOpen = false;
  ui.ostav = O_NORMAL;
  ui.panelDragBus = null;
  ui.panelPressed = 0;
  overlay.hidden = true;
  vi.clearAllMocks();
});
afterEach(() => {
  closeTouchOptions();
  vi.unstubAllGlobals();
});

describe('touch Options presentation', () => {
  it('borrows the original panel on a tablet and restores it on close', () => {
    openTouchOptions();
    expect(touchOptionsOpen()).toBe(true);
    expect(canvasTouchOptionsOpen()).toBe(true);
    expect(overlay.prepend).toHaveBeenCalledExactlyOnceWith(dom.panelCol);
    expect(overlay.toggleAttribute).toHaveBeenCalledWith('data-canvas-options', true);
    expect(overlay.hidden).toBe(false);
    expect(ui.ostav).toBe(O_OPTIONS);
    expect(ui.scroll).toBe(SCMAX);
    openTouchOptions();
    expect(overlay.prepend).toHaveBeenCalledTimes(1);
    ui.panelDragBus = 'voice';
    ui.panelPressed = 18;
    toggleTouchOptions();
    expect(dom.home.append).toHaveBeenCalledExactlyOnceWith(dom.panelCol);
    expect(dom.panelCol.style.display).toBe('none');
    expect(ui.ostav).toBe(O_NORMAL);
    expect(ui.scroll).toBe(SCMIN);
    expect(ui.scrollAcc).toBe(0);
    expect(ui.panelDragBus).toBeNull();
    expect(ui.panelPressed).toBe(0);
    expect(overlay.hidden).toBe(true);
    expect(canvasTouchOptionsOpen()).toBe(false);
  });

  it('leaves phones on HTML controls without moving the panel', () => {
    mode.phone = true;
    openTouchOptions();
    expect(touchOptionsOpen()).toBe(true);
    expect(canvasTouchOptionsOpen()).toBe(false);
    expect(overlay.prepend).not.toHaveBeenCalled();
    expect(ui.ostav).toBe(O_NORMAL);
    syncTouchOptions();
    expect(touchOptionsOpen()).toBe(true);
  });

  it('uses the same tablet presentation over the map without a desktop map overlay', () => {
    ui.screen = 'map';
    ui.mapOverlay = 'none';
    openTouchOptions();
    syncTouchOptions();
    expect(canvasTouchOptionsOpen()).toBe(true);
    expect(ui.mapOverlay).toBe('none');
  });

  it.each(['help', 'intro', 'desktop', 'phone'] as const)('restores the column on transition to %s', (target) => {
    openTouchOptions();
    if (target === 'help') ui.helpOpen = true;
    if (target === 'intro') ui.screen = 'intro';
    if (target === 'desktop') mode.touch = false;
    if (target === 'phone') mode.phone = true;
    syncTouchOptions();
    expect(touchOptionsOpen()).toBe(false);
    expect(dom.home.append).toHaveBeenCalledExactlyOnceWith(dom.panelCol);
  });

  it('dismisses phone controls rather than leaving them on a newly detected tablet', () => {
    mode.phone = true;
    openTouchOptions();
    mode.phone = false;
    syncTouchOptions();
    expect(touchOptionsOpen()).toBe(false);
    openTouchOptions();
    expect(canvasTouchOptionsOpen()).toBe(true);
  });
});
