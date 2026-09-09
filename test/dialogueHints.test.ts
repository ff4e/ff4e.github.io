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
  options: false,
  tetris: false,
};
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; },
  get showmode() { return state.showmode; },
  get cutscene() { return state.cutscene; },
  get replaymode() { return state.replaymode; },
}));
vi.mock('../src/app/screenState.js', () => ({ ui: state }));
vi.mock('../src/app/framePacing.js', () => ({ get roomLoading() { return state.loading; } }));
vi.mock('../src/app/touchButtons.js', () => ({ touchUi: () => state.touch }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => state.options }));
vi.mock('../src/app/cheats.js', () => ({ tetrisModal: () => state.tetris }));
const wrap = { appendChild: vi.fn() };
vi.mock('../src/app/dom.js', () => ({ wrap }));

const { showDialogueHint, clearDialogueHint, syncDialogueHint } = await import('../src/app/dialogueHints.js');
const overlay = {
  id: '', innerHTML: '',
  setAttribute: vi.fn(),
  style: { setProperty: vi.fn() },
  remove: vi.fn(),
};
const save = { offsetWidth: 52, classList: { add: vi.fn(), remove: vi.fn() } };
const load = { offsetWidth: 52, classList: { add: vi.fn(), remove: vi.fn() } };
const querySelector = vi.fn((selector: string) =>
  selector === '#touchbar [data-region="12"]' ? save :
    selector === '#touchbar [data-region="13"]' ? load : null);
const createElement = vi.fn(() => overlay);

beforeEach(() => {
  clearDialogueHint();
  vi.clearAllMocks();
  Object.assign(state, {
    room: {}, showmode: null, cutscene: null, replaymode: null,
    screen: 'room', helpOpen: false, loading: false, touch: true, options: false, tetris: false,
  });
  vi.stubGlobal('document', { createElement, querySelector, hidden: false });
  vi.spyOn(performance, 'now').mockReturnValue(100);
});
afterEach(() => {
  clearDialogueHint();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tutorial dialogue hints', () => {
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
      expect(createElement).not.toHaveBeenCalled();
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
