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
import { O_NORMAL, O_OPTIONS, SCMAX, SCMIN, ui } from '../src/app/screenState.js';
import {
  closeTouchOptions, openTouchOptions, syncTouchOptions, toggleTouchOptions, touchOptionsOpen,
} from '../src/app/touchOptions.js';

const overlay = { hidden: true, prepend: vi.fn() };

beforeEach(() => {
  vi.stubGlobal('document', {
    getElementById: (id: string) => id === 'touchopts' ? overlay : null,
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
  it.each([false, true])('borrows the original panel (phone: %s) and restores it on close', (phone) => {
    mode.phone = phone;
    openTouchOptions();
    expect(touchOptionsOpen()).toBe(true);
    expect(overlay.prepend).toHaveBeenCalledExactlyOnceWith(dom.panelCol);
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
    expect(touchOptionsOpen()).toBe(false);
  });

  it('uses the same presentation over the map without a desktop map overlay', () => {
    ui.screen = 'map';
    ui.mapOverlay = 'none';
    openTouchOptions();
    syncTouchOptions();
    expect(touchOptionsOpen()).toBe(true);
    expect(ui.mapOverlay).toBe('none');
  });

  it.each(['help', 'intro', 'desktop'] as const)('restores the column on transition to %s', (target) => {
    openTouchOptions();
    if (target === 'help') ui.helpOpen = true;
    if (target === 'intro') ui.screen = 'intro';
    if (target === 'desktop') mode.touch = false;
    syncTouchOptions();
    expect(touchOptionsOpen()).toBe(false);
    expect(dom.home.append).toHaveBeenCalledExactlyOnceWith(dom.panelCol);
  });

  it('keeps the dialog open when a phone is re-detected as a tablet, or back', () => {
    mode.phone = true;
    openTouchOptions();
    mode.phone = false;
    syncTouchOptions();
    expect(touchOptionsOpen()).toBe(true);
    mode.phone = true;
    syncTouchOptions();
    expect(touchOptionsOpen()).toBe(true);
    expect(overlay.prepend).toHaveBeenCalledTimes(1);
  });
});
