import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dir } from '../src/core/dir.js';

const state = vi.hoisted(() => ({
  phone: true,
  room: {},
  engine: {
    active: 'little' as 'little' | 'big',
    swim: null,
    press: vi.fn(() => 'moving' as const),
  },
  beginInspection: vi.fn(),
}));
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; },
  engine: state.engine,
  cutscene: null,
}));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => state.phone, touchUi: () => true }));
vi.mock('../src/app/phoneControls.js', () => ({ phoneMenuOpen: () => false }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => false }));
vi.mock('../src/app/screenState.js', () => ({ ui: { screen: 'room', helpOpen: false } }));
vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/roomGates.js', () => ({ fishBusy: () => false }));
vi.mock('../src/platform/haptics.js', () => ({ hapticBlocked: vi.fn() }));
vi.mock('../src/app/phoneViewport.js', () => ({
  beginPhoneGesture: state.beginInspection,
  movePhoneGesture: vi.fn(),
  endPhoneGesture: vi.fn(),
  cancelPhoneGesture: vi.fn(),
}));

import {
  beginHeldMove, clearHeldKey, dispatchHeldMove, heldKeyState, initMovement, releaseHeldKey,
} from '../src/app/movement.js';
import { initTouchSwipe, syncTouchSwipe } from '../src/app/touchSwipe.js';

class Surface {
  closest(selector: string): Surface | null { return selector === '.stage' ? this : null; }
}
class KeyEvent extends Event {
  readonly code: string;
  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, init);
    this.code = init.code ?? '';
  }
}

let win: EventTarget & { innerWidth: number; innerHeight: number };
const surface = new Surface();
const directions: Record<string, Dir> = {
  ArrowUp: Dir.up, ArrowDown: Dir.down, ArrowLeft: Dir.left, ArrowRight: Dir.right,
};

function pointer(type: string, id: number, x = 400, y = 180): void {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    pointerType: 'touch', pointerId: id, clientX: x, clientY: y,
  });
  Object.defineProperty(event, 'target', { value: surface });
  win.dispatchEvent(event);
}
function key(type: 'keydown' | 'keyup', code = 'ArrowRight'): void {
  win.dispatchEvent(new KeyEvent(type, { code }));
}
function swipe(): void {
  pointer('pointerdown', 1);
  pointer('pointermove', 1, 450);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHeldKey();
  state.phone = true;
  state.room = {};
  state.engine.active = 'little';
  win = Object.assign(new EventTarget(), { innerWidth: 852, innerHeight: 393 });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(new EventTarget(), {
    body: surface, documentElement: surface, hidden: false,
  }));
  vi.stubGlobal('Element', Surface);
  vi.stubGlobal('KeyboardEvent', KeyEvent);
  // Only the keyboard-to-movement bridge is a fixture. Both gesture handling and
  // the pending/repeating/released movement state machine are the production code.
  win.addEventListener('keydown', (event) => {
    if (!(event instanceof KeyEvent)) throw new Error('Expected a keyboard event');
    const dir = directions[event.code];
    if (dir !== undefined) beginHeldMove(event.code, true, 'little', dir);
  });
  win.addEventListener('keyup', (event) => {
    if (!(event instanceof KeyEvent)) throw new Error('Expected a keyboard event');
    releaseHeldKey(event.code);
  });
  initMovement({ buildRoom: vi.fn(), endShowmode: vi.fn(), hracNespi: vi.fn(), setInfo: vi.fn() });
  initTouchSwipe();
});

afterEach(() => {
  win.dispatchEvent(new Event('blur'));
  clearHeldKey();
  vi.unstubAllGlobals();
});

describe('phone swipe cancellation', () => {
  it('discards the pending swipe when a second finger starts inspection before dispatch', () => {
    swipe();
    expect(heldKeyState()).toBe(1);
    pointer('pointerdown', 2, 550);
    expect(state.beginInspection).toHaveBeenCalledOnce();
    dispatchHeldMove();
    expect(state.engine.press).not.toHaveBeenCalled();
    expect(heldKeyState()).toBe(0);
  });

  it('stops repeat without undoing a move that was already dispatched', () => {
    swipe();
    dispatchHeldMove();
    expect(state.engine.press).toHaveBeenCalledOnce();
    pointer('pointerdown', 2, 550);
    dispatchHeldMove();
    expect(state.engine.press).toHaveBeenCalledOnce();
    expect(heldKeyState()).toBe(0);
  });

  it.each(['pinch', 'release', 'turn'] as const)('does not release a physical key when an ignored swipe ends by %s', (ending) => {
    key('keydown');
    swipe();
    if (ending === 'pinch') pointer('pointerdown', 2, 550);
    else if (ending === 'release') pointer('pointerup', 1, 450);
    else pointer('pointermove', 1, 450, 120);
    expect(heldKeyState()).toBe(1);
    dispatchHeldMove();
    expect(state.engine.press).toHaveBeenCalledExactlyOnceWith('little', Dir.right);
    expect(heldKeyState()).toBe(2);
  });

  it('does not cancel a newer physical press of the same arrow', () => {
    swipe();
    key('keyup');
    key('keydown');
    pointer('pointerdown', 2, 550);
    dispatchHeldMove();
    expect(state.engine.press).toHaveBeenCalledExactlyOnceWith('little', Dir.right);
    expect(heldKeyState()).toBe(2);
  });

  it('still dispatches an ordinary completed one-finger flick exactly once', () => {
    swipe();
    pointer('pointerup', 1, 450);
    expect(heldKeyState()).toBe(3);
    dispatchHeldMove();
    dispatchHeldMove();
    expect(state.engine.press).toHaveBeenCalledExactlyOnceWith('little', Dir.right);
    expect(heldKeyState()).toBe(0);
  });

  it('keeps a completed earlier flick when a new stationary gesture becomes a pinch', () => {
    swipe();
    pointer('pointerup', 1, 450);
    pointer('pointerdown', 3);
    pointer('pointerdown', 4, 550);
    dispatchHeldMove();
    expect(state.engine.press).toHaveBeenCalledExactlyOnceWith('little', Dir.right);
    expect(heldKeyState()).toBe(0);
  });

  it('cancels the latest pending direction after the swipe turns', () => {
    swipe();
    pointer('pointermove', 1, 450, 120);
    pointer('pointerdown', 2, 550);
    dispatchHeldMove();
    expect(state.engine.press).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'rotation', 'room change'] as const)('discards pending phone movement on %s', (reason) => {
    swipe();
    if (reason === 'pointercancel') pointer('pointercancel', 1, 450);
    else {
      if (reason === 'rotation') win.innerWidth = 393;
      else state.room = {};
      syncTouchSwipe();
    }
    dispatchHeldMove();
    expect(state.engine.press).not.toHaveBeenCalled();
    expect(heldKeyState()).toBe(0);
  });

  it('preserves the tablet single-pointer behavior', () => {
    state.phone = false;
    swipe();
    pointer('pointerdown', 2, 550);
    dispatchHeldMove();
    expect(state.beginInspection).not.toHaveBeenCalled();
    expect(state.engine.press).toHaveBeenCalledExactlyOnceWith('little', Dir.right);
  });
});
