/**
 * The orientation lock's plumbing (`src/platform/orientationLock.ts`).
 *
 * Three properties, and the first is the one that would rot silently — the same bundling
 * property `haptics.test.ts` pins for the same reason. `src/` is shared with the website,
 * and if somebody "tidies" the dynamic import into a static one nothing breaks visibly:
 * the plugin's web implementation throws, we swallow it, the game plays on, and the
 * website quietly starts shipping a plugin registry no browser can use. Asserting that a
 * browser never even RESOLVES the module is the only way that surfaces as a failure.
 *
 * The second is idempotency: a lock that is already standing must not be re-issued. It is
 * the whole answer to "does re-entering a landscape room after a map visit re-rotate the
 * phone?" — not "the second call is harmless", but "there is no second call".
 *
 * The third is which side of landscape is asked for. The plugin cannot say "either
 * landscape" (see the module header), so naming the side the phone is ALREADY at is what
 * keeps a sideways player from being flipped 180 degrees on entering a landscape room.
 * Getting that backwards is invisible to every other check we have and is a rotation in
 * the player's hands.
 *
 * The fourth was found on the simulator rather than reasoned out: a request made before
 * the plugin chunk has resolved must be REMEMBERED, not dropped. The first answer of a
 * session is always made in that window, and since the answer then does not change, a
 * dropped one is never re-asked — the app came up portrait on the map and stayed there.
 *
 * What is NOT here is the widening itself — `SafeAreaBridgeViewController`'s override that
 * turns a single-landscape mask back into both. That is Swift, on a device, and is pinned
 * by its comment and by play.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initOrientationLock, lockOrientation, resetOrientationLockForTest } from '../src/platform/orientationLock.js';

const lock = vi.fn(() => Promise.resolve());

vi.mock('@capacitor/screen-orientation', () => ({
  ScreenOrientation: {
    lock: (...args: unknown[]) => lock(...args),
    unlock: () => Promise.resolve(),
  },
}));

const setProtocol = (protocol: string): void => {
  Object.defineProperty(globalThis, 'location', { value: { protocol }, configurable: true, writable: true });
};

/** What `screen.orientation.type` reports, or nothing at all. */
const setScreenOrientation = (type: string | null): void => {
  Object.defineProperty(globalThis, 'screen', {
    value: type === null ? {} : { orientation: { type } },
    configurable: true,
    writable: true,
  });
};

/** Let the module's fire-and-forget `import()` settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetOrientationLockForTest();
  lock.mockClear();
  lock.mockImplementation(() => Promise.resolve());
  setScreenOrientation('landscape-primary');
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'location');
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'screen');
});

describe('on the web', () => {
  it('never loads the plugin, however many times it is asked', async () => {
    setProtocol('https:');
    initOrientationLock();
    lockOrientation('landscape');
    lockOrientation('portrait');
    await settle();
    // Not "did not rotate" — did not even resolve the module.
    expect(lock).not.toHaveBeenCalled();
  });
});

describe('on the native host', () => {
  beforeEach(async () => {
    setProtocol('capacitor:');
    initOrientationLock();
    await settle();
  });

  it('locks portrait as portrait, never upside-down', () => {
    lockOrientation('portrait');
    expect(lock).toHaveBeenCalledWith({ orientation: 'portrait' });
  });

  it('asks for the landscape the phone is already at', () => {
    // A player holding the phone the "other" way round enters a landscape room. Asking
    // for the plugin's default would name the opposite side and turn them 180 degrees for
    // no reason at all.
    setScreenOrientation('landscape-secondary');
    lockOrientation('landscape');
    expect(lock).toHaveBeenCalledWith({ orientation: 'landscape-secondary' });
  });

  it('asks for plain landscape from portrait, and when the screen will not say', () => {
    setScreenOrientation('portrait-primary');
    lockOrientation('landscape');
    expect(lock).toHaveBeenLastCalledWith({ orientation: 'landscape' });
    resetOrientationLockForTest();
    initOrientationLock();
    setScreenOrientation(null); // no `screen.orientation` at all
    lockOrientation('landscape');
    expect(lock).toHaveBeenLastCalledWith({ orientation: 'landscape' });
  });

  it('does not re-issue a lock that is already standing', async () => {
    // Room A (landscape) -> map (landscape) -> room B (landscape): three decisions, one
    // call. The map must not re-rotate anything on the way through.
    lockOrientation('landscape');
    lockOrientation('landscape');
    lockOrientation('landscape');
    await settle();
    expect(lock).toHaveBeenCalledTimes(1);
    // …and a genuine change still gets through, then holds in its turn.
    lockOrientation('portrait');
    lockOrientation('portrait');
    await settle();
    expect(lock).toHaveBeenCalledTimes(2);
  });

  it('retries after a lock that failed rather than remembering it as applied', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    lock.mockImplementationOnce(() => Promise.reject(new Error('no window scene')));
    expect(() => lockOrientation('portrait')).not.toThrow();
    await settle(); // an unhandled rejection here would fail the run
    now.mockReturnValue(2000); // a second later, past the retry gate
    lockOrientation('portrait');
    expect(lock).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('does not re-issue a failing lock on every frame', async () => {
    // The frame loop asks sixty times a second and the answer does not change, so a lock
    // that fails every time is the one shape that could turn "retry" into a bridge storm.
    lock.mockImplementation(() => Promise.reject(new Error('nope')));
    for (let i = 0; i < 60; i++) {
      lockOrientation('portrait');
      await settle();
    }
    expect(lock.mock.calls.length).toBeLessThan(3);
  });
});

describe('before the plugin has loaded', () => {
  it('does not stall the frame, and still applies once the plugin lands', async () => {
    setProtocol('capacitor:');
    // The first tick of the session, mid-import — no `await` after init. This is not a
    // corner case: `initOrientationLock()` starts the chunk fetch at boot and the frame
    // loop asks a frame or two later, so the FIRST answer of every session is made here.
    lockOrientation('landscape');
    expect(lock).not.toHaveBeenCalled(); // synchronous: the frame is not blocked on it
    await settle();
    // Measured on the iPhone 17 Pro simulator with the earlier version, which dropped
    // this request: the app came up portrait on the map and stayed there for the whole
    // session, because the answer never changed and so was never asked again.
    expect(lock).toHaveBeenCalledWith({ orientation: 'landscape' });
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('applies the answer in force when it lands, not the one it started with', async () => {
    setProtocol('capacitor:');
    // The screen can change while the chunk is in flight — the intro is short.
    lockOrientation('landscape');
    lockOrientation('portrait');
    await settle();
    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledWith({ orientation: 'portrait' });
  });
});
