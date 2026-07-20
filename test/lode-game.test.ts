/**
 * LODE Battleship engine invariants. The engine is a faithful port of the Delphi
 * initLode/hrajlode, so we verify the structural guarantees the original relies on:
 * every grid gets all 7 ships (correct cell counts) with a ≥1-cell gap between
 * different ships, and a full game of AI moves terminates having sunk every ship,
 * only ever returning the documented result codes. A seeded RNG keeps it deterministic.
 */
import { describe, it, expect } from 'vitest';
import { LodeGame, LODE, type Rnd } from '../src/rooms/lode-game.js';

/** mulberry32 → a deterministic Pascal-style random(n) = 0..n-1. */
function seeded(seed: number): Rnd {
  let a = seed >>> 0;
  return (n: number): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return n <= 0 ? 0 : Math.floor(r * n);
  };
}

const NKOSTEK = [0, 4, 4, 4, 6, 6, 5, 7]; // matches lode-game.ts

describe('LODE battleship — initLode placement', () => {
  it('places all 7 ships on both grids with correct cell counts and gaps (50 seeds)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = new LodeGame(seeded(seed));
      g.initLode(); // must terminate

      for (let h = 1; h <= 2; h++) {
        const counts = new Array<number>(8).fill(0);
        for (let x = 1; x <= 10; x++) {
          for (let y = 1; y <= 10; y++) {
            const k = g.ships(h, x, y);
            expect(k).toBeGreaterThanOrEqual(0);
            expect(k).toBeLessThanOrEqual(7);
            if (k > 0) counts[k]!++;
          }
        }
        // Every ship 1..7 present with exactly its cell count.
        for (let k = 1; k <= 7; k++) {
          expect(counts[k], `seed ${seed} grid ${h} ship ${k}`).toBe(NKOSTEK[k]);
        }
        // No two DIFFERENT ships are 4-adjacent (≥1 water cell between hulls).
        for (let x = 1; x <= 10; x++) {
          for (let y = 1; y <= 10; y++) {
            const k = g.ships(h, x, y);
            if (k === 0) continue;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 1 || nx > 10 || ny < 1 || ny > 10) continue;
              const nk = g.ships(h, nx, ny);
              expect(nk === 0 || nk === k, `seed ${seed} grid ${h} adj ${x},${y}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('LODE battleship — hrajlode game play', () => {
  it('player 1 sinks all of player 2\'s ships in a bounded number of valid moves', () => {
    const valid = new Set<number>(Object.values(LODE));
    for (let seed = 1; seed <= 20; seed++) {
      const g = new LodeGame(seeded(seed * 97 + 3));
      g.initLode();
      let sinks = 0;
      let moves = 0;
      while (sinks < 7 && moves < 400) {
        const { result, sx, sy } = g.hrajlode(1);
        moves++;
        expect(valid.has(result), `seed ${seed}: result ${result}`).toBe(true);
        expect(sx >= 1 && sx <= 10 && sy >= 1 && sy <= 10, `seed ${seed}: cell ${sx},${sy}`).toBe(true);
        // Player 1 never cheats (codes 5/6/7 are player-2 only).
        expect(result === LODE.PODVOD_POTOPENA || result === LODE.ZASAH_PODVOD || result === LODE.POTOPENA_PODVOD).toBe(false);
        if (result === LODE.POTOPENA) sinks++;
      }
      expect(sinks, `seed ${seed}: sank ${sinks}/7 in ${moves} moves`).toBe(7);
    }
  });

  it('player 2 makes only valid moves (may cheat) and sinks everything', () => {
    const valid = new Set<number>(Object.values(LODE));
    for (let seed = 1; seed <= 20; seed++) {
      const g = new LodeGame(seeded(seed * 131 + 7));
      g.initLode();
      let sinks = 0;
      let moves = 0;
      while (sinks < 7 && moves < 500) {
        const { result } = g.hrajlode(2);
        moves++;
        expect(valid.has(result)).toBe(true);
        if (result === LODE.POTOPENA || result === LODE.PODVOD_POTOPENA || result === LODE.POTOPENA_PODVOD) sinks++;
      }
      expect(sinks, `seed ${seed}: sank ${sinks}/7`).toBe(7);
    }
  });
});

describe('LODE battleship — a real, unique, two-player game', () => {
  it('produces a distinct board essentially every game (uniqueness)', () => {
    const N = 120;
    const boards = new Set<string>();
    for (let seed = 1; seed <= N; seed++) {
      const g = new LodeGame(seeded(seed * 7919 + 13));
      g.initLode();
      let fp = '';
      for (let x = 1; x <= 10; x++) for (let y = 1; y <= 10; y++) fp += g.ships(1, x, y);
      boards.add(fp);
    }
    // Random 7-ship placements: essentially all distinct (allow a tiny collision margin).
    expect(boards.size).toBeGreaterThanOrEqual(N - 1);
  });

  it('plays a full alternating match to a real winner (mirrors the room turn logic)', () => {
    // The room: buh1 starts (hraje=1). A god keeps shooting on a hit and passes the
    // turn on a miss; each god's `lodi` counts the OPPONENT ships it still must sink,
    // starting at 7. First to lodi=0 wins. (URoom.pas LODE stavhry / hraje / lodi.)
    for (let seed = 1; seed <= 25; seed++) {
      const g = new LodeGame(seeded(seed * 5407 + 1));
      g.initLode();
      const lodi = { 1: 7, 2: 7 };
      let hraje = 1;
      let turns = 0;
      let winner = 0;
      while (winner === 0 && turns < 600) {
        turns++;
        const h = hraje;
        const { result } = g.hrajlode(h);
        // Turn passes only on a "clean" miss (VODA / buh1's UZ_VODA); hits/cheats keep it.
        if (result === LODE.VODA || (h === 1 && result === LODE.UZ_VODA)) hraje = 3 - h;
        if (
          result === LODE.POTOPENA ||
          result === LODE.PODVOD_POTOPENA ||
          result === LODE.POTOPENA_PODVOD
        ) {
          lodi[h as 1 | 2]--;
          if (lodi[h as 1 | 2] === 0) winner = h;
        }
      }
      expect(winner === 1 || winner === 2, `seed ${seed}: winner=${winner} after ${turns} turns`).toBe(true);
      // The winner sank all 7 of the loser's ships; the loser did not finish.
      expect(lodi[winner as 1 | 2]).toBe(0);
      expect(lodi[(3 - winner) as 1 | 2]).toBeGreaterThan(0);
    }
  });
});
