import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dir } from '../src/core/dir.js';

const state = vi.hoisted(() => ({
  busy: false,
  room: { alive: { little: true, big: true } },
  engine: {
    active: 'little' as 'little' | 'big',
    swim: null,
    press: vi.fn(() => 'blocked' as 'moving' | 'blocked'),
  },
}));
vi.mock('../src/app/gameState.js', () => ({
  get room() { return state.room; },
  engine: state.engine,
  cutscene: null,
}));
vi.mock('../src/app/screenState.js', () => ({ ui: { screen: 'room' } }));
vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/roomGates.js', () => ({ fishBusy: () => state.busy }));
vi.mock('../src/platform/haptics.js', () => ({ hapticBlocked: vi.fn() }));
vi.mock('../src/app/phoneViewport.js', () => ({ continuePhoneRoom: vi.fn() }));

import { beginHeldMove, clearHeldKey, dispatchHeldMove, initMovement, releaseHeldKey } from '../src/app/movement.js';
import { clearPanelLight, lightPanel, panelLight, settlePanelLight } from '../src/app/panelLight.js';

beforeEach(() => {
  clearHeldKey();
  clearPanelLight();
  state.busy = false;
  state.room.alive = { little: true, big: true };
  state.engine.active = 'little';
  initMovement({ buildRoom: vi.fn(), endShowmode: vi.fn(), hracNespi: vi.fn(), setInfo: vi.fn() });
});

describe('panel light from the keyboard (AktualizujPanel, URoom.pas:24800-24812)', () => {
  it('a rest tick lights what it dispatched and goes out on the first one with nothing', () => {
    settlePanelLight(3);
    expect(panelLight()).toBe(3);
    settlePanelLight(3);
    expect(panelLight()).toBe(3);
    settlePanelLight(0);
    expect(panelLight()).toBe(0);
  });

  it('a command run straight from keydown survives one rest tick, then goes out', () => {
    lightPanel(12);
    settlePanelLight(0);
    expect(panelLight()).toBe(12);
    settlePanelLight(0);
    expect(panelLight()).toBe(0);
  });

  it('a held move dispatched after a keydown command takes the light over', () => {
    lightPanel(11);
    settlePanelLight(6);
    expect(panelLight()).toBe(6);
    settlePanelLight(0);
    expect(panelLight()).toBe(0);
  });
});

describe('dispatchHeldMove reports the region it lights', () => {
  it.each([
    ['little', Dir.up, 1], ['little', Dir.right, 4],
    ['big', Dir.up, 6], ['big', Dir.right, 9],
  ] as const)('%s fish dir %i -> region %i, blocked or not', (which, dir, region) => {
    beginHeldMove('Key', false, which, dir);
    expect(dispatchHeldMove()).toBe(region);
  });

  it('an arrow lights the ACTIVE fish, and a tap still lights on its release tick', () => {
    state.engine.active = 'big';
    beginHeldMove('ArrowLeft', true, 'little', Dir.left);
    releaseHeldKey('ArrowLeft');
    expect(dispatchHeldMove()).toBe(Dir.left + 5);
    expect(dispatchHeldMove()).toBe(0);
  });

  it('nothing dispatched lights nothing: no key, a busy fish, a departed fish', () => {
    expect(dispatchHeldMove()).toBe(0);
    beginHeldMove('KeyW', false, 'big', Dir.up);
    state.busy = true;
    expect(dispatchHeldMove()).toBe(0);
    state.busy = false;
    state.room.alive.big = false;
    expect(dispatchHeldMove()).toBe(0);
  });
});
