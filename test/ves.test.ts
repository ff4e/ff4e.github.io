/**
 * VES (room 26) deterministic mechanics (URoom.pas:5759-5807, 12166-12414): the
 * amplifier state machines (start loop / dance / push-down / smash), the singing
 * head timeline, and the crab. A sound-spy captures musiccyc/ksnd/snd/talkNow so
 * the audio-driven transitions can be asserted without real playback. The story
 * dialogue is gated on both fish alive + no dialogue and is switched off (kill the
 * little fish) for the object-block tests.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { VES } from '../src/rooms/ves.js';

const R = { amp1: 1, amp2: 2, amp3: 3, hlava: 4, krabik: 13 } as const;
const STAV = 1;
const FAZE = 2;
const ROOM_ROZBITO = 3;
const HLAVA_STAV = 1;

interface Spy {
  musiccyc: Array<{ name: string; prior: number }>;
  ksnd: number[];
  snd: Array<{ name: string; prior: number }>;
  talkNow: Array<{ name: string; prior: number }>;
}

function ves(isPlaying: (p: number) => boolean = () => false): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 13; i++) {
    if (i === 11) items.push({ kind: 'little', x: 2, y: 20 });
    else if (i === 12) items.push({ kind: 'big', x: 6, y: 20 });
    else items.push({ kind: 'static', x: (i % 10) + 1, y: 4 });
  }
  const room = makeRoom({ w: 40, h: 30, items });
  const spy: Spy = { musiccyc: [], ksnd: [], snd: [], talkNow: [] };
  const s = new Script(room, () => 0, isPlaying, {
    musiccyc: (name, prior) => spy.musiccyc.push({ name, prior }),
    ksnd: (prior) => spy.ksnd.push(prior),
    snd: (name, prior) => spy.snd.push({ name, prior }),
    talkNow: (name, prior) => {
      spy.talkNow.push({ name, prior });
      return 0;
    },
  });
  VES.init(s);
  s.room.alive.little = false; // close the story-dialogue gate for object tests
  return { s, spy };
}

describe('VES init', () => {
  it('seeds the room, amps (with staggered start frames), head and crab', () => {
    const { s } = ves();
    const v = s.vars(0);
    expect(v[1]).toBe(0); // hlaskam
    expect(v[2]).toBe(0); // hlaskav
    expect(v[ROOM_ROZBITO]).toBe(0);
    expect(s.roompole[0]).toBe(27); // music_volume default
    expect(s.vars(R.amp1)[STAV]).toBe(0);
    expect(s.item(R.amp2).afaze).toBe(3);
    expect(s.item(R.amp3).afaze).toBe(6);
    const h = s.vars(R.hlava);
    expect(h[HLAVA_STAV]).toBe(0);
    expect(h[2]).toBe(30); // zac1
    expect(h[3]).toBe(65); // zac2
    expect(s.item(R.krabik).afaze).toBe(1);
  });
});

describe('VES amplifier', () => {
  it('starts its looping track at count = zac2 + offset (musiccyc)', () => {
    const { s, spy } = ves();
    s.count = 65; // zac2 + 0 -> amp1 starts
    VES.prog(s);
    expect(spy.musiccyc).toContainEqual({ name: 'ves-ampliony', prior: 50 });
    expect(s.vars(R.amp1)[STAV]).toBe(1);
    expect(s.vars(R.amp1)[FAZE]).toBe(0);
    // amp2/amp3 (offset 3/5) have not started yet.
    expect(s.vars(R.amp2)[STAV]).toBe(0);
    expect(s.vars(R.amp3)[STAV]).toBe(0);
  });

  it('dances through the afaze pattern on odd ticks (stav 1)', () => {
    const { s } = ves();
    const av = s.vars(R.amp1);
    av[STAV] = 1;
    av[FAZE] = 0;
    s.item(R.amp1).afaze = 0;
    s.count = 1; // odd
    VES.prog(s);
    expect(s.item(R.amp1).afaze).toBe(1); // faze 0 -> inc
    expect(av[FAZE]).toBe(1);

    // faze 13 wraps: afaze -> 0, faze -> -1 then ++ -> 0.
    av[FAZE] = 13;
    s.item(R.amp1).afaze = 5;
    s.count = 3;
    VES.prog(s);
    expect(s.item(R.amp1).afaze).toBe(0);
    expect(av[FAZE]).toBe(0);
  });

  it('goes to stav 2 when pushed down, and smashes (ksnd + smash + rozbito) on release', () => {
    const { s, spy } = ves();
    const av = s.vars(R.amp1);
    av[STAV] = 1;
    s.item(R.amp1).dir = Dir.down;
    s.count = 65 + 4; // not a start tick; even so no dance advance
    VES.prog(s);
    expect(av[STAV]).toBe(2);
    expect(s.item(R.amp1).afaze).toBe(7);

    // Release: Dir back to no -> smash.
    s.item(R.amp1).dir = Dir.no;
    VES.prog(s);
    expect(av[STAV]).toBe(3);
    expect(s.item(R.amp1).afaze).toBe(9);
    expect(spy.ksnd).toContain(50);
    expect(spy.snd).toContainEqual({ name: 'sp-smrt', prior: 40 });
    expect(s.vars(0)[ROOM_ROZBITO]).toBe(1); // one amp broken
  });
});

describe('VES singing head', () => {
  it('strikes up at count = zac1 (snd 301)', () => {
    const { s, spy } = ves();
    s.count = 30; // zac1
    VES.prog(s);
    expect(spy.snd).toContainEqual({ name: 'ves-hs-hrajeme', prior: 301 });
    expect(s.vars(R.hlava)[HLAVA_STAV]).toBe(1);
  });

  it('counts up through the idle band (stav 4..50)', () => {
    const { s } = ves();
    s.vars(R.hlava)[HLAVA_STAV] = 10;
    VES.prog(s);
    expect(s.vars(R.hlava)[HLAVA_STAV]).toBe(11);
  });

  it('sings its farewell at stav 51 (talkNow papa) and moves to stav 100', () => {
    const { s, spy } = ves();
    s.vars(R.hlava)[HLAVA_STAV] = 51;
    const before = s.vars(0)[ROOM_ROZBITO]!;
    VES.prog(s);
    expect(spy.talkNow).toContainEqual({ name: 'ves-hs-papa', prior: 302 });
    expect(s.vars(0)[ROOM_ROZBITO]).toBe(before + 1);
    expect(s.vars(R.hlava)[HLAVA_STAV]).toBe(100);
  });
});

describe('VES crab', () => {
  it('bops (never resting-frame 1) while a track plays', () => {
    const { s } = ves((p) => p === 50); // pretend the first amp loop is sounding
    for (let t = 0; t < 12; t++) {
      VES.prog(s);
      expect(s.item(R.krabik).afaze).not.toBe(1); // the 1->5 guard keeps it off frame 1
      expect(s.item(R.krabik).afaze! <= 5).toBe(true);
    }
  });
});
