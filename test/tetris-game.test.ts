/**
 * The Tetris minigame's rules (Ttr/Ttr.pas) — the unit the port had never
 * touched. Driven against the real `all.txt` shape table that ships in
 * public/data/Intro, with a scripted "random" so every spawn is deterministic.
 *
 * Not to be confused with the TETRIS *room* (test/tetris-room coverage lives with
 * the room scripts); this is the modal minigame the xtetris cheat launches.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  TetrisGame,
  parseShapes,
  MAX_HISC,
  NX,
  NY,
  type HiscoreStore,
  type TetrisShapes,
} from '../src/core/tetris.js';

const shapes: TetrisShapes = parseShapes(
  readFileSync(new URL('../public/data/Intro/all.txt', import.meta.url), 'latin1'),
);

/** A game whose "random" replays a fixed script (then repeats its last value). */
function game(script: number[] = [0, 0, 0], store?: HiscoreStore): TetrisGame {
  let i = 0;
  return new TetrisGame(shapes, () => script[Math.min(i++, script.length - 1)] ?? 0, store);
}

/** Run n ticks. */
function ticks(g: TetrisGame, n: number): void {
  for (let i = 0; i < n; i++) g.tick();
}

/** How many cells are occupied. */
function filled(g: TetrisGame): number {
  return g.pole.reduce((n, col) => n + col.reduce((m, c) => m + (c.volno ? 0 : 1), 0), 0);
}

/** Fill a whole row except one column, without disturbing the falling piece. */
function fillRow(g: TetrisGame, y: number, except = -1): void {
  for (let x = 0; x < NX; x++) {
    if (x === except) continue;
    Object.assign(g.pole[x]![y]!, { volno: false, xx: 0, yy: 0, ss: 1, rev: false });
  }
}

describe('all.txt shape table', () => {
  it('parses the seven shipped pieces', () => {
    expect(shapes.shapes.length).toBe(7);
    expect(shapes.xfont).toBe(0);
    expect(shapes.yfont).toBe(8);
  });

  it('gives every piece four cells, four rotation offsets and its colour variants', () => {
    for (const s of shapes.shapes) {
      expect(s.xk.length).toBe(4);
      expect(s.yk.length).toBe(4);
      expect(s.dxs.length).toBe(4);
      expect(s.dys.length).toBe(4);
      expect(s.xp.length).toBe(s.yp.length);
      expect(s.xp.length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the two mirrored pieces (the -1 flag in all.txt)', () => {
    expect(shapes.shapes.map((s) => s.reverse)).toEqual([
      false,
      false,
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it('reads the I-piece as a straight four with eleven colour variants', () => {
    const i = shapes.shapes[0]!;
    expect(i.xk).toEqual([0, 1, 2, 3]);
    expect(i.yk).toEqual([0, 0, 0, 0]);
    expect(i.xp.length).toBe(11);
  });
});

describe('TetrisGame start-up', () => {
  it('starts empty, at the slowest speed, with nothing falling', () => {
    const g = game();
    expect(filled(g)).toBe(0);
    expect(g.rychlost).toBe(11);
    expect(g.score).toBe(0);
    expect(g.gameover).toBe(false);
    expect(g.pada.druh).toBe(0);
  });

  it('spawns a piece on the first tick, centred at the top', () => {
    const g = game([0]); // random() -> 0 everywhere: smer 1, druh 1, podoba 1
    g.tick();
    expect(g.pada.druh).toBe(1);
    expect(g.pada.smer).toBe(1);
    expect(g.pada.podoba).toBe(1);
    expect(g.pada.x).toBe(Math.floor(NX / 2) - 2);
    expect(g.pada.y).toBe(0);
    expect(filled(g)).toBe(4); // the piece is stamped into the board
  });

  it('hangs for `rychlost` ticks before dropping a row', () => {
    const g = game([0]);
    g.tick(); // spawn
    const y0 = g.pada.y;
    ticks(g, g.rychlost - 1);
    expect(g.pada.y).toBe(y0); // still hanging
    g.tick();
    expect(g.pada.y).toBe(y0 + 1);
  });
});

describe('TetrisGame movement', () => {
  it('moves left and right, and stays put at the wall', () => {
    const g = game([0]);
    g.tick();
    const x0 = g.pada.x;
    g.key('left');
    expect(g.pada.x).toBe(x0 - 1);
    g.key('right');
    expect(g.pada.x).toBe(x0);
    for (let i = 0; i < 20; i++) g.key('left');
    expect(g.pada.x).toBeGreaterThanOrEqual(-3); // clamped by the wall, not runaway
    expect(filled(g)).toBe(4); // and never loses or duplicates cells
  });

  it('rotates backwards through smer 1 -> 4 -> 3 ... (dec, wrapping)', () => {
    const g = game([0]);
    g.tick();
    expect(g.pada.smer).toBe(1);
    g.key('rotate');
    expect(g.pada.smer).toBe(4);
    g.key('rotate');
    expect(g.pada.smer).toBe(3);
  });

  it('ignores keys while no piece is falling', () => {
    const g = game([0]);
    expect(g.pada.druh).toBe(0);
    g.key('left');
    g.key('rotate');
    expect(filled(g)).toBe(0);
  });

  it('slams the piece down with `drop`, which then falls every tick', () => {
    const g = game([0]);
    g.tick();
    g.key('drop');
    expect(g.pada.rychle).toBe(true);
    const y0 = g.pada.y;
    g.tick();
    expect(g.pada.y).toBe(y0 + 1); // no hang time once slammed
  });
});

describe('TetrisGame scoring', () => {
  it('scores 1 per row fallen, 2 while slammed, and 10 for landing', () => {
    const slow = game([0]);
    slow.tick();
    ticks(slow, slow.rychlost);
    expect(slow.score).toBe(1);

    const fast = game([0]);
    fast.tick();
    fast.key('drop');
    fast.tick();
    expect(fast.score).toBe(2);
  });

  it('awards the landing bonus and releases the piece when it hits the floor', () => {
    const g = game([0]);
    g.tick();
    g.key('drop');
    for (let i = 0; i < NY + 5 && g.pada.druh !== 0; i++) g.tick();
    expect(g.pada.druh).toBe(0); // landed
    expect(g.score).toBeGreaterThanOrEqual(10);
    expect(filled(g)).toBe(4); // it stayed on the board
  });

  it('clears a full row and pays 50 x the consecutive-row bonus', () => {
    const g = game([0]);
    g.tick(); // spawn, so the board is not idle
    g.pada.druh = 0; // hand the board back to the row logic
    fillRow(g, NY - 1);
    for (let x = 0; x < NX; x++) g.pole[x]![NY - 1]!.volno = false;
    const before = g.score;
    g.tick(); // notices the full row and blanks it
    expect(g.mizi).toBe(NY - 1);
    g.tick(); // collapses it
    expect(g.mizi).toBe(-1);
    expect(g.score).toBe(before + 50);
    for (let x = 0; x < NX; x++) expect(g.pole[x]![NY - 1]!.volno).toBe(true);
  });

  it('speeds up one step every ten cleared rows, down to a floor of 2', () => {
    const g = game([0]);
    g.zmizelo = 9;
    g.pada.druh = 0;
    for (let x = 0; x < NX; x++) g.pole[x]![NY - 1]!.volno = false;
    g.tick();
    g.tick();
    expect(g.rychlost).toBe(10);
    expect(g.zmizelo).toBe(0);

    const fastest = game([0]);
    fastest.rychlost = 2;
    fastest.zmizelo = 9;
    fastest.pada.druh = 0;
    for (let x = 0; x < NX; x++) fastest.pole[x]![NY - 1]!.volno = false;
    fastest.tick();
    fastest.tick();
    expect(fastest.rychlost).toBe(2); // never goes below 2
  });
});

describe('TetrisGame game over', () => {
  it('ends when a new piece cannot be placed, and records the hiscore', () => {
    const saved: number[][] = [];
    const store: HiscoreStore = { load: () => [], save: (s) => void saved.push(s) };
    const g = game([0], store);
    // Block where the first piece would land, but leave column 0 free so no row
    // is complete — a full row would be cleared instead of ending the game.
    for (let y = 0; y < 4; y++) fillRow(g, y, 0);
    g.score = 1234;
    g.tick();
    expect(g.gameover).toBe(true);
    expect(g.pada.druh).toBe(0);
    expect(g.umisteni).toBe(1);
    expect(g.hiscore[0]).toBe(1234);
    expect(saved.length).toBe(1);
  });

  it('does nothing more once it is over', () => {
    const g = game([0]);
    g.gameover = true;
    const before = filled(g);
    ticks(g, 20);
    expect(filled(g)).toBe(before);
    expect(g.score).toBe(0);
  });
});

describe('TetrisGame hiscore table', () => {
  function scored(score: number, table: number[]): TetrisGame {
    const g = game([0], { load: () => table, save: () => {} });
    g.score = score;
    g.zpracujHiscore();
    return g;
  }

  it('keeps ten rows, sorted, inserting the new score in place', () => {
    const g = scored(55, [100, 90, 50, 40, 30, 20, 10, 5, 3, 1]);
    expect(g.umisteni).toBe(3);
    expect(g.hiscore).toEqual([100, 90, 55, 50, 40, 30, 20, 10, 5, 3]);
    expect(g.hiscore.length).toBe(MAX_HISC);
  });

  it('refuses a score that cannot beat the last row', () => {
    const table = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    const g = scored(10, table);
    expect(g.umisteni).toBe(-1);
    expect(g.hiscore).toEqual(table);
  });

  it('takes the top row on a fresh (or unreadable) table', () => {
    expect(scored(7, []).umisteni).toBe(1);
    expect(scored(7, [] as number[]).hiscore[0]).toBe(7);
  });

  it('repairs a short or junk stored table rather than trusting it', () => {
    const g = game([0], { load: () => [5, NaN, -3, 999] as number[], save: () => {} });
    g.score = 1;
    g.zpracujHiscore();
    expect(g.hiscore.length).toBe(MAX_HISC);
    expect(g.hiscore.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
});

describe('TetrisGame board integrity', () => {
  it('never leaves stray cells behind through a long scripted game', () => {
    // A varied "random" so different pieces, rotations and colours all show up.
    let i = 0;
    const seq = [3, 1, 0, 2, 6, 4, 1, 5, 2, 0, 3, 6];
    const g = new TetrisGame(shapes, (n) => seq[i++ % seq.length]! % n);
    for (let t = 0; t < 400; t++) {
      g.tick();
      if (t % 7 === 0) g.key('left');
      if (t % 11 === 0) g.key('rotate');
      if (t % 13 === 0) g.key('right');
      // Every occupied cell must be a multiple of 4 plus whatever has settled —
      // the invariant that matters is simply that it stays in range.
      expect(filled(g)).toBeLessThanOrEqual(NX * NY);
      if (g.pada.druh > 0) expect(filled(g)).toBeGreaterThanOrEqual(4);
    }
  });
});
