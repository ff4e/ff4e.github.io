/**
 * DRAKAR1's band is the room's own time-driven performance, not anything the fish did, so
 * taking back a move must leave it exactly where it is: same block, same tracks still
 * sounding, the intro music neither restarted nor revived, and a music-to-band handoff
 * that is in progress still completing. Real room data, real script, real undo path.
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

const ROOM_BLOK = 1;
const ROOM_DOHRAT = 3;
const lengths = (name: string): number => (name === 'rybky04' ? 1500 : name.startsWith('d1-z-') ? 90 : 30);
const band = () => {
  const h = roomHarness('DRAKAR1', lengths);
  const rv = () => h.s().vars(0);
  return { ...h, rv };
}

beforeEach(() => seedRandom('drakar1-undo'));
afterEach(() => restoreRandom());

describe('DRAKAR1 band across undo', () => {
  it('keeps the band playing, in the same block, when a move is undone mid-song', () => {
    const h = band();
    h.move();
    h.move();
    h.until(() => h.rv()[ROOM_BLOK]! >= 2);
    const blok = h.rv()[ROOM_BLOK]!;
    const whistle = h.mix.on(111);
    expect(whistle).toMatch(/^d1-z-p/);
    const startsBefore = h.mix.started.length;
    h.undo();
    h.tick();
    expect(h.rv()[ROOM_BLOK]).toBe(blok);
    expect(h.mix.on(111)).toBe(whistle);
    expect(h.mix.on(-998)).toBeNull();
    expect(h.mix.started.slice(startsBefore).map((x) => x.name)).not.toContain('rybky04');
    // and it carries on through the arrangement afterwards
    h.until(() => h.rv()[ROOM_BLOK] !== blok);
    expect(h.mix.on(111)).toMatch(/^d1-z-p/);
  });

  it('does not restart the intro music on undo before the band starts', () => {
    const h = band();
    h.move();
    h.until(() => h.s().noDialog(), 2000); // the countdown only runs while nobody talks
    h.ticks(50);
    h.move();
    h.ticks(20);
    const dohrat = h.rv()[ROOM_DOHRAT]!;
    expect(dohrat).toBeGreaterThan(0);
    const startsBefore = h.mix.started.length;
    h.undo();
    h.tick();
    expect(h.mix.started.slice(startsBefore).map((x) => x.name)).not.toContain('rybky04');
    expect(h.mix.on(-998)).toBe('rybky04');
    expect(h.rv()[ROOM_DOHRAT]).toBe(dohrat - 1);
  });

  it('still brings the band in when undo lands during the music-to-band handoff', () => {
    const h = band();
    h.move();
    h.until(() => h.rv()[ROOM_DOHRAT] === -1);
    h.ticks(15);
    h.move(); // banked mid-handoff: dohrat = -1, blok = -1, the queue holds the rest
    h.move();
    expect(h.s().isDialog()).toBe(true); // still mid-handoff: the queue is adopted
    h.undo();
    h.until(() => h.rv()[ROOM_BLOK]! >= 1, 2000);
    expect(h.mix.on(111)).toMatch(/^d1-z-p/);
    const said = h.mix.started.map((x) => x.name);
    expect(said.filter((n) => n.startsWith('d1-1-hudba'))).toHaveLength(1);
    expect(said.filter((n) => n.startsWith('d1-5-nevadi'))).toHaveLength(1);
  });

  it('re-arms a handoff that a load restores without its queue', () => {
    const h = band();
    h.move();
    h.until(() => h.rv()[ROOM_DOHRAT] === -1);
    h.ticks(15);
    const saved = h.s().snapshot();
    restore(game.engine!.srecord, saved, false, true);
    while (game.loadmode) advanceLoadmode();
    h.until(() => h.rv()[ROOM_BLOK]! >= 1, 2000);
    expect(h.mix.on(111)).toMatch(/^d1-z-p/);
  });
});
