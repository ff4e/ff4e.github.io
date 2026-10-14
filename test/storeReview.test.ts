import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  native: true,
  modes: { showmode: false, replaymode: false, loadmode: false },
  frame: { roomLoading: false },
  solving: false,
  launching: null as number | null,
  touchOptions: false,
  tetris: false,
  ui: {
    screen: 'map', mapRevealStart: 1, mapOverlay: 'none', mapInfoRoom: null as number | null,
    creditsLoading: false, helpOpen: false, feedback: { isOpen: () => false },
  },
  request: vi.fn<() => Promise<void>>(),
  register: vi.fn(),
}));
vi.mock('../src/platform/nativeHost.js', () => ({ isNativeHost: () => mocks.native }));
vi.mock('../src/app/gameState.js', () => mocks.modes);
vi.mock('../src/app/cheats.js', () => ({ tetrisModal: () => mocks.tetris }));
vi.mock('../src/app/framePacing.js', () => mocks.frame);
vi.mock('../src/app/roomLaunch.js', () => ({ mapLaunching: () => mocks.launching }));
vi.mock('../src/app/screenState.js', () => ({ ui: mocks.ui }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => mocks.solving }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => mocks.touchOptions }));
vi.mock('@capacitor/core', () => ({ registerPlugin: mocks.register }));

const KEY = 'ff.reviewMilestone';
let review: typeof import('../src/app/storeReview.js');
let data: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
let doc: { hidden: boolean; querySelector: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.native = true;
  Object.assign(mocks.modes, { showmode: false, replaymode: false, loadmode: false });
  mocks.frame.roomLoading = mocks.solving = mocks.touchOptions = mocks.tetris = false;
  mocks.launching = null;
  Object.assign(mocks.ui, {
    screen: 'map', mapRevealStart: 1, mapOverlay: 'none', mapInfoRoom: null,
    creditsLoading: false, helpOpen: false, feedback: { isOpen: () => false },
  });
  data = new Map();
  storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
  };
  doc = { hidden: false, querySelector: vi.fn(() => null) };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', storage);
  mocks.request.mockReset().mockResolvedValue(undefined);
  mocks.register.mockReset().mockReturnValue({ requestReview: mocks.request });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  review = await import('../src/app/storeReview.js');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function firstSolve(count: number): void {
  review.noteReviewSolve(count, new Set(Array.from({ length: count - 1 }, (_, i) => i + 1)));
}

async function returnToMap(): Promise<void> {
  mocks.ui.screen = 'map';
  mocks.ui.mapRevealStart++;
  review.scheduleStoreReview();
  await vi.advanceTimersByTimeAsync(2000);
}

describe('review milestones', () => {
  it('requests at exactly 4, 12 and 30 distinct solves across all 72 rooms', async () => {
    const requestedAt: number[] = [];
    mocks.request.mockImplementation(async () => { requestedAt.push(Number(data.get(KEY))); });
    for (let count = 1; count <= 72; count++) {
      firstSolve(count);
      await returnToMap();
    }
    expect(requestedAt).toEqual([4, 12, 30]);
    expect(mocks.register).toHaveBeenCalledWith('StoreReview');
  });

  it('does nothing on the web, including no storage access or plugin registration', async () => {
    mocks.native = false;
    firstSolve(4);
    await returnToMap();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not count re-solving a room', async () => {
    review.noteReviewSolve(3, new Set([1, 2, 3]));
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(['showmode', 'replaymode', 'loadmode'] as const)('does not queue during %s', async (mode) => {
    mocks.modes[mode] = true;
    firstSolve(4);
    mocks.modes[mode] = false;
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not queue developer auto-solves', async () => {
    mocks.solving = true;
    firstSolve(4);
    mocks.solving = false;
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not ask on ordinary map visits, cheat returns or startup with existing progress', async () => {
    await returnToMap(); // These paths do not report a new genuine solve.
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('persists attempts across relaunches, including a prompt Apple silently suppresses', async () => {
    firstSolve(4);
    await returnToMap();
    expect(data.get(KEY)).toBe('4');
    vi.resetModules();
    review = await import('../src/app/storeReview.js');
    firstSolve(4);
    await returnToMap();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    firstSolve(12);
    await returnToMap();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(data.get(KEY)).toBe('12');
  });

  it('does not repeat an earlier milestone after progress is reset', async () => {
    data.set(KEY, '30');
    firstSolve(4);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe('quiet map timing', () => {
  it('waits through room dialogue, the story page, then two seconds on the map', async () => {
    mocks.ui.screen = 'room';
    firstSolve(4);
    await vi.advanceTimersByTimeAsync(5000);
    mocks.ui.screen = 'legimage';
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.ui.screen = 'map';
    review.scheduleStoreReview();
    await vi.advanceTimersByTimeAsync(1999);
    expect(mocks.request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['room', () => { mocks.ui.screen = 'room'; }],
    ['intro', () => { mocks.ui.screen = 'intro'; }],
    ['story', () => { mocks.ui.screen = 'legimage'; }],
    ['new map visit', () => { review.scheduleStoreReview(); }],
    ['background', () => { doc.hidden = true; }],
    ['loading', () => { mocks.frame.roomLoading = true; }],
    ['launch', () => { mocks.launching = 5; }],
    ['options', () => { mocks.ui.mapOverlay = 'options'; }],
    ['credits', () => { mocks.ui.creditsLoading = true; }],
    ['room info', () => { mocks.ui.mapInfoRoom = 5; }],
    ['help', () => { mocks.ui.helpOpen = true; }],
    ['touch options', () => { mocks.touchOptions = true; }],
    ['feedback', () => { mocks.ui.feedback = { isOpen: () => true }; }],
    ['minigame', () => { mocks.tetris = true; }],
    ['DOM overlay', () => { doc.querySelector.mockReturnValue({}); }],
  ])('skips an opportunity interrupted by %s', async (_name, interrupt) => {
    firstSolve(4);
    review.scheduleStoreReview();
    interrupt();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('cancels an old map timer rather than asking on a subsequent visit', async () => {
    firstSolve(4);
    review.scheduleStoreReview();
    await vi.advanceTimersByTimeAsync(1000);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('does not confuse the first map paint restarting its reveal clock with a new visit', async () => {
    firstSolve(4);
    review.scheduleStoreReview();
    mocks.ui.mapRevealStart++;
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('drops an interrupted opportunity instead of showing it on a later map visit', async () => {
    firstSolve(4);
    review.scheduleStoreReview();
    mocks.ui.screen = 'room';
    await vi.advanceTimersByTimeAsync(2000);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rechecks the screen after loading the native plugin', async () => {
    mocks.register.mockImplementation(() => {
      mocks.ui.screen = 'room';
      return { requestReview: mocks.request };
    });
    firstSolve(4);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('room rebuild cancellation', () => {
  it('wires cancellation into the shared rebuild before replacing the room', () => {
    const main = readFileSync(new URL('../src/app/main.ts', import.meta.url), 'utf8');
    expect(/function buildRoom\(carryPole = false\): void \{\s*if \(!ffr\) return;\s*cancelStoreReview\(\);/.test(main)).toBe(true);
  });

  it('drops a win opportunity when the player restarts before the map return', async () => {
    mocks.ui.screen = 'room';
    firstSolve(4);
    review.cancelStoreReview();
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('clears an already scheduled timer when a room is rebuilt', async () => {
    firstSolve(4);
    review.scheduleStoreReview();
    await vi.advanceTimersByTimeAsync(1000);
    review.cancelStoreReview();
    expect(vi.getTimerCount()).toBe(0);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('invalidates a request already loading its native plugin', async () => {
    mocks.register.mockImplementation(() => {
      review.cancelStoreReview();
      return { requestReview: mocks.request };
    });
    firstSolve(4);
    await returnToMap();
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('preserves attempted milestones and still allows a later new milestone', async () => {
    data.set(KEY, '4');
    firstSolve(12);
    review.cancelStoreReview();
    await returnToMap();
    expect(data.get(KEY)).toBe('4');
    expect(mocks.request).not.toHaveBeenCalled();
    firstSolve(30);
    await returnToMap();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(data.get(KEY)).toBe('30');
  });
});

describe('failures are reported without interrupting play or retrying the milestone', () => {
  it.each(['getItem', 'setItem'] as const)('skips the request when %s fails', async (method) => {
    storage[method].mockImplementation(() => { throw new Error('Storage unavailable'); });
    firstSolve(4);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('store review: could not request a review', expect.any(Error));
  });

  it.each(['NaN', '0', '13', '[]', ''])('does not reset corrupt state %j and start asking again', async (value) => {
    data.set(KEY, value);
    firstSolve(4);
    await returnToMap();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    expect(data.get(KEY)).toBe(value);
  });

  it('logs a native rejection and keeps the attempted milestone consumed', async () => {
    mocks.request.mockRejectedValueOnce(new Error('No active scene'));
    firstSolve(4);
    await returnToMap();
    firstSolve(4);
    await returnToMap();
    expect(data.get(KEY)).toBe('4');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
  });
});
