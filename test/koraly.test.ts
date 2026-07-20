/**
 * KORALY (room 34) deterministic mechanics (URoom.pas:6654-6776, 15384-15828): the
 * octopus waking into its tune when shoved (`cinnost`/`hrala` + KSnd(501)), cueing
 * the music at score-step 19 (`music('rybky08', 10)`), and the lead crab deriving
 * its dance frame from `playing(10)`. The `playing`/`music` channels are injected.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { KORALY } from '../src/rooms/koraly.js';

const R = { krab1: 1, balalajka: 2, velkar: 18, sepie: 21 } as const;
const KRAB1_KRABFAZE = 1;
const BAL_CINNOST = 1;
const BAL_HRALA = 3;

interface Spy {
  ksnd: number[];
  music: Array<{ name: string; prior: number }>;
}

/** A KORALY-shaped room (items 1..21). `playing` marks the tune (priority 10). */
function koraly(playing: (p: number) => boolean = () => false): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 21; i++) {
    if (i === R.velkar) items.push({ kind: 'big', x: 34, y: 2 });
    else if (i === 17) items.push({ kind: 'little', x: 2, y: 2 }); // an unscripted little-fish slot
    else if (i === R.balalajka) items.push({ kind: 'static', x: 15, y: 20 });
    else items.push({ kind: 'static', x: (i % 12) * 2 + 1, y: 25 });
  }
  const room = makeRoom({ w: 40, h: 30, items });
  const spy: Spy = { ksnd: [], music: [] };
  const s = new Script(room, () => 0, playing, {
    ksnd: (prior) => spy.ksnd.push(prior),
    music: (name, prior) => spy.music.push({ name, prior }),
  });
  KORALY.init(s);
  s.room.alive.little = false; // close the room dialogue gate for object tests
  return { s, spy };
}

describe('KORALY balalaika octopus', () => {
  it('wakes into its tune when shoved (advances cinnost, counts a play, KSnd 501)', () => {
    const { s, spy } = koraly();
    s.item(R.balalajka).dir = Dir.left; // pushed
    KORALY.prog(s);
    expect(s.vars(R.balalajka)[BAL_CINNOST]!).toBeGreaterThan(0);
    expect(s.vars(R.balalajka)[BAL_HRALA]).toBe(1); // one performance counted
    expect(spy.ksnd).toContain(501); // cut its idle beat
  });

  it('cues the music track at score-step 19', () => {
    const { s, spy } = koraly();
    s.vars(R.balalajka)[BAL_CINNOST] = 19;
    KORALY.prog(s);
    expect(spy.music).toContainEqual({ name: 'rybky08', prior: 10 });
  });
});

describe('KORALY dancing crab', () => {
  it('kicks to frame 7/9 while the tune plays', () => {
    const { s } = koraly((p) => p === 10); // tune sounding
    KORALY.prog(s);
    expect([7, 9]).toContain(s.vars(R.krab1)[KRAB1_KRABFAZE]);
  });

  it('settles to its resting frame (1) while the tune is silent', () => {
    const { s } = koraly(); // no tune
    KORALY.prog(s);
    expect(s.vars(R.krab1)[KRAB1_KRABFAZE]).toBe(1);
  });
});
