/**
 * KANKAN (room 35) deterministic mechanics (URoom.pas:5395-5469, 10653-10947):
 * the crabs' dance-partner detection (`muze`, same row & adjacent), the music gate
 * (no room music → cooldown `ceka` resets so nobody dances), the piano octopus's
 * key-slam (`KSnd(-999)` + `vyruseni`) when shoved, the anemone's composed afaze,
 * and the big fish's between-numbers "why?". The room-music channel is simulated
 * via the injectable `playing` predicate.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { KANKAN } from '../src/rooms/kankan.js';

const R = { krab1: 1, krab2: 2, klavir: 6, sasanka: 18, velkar: 19 } as const;
const MUSIC = -999;
const KRAB1_MUZE = 1;
const KRAB2_MUZE = 1;
const KRAB1_CEKA = 3;
const KLAVIR_VYRUSENI = 4;
const SASANKA_NOHA = 1;
const SASANKA_KVET = 2;
const VELKAR_PTALNYNI = 1;

interface Spy {
  ksnd: number[];
}

/** A KANKAN-shaped room (items 1..19). Crabs 1..4 in a row, klavir/sepie/rejnok/
 *  sasanka spread out, velkar (19) the big fish, a little fish parked at slot 5.
 *  `music` toggles whether the room track counts as playing (-999). */
function kankan(music: boolean): { s: Script; spy: Spy; setMusic: (v: boolean) => void } {
  let playing = music;
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 19; i++) {
    if (i >= R.krab1 && i <= 4) items.push({ kind: 'static', x: 5 + i, y: 20 }); // crabs 1..4 in a row
    else if (i === 5) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 34, y: 2 });
    else if (i === R.sasanka) items.push({ kind: 'static', x: 20, y: 30 });
    else items.push({ kind: 'static', x: i, y: 10 });
  }
  const room = makeRoom({ w: 40, h: 40, items });
  const spy: Spy = { ksnd: [] };
  const s = new Script(
    room,
    () => 0,
    (prior) => (prior === MUSIC ? playing : false),
    { ksnd: (prior) => spy.ksnd.push(prior) },
  );
  KANKAN.init(s);
  return { s, spy, setMusic: (v) => (playing = v) };
}

describe('KANKAN crab dance-partner detection', () => {
  it('flags both crabs as able to dance when adjacent in the same row', () => {
    const { s } = kankan(true);
    // crab1 at (6,20), crab2 at (7,20): same row, adjacent → dist 1.
    KANKAN.prog(s);
    expect(s.vars(R.krab1)[KRAB1_MUZE]).toBe(1);
    expect(s.vars(R.krab2)[KRAB2_MUZE]).toBe(1);
  });

  it('clears the flag when the crabs are not in the same row', () => {
    const { s } = kankan(true);
    s.item(R.krab2).y = 25; // move crab2 to a different row
    KANKAN.prog(s);
    expect(s.vars(R.krab1)[KRAB1_MUZE]).toBe(0);
    expect(s.vars(R.krab2)[KRAB2_MUZE]).toBe(0);
  });
});

describe('KANKAN music gate', () => {
  it('resets the dance cooldown while the room music is not playing', () => {
    const { s } = kankan(false); // no music
    s.vars(R.krab1)[KRAB1_CEKA] = 0;
    KANKAN.prog(s);
    expect(s.vars(R.krab1)[KRAB1_CEKA]).toBe(20); // no music → nobody dances
  });
});

describe('KANKAN piano octopus', () => {
  it('slams the keys (KSnd -999) and covers its ears when shoved', () => {
    const { s, spy } = kankan(true);
    s.item(R.klavir).dir = Dir.left; // pushed
    KANKAN.prog(s);
    expect(spy.ksnd).toContain(MUSIC);
    expect(s.vars(R.klavir)[KLAVIR_VYRUSENI]).toBeGreaterThan(0);
  });
});

describe('KANKAN anemone', () => {
  it('composes its afaze as noha*4 + kvet + 1 over open water', () => {
    const { s } = kankan(true);
    KANKAN.prog(s);
    const sa = s.vars(R.sasanka);
    expect(s.item(R.sasanka).afaze).toBe(sa[SASANKA_NOHA]! * 4 + sa[SASANKA_KVET]! + 1);
  });
});

describe('KANKAN big fish', () => {
  it('clears its "asked" flag once the music resumes', () => {
    const { s } = kankan(true); // music playing again
    s.vars(R.velkar)[VELKAR_PTALNYNI] = 1; // had asked during the silence
    KANKAN.prog(s);
    expect(s.vars(R.velkar)[VELKAR_PTALNYNI]).toBe(0);
  });
});
