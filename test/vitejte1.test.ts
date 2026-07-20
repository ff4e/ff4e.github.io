/**
 * VITEJTE1 (room 21) deterministic mechanics (URoom.pas:8170-8238, 20401-20858):
 * the ruler's cinnost announcement dispatcher, the obecne/specialni topic
 * bitmasks, and the crab audience reaction. A talkNow spy captures the head's
 * immediate voice lines. The shared vladce face frames are covered by diry.test.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { VITEJTE1 } from '../src/rooms/vitejte1.js';

const R = { vladce: 1, malar: 9, velkar: 10, krabi: 11 } as const;
const KSICHTY = 1;
const CINNOST = 2;
const FAZE = 3;
const DELAY = 4;
const VITAL = 5;
const OBECNE = 6;
const SPECIALNI = 7;
const PROMLUVILA = 9;

interface Spy {
  talk: Array<{ name: string; prior: number }>;
}

/** A VITEJTE1-shaped room: vladce (1) at top-centre, malar (9) = little, velkar
 *  (10) = big, seven crabs at 11..17 near the ruler. */
function vitejte1(isPlaying: (p: number) => boolean = () => false): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 17; i++) {
    if (i === 1) items.push({ kind: 'static', x: 18, y: 3 }); // vladce
    else if (i === 9) items.push({ kind: 'little', x: 2, y: 25 });
    else if (i === 10) items.push({ kind: 'big', x: 6, y: 25 });
    else items.push({ kind: 'static', x: 16 + (i - 11), y: 6 }); // crabs 11..17 near ruler
  }
  const room = makeRoom({ w: 40, h: 30, items });
  const spy: Spy = { talk: [] };
  const s = new Script(
    room,
    () => 0,
    isPlaying,
    {
      talkNow: (name, prior) => {
        spy.talk.push({ name, prior });
        return 5;
      },
    },
    isPlaying, // isTalking: reuse the same predicate for talking(302)/talking(303)
  );
  VITEJTE1.init(s);
  return { s, spy };
}

describe('VITEJTE1 init', () => {
  it('seeds the room + ruler, zeroes globpole[0..6], and sets only crab item 11', () => {
    const { s } = vitejte1();
    const vl = s.vars(R.vladce);
    expect(vl[KSICHTY]).toBe(0);
    expect(vl[CINNOST]).toBe(0);
    expect(vl[VITAL]).toBe(0);
    expect(vl[OBECNE]).toBe(0);
    expect(vl[SPECIALNI]).toBe(0);
    expect(vl[8]).toBe(100); // prodleva
    expect(vl[DELAY]! >= 80 && vl[DELAY]! <= 159).toBe(true);
    for (let p = 0; p <= 6; p++) expect(s.globpole[p]).toBe(0);
    // The original's `afaze:=1` is scoped to `with Items[krabi]` (item 11) only,
    // so items 12..17 keep their loaded afaze (0 here), not 1.
    expect(s.item(R.krabi).afaze).toBe(1);
  });
});

describe('VITEJTE1 ruler dispatcher', () => {
  /** Force the ruler idle with a ready delay so the scheduler runs this tick. */
  function ready(s: Script): number[] {
    const vl = s.vars(R.vladce);
    vl[KSICHTY] = 0;
    vl[CINNOST] = 0;
    vl[DELAY] = 0;
    s.count = 1; // odd: the face machine's ksichty 1..4 branch (count%2==0) is skipped,
    // so it doesn't reset the ksichty the dispatcher just set (in-test playing(302) is
    // false). This isolates the dispatcher; the face frames are covered by diry.test.
    s.room.alive.little = false; // keep the fish-comment gate closed
    return vl;
  }

  it('gives the welcome speech first (vital latch -> cinnost 1 -> talk vitejte)', () => {
    const { s, spy } = vitejte1();
    const vl = ready(s);
    expect(vl[VITAL]).toBe(0);
    VITEJTE1.prog(s); // scheduler: vital 0 -> cinnost 1, vital 1
    expect(vl[VITAL]).toBe(1);
    // Same tick, the dispatcher runs cinnost 1 (ksichty still 0) -> talk welcome.
    expect(spy.talk.some((t) => t.name.startsWith('vit-hs-vitejte') && t.prior === 302)).toBe(true);
    expect(vl[KSICHTY]).toBe(2);
    expect(vl[CINNOST]).toBe(0);
  });

  it('picks an "obecne" topic and marks its bit + increments promluvila', () => {
    const { s } = vitejte1((p) => p === 999); // nothing relevant playing
    const vl = ready(s);
    vl[VITAL] = 1; // past the welcome
    const before = vl[PROMLUVILA]!;
    // Run until an obecne topic is picked (random gated; bounded attempts).
    let picked = false;
    for (let t = 0; t < 200 && !picked; t++) {
      vl[KSICHTY] = 0;
      vl[CINNOST] = 0;
      vl[DELAY] = 0;
      const promBefore = vl[PROMLUVILA]!;
      VITEJTE1.prog(s);
      if (vl[PROMLUVILA]! > promBefore) picked = true;
    }
    expect(picked).toBe(true);
    expect(vl[OBECNE]! > 0 || vl[SPECIALNI]! > 0).toBe(true); // a topic bit was set
    expect(vl[PROMLUVILA]!).toBeGreaterThan(before);
  });

  it('doubles prodleva and clears the masks when both pools are exhausted', () => {
    const { s } = vitejte1();
    const vl = s.vars(R.vladce);
    vl[OBECNE] = 31;
    vl[SPECIALNI] = 31;
    vl[8] = 100; // prodleva
    vl[KSICHTY] = 5; // keep the scheduler/dispatcher out of the way
    VITEJTE1.prog(s);
    expect(vl[8]).toBe(200); // doubled
    expect(vl[OBECNE]).toBe(0);
    expect(vl[SPECIALNI]).toBe(0);
  });

  it('dispatches the demons topic (cinnost 2 -> talk demoni0, ksichty 1)', () => {
    const { s, spy } = vitejte1();
    const vl = s.vars(R.vladce);
    vl[KSICHTY] = 0;
    vl[CINNOST] = 2;
    vl[VITAL] = 1;
    vl[DELAY] = 50; // not ready -> scheduler won't overwrite cinnost
    s.count = 1; // odd -> face machine leaves the dispatched ksichty intact
    VITEJTE1.prog(s);
    expect(spy.talk).toContainEqual({ name: 'vit-hs-demoni0', prior: 302 });
    expect(vl[KSICHTY]).toBe(1);
    expect(vl[CINNOST]).toBe(0);
  });
});

describe('VITEJTE1 crab audience', () => {
  it('wakes a nearby crab (globpole=1, afaze 0..5) while the ruler is talking', () => {
    const { s } = vitejte1((p) => p === 302); // talking(302) true
    const vl = s.vars(R.vladce);
    vl[KSICHTY] = 5; // freeze the ruler face/dispatcher
    // Put crab 0 within 4 cells of the ruler and at rest.
    s.item(R.krabi).x = s.item(R.vladce).x;
    s.item(R.krabi).y = s.item(R.vladce).y + 2;
    s.item(R.krabi).dir = Dir.no;
    s.globpole[0] = 0;
    VITEJTE1.prog(s);
    expect(s.globpole[0]).toBe(1); // reacting
    expect(s.item(R.krabi).afaze! >= 0 && s.item(R.krabi).afaze! <= 5).toBe(true);
  });

  it('lets a crab doze (negative globpole counts back up) when the ruler is silent', () => {
    const { s } = vitejte1(() => false); // nothing talking
    const vl = s.vars(R.vladce);
    vl[KSICHTY] = 5;
    s.item(R.krabi).dir = Dir.no;
    s.item(R.krabi).x = 0; // far from the ruler
    s.item(R.krabi).y = 25;
    s.globpole[0] = -5; // mid-doze
    VITEJTE1.prog(s);
    expect(s.globpole[0]).toBe(-4); // counted back toward 0
  });
});
