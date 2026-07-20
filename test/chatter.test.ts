/**
 * Ambient idle chatter (StdKecej / vyber_hlasku, URoom.pas:3207-3375). These unit
 * tests own the *firing logic* — timer gating, the enqueue, interval growth and the
 * no-repeat group rotation — so it no longer depends on the UI suite having an
 * "unported quiet room" to run in (the moving target that broke as rooms got ported).
 * The UI probe keeps only the porting-independent integration checks (bank loaded,
 * a timer exists, the shake).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { newChatter, tickChatter, vyberHlasku } from '../src/core/chatter.js';

const TPS = 12.5; // ticks per second (LOGIC_MS ~ 80ms)

function script(): Script {
  const items: ItemSpec[] = [
    { kind: 'little', x: 2, y: 2 },
    { kind: 'big', x: 6, y: 2 },
  ];
  return new Script(makeRoom({ w: 20, h: 12, items }), () => 0);
}

describe('chatter timer (StdKecej)', () => {
  it('newChatter starts with a positive interval (CasKecu = random(60)+60s)', () => {
    const st = newChatter(script(), TPS);
    expect(st.interval).toBeGreaterThanOrEqual(Math.round(60 * TPS));
    expect(st.interval).toBeLessThanOrEqual(Math.round(120 * TPS));
    expect(st.last).toBe(0);
  });

  it('does not fire while a dialogue is active', () => {
    const s = script();
    const st = newChatter(s, TPS);
    const fired = tickChatter(s, st, st.interval + 100, TPS, /*dialogActive*/ true);
    expect(fired).toBe(false);
    expect(s.isDialog()).toBe(false);
  });

  it('does not fire before the interval has elapsed', () => {
    const s = script();
    const st = newChatter(s, TPS);
    const fired = tickChatter(s, st, st.interval - 1, TPS, false);
    expect(fired).toBe(false);
  });

  it('fires when due: enqueues an ambient line and re-arms the timer', () => {
    const s = script();
    const st = newChatter(s, TPS);
    const before = st.interval;
    const fired = tickChatter(s, st, st.interval, TPS, false);
    expect(fired).toBe(true);
    expect(s.isDialog()).toBe(true); // a line was queued
    expect(st.last).toBe(before); // last := now
    expect(st.interval).toBeGreaterThanOrEqual(before); // grows 0-50%
    expect(st.interval).toBeLessThanOrEqual(Math.round((before * 150) / 100));
  });

  it('never repeats any of the last three chatter groups', () => {
    const s = script();
    const st = newChatter(s, TPS);
    let now = 0;
    const recent: number[] = []; // last three picked groups
    for (let i = 0; i < 40; i++) {
      now = st.last + st.interval; // jump straight to "due"
      const before = st.poslhlasky;
      tickChatter(s, st, now, TPS, false);
      // The newly-picked group is the high 3 bits of poslhlasky (packed n, 1..6).
      const picked = st.poslhlasky >> 6;
      expect(picked).toBeGreaterThanOrEqual(1);
      expect(picked).toBeLessThanOrEqual(6);
      for (const r of recent) expect(picked).not.toBe(r);
      recent.push(picked);
      if (recent.length > 3) recent.shift();
      expect(st.poslhlasky).not.toBe(before);
    }
  });
});

describe('vyber_hlasku groups', () => {
  it('every group (0..5) enqueues at least one line', () => {
    for (let druh = 0; druh <= 5; druh++) {
      const s = script();
      vyberHlasku(s, druh, /*depth15*/ false);
      expect(s.isDialog(), `group ${druh} enqueues a line`).toBe(true);
    }
  });

  it('group 0 stays silent at depth 15 (the original Room.Depth<>15 gate)', () => {
    const s = script();
    vyberHlasku(s, 0, /*depth15*/ true);
    expect(s.isDialog()).toBe(false);
  });
});
