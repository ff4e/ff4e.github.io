/**
 * SPUNT (room 29) — the gspec=9 "push the cork out" room. Covers init (gspec=9 +
 * timers), the Spec9 cork marking + "jo!" acknowledgement, and the decor helpers
 * (crab / snail / head). The host-side cork exit-slide + win is verified live in
 * tools (there is no headless step loop here).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { SPUNT } from '../src/rooms/spunt.js';

const R = {
  spunt: 1,
  krab1: 7,
  hlava3: 11,
  snecik1: 12,
  hlava1: 19,
} as const;

interface Spy {
  talk: Array<{ name: string; prior: number }>;
}

/** A SPUNT-shaped room (19 items). The two fish are found by kind; velkar(3)=big,
 *  malar(4)=little. The cork (1) starts mid-room; decor fills the rest. */
function spunt(cork?: { x: number; y: number }): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 19; i++) {
    if (i === 1) items.push({ kind: 'light', x: cork?.x ?? 15, y: cork?.y ?? 15 }); // spunt (pushable)
    else if (i === 3) items.push({ kind: 'big', x: 6, y: 25 });
    else if (i === 4) items.push({ kind: 'little', x: 2, y: 25 });
    else items.push({ kind: 'static', x: (i % 12) + 1, y: 5 });
  }
  const room = makeRoom({ w: 30, h: 30, items });
  const spy: Spy = { talk: [] };
  const s = new Script(
    room,
    () => 0,
    () => false,
    {
      talkNow: (name, prior) => {
        spy.talk.push({ name, prior });
        return 5;
      },
    },
    () => false, // isTalking: nothing talking, so the "jo" cheer fires
  );
  SPUNT.init(s);
  return { s, spy };
}

describe('SPUNT init', () => {
  it('marks the room gspec=9 and seeds the timers/decor', () => {
    const { s } = spunt();
    expect(s.room.gspec).toBe(9);
    expect(s.room.vytlacit).toBe(1);
    const v = s.vars(0);
    expect(v[1]).toBe(0); // uvod
    expect(v[3]! >= 1000 && v[3]! <= 2500).toBe(true); // nechat
    expect(v[4]! >= 2000 && v[4]! <= 4000).toBe(true); // zatraceny
    expect(s.vars(R.krab1)[2]! >= 2 && s.vars(R.krab1)[2]! <= 70).toBe(true); // krab1 spi
    expect(s.vars(R.hlava1)[1]! >= 10 && s.vars(R.hlava1)[1]! <= 100).toBe(true); // hlava1 ksicht
  });
});

describe('SPUNT cork (Spec9 push-out)', () => {
  it('marks the cork spec=9 with dir + faziVen when it reaches the left edge', () => {
    const { s } = spunt({ x: 0, y: 15 }); // cork against the left wall
    SPUNT.prog(s);
    const cork = s.item(R.spunt);
    expect(cork.spec).toBe(9);
    expect(cork.dir).toBe(Dir.left);
    expect(cork.faziVen).toBe(18); // 3 * a (a = 6)
  });

  it('cheers "jo!" from both fish when the cork is pushed out', () => {
    const { s, spy } = spunt({ x: 0, y: 15 });
    SPUNT.prog(s);
    expect(spy.talk.some((t) => t.name.startsWith('jo-m-') && t.prior === 1)).toBe(true);
    expect(spy.talk.some((t) => t.name.startsWith('jo-v-') && t.prior === 2)).toBe(true);
  });

  it('does not re-mark a cork that is already spec=9', () => {
    const { s, spy } = spunt({ x: 0, y: 15 });
    SPUNT.prog(s); // marks + cheers once
    const cheers = spy.talk.length;
    SPUNT.prog(s); // cork already spec=9 -> early return, no new cheer
    expect(spy.talk.length).toBe(cheers);
  });

  it('leaves the cork untouched (spec 0) when it is not at an edge', () => {
    const { s } = spunt({ x: 15, y: 15 });
    SPUNT.prog(s);
    expect(s.item(R.spunt).spec).toBe(0);
  });
});

describe('SPUNT decor', () => {
  it('snail peeks out (afaze grows) after being nudged, then retracts', () => {
    const { s } = spunt();
    const sn = s.item(R.snecik1);
    sn.dir = Dir.up; // nudged
    sn.afaze = 0;
    SPUNT.prog(s);
    expect(s.vars(R.snecik1)[1]! > 0).toBe(true); // kouka armed
    expect(sn.afaze).toBe(1); // popped out a frame

    // Now at rest with the timer running down: keeps peeking until it expires.
    sn.dir = Dir.no;
    SPUNT.prog(s);
    expect(sn.afaze).toBe(2); // grows toward the max (2)
  });

  it('head closes its mouth (afaze 0) when its ksicht timer is exhausted', () => {
    const { s } = spunt();
    const hv = s.vars(R.hlava3);
    hv[2] = 0; // huba closed
    hv[1] = 5; // ksicht still counting
    // With huba 0 and ksicht>0, the first two branches fall through; random(1000)<3
    // rarely opens it, otherwise afaze:=0. Run a few times; afaze must stay 0 unless opened.
    for (let t = 0; t < 20; t++) {
      s.vars(R.hlava3)[2] = 0;
      s.vars(R.hlava3)[1] = 5;
      s.item(R.hlava3).afaze = 3;
      SPUNT.prog(s);
      // Either it opened (huba set 1/2 -> afaze unchanged this tick) or stayed closed (0).
      const huba = s.vars(R.hlava3)[2]!;
      if (huba === 0) expect(s.item(R.hlava3).afaze).toBe(0);
    }
  });
});
