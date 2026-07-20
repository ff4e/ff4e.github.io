/**
 * SLOUPY (room 23) deterministic mechanics (URoom.pas:6829-6899, 16006-16285):
 * the colonnade wave state machine (rada1 = items 9..26) and the rising-statue /
 * toppling-figure sequences. The RNG-heavy story dialogue is gated on both fish
 * alive + no dialogue, so tests close that gate (kill a fish) and drive the
 * always-run object blocks, which are RNG-free for the cases exercised here.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { SLOUPY } from '../src/rooms/sloupy.js';

const R = {
  rada1beg: 9,
  rada1end: 26,
  rada2beg: 27,
  sochoradi: 52,
  chlapik: 53,
} as const;
const CIN = 1;
const FAZE = 2;
const X1 = 3;

/** A SLOUPY-shaped room with all 53 items (fillers where the script ignores them);
 *  malar (7) = little fish, velkar (8) = big fish, rada1 = 9..26, rada2 = 27..50,
 *  sochoradi = 52, chlapik = 53. */
function sloupy(): Script {
  const items: ItemSpec[] = [];
  const stat = (x: number, y: number): ItemSpec => ({ kind: 'static', x, y });
  for (let i = 1; i <= 53; i++) {
    if (i === 7) items.push({ kind: 'little', x: 2, y: 20 });
    else if (i === 8) items.push({ kind: 'big', x: 6, y: 20 });
    else items.push(stat((i % 20) + 1, 2 + (i % 5)));
  }
  const room = makeRoom({ w: 60, h: 30, items });
  const s = new Script(room, () => 0);
  SLOUPY.init(s);
  s.room.alive.little = false; // close the story-dialogue gate for object tests
  return s;
}

describe('SLOUPY init', () => {
  it('seeds the room vars and idles every animated group', () => {
    const s = sloupy();
    const v = s.vars(0);
    expect(v[1]).toBe(12); // uvod (pokus 1)
    expect(v[2]! === 0 || v[2]! === 1).toBe(true); // kochani = random(2)
    expect(v[3]).toBe(0); // pady
    expect(v[4]! >= 500 && v[4]! <= 1999).toBe(true); // osose
    expect(s.vars(R.rada1beg)[CIN]).toBe(0);
    expect(s.vars(R.rada2beg)[CIN]).toBe(0);
    expect(s.vars(R.sochoradi)[CIN]).toBe(0);
    expect(s.vars(R.chlapik)[CIN]).toBe(0);
  });
});

describe('SLOUPY wave (rada1)', () => {
  it('runs a left-to-right wave (cinnost 2) one column per odd tick, then idles', () => {
    const s = sloupy();
    const rv = s.vars(R.rada1beg);
    rv[CIN] = 2;
    rv[X1] = 2; // the expression to paint
    rv[FAZE] = 0;

    s.count = 1; // odd -> advances
    SLOUPY.prog(s);
    expect(s.item(R.rada1beg).afaze).toBe(2); // painted column 9
    expect(rv[FAZE]).toBe(1);
    expect(rv[CIN]).toBe(2); // still running

    s.count = 2; // even -> no advance
    SLOUPY.prog(s);
    expect(rv[FAZE]).toBe(1);

    // Jump to the last column and finish the wave.
    rv[FAZE] = R.rada1end - R.rada1beg; // 17 -> paints item 26 this tick
    s.count = 3;
    SLOUPY.prog(s);
    expect(s.item(R.rada1end).afaze).toBe(2); // last column painted
    expect(rv[CIN]).toBe(0); // wave complete -> idle
  });

  it('scripted trigger (cinnost 7) converts to a double wave with xicht=1', () => {
    const s = sloupy();
    const rv = s.vars(R.rada1beg);
    rv[CIN] = 7;
    s.count = 2; // even, so the case-4 body does not also run this tick
    SLOUPY.prog(s);
    expect(rv[CIN]).toBe(4);
    expect(rv[X1]).toBe(1);
    expect(rv[4]).toBe(1); // xicht2
    expect(rv[FAZE]).toBe(0);
  });
});

describe('SLOUPY sochoradi (rising statue)', () => {
  it('plays its frames 1..7 then kicks rada1 into a wave at cinnost 8', () => {
    const s = sloupy();
    const sv = s.vars(R.sochoradi);
    sv[CIN] = 3;
    SLOUPY.prog(s);
    expect(s.item(R.sochoradi).afaze).toBe(3); // afaze := cinnost
    expect(sv[CIN]).toBe(4); // advanced

    sv[CIN] = 8;
    SLOUPY.prog(s);
    expect(s.vars(R.rada1beg)[CIN]).toBe(7); // triggers the scripted wave
    expect(sv[CIN]).toBe(9); // advanced past 8
  });

  it('waits at cinnost 0 until it is pushed up (dir_up)', () => {
    const s = sloupy();
    const sv = s.vars(R.sochoradi);
    sv[CIN] = 0;
    SLOUPY.prog(s);
    expect(sv[CIN]).toBe(0); // dir == no -> stays
    s.item(R.sochoradi).dir = Dir.up;
    SLOUPY.prog(s);
    expect(sv[CIN]).toBe(1); // rose -> advance
  });
});

describe('SLOUPY chlapik (toppling figure)', () => {
  it('at cinnost 1 (come to rest) it shrieks the fish and clears the queue', () => {
    const s = sloupy();
    s.room.alive.little = true; // the shriek only queues if the little fish lives
    s.room.alive.big = false; // ...but keep the story-dialogue gate closed (needs both)
    const cv = s.vars(R.chlapik);
    cv[CIN] = 1;
    s.item(R.chlapik).dir = Dir.no;
    s.addm(0, 'sl-m-stale'); // something stale in the queue, to be cleared
    SLOUPY.prog(s);
    expect(s.item(R.chlapik).afaze).toBe(1);
    expect(cv[CIN]).toBe(2);
    expect(s.isDialog()).toBe(true); // the shriek line was queued (after clearDialog)
  });

  it('at cinnost 10 it kicks rada1 into the scripted wave', () => {
    const s = sloupy();
    const cv = s.vars(R.chlapik);
    cv[CIN] = 10;
    SLOUPY.prog(s);
    expect(s.vars(R.rada1beg)[CIN]).toBe(7);
    expect(cv[CIN]).toBe(11);
  });
});
