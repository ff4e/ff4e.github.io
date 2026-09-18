/**
 * Touch-control markup and effective presentation transitions.
 * The touch bar's markup agrees with the region table (src/app/touchButtons.ts).
 *
 * This exists because the bar is driven by `data-region` attributes read straight from
 * `index.html`, so the region numbers live in the markup and nothing in the code path
 * ever compares them against anything. That is fine for a typo like `data-region="1x"`,
 * which produces a button that does nothing — but a transposed digit between two VALID
 * regions produces a button that does something else. Save is 12 and Load is 13; a
 * Save button that quietly loads and throws away the attempt is the failure worth a
 * test, and it is invisible to every other check in the repo.
 *
 * A unit test rather than an assertion in the UI probe: it is a static fact about a
 * file, it costs milliseconds against the probe's ~8 s, and it fails with the exact
 * mismatch rather than with a game that behaved oddly.
 *
 * Undo (24) is the one region here with no `Uovl.pas` counterpart — the 1998 game has no
 * undo — so nothing else in the repo would notice if the markup sent 4 (little fish left)
 * instead. That is the transposition case again, one digit further out.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// From `keyTables.ts`, not `touchButtons.ts`: the latter reaches the DOM through
// `loadingUi.ts`, and this suite runs in node with no document.
import { TOUCH_REGIONS } from '../src/app/keyTables.js';
import { O_NORMAL, O_OPTIONS, O_SC_DOWN } from '../src/app/screenState.js';

const mode = vi.hoisted(() => ({ active: false, phone: false, options: false, menu: false }));
vi.mock('../src/app/touchMode.js', () => ({
  touchModeActive: () => mode.active,
  phoneModeActive: () => mode.phone,
}));
vi.mock('../src/app/loadingUi.js', () => ({ relayout: vi.fn() }));
vi.mock('../src/app/mapNav.js', () => ({ closeMapOverlay: vi.fn() }));
vi.mock('../src/app/phoneControls.js', () => ({
  initPhoneControls: vi.fn(), syncPhoneControls: vi.fn(), phoneMenuOpen: () => mode.menu,
}));
vi.mock('../src/app/activeFishIndicator.js', () => ({
  initActiveFishIndicator: vi.fn(), syncActiveFishIndicator: vi.fn(),
}));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => mode.options }));
vi.mock('../src/app/nativeMenu.js', () => ({
  setNativeMenuEnabled: vi.fn(), syncNativeMenu: vi.fn(),
}));
vi.mock('../src/app/gameState.js', () => ({ room: null }));
vi.mock('../src/app/playerSettings.js', () => ({ settings: { fitMode: 'medium' } }));
vi.mock('../src/render/renderRoom.js', () => ({ roomScreenSize: vi.fn() }));
vi.mock('../src/app/framePacing.js', () => ({ roomLoading: false }));
vi.mock('../src/app/safeArea.js', () => ({ safeAreaInset: () => 0 }));
vi.mock('../src/platform/nativeHost.js', () => ({ isNativeHost: () => false }));

const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');

/** The `#touchbar` element's markup, so a `data-region` elsewhere cannot satisfy this. */
function touchbarMarkup(): string {
  const start = html.indexOf('<div id="touchbar"');
  expect(start, 'index.html still has a #touchbar element').toBeGreaterThan(-1);
  const end = html.indexOf('</div>', html.indexOf('</button>', start));
  expect(end, 'the #touchbar element is closed').toBeGreaterThan(start);
  return html.slice(start, end);
}

/**
 * Every button in the bar, as `[visible label, region]`, in document order.
 *
 * The VISIBLE label, not `aria-label`: "Load the saved game" contains "save", and
 * matching that against the verbs paired Load with Save's region — this test's own first
 * bug, and a fair warning about matching prose.
 */
function buttons(): Array<[string, number]> {
  const markup = touchbarMarkup();
  const out: Array<[string, number]> = [];
  const re = /<button\b[^>]*\bdata-region="(\d+)"[\s\S]*?<span>([^<]*)<\/span>[\s\S]*?<\/button>/g;
  for (let m = re.exec(markup); m !== null; m = re.exec(markup)) {
    out.push([m[2]!.trim(), Number(m[1])]);
  }
  return out;
}

describe('touch controls', () => {
  it('puts Restart fourth and Undo last in the tablet visual and keyboard order', () => {
    expect(buttons()).toEqual([
      ['Map', 14],
      ['Save', 12],
      ['Load', 13],
      ['Restart', 15],
      ['Options', 16],
      ['Undo', 24],
    ]);
  });

  it('sends exactly the regions in TOUCH_REGIONS, and no others', () => {
    const inMarkup = buttons()
      .map(([, r]) => r)
      .sort((a, b) => a - b);
    const inTable = Object.values(TOUCH_REGIONS)
      .map(Number)
      .sort((a, b) => a - b);
    expect(inMarkup).toEqual(inTable);
  });

  describe('effective touch-mode transitions', () => {
    let touch: typeof import('../src/app/touchButtons.js');
    let ui: typeof import('../src/app/screenState.js')['ui'];
    let relayout: typeof import('../src/app/loadingUi.js')['relayout'];
    let closeMapOverlay: typeof import('../src/app/mapNav.js')['closeMapOverlay'];
    const initialize = () => touch.initTouchButtons({ panelAction: vi.fn() });

    beforeEach(async () => {
      vi.resetModules();
      vi.clearAllMocks();
      Object.assign(mode, { active: false, phone: false, options: false, menu: false });
      vi.stubGlobal('window', {
        matchMedia: () => ({ addEventListener: vi.fn() }),
        addEventListener: vi.fn(),
      });
      vi.stubGlobal('document', {
        documentElement: { toggleAttribute: vi.fn() },
        querySelectorAll: () => [],
        getElementById: () => ({ hidden: true }),
      });
      touch = await import('../src/app/touchButtons.js');
      ({ ui } = await import('../src/app/screenState.js'));
      ({ relayout } = await import('../src/app/loadingUi.js'));
      ({ closeMapOverlay } = await import('../src/app/mapNav.js'));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('sets initial mode flags without calling post-initialization layout or modal handlers', () => {
      mode.active = mode.phone = true;
      touch.refreshTouchMode();
      initialize();
      expect(touch.touchUi()).toBe(true);
      expect(touch.phoneUi()).toBe(true);
      expect(relayout).not.toHaveBeenCalled();
      expect(closeMapOverlay).not.toHaveBeenCalled();
    });

    it('relayouts once per effective phone, tablet or desktop transition', () => {
      initialize();
      mode.active = mode.phone = true;
      touch.refreshTouchMode();
      expect(relayout).toHaveBeenCalledTimes(1);
      touch.refreshTouchMode();
      expect(relayout).toHaveBeenCalledTimes(1);
      mode.phone = false;
      touch.refreshTouchMode();
      expect(relayout).toHaveBeenCalledTimes(2);
      mode.active = false;
      touch.refreshTouchMode();
      expect(relayout).toHaveBeenCalledTimes(3);
      expect(touch.touchUi()).toBe(false);
    });

    it('closes desktop map Options before laying out the touch presentation', () => {
      initialize();
      ui.mapOverlay = 'options';
      ui.ostav = O_OPTIONS;
      mode.active = mode.phone = true;
      touch.refreshTouchMode();
      expect(closeMapOverlay).toHaveBeenCalledTimes(1);
      expect(vi.mocked(closeMapOverlay).mock.invocationCallOrder[0])
        .toBeLessThan(vi.mocked(relayout).mock.invocationCallOrder[0]!);
    });

    it('unwinds the faithful in-room Options face on a mode change', () => {
      initialize();
      ui.ostav = O_OPTIONS;
      mode.active = mode.phone = true;
      touch.refreshTouchMode();
      expect(ui.ostav).toBe(O_SC_DOWN);
      expect(closeMapOverlay).not.toHaveBeenCalled();
    });

    it('leaves open Options alone when a resize does not change the effective mode', () => {
      initialize();
      ui.mapOverlay = 'options';
      ui.ostav = O_OPTIONS;
      touch.refreshTouchMode();
      expect(ui.mapOverlay).toBe('options');
      expect(ui.ostav).toBe(O_OPTIONS);
      expect(closeMapOverlay).not.toHaveBeenCalled();
      expect(relayout).not.toHaveBeenCalled();
    });

    it('does not dismiss the credits overlay on a mode change', () => {
      initialize();
      ui.mapOverlay = 'credits';
      ui.ostav = O_NORMAL;
      mode.active = mode.phone = true;
      touch.refreshTouchMode();
      expect(ui.mapOverlay).toBe('credits');
      expect(closeMapOverlay).not.toHaveBeenCalled();
      expect(relayout).toHaveBeenCalledTimes(1);
    });

    it('routes the indicator to the current touch controls and hides it on desktop', async () => {
      const { initActiveFishIndicator, syncActiveFishIndicator } = await import('../src/app/activeFishIndicator.js');
      initialize();
      ui.screen = 'room';
      mode.active = true;
      touch.refreshTouchMode();
      touch.syncTouchButtons();
      expect(initActiveFishIndicator).toHaveBeenLastCalledWith('touchbar');
      expect(syncActiveFishIndicator).toHaveBeenLastCalledWith(true);
      mode.phone = true;
      touch.refreshTouchMode();
      touch.syncTouchButtons();
      expect(initActiveFishIndicator).toHaveBeenLastCalledWith('phone-controls');
      expect(syncActiveFishIndicator).toHaveBeenLastCalledWith(true);
      mode.active = false;
      touch.refreshTouchMode();
      touch.syncTouchButtons();
      expect(syncActiveFishIndicator).toHaveBeenLastCalledWith(false);
    });

    it.each([false, true])('hides the indicator outside live gameplay (phone=%s)', async (phone) => {
      const { syncActiveFishIndicator } = await import('../src/app/activeFishIndicator.js');
      Object.assign(mode, { active: true, phone });
      initialize();
      ui.screen = 'room';
      ui.helpOpen = true;
      touch.syncTouchButtons();
      expect(syncActiveFishIndicator).toHaveBeenLastCalledWith(false);
      ui.helpOpen = false;
      mode.options = true;
      touch.syncTouchButtons();
      expect(syncActiveFishIndicator).toHaveBeenLastCalledWith(false);
      mode.options = false;
      mode.menu = true;
      touch.syncTouchButtons();
      expect(syncActiveFishIndicator).toHaveBeenLastCalledWith(!phone);
      mode.menu = false;
      ui.screen = 'map';
      touch.syncTouchButtons();
      expect(syncActiveFishIndicator).toHaveBeenLastCalledWith(false);
    });
  });

  describe('phone controls markup', () => {
    it('keeps the three corners and maps every overflow verb to the existing dispatch table', () => {
      const start = html.indexOf('<div id="phone-controls"');
      const markup = html.slice(start, html.indexOf('<div id="info"', start));
      expect(markup).toMatch(/id="phone-map"[^>]*data-region="14"/);
      expect(markup).toMatch(/id="phone-undo"[^>]*data-region="24"/);
      expect(markup).toMatch(/id="phone-more"[^>]*aria-controls="phone-menu"/);
      const items = [...markup.matchAll(/data-region="(\d+)">([^<]+)<\/button>/g)]
        .map((m) => [m[2], Number(m[1])]);
      expect(items).toEqual([['Load', 13], ['Save', 12], ['Options', 16], ['Restart', 15]]);
    });
  });

  it('gives every button the region its own label describes', () => {
    // The transposition case: both 12 and 13 are valid, so only the pairing catches it.
    const want: Record<string, number> = {
      Map: TOUCH_REGIONS.map,
      Save: TOUCH_REGIONS.save,
      Load: TOUCH_REGIONS.load,
      Undo: TOUCH_REGIONS.undo,
      Options: TOUCH_REGIONS.options,
      Restart: TOUCH_REGIONS.restart,
    };
    for (const [label, region] of buttons()) {
      expect(want, `"${label}" is one of the known buttons`).toHaveProperty(label);
      expect(region, `"${label}" sends its own region`).toBe(want[label]);
    }
  });

  it('has a button for every verb in the table', () => {
    expect(buttons()).toHaveLength(Object.keys(TOUCH_REGIONS).length);
  });
});
