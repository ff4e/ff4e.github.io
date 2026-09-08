/**
 * The per-frame derivation (`src/app/orientationSync.ts`).
 *
 * `deviceOrientation.test.ts` pins the DECISION and `orientationLock.test.ts` the
 * plumbing; what is left in the middle is the wiring, and all of it is about the states
 * where the honest answer is not simply "measure the room on screen".
 *
 * The one that matters is the load in flight. While a room loads, `gameState.room` is
 * still the PREVIOUS room and `ui.screen` is already `'room'` — the trap `touchButtons.ts`
 * documents, where entering KOSTE reports UTES's shape for a frame or two. There it cost
 * a button bar that jumped edges within ~30 ms. Here the naive reading — treat a load as
 * "not a room", i.e. landscape — turns a phone held upright for a portrait room ninety
 * degrees for the length of the load and then ninety degrees back, which is worse than
 * anything it could be protecting against. So the load window holds the standing answer,
 * and this is the test that says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  screen: 'room' as 'map' | 'room' | 'intro' | 'legimage',
  room: {} as object | null,
  loading: false,
  size: { w: 780, h: 225 }, // UTES, the widest room
};

vi.mock('../src/app/screenState.js', () => ({
  get ui() {
    return { screen: state.screen };
  },
}));
vi.mock('../src/app/gameState.js', () => ({
  get room() {
    return state.room;
  },
}));
vi.mock('../src/app/framePacing.js', () => ({
  get roomLoading() {
    return state.loading;
  },
}));
vi.mock('../src/render/renderRoom.js', () => ({ roomScreenSize: () => state.size }));
vi.mock('../src/app/playerSettings.js', () => ({ settings: { fitMode: 'fill' } }));
vi.mock('../src/app/safeArea.js', () => ({ housingInset: () => 62 }));

const lockOrientation = vi.fn();
vi.mock('../src/platform/orientationLock.js', () => ({
  initOrientationLock: () => {},
  lockOrientation: (...args: unknown[]) => lockOrientation(...args),
}));

const { resetOrientationSyncForTest, syncOrientationLock } = await import('../src/app/orientationSync.js');

/** The iPhone 17 Pro, held either way — the answer must not depend on which. */
const setViewport = (w: number, h: number): void => {
  Object.defineProperty(globalThis, 'window', {
    value: { innerWidth: w, innerHeight: h, devicePixelRatio: 3 },
    configurable: true,
    writable: true,
  });
};

/** The last orientation actually asked for. */
const asked = (): unknown => lockOrientation.mock.calls.at(-1)?.[0];

beforeEach(() => {
  resetOrientationSyncForTest();
  lockOrientation.mockClear();
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'capacitor:' }, configurable: true, writable: true });
  setViewport(874, 402);
  state.screen = 'room';
  state.room = {};
  state.loading = false;
  state.size = { w: 780, h: 225 };
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'location');
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'window');
});

describe('syncOrientationLock', () => {
  it('does nothing at all in a browser', () => {
    Object.defineProperty(globalThis, 'location', { value: { protocol: 'https:' }, configurable: true, writable: true });
    syncOrientationLock();
    // Not "asked for landscape" — did not ask. The website's behaviour is unchanged by
    // design, and #123 stands there.
    expect(lockOrientation).not.toHaveBeenCalled();
  });

  it('answers for the room on screen', () => {
    syncOrientationLock();
    expect(asked()).toBe('landscape');
    state.size = { w: 315, h: 555 }; // VRAK
    syncOrientationLock();
    expect(asked()).toBe('portrait');
  });

  it('gives the same answer whichever way the phone is currently held', () => {
    // The decision must be made against the device's two FIXED edges, or locking changes
    // the viewport, which changes the answer, which changes the lock.
    state.size = { w: 315, h: 555 };
    setViewport(874, 402);
    syncOrientationLock();
    expect(asked()).toBe('portrait');
    setViewport(402, 874);
    syncOrientationLock();
    expect(asked()).toBe('portrait');
  });

  it('holds the standing answer while the next room loads, rather than turning twice', () => {
    // In VRAK, upright.
    state.size = { w: 315, h: 555 };
    syncOrientationLock();
    expect(asked()).toBe('portrait');
    // Now leave it for another room. `ui.screen` is already 'room' and `gameState.room`
    // is still VRAK, so the only honest reading of this frame is "ask again later".
    state.loading = true;
    syncOrientationLock();
    syncOrientationLock();
    expect(asked()).toBe('portrait'); // NOT landscape — that would be a full turn and back
    // The new room arrives and gets its own answer.
    state.loading = false;
    state.size = { w: 780, h: 225 };
    syncOrientationLock();
    expect(asked()).toBe('landscape');
  });

  it('takes landscape for everything that is not a room', () => {
    state.size = { w: 315, h: 555 }; // a portrait room is still the loaded one
    syncOrientationLock();
    expect(asked()).toBe('portrait');
    for (const screen of ['map', 'intro', 'legimage'] as const) {
      state.screen = screen;
      syncOrientationLock();
      expect(asked()).toBe('landscape');
    }
  });

  it('holds the standing answer for a room it cannot measure', () => {
    state.size = { w: 315, h: 555 };
    syncOrientationLock();
    expect(asked()).toBe('portrait');
    // A 0x0 room has no opinion and must not express one through the tie-break, which
    // resolves to landscape — right for a room that does not care, wrong for this.
    state.size = { w: 0, h: 0 };
    syncOrientationLock();
    expect(asked()).toBe('portrait');
  });

  it('asks every frame, leaving "already asked" to the lock itself', () => {
    // A latch here would swallow the retry for the first request of a session, which is
    // made before the plugin has loaded — see `orientationLock.ts`'s `desired`.
    syncOrientationLock();
    syncOrientationLock();
    syncOrientationLock();
    expect(lockOrientation).toHaveBeenCalledTimes(3);
  });
});
