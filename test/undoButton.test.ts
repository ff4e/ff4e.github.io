import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  room: {},
  screen: 'room',
  helpOpen: false,
  options: false,
  menu: false,
  loading: false,
  cutscene: null as object | null,
  loadmode: false,
  showmode: false,
  replaymode: false,
}));
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; },
  get cutscene() { return state.cutscene; },
  get loadmode() { return state.loadmode; },
  get showmode() { return state.showmode; },
  get replaymode() { return state.replaymode; },
}));
vi.mock('../src/app/framePacing.js', () => ({ get roomLoading() { return state.loading; } }));
vi.mock('../src/app/phoneControls.js', () => ({ phoneMenuOpen: () => state.menu }));
vi.mock('../src/app/screenState.js', () => ({ ui: state }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => state.options }));

import { bindUndoHold } from '../src/app/undoButton.js';

class Button extends EventTarget {
  disabled = false;
  visible = true;
  captured: number | null = null;
  blur = vi.fn();
  getClientRects() { return this.visible ? [this.getBoundingClientRect()] : []; }
  getBoundingClientRect() { return { left: 10, right: 70, top: 10, bottom: 70 }; }
  setPointerCapture(id: number) { this.captured = id; }
  hasPointerCapture(id: number) { return this.captured === id; }
  releasePointerCapture() { this.captured = null; }
}

let button: Button;
let win: EventTarget;
let doc: EventTarget & { hidden: boolean };
const repeat = vi.fn();
const clickAction = vi.fn();

function pointer(type: string, init: Partial<PointerEvent> = {}): void {
  const target = type === 'pointerdown' || type === 'lostpointercapture' ? button : win;
  target.dispatchEvent(Object.assign(new Event(type), {
    pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientX: 40, clientY: 40, ...init,
  }));
}
function click(detail = 1): void {
  button.dispatchEvent(Object.assign(new Event('click', { cancelable: true }), { detail }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  Object.assign(state, {
    room: {}, screen: 'room', helpOpen: false, options: false, menu: false, loading: false,
    cutscene: null, loadmode: false, showmode: false, replaymode: false,
  });
  button = new Button();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { hidden: false, createElement: () => button });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  bindUndoHold(document.createElement('button'), repeat);
  button.addEventListener('click', clickAction);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Undo button hold', () => {
  it('keeps a quick tap on the single-click path', () => {
    pointer('pointerdown');
    vi.advanceTimersByTime(349);
    expect(repeat).not.toHaveBeenCalled();
    pointer('pointerup');
    click();
    vi.advanceTimersByTime(1000);
    expect(clickAction).toHaveBeenCalledTimes(1);
    expect(repeat).not.toHaveBeenCalled();
    expect(button.captured).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('repeats after 350ms, every 80ms, accepting the room rebuilt by each undo', () => {
    repeat.mockImplementation(() => { state.room = {}; });
    pointer('pointerdown');
    vi.advanceTimersByTime(350);
    expect(repeat).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(79);
    expect(repeat).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(161);
    expect(repeat).toHaveBeenCalledTimes(4);
    expect(button.blur).toHaveBeenCalledTimes(4);
    pointer('pointerup');
    click();
    vi.advanceTimersByTime(1000);
    expect(repeat).toHaveBeenCalledTimes(4);
    expect(clickAction).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves keyboard/assistive clicks and the next pointer tap after a hold', () => {
    pointer('pointerdown');
    vi.advanceTimersByTime(350);
    pointer('pointerup');
    click(0);
    expect(clickAction).toHaveBeenCalledTimes(1);
    pointer('pointerdown');
    pointer('pointerup');
    click();
    expect(clickAction).toHaveBeenCalledTimes(2);
    expect(repeat).toHaveBeenCalledTimes(1);
  });

  it.each(['pointercancel', 'lostpointercapture', 'drag-out', 'released-buttons', 'blur', 'pagehide', 'resize', 'hidden'])(
    'cancels on %s without a trailing click or automatic resumption',
    (reason) => {
      pointer('pointerdown');
      vi.advanceTimersByTime(350);
      if (reason === 'drag-out') pointer('pointermove', { clientX: 80 });
      else if (reason === 'released-buttons') pointer('pointermove', { buttons: 0 });
      else if (reason === 'hidden') {
        doc.hidden = true;
        doc.dispatchEvent(new Event('visibilitychange'));
        doc.hidden = false;
      } else if (reason.startsWith('pointer') || reason === 'lostpointercapture') pointer(reason);
      else win.dispatchEvent(new Event(reason));
      pointer('pointermove');
      pointer('pointerup');
      click();
      vi.advanceTimersByTime(1000);
      expect(repeat).toHaveBeenCalledTimes(1);
      expect(clickAction).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not turn a cancelled short press into a click', () => {
    pointer('pointerdown');
    pointer('pointermove', { clientY: 5 });
    pointer('pointermove');
    pointer('pointerup');
    click();
    vi.advanceTimersByTime(1000);
    expect(repeat).not.toHaveBeenCalled();
    expect(clickAction).not.toHaveBeenCalled();
  });

  it.each([
    ['new room', () => { state.room = {}; }],
    ['map', () => { state.screen = 'map'; }],
    ['help', () => { state.helpOpen = true; }],
    ['options', () => { state.options = true; }],
    ['phone menu', () => { state.menu = true; }],
    ['loading', () => { state.loading = true; }],
    ['cutscene', () => { state.cutscene = {}; }],
    ['load replay', () => { state.loadmode = true; }],
    ['demo', () => { state.showmode = true; }],
    ['solution replay', () => { state.replaymode = true; }],
    ['hidden control', () => { button.visible = false; }],
    ['disabled control', () => { button.disabled = true; }],
  ])('stops before another repeat after %s', (_reason, change) => {
    pointer('pointerdown');
    vi.advanceTimersByTime(350);
    change();
    vi.advanceTimersByTime(1000);
    pointer('pointerup');
    click();
    expect(repeat).toHaveBeenCalledTimes(1);
    expect(clickAction).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 350, 1000])(
    'preserves one release click across a death auto-restart before repeating (held %i ms)',
    (held) => {
      pointer('pointerdown');
      state.room = {};
      vi.advanceTimersByTime(held);
      expect(repeat).not.toHaveBeenCalled();
      expect(button.captured).toBe(1);
      pointer('pointerup');
      click();
      vi.advanceTimersByTime(1000);
      expect(clickAction).toHaveBeenCalledTimes(1);
      expect(repeat).not.toHaveBeenCalled();
      expect(button.captured).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['drag-out', 'pointercancel', 'lostpointercapture', 'blur'])(
    'still cancels on %s after a room change has stopped the timer',
    (reason) => {
      pointer('pointerdown');
      state.room = {};
      vi.advanceTimersByTime(350);
      if (reason === 'drag-out') pointer('pointermove', { clientY: 5 });
      else if (reason === 'blur') win.dispatchEvent(new Event('blur'));
      else pointer(reason);
      pointer('pointermove');
      pointer('pointerup');
      click();
      expect(clickAction).not.toHaveBeenCalled();
      expect(repeat).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not preserve the click if an overlay opens after the room-change timer stops', () => {
    pointer('pointerdown');
    state.room = {};
    vi.advanceTimersByTime(350);
    state.options = true;
    pointer('pointerup');
    click();
    expect(clickAction).not.toHaveBeenCalled();
    expect(repeat).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores secondary buttons, additional fingers and unrelated pointer releases', () => {
    pointer('pointerdown', { button: 2 });
    pointer('pointerdown', { isPrimary: false, pointerId: 2 });
    vi.advanceTimersByTime(1000);
    expect(repeat).not.toHaveBeenCalled();
    pointer('pointerdown');
    pointer('pointerdown', { pointerId: 2 });
    pointer('pointerup', { pointerId: 2 });
    pointer('pointercancel', { pointerId: 2 });
    vi.advanceTimersByTime(350);
    expect(repeat).toHaveBeenCalledTimes(1);
    pointer('pointerup');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not arm while a menu is open or when the button is hidden', () => {
    state.menu = true;
    pointer('pointerdown');
    state.menu = false;
    button.visible = false;
    pointer('pointerdown');
    vi.advanceTimersByTime(1000);
    expect(repeat).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
