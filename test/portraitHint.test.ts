import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  room: {} as object | null, curNum: 4, phone: true, screen: 'room',
  roomLoading: false, art: false, entry: false, fatal: false,
  cutscene: null as object | null, showmode: null as object | null,
  replaymode: null as object | null, loadmode: null as object | null,
  solving: false, helpOpen: false, options: false, menu: false, tetris: false,
  language: 'en', native: false,
};
const stageBox = { appendChild: vi.fn() };
const nativeLock = vi.fn(() => Promise.resolve());
const nativeUnlock = vi.fn(() => Promise.resolve());
vi.mock('../src/platform/nativeHost.js', () => ({ isNativeHost: () => state.native }));
vi.mock('@capacitor/screen-orientation', () => ({
  ScreenOrientation: { lock: () => nativeLock(), unlock: () => nativeUnlock() },
}));
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
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => state.phone }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => state.options }));

let hints: typeof import('../src/app/portraitHint.js');
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
    room: {}, curNum: 4, phone: true, screen: 'room',
    roomLoading: false, art: false, entry: false, fatal: false,
    cutscene: null, showmode: null, replaymode: null, loadmode: null,
    solving: false, helpOpen: false, options: false, menu: false, tetris: false,
    language: 'en', native: false,
  });
  nativeLock.mockReset().mockResolvedValue(undefined);
  nativeUnlock.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('window', { innerWidth: 852, innerHeight: 393 });
  vi.stubGlobal('document', { createElement, hidden: false });
  vi.stubGlobal('localStorage', { getItem, setItem });
  hints = await import('../src/app/portraitHint.js');
});
afterEach(() => {
  hints.clearPortraitHint();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('one-time VRAK portrait suggestion', () => {
  it('does not consume a native map-entry hint before unlock and a delayed portrait resize', async () => {
    state.native = true;
    state.screen = 'map';
    const bridge = await import('../src/platform/orientationLock.js');
    bridge.lockOrientation('landscape');
    await new Promise((resolve) => setTimeout(resolve, 0));
    let finishUnlock!: () => void;
    nativeUnlock.mockReturnValueOnce(new Promise<void>((resolve) => { finishUnlock = resolve; }));
    state.screen = 'room';
    state.entry = true;
    hints.syncPortraitHint(100);
    state.entry = false;
    hints.syncPortraitHint(200);
    bridge.unlockOrientation();
    hints.syncPortraitHint(10000);
    expect(stageBox.appendChild).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();

    finishUnlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    hints.syncPortraitHint(10100);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    window.innerWidth = 393;
    window.innerHeight = 852;
    hints.syncPortraitHint(10300);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();

    window.innerWidth = 852;
    window.innerHeight = 393;
    hints.syncPortraitHint(11000);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(2);
    hints.syncPortraitHint(13400);
    expect(setItem).toHaveBeenCalledExactlyOnceWith('ff.portraitHint.4', '1');
  });

  it('does no work on import and remembers only after 2.4 seconds of landscape display', () => {
    expect(getItem).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    hints.syncPortraitHint(100);
    expect(stageBox.appendChild).toHaveBeenCalledExactlyOnceWith(elements[0]);
    expect(elements[0]!.id).toBe('phone-portrait-hint');
    expect(elements[0]!.setAttribute).toHaveBeenCalledWith('role', 'img');
    expect(elements[0]!.setAttribute).toHaveBeenCalledWith('aria-label', 'Try portrait for a better view.');
    expect(elements).toHaveLength(1);
    expect(elements[0]!.innerHTML).toContain('class="portrait-hint-phone"');
    expect(elements[0]!.appendChild).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    hints.syncPortraitHint(101);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
    hints.syncPortraitHint(2499);
    expect(setItem).not.toHaveBeenCalled();
    hints.syncPortraitHint(2500);
    expect(setItem).toHaveBeenCalledExactlyOnceWith('ff.portraitHint.4', '1');
    hints.syncPortraitHint(2501);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('expires at five seconds and stays seen after restart, re-entry and relaunch', async () => {
    hints.syncPortraitHint(100);
    hints.syncPortraitHint(2500);
    hints.syncPortraitHint(5099);
    expect(elements[0]!.remove).not.toHaveBeenCalled();
    hints.syncPortraitHint(5100);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    state.room = {};
    hints.syncPortraitHint(6000);
    state.screen = 'map';
    hints.syncPortraitHint(6100);
    state.screen = 'room';
    hints.syncPortraitHint(6200);
    vi.resetModules();
    hints = await import('../src/app/portraitHint.js');
    hints.syncPortraitHint(6300);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
  });

  it('waits for landscape and entry readiness, then disappears on rotation without repeating', () => {
    window.innerWidth = 393;
    window.innerHeight = 852;
    hints.syncPortraitHint(100);
    expect(getItem).not.toHaveBeenCalled();
    window.innerWidth = 852;
    window.innerHeight = 393;
    state.entry = true;
    hints.syncPortraitHint(200);
    expect(setItem).not.toHaveBeenCalled();
    state.entry = false;
    hints.syncPortraitHint(300);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
    hints.syncPortraitHint(2700);
    window.innerWidth = 393;
    window.innerHeight = 852;
    hints.syncPortraitHint(2800);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    window.innerWidth = 852;
    window.innerHeight = 393;
    hints.syncPortraitHint(2900);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
  });

  it('uses a Czech accessible label without adding visible text or requiring subtitles', () => {
    state.language = 'cz';
    hints.syncPortraitHint(100);
    expect(elements[0]!.setAttribute).toHaveBeenCalledWith('aria-label', 'Zkuste telefon na výšku pro lepší přehled.');
    expect(elements).toHaveLength(1);
  });

  it.each([2499, 2500, 5100])('does not remember an ineligible hint when the next frame arrives at %dms', async (now) => {
    hints.syncPortraitHint(100);
    window.innerWidth = 393;
    window.innerHeight = 852;
    hints.syncPortraitHint(now);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
    vi.resetModules();
    hints = await import('../src/app/portraitHint.js');
    window.innerWidth = 852;
    window.innerHeight = 393;
    hints.syncPortraitHint(6000);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(2);
    hints.syncPortraitHint(8399);
    expect(setItem).not.toHaveBeenCalled();
    hints.syncPortraitHint(8400);
    expect(setItem).toHaveBeenCalledExactlyOnceWith('ff.portraitHint.4', '1');
  });

  it('starts a fresh visibility interval after an early interruption', () => {
    hints.syncPortraitHint(100);
    state.options = true;
    hints.syncPortraitHint(1300);
    state.options = false;
    hints.syncPortraitHint(1500);
    hints.syncPortraitHint(3899);
    expect(setItem).not.toHaveBeenCalled();
    hints.syncPortraitHint(3900);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(2);
    expect(setItem).toHaveBeenCalledExactlyOnceWith('ff.portraitHint.4', '1');
  });

  it('does not carry visibility time into a replacement room', () => {
    hints.syncPortraitHint(100);
    state.room = {};
    hints.syncPortraitHint(1300);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    hints.syncPortraitHint(3699);
    expect(setItem).not.toHaveBeenCalled();
    hints.syncPortraitHint(3700);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(2);
    expect(setItem).toHaveBeenCalledExactlyOnceWith('ff.portraitHint.4', '1');
  });

  const interruptions: Array<[string, () => void]> = [
    ['tablet/desktop', () => { state.phone = false; }],
    ['another tutorial room', () => { state.curNum = 3; }],
    ['another tall room', () => { state.curNum = 56; }],
    ['portrait', () => { window.innerWidth = 393; window.innerHeight = 852; }],
    ['square viewport', () => { window.innerWidth = window.innerHeight; }],
    ['map', () => { state.screen = 'map'; }],
    ['intro', () => { state.screen = 'intro'; }],
    ['absent room', () => { state.room = null; }],
    ['loading room', () => { state.roomLoading = true; }],
    ['loading art', () => { state.art = true; }],
    ['entry hold', () => { state.entry = true; }],
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
  ];
  it.each(interruptions)('does not display or consume the hint under %s', (_name, interrupt) => {
    interrupt();
    hints.syncPortraitHint(100);
    expect(stageBox.appendChild).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
  it.each(interruptions)('clears an active hint under %s', (_name, interrupt) => {
    hints.syncPortraitHint(100);
    interrupt();
    hints.syncPortraitHint(101);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('clears on a same-number room rebuild without showing again', () => {
    hints.syncPortraitHint(100);
    hints.syncPortraitHint(2500);
    state.room = {};
    hints.syncPortraitHint(2600);
    expect(elements[0]!.remove).toHaveBeenCalledTimes(1);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
  });

  it('logs blocked storage and retains session-only progress', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getItem.mockImplementationOnce(() => { throw new Error('blocked read'); });
    setItem.mockImplementationOnce(() => { throw new Error('blocked write'); });
    hints.syncPortraitHint(100);
    hints.syncPortraitHint(2500);
    hints.syncPortraitHint(5100);
    state.room = {};
    hints.syncPortraitHint(5200);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(stageBox.appendChild).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});
