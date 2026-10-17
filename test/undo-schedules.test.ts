/**
 * Undo restarts `count` from 0 with the rebuilt room. Rooms that keep a schedule as absolute
 * `count` values used to take the undo target's schedule, which put the next scheduled
 * remark as far off again as the time already spent in the room. The schedule runs on time,
 * so an undo leaves it where it was: the next remark is exactly as far off after the undo as
 * before it. Real room data, real scripts, real undo path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** The room item's Var slots that hold a `count` schedule. */
describe.each([
  ['ZAVAL', [1]], // room_uz
  ['TRUP', [1]], // room_rozh
  ['UTES', [6]], // room_rozhovor
  ['BANKA', [2, 3, 12]], // room_kdy, room_kdy2, room_fuja
] as const)('%s', (room, slots) => {
  it('keeps its next scheduled remark as far off through an undo as before it', () => {
    const h = roomHarness(room, () => 25);
    h.move();
    h.ticks(3000);
    h.move();
    h.move();
    const due = () => slots.map((i) => h.s().vars(0)[i]! - h.s().count);
    const before = due();
    h.undo();
    expect(due()).toEqual(before);
  });
});

describe('PRVNI', () => {
  it('keeps the tutorial countdown running through an undo', () => {
    const h = roomHarness('PRVNI', () => 25);
    const QNAVOD2 = 2;
    h.move();
    h.ticks(40);
    h.move();
    h.move();
    const v = () => h.s().vars(0)[QNAVOD2]!;
    expect(v()).not.toBe(-1); // still counting down
    const due = v() - h.s().count;
    h.undo();
    expect(v() - h.s().count).toBe(due);
  });
});
