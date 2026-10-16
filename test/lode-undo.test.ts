/**
 * LODE's Battleship match runs on time, so an undo leaves it where it is: the boards the
 * score was played on, every pending line (the gods' calls and answers, the fish's
 * remarks), and the wreckage sunk ships have eroded into the background. Real room data,
 * real script, real undo path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as game from '../src/app/gameState.js';
import { advanceLoadmode, restore } from '../src/app/movement.js';
import { roomHarness } from './undoRoomHarness.js';
import { restoreRandom, seedRandom } from './rng.js';

vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/framePacing.js', () => ({ roomLoading: false }));
vi.mock('../src/app/phoneViewport.js', () => ({ continuePhoneRoom: vi.fn() }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => false }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => false }));
vi.mock('../src/platform/haptics.js', () => ({ hapticBlocked: vi.fn() }));

beforeEach((ctx) => seedRandom(ctx.task.name));
afterEach(() => restoreRandom());

const STAVHRY = 8;
const lode = () => {
  const h = roomHarness('LODE', () => 20);
  const said = (from = 0) => h.mix.started.slice(from).map((x) => x.name);
  const hits = (from = 0) => said(from).filter((n) => /^b[12]-(zasah|potop)/.test(n)).length;
  return { ...h, said, hits };
};

describe('LODE match across undo', () => {
  it('keeps scoring on the same boards after an undo mid-match', () => {
    const h = lode();
    h.move();
    h.move();
    h.until(() => h.hits() >= 2, 8000);
    h.undo();
    const mark = h.mix.started.length;
    h.until(() => h.hits(mark) >= 2, 8000);
  });

  it('finishes the line in progress and the lines still queued', () => {
    const h = lode();
    h.move();
    h.move();
    h.until(() => h.s().isDialog() && h.mix.playing(101), 8000);
    const line = h.mix.sounding.get(101);
    const before = h.mix.started.length;
    h.undo();
    expect(h.s().isDialog()).toBe(true);
    expect(h.mix.sounding.get(101)).toBe(line); // not cut, not restarted
    h.until(() => !h.s().isDialog(), 2000);
    expect(h.said(before).some((n) => /^b2-/.test(n))).toBe(true); // the answer still came
  });

  it('keeps the wreckage sunk ships eroded into the background', () => {
    const h = lode();
    h.move();
    h.move();
    h.until(() => game.room!.wreckSwaps.length > 0 && h.s().padalod === -1, 40000);
    const bg = [...game.room!.bitmaps[1]!.pixels];
    const swaps = game.room!.wreckSwaps.length;
    h.undo();
    expect(game.room!.wreckSwaps.length).toBe(swaps);
    expect([...game.room!.bitmaps[1]!.pixels]).toEqual(bg);
  });

  it('does not finish a dead fish’s lines after undo brings it back', () => {
    const h = lode();
    h.move();
    h.move();
    h.until(() => h.s().noDialog() && !h.mix.playing(1), 8000);
    h.s().addm(0, 'smrt-m-0');
    h.tick();
    expect(h.mix.on(1)).toBe('smrt-m-0');
    game.room!.killFish('little');
    h.undo();
    expect(h.mix.playing(1)).toBe(false);
    expect(h.s().isDialog()).toBe(false);
  });

  it('deals a new match when a load restores a score without its boards', () => {
    const h = lode();
    h.move();
    h.until(() => h.hits() >= 1, 8000);
    const saved = h.s().snapshot();
    expect(saved.vars[0]![STAVHRY]).not.toBe(0);
    restore(game.engine!.srecord, saved, false, true);
    while (game.loadmode) advanceLoadmode();
    const mark = h.mix.started.length;
    h.until(() => h.hits(mark) >= 2, 8000);
  });
});
