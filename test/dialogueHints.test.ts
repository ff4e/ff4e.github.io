import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  room: {} as object | null,
  showmode: null as object | null,
  cutscene: null as object | null,
  replaymode: null as object | null,
  screen: 'room',
  helpOpen: false,
  loading: false,
  touch: true,
  phone: false,
  options: false,
  tetris: false,
  menu: false,
};
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; },
  get showmode() { return state.showmode; },
  get cutscene() { return state.cutscene; },
  get replaymode() { return state.replaymode; },
}));
vi.mock('../src/app/screenState.js', () => ({ ui: state }));
vi.mock('../src/app/framePacing.js', () => ({ get roomLoading() { return state.loading; } }));
vi.mock('../src/app/touchButtons.js', () => ({ touchUi: () => state.touch, phoneUi: () => state.phone }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => state.options }));
vi.mock('../src/app/cheats.js', () => ({ tetrisModal: () => state.tetris }));
const setPhoneMenuOpen = vi.fn((want: boolean) => { state.menu = want; });
vi.mock('../src/app/phoneControls.js', () => ({ phoneMenuOpen: () => state.menu, setPhoneMenuOpen }));
const wrap = { appendChild: vi.fn() };
vi.mock('../src/app/dom.js', () => ({ wrap }));

const { showDialogueHint, clearDialogueHint, syncDialogueHint } = await import('../src/app/dialogueHints.js');
const overlay = {
  id: '', innerHTML: '',
  setAttribute: vi.fn(),
  style: { setProperty: vi.fn() },
  remove: vi.fn(),
};
type Box = { left: number; top: number; width: number; height: number };
const rect = (b: Box) => ({ ...b, right: b.left + b.width, bottom: b.top + b.height });
// A tablet bar down the left edge, and the phone's "..." menu in the top-right corner.
const LEFT_BAR = { left: 0, top: 0, width: 80, height: 768 };
const PHONE_MENU = { left: 740, top: 90, width: 112, height: 200 };
const button = (box: Box, bar: Box) => ({
  offsetWidth: box.width,
  classList: { add: vi.fn(), remove: vi.fn() },
  getBoundingClientRect: vi.fn(() => rect(box)),
  parentElement: { getBoundingClientRect: () => rect(bar) },
});
const save = button({ left: 12, top: 100, width: 56, height: 56 }, LEFT_BAR);
const load = button({ left: 12, top: 172, width: 56, height: 56 }, LEFT_BAR);
const menuSave = button({ left: 746, top: 146, width: 100, height: 44 }, PHONE_MENU);
const menuLoad = button({ left: 746, top: 96, width: 100, height: 44 }, PHONE_MENU);
const getElementById = vi.fn(() => null);
const BUTTONS: Record<string, unknown> = {
  '#touchbar [data-region="12"]': save,
  '#touchbar [data-region="13"]': load,
  '#phone-menu [data-region="12"]': menuSave,
  '#phone-menu [data-region="13"]': menuLoad,
};
// A button cue looks its button up and then makes its arrow; a gesture makes only its overlay.
let arrowNext = false;
const querySelector = vi.fn((selector: string) => {
  arrowNext = true;
  return BUTTONS[selector] ?? null;
});
const arrow = {
  id: '', innerHTML: '', hidden: false,
  setAttribute: vi.fn(),
  style: { transform: '' },
  dataset: {} as Record<string, string>,
  remove: vi.fn(),
};
const createElement = vi.fn(() => {
  const made = arrowNext ? arrow : overlay;
  arrowNext = false;
  return made;
});
const body = { appendChild: vi.fn() };

beforeEach(() => {
  clearDialogueHint();
  vi.clearAllMocks();
  Object.assign(state, {
    room: {}, showmode: null, cutscene: null, replaymode: null,
    screen: 'room', helpOpen: false, loading: false, touch: true, phone: false, options: false, tetris: false,
    menu: false,
  });
  arrowNext = false;
  Object.assign(arrow, { id: '', innerHTML: '', hidden: false, style: { transform: '' }, dataset: {} });
  vi.stubGlobal('document', { createElement, querySelector, getElementById, body, hidden: false });
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 768);
  vi.spyOn(performance, 'now').mockReturnValue(100);
});
afterEach(() => {
  clearDialogueHint();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tutorial dialogue hints', () => {
  it.each([['help2', menuSave], ['help7', menuLoad], ['help11', menuLoad]])(
    '%s opens the phone menu and highlights the real button inside it', (name, target) => {
      state.phone = true;
      showDialogueHint(name, 3000);
      expect(setPhoneMenuOpen).toHaveBeenCalledExactlyOnceWith(true);
      expect(target.classList.add).toHaveBeenCalledExactlyOnceWith('dialogue-hint-pulse');
      expect(getElementById).not.toHaveBeenCalled();
      clearDialogueHint();
      expect(target.classList.remove).toHaveBeenCalledExactlyOnceWith('dialogue-hint-pulse');
      expect(setPhoneMenuOpen).toHaveBeenLastCalledWith(false);
      expect(state.menu).toBe(false);
    },
  );
  it('leaves a menu the player had already opened open afterwards', () => {
    state.phone = true;
    state.menu = true;
    showDialogueHint('help2', 3000);
    clearDialogueHint();
    expect(setPhoneMenuOpen).not.toHaveBeenCalled();
    expect(state.menu).toBe(true);
  });
  it('ends when the player closes the phone menu, without reopening it', () => {
    state.phone = true;
    showDialogueHint('help2', 6000);
    state.menu = false;
    syncDialogueHint(101);
    expect(menuSave.classList.remove).toHaveBeenCalledTimes(1);
    expect(arrow.remove).toHaveBeenCalledTimes(1);
    expect(setPhoneMenuOpen).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('reopens the phone menu after the same demo rebuilds the room under it', () => {
    state.phone = true;
    state.showmode = {};
    showDialogueHint('help7', 6000);
    state.room = {};
    state.menu = false;
    syncDialogueHint(101);
    expect(menuLoad.classList.remove).not.toHaveBeenCalled();
    expect(setPhoneMenuOpen).toHaveBeenLastCalledWith(true);
    state.menu = false;
    syncDialogueHint(102);
    expect(menuLoad.classList.remove).toHaveBeenCalledTimes(1);
  });
  it('clears if the device stops being a phone mid-cue', () => {
    state.phone = true;
    showDialogueHint('help2', 6000);
    state.phone = false;
    syncDialogueHint(101);
    expect(menuSave.classList.remove).toHaveBeenCalledTimes(1);
    expect(state.menu).toBe(false);
  });

  it('points a decorative arrow at a tablet button from the room side of a left bar', () => {
    showDialogueHint('help2', 3000);
    expect(arrow.id).toBe('dialogue-button-arrow');
    expect(arrow.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(body.appendChild).toHaveBeenCalledExactlyOnceWith(arrow);
    expect(arrow.dataset.side).toBe('right');
    expect(arrow.style.transform).toBe('translate(76px, 128px) rotate(180deg)');
    clearDialogueHint();
    expect(arrow.remove).toHaveBeenCalledTimes(1);
  });
  it('points up at a button in a bar along the top', () => {
    const bar = { left: 0, top: 0, width: 1024, height: 80 };
    save.getBoundingClientRect.mockReturnValue(rect({ left: 300, top: 12, width: 56, height: 56 }));
    save.parentElement.getBoundingClientRect = () => rect(bar);
    try {
      showDialogueHint('help2', 3000);
      expect(arrow.dataset.side).toBe('below');
      expect(arrow.style.transform).toBe('translate(328px, 76px) rotate(-90deg)');
    } finally {
      save.getBoundingClientRect.mockImplementation(() => rect({ left: 12, top: 100, width: 56, height: 56 }));
      save.parentElement.getBoundingClientRect = () => rect(LEFT_BAR);
    }
  });
  it('points right at the phone menu item from the room on its left', () => {
    state.phone = true;
    showDialogueHint('help2', 3000);
    expect(arrow.dataset.side).toBe('left');
    expect(arrow.style.transform).toBe('translate(738px, 168px) rotate(0deg)');
  });
  it('follows the button when the layout moves, and hides while it has no box', () => {
    showDialogueHint('help7', 6000);
    load.getBoundingClientRect.mockReturnValueOnce(rect({ left: 12, top: 300, width: 56, height: 56 }));
    syncDialogueHint(101);
    expect(arrow.style.transform).toBe('translate(76px, 328px) rotate(180deg)');
    load.getBoundingClientRect.mockReturnValueOnce(rect({ left: 0, top: 0, width: 0, height: 0 }));
    syncDialogueHint(102);
    expect(arrow.hidden).toBe(true);
    syncDialogueHint(103);
    expect(arrow.hidden).toBe(false);
  });
  it('creates one decorative gesture for the exact movement line', () => {
    showDialogueHint('1st-v-navod1', 6000);
    expect(createElement).toHaveBeenCalledExactlyOnceWith('div');
    expect(overlay.id).toBe('dialogue-gesture-hint');
    expect(overlay.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(overlay.style.setProperty).toHaveBeenCalledWith('--hint-duration', '6000ms');
    expect(wrap.appendChild).toHaveBeenCalledExactlyOnceWith(overlay);
    expect(querySelector).not.toHaveBeenCalled();
  });

  it.each([['help2', save], ['help7', load], ['help11', load]])(
    '%s highlights only its matching button', (name, target) => {
      showDialogueHint(name, 3000);
      expect(target.classList.add).toHaveBeenCalledExactlyOnceWith('dialogue-hint-pulse');
      expect((target === save ? load : save).classList.add).not.toHaveBeenCalled();
      expect(createElement).toHaveBeenCalledExactlyOnceWith('div');
      expect(createElement).toHaveLastReturnedWith(arrow);
      expect(setPhoneMenuOpen).not.toHaveBeenCalled();
    },
  );

  it.each(['1st-v-navod2', 'help1', 'help12', 'HELP2', 'constructor', 'toString'])(
    'does not guess a hint for %s', (name) => {
      showDialogueHint(name, 6000);
      expect(createElement).not.toHaveBeenCalled();
      expect(querySelector).not.toHaveBeenCalled();
    },
  );

  it('expires at the supplied voice duration, not before', () => {
    showDialogueHint('help2', 3200);
    syncDialogueHint(3299);
    expect(save.classList.remove).not.toHaveBeenCalled();
    syncDialogueHint(3300);
    expect(save.classList.remove).toHaveBeenCalledExactlyOnceWith('dialogue-hint-pulse');
    syncDialogueHint(4000);
    expect(save.classList.remove).toHaveBeenCalledTimes(1);
  });

  it('removes an expired gesture as well as a pulse', () => {
    showDialogueHint('1st-v-navod1', 3200);
    syncDialogueHint(3300);
    expect(overlay.remove).toHaveBeenCalledTimes(1);
  });

  it.each([0, 960, 2000, 2500])('gives a %dms gesture a readable 2500ms animation and lifetime', (duration) => {
    showDialogueHint('1st-v-navod1', duration);
    expect(overlay.style.setProperty).toHaveBeenCalledWith('--hint-duration', '2500ms');
    syncDialogueHint(2599);
    expect(overlay.remove).not.toHaveBeenCalled();
    syncDialogueHint(2600);
    expect(overlay.remove).toHaveBeenCalledTimes(1);
  });

  it('does not lengthen a short button cue or keep a gesture through an interruption', () => {
    showDialogueHint('help2', 960);
    syncDialogueHint(1060);
    expect(save.classList.remove).toHaveBeenCalledExactlyOnceWith('dialogue-hint-pulse');
    showDialogueHint('1st-v-navod1', 960);
    showDialogueHint('1st-m-navod2', 960);
    expect(overlay.remove).toHaveBeenCalledTimes(1);
  });

  it('clears on another line and repeats without persisted first-run state', () => {
    showDialogueHint('1st-v-navod1', 6000);
    showDialogueHint('1st-m-navod2', 3000);
    expect(overlay.remove).toHaveBeenCalledTimes(1);
    showDialogueHint('1st-v-navod1', 6000);
    expect(wrap.appendChild).toHaveBeenCalledTimes(2);
    showDialogueHint('help2', 3000);
    expect(overlay.remove).toHaveBeenCalledTimes(2);
    showDialogueHint('help7', 3000);
    expect(save.classList.remove).toHaveBeenCalledWith('dialogue-hint-pulse');
  });

  const interruptions: Array<[string, () => void]> = [
    ['desktop', () => { state.touch = false; }],
    ['map', () => { state.screen = 'map'; }],
    ['help', () => { state.helpOpen = true; }],
    ['options', () => { state.options = true; }],
    ['cutscene', () => { state.cutscene = {}; }],
    ['replay', () => { state.replaymode = {}; }],
    ['loading', () => { state.loading = true; }],
    ['missing room', () => { state.room = null; }],
    ['minigame', () => { state.tetris = true; }],
    ['hidden page', () => { Object.assign(document, { hidden: true }); }],
  ];
  it.each(interruptions)('does not start under %s', (_name, interrupt) => {
    interrupt();
    showDialogueHint('help2', 6000);
    expect(querySelector).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });
  it.each(interruptions)('clears on %s without resurrecting later', (_name, interrupt) => {
    showDialogueHint('help2', 6000);
    interrupt();
    syncDialogueHint(101);
    expect(save.classList.remove).toHaveBeenCalledTimes(1);
    state.touch = true;
    state.screen = 'room';
    syncDialogueHint(102);
    expect(save.classList.add).toHaveBeenCalledTimes(1);
  });

  it('clears on a player restart/load even if the room number stays the same', () => {
    showDialogueHint('help7', 6000);
    state.room = {};
    syncDialogueHint(101);
    expect(load.classList.remove).toHaveBeenCalledTimes(1);
  });

  it('survives the same demo loading its checkpoint but not the demo ending', () => {
    state.showmode = {};
    showDialogueHint('help7', 6000);
    state.room = {};
    syncDialogueHint(101);
    expect(load.classList.remove).not.toHaveBeenCalled();
    state.showmode = null;
    syncDialogueHint(102);
    expect(load.classList.remove).toHaveBeenCalledTimes(1);
  });

  it('does not carry a pulse into a new demo', () => {
    state.showmode = {};
    showDialogueHint('help7', 6000);
    state.showmode = {};
    syncDialogueHint(101);
    expect(load.classList.remove).toHaveBeenCalledTimes(1);
  });
});
