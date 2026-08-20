/**
 * The room-entry preload's own invariants — the ones a browser probe cannot see.
 *
 * A mutation pass over this change found that the suite proved two things ("a preload
 * failure is fatal", "the log names the asset") and almost nothing that makes the preload
 * WORK. Fifteen of twenty mutations survived. These are the ones with no other net:
 *
 *  - the per-leg key (hand out any cached page and the wrong leg's story appears; join a
 *    load for the wrong leg and the room that was entered gets no preload at all);
 *  - retract-on-failure (without it, one bad KUFRIK entry breaks KUFRIK for the rest of
 *    the session — every later entry joins the rejected promise and dies instantly);
 *  - the by-room scoping of the hold (a stale room's outcome releasing a newer room's hold
 *    presents that room before its assets are in);
 *  - what the finale warm actually asks for, and that it asks once.
 *
 * Unit, not probe: these are milliseconds against ~10 s, and none of them needs a browser.
 * `renderSettings` is mocked only because it reaches the DOM at module scope; the tier it
 * exposes is a plain value here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/app/renderSettings.js', () => ({ graphics: 'classic' }));

/** Every URL the module asked for, in order. */
const asked: string[] = [];
/** URLs the fake door should reject once, then serve. */
const failOnce = new Set<string>();

vi.mock('../src/render/assetFetch.js', () => {
  const doorway = (url: string): Promise<never> | null => {
    asked.push(url);
    if (!failOnce.has(url)) return null;
    failOnce.delete(url);
    return Promise.reject(new Error(`refused ${url}`));
  };
  return {
    requiredBytes: (url: string) => doorway(url) ?? Promise.resolve(new Uint8Array([1, 2, 3])),
    requiredText: (url: string) => doorway(url) ?? Promise.resolve('script'),
    requiredBlob: (url: string) => doorway(url) ?? Promise.resolve(new Blob(['ai'])),
  };
});

vi.mock('../src/data/bmp.js', () => ({ parseBmp: () => ({ w: 640, h: 480 }) }));
vi.mock('../src/intro/helpCap.js', () => ({ parseHelpCap: () => [{ kdo: 0, akce: 0 }] }));

const mod = await import('../src/app/roomPreload.js');
const {
  clearRoomPreloadPending,
  preloadLegPage,
  preloadedLegPage,
  roomPreloadPending,
  setRoomPreloadPending,
  warmFinaleRoom,
} = mod;

const ffrUrl = (n: number): string => `/data/Graphic/${String(n).padStart(3, '0')}.ffr`;
/** Every registered room except `open` — i.e. one win away from finishing the game. */
const solvedExcept = (open: number): ReadonlySet<number> =>
  new Set(Array.from({ length: 70 }, (_, i) => i + 1).filter((r) => r !== open));

beforeEach(() => {
  asked.length = 0;
  failOnce.clear();
});
afterEach(() => {
  clearRoomPreloadPending(0);
});

describe('the leg story page is keyed by its leg', () => {
  it('a later leg replaces the slot, and the old leg reports nothing preloaded', async () => {
    await preloadLegPage(1);
    expect(preloadedLegPage(1)).not.toBeNull();
    await preloadLegPage(2);
    // The window this closes: `showLegImage(1)` handing back leg 2's picture. The slot is
    // deliberately single, so the check has to be on the KEY, not on the slot being full.
    expect(preloadedLegPage(1)).toBeNull();
    expect(preloadedLegPage(2)).not.toBeNull();
  });

  it('two legs in flight at once are two loads, not one joined by the wrong room', async () => {
    await Promise.all([preloadLegPage(3), preloadLegPage(5)]);
    expect(asked).toContain('/data/Menu/003.$dv');
    expect(asked).toContain('/data/Menu/005.$dv');
    // A bare single-flight would let the leg-5 entry await the leg-3 load and return
    // "done" — leaving leg 5's room with no page, to be fetched when it is won.
    expect(preloadedLegPage(5)).not.toBeNull();
  });
});

describe('a failed preload is not remembered', () => {
  it('re-fetches on the next entry rather than joining the rejection for ever', async () => {
    failOnce.add('/data/Menu/007.$dv');
    await expect(preloadLegPage(7)).rejects.toThrow();
    expect(asked.filter((u) => u === '/data/Menu/007.$dv')).toHaveLength(1);
    await preloadLegPage(7);
    expect(asked.filter((u) => u === '/data/Menu/007.$dv')).toHaveLength(2);
    expect(preloadedLegPage(7)).not.toBeNull();
  });
});

describe('the entry hold is scoped to the room that armed it', () => {
  it('a stale room releasing cannot free a newer room hold', () => {
    setRoomPreloadPending(4);
    expect(roomPreloadPending()).toBe(true);
    // Room 2's entry settling late must not present room 4 before its assets are in.
    clearRoomPreloadPending(2);
    expect(roomPreloadPending()).toBe(true);
    clearRoomPreloadPending(4);
    expect(roomPreloadPending()).toBe(false);
  });
});

describe('the finale warm', () => {
  it('asks for every file ZAVER entry will need, including its music', () => {
    warmFinaleRoom(70, ffrUrl, solvedExcept(70));
    // Four, and the fourth is the point: `rybky04` is 1.11 MB of ZAVER's ~4.8 MB, so a
    // warm without it leaves the finale stalling on the largest file it needs.
    expect(asked).toEqual([
      '/data/Graphic/071.ffr',
      '/data/Title/071.fft',
      '/data/Sound/071.ffs2',
      '/data/Music/rybky04.m4a',
    ]);
  });

  it('happens once a session, not on every re-entry of the room', () => {
    warmFinaleRoom(70, ffrUrl, solvedExcept(70));
    const first = asked.length;
    warmFinaleRoom(70, ffrUrl, solvedExcept(70));
    expect(asked).toHaveLength(first);
  });

  it('does not fire for a leg-final room that would not finish the game', () => {
    // Two rooms still unsolved, so winning this one chains to the map, not to ZAVER.
    const solved = new Set([...solvedExcept(70)].filter((r) => r !== 37));
    warmFinaleRoom(70, ffrUrl, solved);
    expect(asked).toEqual([]);
  });
});
