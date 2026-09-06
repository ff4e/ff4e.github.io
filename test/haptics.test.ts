import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hapticBlocked, hapticDeath, hapticSolved, initHaptics, resetHapticsForTest } from '../src/platform/haptics.js';

/**
 * The two properties of the haptics layer that are worth pinning.
 *
 * The first is a bundling property, and it is the one that would rot silently: the web
 * build must never load `@capacitor/haptics`. `src/` is shared with the website, and this
 * is the only file in it that reaches for a Capacitor package. If somebody "tidies" the
 * dynamic import into a static one the game still works everywhere — the plugin's web
 * implementation is a no-op — so nothing fails, and the website quietly starts shipping a
 * plugin registry it has no use for. Asserting that a browser never even *asks* for the
 * module is the only way that shows up as a failure.
 *
 * The second is the mapping: which of the three moments plays which pattern. Getting
 * Success and Error the wrong way round is invisible to every other check we have, and on
 * a device it is worse than no haptics at all.
 *
 * What is NOT here is the once-per-hold latch in `movement.ts` — the thing that stops a
 * thumb parked against a wall from buzzing sixty times. It needs a live engine and room to
 * exercise, so it is pinned by its comment and by play, not by this file.
 */

const impact = vi.fn(() => Promise.resolve());
const notification = vi.fn(() => Promise.resolve());

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: (...args: unknown[]) => impact(...args),
    notification: (...args: unknown[]) => notification(...args),
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

const setProtocol = (protocol: string): void => {
  Object.defineProperty(globalThis, 'location', { value: { protocol }, configurable: true, writable: true });
};

/** Let the module's fire-and-forget `import()` settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetHapticsForTest();
  impact.mockClear();
  notification.mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'location');
});

describe('on the web', () => {
  it('never loads the plugin, however many times it is asked', async () => {
    setProtocol('https:');
    initHaptics();
    hapticBlocked();
    hapticDeath();
    hapticSolved();
    await settle();
    // Not "did not vibrate" — did not even resolve the module.
    expect(impact).not.toHaveBeenCalled();
    expect(notification).not.toHaveBeenCalled();
  });
});

describe('on the native host', () => {
  beforeEach(async () => {
    setProtocol('capacitor:');
    initHaptics();
    await settle();
  });

  it('plays the lightest impact for a blocked push', () => {
    hapticBlocked();
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(notification).not.toHaveBeenCalled();
  });

  it('plays error for a death and success for a solve, not the other way round', () => {
    hapticDeath();
    expect(notification).toHaveBeenLastCalledWith({ type: 'ERROR' });
    hapticSolved();
    expect(notification).toHaveBeenLastCalledWith({ type: 'SUCCESS' });
    expect(impact).not.toHaveBeenCalled();
  });

  it('swallows a plugin that rejects', async () => {
    impact.mockImplementationOnce(() => Promise.reject(new Error('no Taptic Engine')));
    expect(() => hapticBlocked()).not.toThrow();
    await settle(); // an unhandled rejection here would fail the run
  });
});

describe('before the plugin has loaded', () => {
  it('drops the buzz rather than stalling the caller', () => {
    setProtocol('capacitor:');
    // No `await` after init: this is the first tick of the session, mid-import.
    hapticBlocked();
    expect(impact).not.toHaveBeenCalled();
  });
});
