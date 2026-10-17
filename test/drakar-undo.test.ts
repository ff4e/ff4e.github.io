/**
 * DRAKAR's crew runs on time — the roll-call, the beard argument, the rowing chants, the
 * coward taunts, the dog — so an undo leaves it where it is, pending lines included.
 * Before, a point banked while one of those was queued lost the queue: the roll-call's
 * closing `set` never ran and the crew fell silent for the visit, and a rower or a talker
 * was left frozen mid-line. Real room data, real script, real undo path.
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

const QUVOD = 1;
const drakar = () => {
  const h = roomHarness('DRAKAR', () => 25);
  const quvod = () => h.s().vars(0)[QUVOD]!;
  const said = (from = 0) => h.mix.started.slice(from).map((x) => x.name);
  /** Wait for the roll-call to be queued and under way. */
  const rollCall = () => {
    h.move();
    if (quvod() === -2) h.s().vars(0)[QUVOD] = 5; // this attempt skipped it: ask for one
    h.until(() => quvod() === -1 && h.s().isDialog(), 400);
  };
  return { ...h, quvod, said, rollCall };
};

describe('DRAKAR crew across undo', () => {
  it('finishes the roll-call and lets the crew talk on after an undo during it', () => {
    const h = drakar();
    h.rollCall();
    h.move(); // banked mid roll-call: quvod = -1, the rest queued
    h.move();
    const line = h.mix.sounding.get(1) ?? h.mix.sounding.get(2);
    h.undo();
    if (line) expect(h.mix.sounding.get(1) ?? h.mix.sounding.get(2)).toBe(line);
    h.until(() => h.quvod() === -2, 3000);
    expect(h.said().filter((n) => n === 'dr1-m-dlouho')).toHaveLength(1); // not started over
  });

  it('lets a talking viking finish his line, and then stop mouthing', () => {
    const h = drakar();
    h.move();
    h.move();
    const talker = () => [1, 2, 3].map((i) => h.s().vars(i)[1]!).find((c) => c >= 200);
    h.until(() => talker() !== undefined && h.mix.playing(talker()!), 20000);
    const prior = talker()!;
    const line = h.mix.sounding.get(prior);
    h.undo();
    expect(h.mix.sounding.get(prior)).toBe(line);
    expect(talker()).toBe(prior);
    h.until(() => talker() === undefined, 400);
  });

  it('does not finish a dead fish’s lines, but the crew carries on', () => {
    const h = drakar();
    h.rollCall();
    h.until(() => h.quvod() === -2 && h.s().noDialog(), 3000);
    h.move();
    h.move(); // so the undo target is after the roll-call
    h.until(() => h.s().noDialog() && !h.mix.playing(1), 3000);
    h.s().addm(0, 'smrt-m-0');
    h.s().addm(0, 'smrt-m-1');
    h.tick();
    expect(h.mix.on(1)).toBe('smrt-m-0');
    const dogComment = h.s().vars(0)[7]!; // qpejsek, counting down while the dog is quiet
    game.room!.killFish('little');
    h.tick(); // the death silences the crew's banter (quvod := -1)
    h.undo();
    const mark = h.mix.started.length;
    expect(h.mix.playing(1)).toBe(false);
    expect(h.quvod()).toBe(-2);
    if (dogComment > 0) expect(h.s().vars(0)[7]).toBeGreaterThanOrEqual(dogComment);
    h.ticks(300);
    expect(h.said(mark).some((n) => n.startsWith('smrt-'))).toBe(false);
  });

  it('re-runs a roll-call that a load restores without its queue', () => {
    const h = drakar();
    h.rollCall();
    const saved = h.s().snapshot();
    restore(game.engine!.srecord, saved, false, true);
    while (game.loadmode) advanceLoadmode();
    h.until(() => h.quvod() === -2, 3000);
  });
});
