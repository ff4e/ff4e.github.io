/**
 * Death commentary (StdSmrt) unit tests: when one fish dies while the other lives,
 * ~8 ticks later the survivor speaks a "smrt-*" line, gated by the room Depth.
 * We drive stdSmrt directly and drain the dialog queue through a talk-spy to see
 * which line is spoken — deterministic (depth 1 always yields a normal line).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { stdSmrt, newDeathState } from '../src/core/deathlines.js';

/** A room + Script whose talk-spy records every spoken line name. */
function setup() {
  const room = makeRoom({
    w: 20,
    h: 12,
    items: [
      { kind: 'little', x: 3, y: 10 },
      { kind: 'big', x: 10, y: 10 },
    ],
  });
  const spoken: string[] = [];
  const s = new Script(room, (name) => {
    spoken.push(name);
    return 1; // each line lasts 1 tick
  });
  return { room, s, spoken };
}

/** Drain the dialog queue, collecting spoken line names. */
function drain(s: Script, from: number, ticks = 80): void {
  for (let t = from; t < from + ticks; t++) s.dialogy(t);
}

const flags = (aliveLittle: boolean, aliveBig: boolean) => ({
  aliveLittle,
  aliveBig,
  venkuLittle: false,
  venkuBig: false,
});

describe('StdSmrt death commentary', () => {
  it('keeps the timer fresh while both fish are alive', () => {
    const { s } = setup();
    const st = newDeathState();
    stdSmrt(s, st, 100, 5, flags(true, true));
    expect(st.hlasitSmrt).toBe(100);
  });

  it('says nothing in the tutorial room (Depth = 2)', () => {
    const { s, spoken } = setup();
    const st = newDeathState();
    st.hlasitSmrt = 50;
    stdSmrt(s, st, 58, 2, flags(true, false)); // big dead, +8 ticks, but depth 2
    drain(s, 58);
    expect(spoken).toEqual([]);
  });

  it('the survivor comments 8 ticks after a partner dies (Depth 1 always speaks)', () => {
    const { s, spoken } = setup();
    const st = newDeathState();
    st.hlasitSmrt = 50; // both were alive until tick 50
    stdSmrt(s, st, 58, 1, flags(true, false)); // big died -> little speaks at +8
    drain(s, 58);
    expect(spoken.some((n) => n.startsWith('smrt-m-'))).toBe(true);
  });

  it('the big fish comments (smrt-v-*) when the little fish dies', () => {
    const { s, spoken } = setup();
    const st = newDeathState();
    st.hlasitSmrt = 50;
    stdSmrt(s, st, 58, 1, flags(false, true)); // little died -> big speaks
    drain(s, 58);
    expect(spoken.some((n) => n.startsWith('smrt-v-'))).toBe(true);
  });

  it('only fires exactly at hlasitSmrt + 8 (not earlier)', () => {
    const { s, spoken } = setup();
    const st = newDeathState();
    st.hlasitSmrt = 50;
    stdSmrt(s, st, 55, 1, flags(true, false)); // +5 ticks: too early
    drain(s, 55, 10);
    expect(spoken).toEqual([]);
  });

  it('adds a restart hint at shallow depth (hlrestart)', () => {
    const { s, spoken } = setup();
    const st = newDeathState();
    st.hlasitSmrt = 50;
    stdSmrt(s, st, 58, 1, flags(true, false)); // depth 1 -> hlrestart always true
    drain(s, 58);
    expect(spoken.some((n) => n === 'smrt-m-restart')).toBe(true);
  });
});
