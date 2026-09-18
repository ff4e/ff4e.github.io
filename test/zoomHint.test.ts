import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  room: {} as object | null, curNum: 2, phone: true, screen: 'room', scale: 1,
  roomLoading: false, art: false, entry: false, fatal: false,
  cutscene: null as object | null, showmode: null as object | null,
  replaymode: null as object | null, loadmode: null as object | null,
  solving: false, helpOpen: false, options: false, menu: false, tetris: false,
  language: 'en',
};
const stageBox = { appendChild: vi.fn() };
vi.mock('../src/app/dom.js', () => ({ stageBox }));
vi.mock('../src/app/art.js', () => ({
  get curNum() { return state.curNum; }, roomArtPending: () => state.art,
}));
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; },
  get cutscene() { return state.cutscene; },
  get showmode() { return state.showmode; },
  get replaymode() { return state.replaymode; },
  get loadmode() { return state.loadmode; },
}));
vi.mock('../src/app/framePacing.js', () => ({ get roomLoading() { return state.roomLoading; } }));
vi.mock('../src/app/roomLoad.js', () => ({ roomEntryHeld: () => state.entry }));
vi.mock('../src/app/loadingUi.js', () => ({ fatalShown: () => state.fatal }));
vi.mock('../src/app/cheats.js', () => ({ tetrisModal: () => state.tetris }));
vi.mock('../src/app/screenState.js', () => ({ ui: state }));
vi.mock('../src/app/phoneControls.js', () => ({ phoneMenuOpen: () => state.menu }));
vi.mock('../src/app/playerSettings.js', () => ({ subLang: () => state.language }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => state.solving }));
vi.mock('../src/app/stageGeometry.js', () => ({ roomGeometry: () => ({ scale: state.scale }) }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => state.phone }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => state.options }));

let hints: typeof import('../src/app/zoomHint.js');
let values: Map<string, string>;
const getItem = vi.fn((key: string) => values.get(key) ?? null);
const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
const elements: Array<{
  id: string; innerHTML: string; textContent: string; setAttribute: ReturnType<typeof vi.fn>;
  appendChild: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>;
}> = [];
const createElement = vi.fn(() => {
  const element = {
    id: '', innerHTML: '', textContent: '',
    setAttribute: vi.fn(), appendChild: vi.fn(), remove: vi.fn(),
  };
  elements.push(element);
  return element;
});

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  elements.length = 0;
  values = new Map();
  Object.assign(state, {
    room: {}, curNum: 2, phone: true, screen: 'room', scale: 1,
    roomLoading: false, art: false, entry: false, fatal: false,
    cutscene: null, showmode: null, replaymode: null, loadmode: null,
    solving: false, helpOpen: false, options: false, menu: false, tetris: false, language: 'en',
  });
  vi.stubGlobal('document', { createElement, hidden: false });
  vi.stubGlobal('localStorage', { getItem, setItem });
  hints = await import('../src/app/zoomHint.js');
});
afterEach(() => {
  hints.clearZoomHint();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('first-entry phone zoom hint', () => {
  it('does no storage or DOM work on import and remembers only the shown room', () => {
    expect(getItem).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    hints.syncZoomHint(100);
    expect(stageBox.appendChild).toHaveBeenCalledExactlyOnceWith(elements[0]);
    expect(elements[0]!.setAttribute).toHaveBeenCalledWith('role', 'img');
    expect(elements[0]!.setAttribute).toHaveBeenCalledWith('aria-label', 'Pinch to zoom');
    expect(elements[1]!.textContent).toBe('Pinch to zoom');
    expect(setItem).toHaveBeenCalledExactlyOnceWith('ff.zoomHint.2', '1');
    hints.syncZoomHint(101);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
  });

  it('expires at five seconds and does not repeat after restart, re-entry or relaunch', async () => {
    hints.syncZoomHint(100);
    hints.syncZoomHint(5099);
    expect(elements[0]!.remove).not.toHaveBeenCalled();
    hints.syncZoomHint(5100);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    state.room = {};
    hints.syncZoomHint(6000);
    state.screen = 'map';
    hints.syncZoomHint(6100);
    state.screen = 'room';
    hints.syncZoomHint(6200);
    vi.resetModules();
    hints = await import('../src/app/zoomHint.js');
    hints.syncZoomHint(6300);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
  });

  it('shows independently in the second and third rooms, in either order', () => {
    state.curNum = 3;
    hints.syncZoomHint(100);
    state.curNum = 2;
    state.room = {};
    hints.syncZoomHint(200);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(2);
    expect([...values.keys()].sort()).toEqual(['ff.zoomHint.2', 'ff.zoomHint.3']);
  });

  it('keeps persisted third-room progress separate from unseen second-room progress', () => {
    values.set('ff.zoomHint.3', '1');
    state.curNum = 3;
    hints.syncZoomHint(100);
    expect(stageBox.appendChild).not.toHaveBeenCalled();
    state.curNum = 2;
    hints.syncZoomHint(200);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
  });

  it('uses Czech copy even when Czech-device subtitles are off', () => {
    state.language = 'cz';
    hints.syncZoomHint(100);
    expect(elements[0]!.setAttribute).toHaveBeenCalledWith('aria-label', 'Přiblížení dvěma prsty');
    expect(elements[1]!.textContent).toBe('Přiblížení dvěma prsty');
  });

  const interruptions: Array<[string, () => void]> = [
    ['tablet/desktop', () => { state.phone = false; }],
    ['first room', () => { state.curNum = 1; }],
    ['later room', () => { state.curNum = 4; }],
    ['map', () => { state.screen = 'map'; }],
    ['absent room', () => { state.room = null; }],
    ['loading room', () => { state.roomLoading = true; }],
    ['loading art', () => { state.art = true; }],
    ['loading sound/story', () => { state.entry = true; }],
    ['fatal error', () => { state.fatal = true; }],
    ['cutscene', () => { state.cutscene = {}; }],
    ['demo', () => { state.showmode = {}; }],
    ['replay', () => { state.replaymode = {}; }],
    ['saved-game load', () => { state.loadmode = {}; }],
    ['solution replay', () => { state.solving = true; }],
    ['help', () => { state.helpOpen = true; }],
    ['options', () => { state.options = true; }],
    ['phone menu', () => { state.menu = true; }],
    ['minigame', () => { state.tetris = true; }],
    ['hidden document', () => { Object.assign(document, { hidden: true }); }],
    ['zoom-ineligible geometry', () => { state.scale = 20 / 15; }],
  ];
  it.each(interruptions)('does not display or consume the hint under %s', (_name, interrupt) => {
    interrupt();
    hints.syncZoomHint(100);
    expect(stageBox.appendChild).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
  it.each(interruptions)('removes an active hint under %s', (_name, interrupt) => {
    hints.syncZoomHint(100);
    interrupt();
    hints.syncZoomHint(101);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it('waits for a visible, zoom-eligible room and clears on a same-number rebuild', () => {
    state.entry = true;
    hints.syncZoomHint(100);
    state.entry = false;
    state.scale = 2;
    hints.syncZoomHint(200);
    state.scale = 1;
    hints.syncZoomHint(300);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
    state.room = {};
    hints.syncZoomHint(400);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
  });

  it('logs blocked storage once per operation and retains session-only progress', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getItem.mockImplementationOnce(() => { throw new Error('blocked read'); });
    setItem.mockImplementationOnce(() => { throw new Error('blocked write'); });
    hints.syncZoomHint(100);
    hints.syncZoomHint(5100);
    state.room = {};
    hints.syncZoomHint(5200);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});
