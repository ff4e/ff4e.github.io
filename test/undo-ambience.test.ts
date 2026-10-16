/**
 * Room ambience that runs on time keeps playing through an undo (`RoomScript.carriedSounds`
 * + `restorePresentation`), while what an undone move started or stopped follows the move.
 * Real room data, real scripts, real undo path; DRAKAR1's band is in drakar1-undo.test.ts.
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

const lengths = (name: string): number =>
  name === 'rybky08' ? 900 : name.startsWith('ves-hs') ? 60 : name === 'dr-x-pes' ? 25 : 30;

beforeEach((ctx) => seedRandom(ctx.task.name));
afterEach(() => restoreRandom());

describe.each([
  ['DRAKAR', 351], // the dog's bark
  ['BARELY', 701], // the duck's quack
  ['SMETAK', 940], // the alarm clock's tick
  ['MOTOR', 10], // the running motor's hum
] as const)('%s', (room, prior) => {
  it(`keeps sound ${prior} playing, not restarted, through an undo`, () => {
    const h = roomHarness(room, lengths);
    h.move();
    h.move();
    for (let i = 0; i < 4000 && !h.mix.playing(prior); i++) {
      if (i % 20 === 19) h.move();
      else h.tick();
    }
    expect(h.mix.playing(prior)).toBe(true);
    if (room === 'MOTOR') h.move(); // so the undo lands where the motor already runs
    const voice = h.mix.sounding.get(prior);
    h.undo();
    expect(h.mix.sounding.get(prior)).toBe(voice);
    expect(h.mix.playing(prior)).toBe(true);
  });
});

describe('KORALY', () => {
  const CINNOST = 1;
  it('plays the octopus tune on through an undo, and stops it when the shove is undone', () => {
    const h = roomHarness('KORALY', lengths);
    const octopus = () => h.s().vars(2);
    h.move();
    for (let i = 0; i < 200 && octopus()[CINNOST] === 0; i++) h.move();
    expect(octopus()[CINNOST]).toBeGreaterThan(0); // that move shoved it
    h.until(() => h.mix.playing(10));
    const tune = h.mix.sounding.get(10);
    h.move();
    h.ticks(10);
    const cursor = octopus()[CINNOST]!;
    expect(cursor).toBeGreaterThan(20);
    expect(cursor).toBeLessThan(80);
    h.undo();
    expect(h.mix.sounding.get(10)).toBe(tune);
    h.tick();
    expect(octopus()[CINNOST]).toBe(cursor === 36 ? 21 : cursor + 1); // not skipped to 80
    h.undo(); // the shove itself
    expect(h.mix.playing(10)).toBe(false);
    expect(octopus()[CINNOST]).toBe(0);
  });
});

describe('VES', () => {
  const AMPS = [[1, 50], [2, 51], [3, 52]] as const;
  const STAV = 1;
  const ves = () => {
    const h = roomHarness('VES', lengths);
    return { ...h, head: () => h.s().vars(4) };
  };

  it('keeps the amps playing and the head in its act through an undo', () => {
    const h = ves();
    h.move();
    h.move();
    h.until(() => AMPS.every(([, p]) => h.mix.playing(p)));
    h.ticks(40);
    const loops = AMPS.map(([, p]) => h.mix.sounding.get(p));
    const head = h.head()[STAV];
    h.undo();
    h.ticks(10);
    AMPS.forEach(([, p], i) => expect(h.mix.sounding.get(p)).toBe(loops[i])); // the same loops, not restarted
    expect(h.head()[STAV]).toBe(head);
  });

  it('keeps the head to its schedule when undo restarts the clock', () => {
    const h = ves();
    h.move();
    h.move();
    const elapsed = h.s().count;
    expect(elapsed).toBeLessThan(25); // the head strikes up at count 30
    h.undo();
    h.ticks(30 - elapsed - 1);
    expect(h.head()[STAV]).toBe(0);
    h.ticks(2);
    expect(h.head()[STAV]).toBe(1);
  });

  it('brings back the loop of an amp whose smash is undone', () => {
    const h = ves();
    const smashed = () => h.s().vars(0)[3]!;
    h.move();
    let before = smashed();
    for (let i = 0; i < 400 && smashed() === before; i++) {
      before = smashed();
      h.move();
    }
    expect(smashed()).toBe(before + 1);
    const broken = AMPS.filter(([i]) => h.s().vars(i)[STAV]! >= 3);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.some(([, p]) => h.mix.playing(p))).toBe(false);
    h.undo();
    expect(smashed()).toBe(before);
    const restored = broken.filter(([i]) => h.s().vars(i)[STAV]! <= 2);
    expect(restored.length).toBeGreaterThan(0);
    for (const [, p] of restored) expect(h.mix.playing(p)).toBe(true);
  });
});
