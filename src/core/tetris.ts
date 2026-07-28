/**
 * The Tetris minigame (Ttr/Ttr.pas) — one of the nine units in `Fillets.dpr`'s
 * compile closure, launched by the `xtetris` cheat from a room (URoom.pas:24564)
 * or from the world map (UMain.pas:1764) as a modal window over the game.
 *
 * NOT to be confused with the TETRIS *room* (`src/rooms/tetris.ts`, room 65),
 * which is an ordinary dialogue room where the fish reminisce about falling
 * blocks. This is the actual playable game.
 *
 * This module is the rules; `src/render/tetrisRender.ts` draws the board. The
 * original's timer runs at 55ms (Ttr.dfm) and a piece drops every `rychlost`
 * ticks, so the fall speed starts at 11 ticks (~605ms per row) and works down to
 * 2 (~110ms) as rows are cleared.
 *
 * The seven shapes, their rotations and their tile positions in `all.bmp` come
 * from `all.txt` (parsed by `nacti`, Ttr.pas:89) — shipped with the game data.
 */

/** Board size and cell pitch (Ttr.pas:38-44). */
export const NX = 10;
export const NY = 20;
export const DK = 15;
/** How many hiscore rows the table keeps (maxhisc). */
export const MAX_HISC = 10;
/** The palette index `all.bmp`/`dira.bmp` use as transparent (transp = $64). */
export const TRANSP = 0x64;

/** One of the seven pieces (tdruhu, Ttr.pas:47). */
export interface Shape {
  /** The four cells' offsets, in the piece's own space. */
  xk: number[];
  yk: number[];
  /** Per-rotation origin nudge, indexed by smer 1..4. */
  dxs: number[];
  dys: number[];
  /** Whether the tile art is mirrored vertically when placed. */
  reverse: boolean;
  /** Tile-atlas positions of the colour variants (podoba 1..npodob). */
  xp: number[];
  yp: number[];
}

/** The parsed contents of `all.txt`. */
export interface TetrisShapes {
  /** Digit-strip position in the atlas, in tiles. */
  xfont: number;
  yfont: number;
  shapes: Shape[];
}

/** One board cell (pole, Ttr.pas:73). */
export interface TetrisCell {
  /** volno — true when the cell is empty. */
  volno: boolean;
  /** Atlas tile of the block sitting here. */
  xx: number;
  yy: number;
  /** The rotation (smer 1..4) it was placed at, which orients the tile art. */
  ss: number;
  /** Whether its art is vertically mirrored. */
  rev: boolean;
}

/** The falling piece (pada, Ttr.pas:63). */
export interface Falling {
  /** 0 = nothing falling; otherwise the 1-based shape number. */
  druh: number;
  /** 1-based colour variant. */
  podoba: number;
  x: number;
  y: number;
  /** Rotation, 1..4. */
  smer: number;
  body: number;
  /** True once the player has slammed it down. */
  rychle: boolean;
}

/**
 * `nacti` (Ttr.pas:89): read `all.txt`. The format is whitespace-separated
 * integers — xfont yfont, the shape count, then per shape four (xk,yk) pairs,
 * four (dxs,dys) pairs, npodob and a flag (-1 meaning the art is mirrored), and
 * finally npodob (xp,yp) atlas positions.
 */
export function parseShapes(text: string): TetrisShapes {
  const n = text.trim().split(/\s+/).map(Number);
  let p = 0;
  const next = (): number => n[p++] ?? 0;
  const xfont = next();
  const yfont = next();
  const ndruhu = next();
  const shapes: Shape[] = [];
  for (let d = 0; d < ndruhu; d++) {
    const xk: number[] = [];
    const yk: number[] = [];
    for (let i = 0; i < 4; i++) {
      xk.push(next());
      yk.push(next());
    }
    const dxs: number[] = [];
    const dys: number[] = [];
    for (let i = 0; i < 4; i++) {
      dxs.push(next());
      dys.push(next());
    }
    const npodob = next();
    const reverse = next() === -1;
    const xp: number[] = [];
    const yp: number[] = [];
    for (let i = 0; i < npodob; i++) {
      xp.push(next());
      yp.push(next());
    }
    shapes.push({ xk, yk, dxs, dys, reverse, xp, yp });
  }
  return { xfont, yfont, shapes };
}

/** Where the hiscore table is read from and written to (the original's ttr.pic). */
export interface HiscoreStore {
  load(): number[];
  save(scores: number[]): void;
}

/** The keys the game answers to (FormKeyDown, Ttr.pas:458). */
export type TetrisKey = 'left' | 'right' | 'rotate' | 'drop';

export class TetrisGame {
  /** pole — the board, indexed [x][y]. */
  readonly pole: TetrisCell[][] = [];
  readonly pada: Falling = { druh: 0, podoba: 1, x: 0, y: 0, smer: 1, body: 0, rychle: false };
  /** Ticks left before the piece drops a row (viset). */
  viset = 0;
  /** The full row waiting to be removed, or -1 (mizi). */
  mizi = -1;
  score = 0;
  /** Consecutive rows cleared without a new piece — the row-clear multiplier. */
  bonus = 0;
  /** Rows cleared since the last speed-up (zmizelo). */
  zmizelo = 0;
  /** Ticks per row: 11 (slowest) down to 2 (rychlost). */
  rychlost = 11;
  gameover = false;
  /** The hiscore row this game earned, or -1 (umisteni). It blinks in the table. */
  umisteni = -1;
  /** Blink counter for the earned hiscore row (blikani). */
  blikani = 0;
  hiscore: number[] = new Array<number>(MAX_HISC).fill(0);

  constructor(
    private readonly data: TetrisShapes,
    private readonly random: (n: number) => number,
    private readonly store?: HiscoreStore,
  ) {
    for (let x = 0; x < NX; x++) {
      const col: TetrisCell[] = [];
      for (let y = 0; y < NY; y++) col.push({ volno: true, xx: 0, yy: 0, ss: 1, rev: false });
      this.pole.push(col);
    }
  }

  private shape(): Shape {
    return this.data.shapes[this.pada.druh - 1]!;
  }

  /** The four board cells the piece currently covers, at its rotation. */
  private cells(): { x: number; y: number; k: number }[] {
    const s = this.shape();
    const { x, y, smer } = this.pada;
    const out: { x: number; y: number; k: number }[] = [];
    for (let i = 0; i < 4; i++) {
      let xi = x + s.dxs[smer - 1]!;
      let yi = y + s.dys[smer - 1]!;
      const kx = s.xk[i]!;
      const ky = s.yk[i]!;
      if (smer === 1) {
        xi += kx;
        yi += ky;
      } else if (smer === 2) {
        xi -= ky;
        yi += kx;
      } else if (smer === 3) {
        xi -= kx;
        yi -= ky;
      } else {
        xi += ky;
        yi -= kx;
      }
      out.push({ x: xi, y: yi, k: i });
    }
    return out;
  }

  /**
   * `zkus_polozit` (Ttr.pas:137): can the piece sit where it is? If so — or if
   * `drsne` forces it — stamp it into the board. `drsne` is used once, for the
   * very first placement of a new piece: it goes down even if it does not fit,
   * which is what ends the game.
   */
  zkusPolozit(drsne: boolean): boolean {
    const s = this.shape();
    const cs = this.cells();
    let muze = true;
    for (const c of cs) {
      muze =
        muze && c.x >= 0 && c.x < NX && c.y >= 0 && c.y < NY && this.pole[c.x]![c.y]!.volno;
    }
    if (muze || drsne) {
      for (const c of cs) {
        const cell = this.pole[c.x]?.[c.y];
        if (!cell) continue; // `drsne` can push a piece past the edge
        cell.volno = false;
        cell.xx = s.xp[this.pada.podoba - 1]! + s.xk[c.k]!;
        cell.yy = s.reverse
          ? s.yp[this.pada.podoba - 1]! + 1 - s.yk[c.k]!
          : s.yp[this.pada.podoba - 1]! + s.yk[c.k]!;
        cell.ss = this.pada.smer;
        cell.rev = s.reverse;
      }
    }
    return muze;
  }

  /** `odstran` (Ttr.pas:184): lift the piece back off the board before moving it. */
  odstran(): void {
    for (const c of this.cells()) {
      const cell = this.pole[c.x]?.[c.y];
      if (cell) cell.volno = true;
    }
  }

  /** `cela_rada` (Ttr.pas:325): the topmost full row, or -1. */
  celaRada(): number {
    for (let y = 0; y < NY; y++) {
      let p = 0;
      for (let x = 0; x < NX; x++) if (!this.pole[x]![y]!.volno) p++;
      if (p === NX) return y;
    }
    return -1;
  }

  /**
   * `zpracuj_hiscore` (Ttr.pas:339): slot this game's score into the table and
   * persist it. The original guards its ttr.pic file with a checksum and wipes
   * the table if it fails; a browser store has nothing to defend against, so the
   * port just keeps the ten numbers.
   */
  zpracujHiscore(): void {
    this.hiscore = normaliseHiscore(this.store?.load());
    this.umisteni = -1;
    if (this.score > this.hiscore[MAX_HISC - 1]!) {
      let u = 1;
      while (this.score <= this.hiscore[u - 1]!) u++;
      for (let i = MAX_HISC; i >= u + 1; i--) this.hiscore[i - 1] = this.hiscore[i - 2]!;
      this.hiscore[u - 1] = this.score;
      this.umisteni = u;
      this.store?.save([...this.hiscore]);
      this.blikani = 0;
    }
  }

  /**
   * `TimerTimer` (Ttr.pas:383): one 55ms tick — clear a pending row, spawn the
   * next piece, or drop the current one by a cell.
   */
  tick(): void {
    if (this.gameover) return;
    if (this.pada.druh === 0) {
      if (this.mizi >= 0) {
        // The blanked row collapses and everything above it slides down.
        for (let x = 0; x < NX; x++) {
          for (let y = this.mizi; y >= 1; y--) {
            this.pole[x]![y] = { ...this.pole[x]![y - 1]! };
          }
          this.pole[x]![0]!.volno = true;
        }
        this.mizi = -1;
        this.bonus++;
        this.score += this.bonus * 50; // consecutive rows are worth more
        this.zmizelo++;
        if (this.rychlost > 2 && this.zmizelo === 10) {
          this.zmizelo = 0;
          this.rychlost--;
        }
        return;
      }
      this.mizi = this.celaRada();
      if (this.mizi === -1) {
        this.pada.x = Math.floor(NX / 2) - 2;
        this.pada.y = 0;
        this.pada.smer = this.random(4) + 1;
        this.pada.druh = this.random(7) + 1;
        this.pada.podoba = this.random(this.shape().xp.length) + 1;
        this.pada.rychle = false;
        this.pada.body = 0;
        this.bonus = 0;
        this.viset = this.rychlost;
        if (!this.zkusPolozit(true)) {
          this.gameover = true;
          this.zpracujHiscore();
          this.pada.druh = 0;
        }
      } else {
        for (let x = 0; x < NX; x++) this.pole[x]![this.mizi]!.volno = true;
      }
      return;
    }
    if (!this.pada.rychle && this.viset > 1) {
      this.viset--;
      return;
    }
    this.viset = this.rychlost;
    this.odstran();
    this.pada.y++;
    if (!this.zkusPolozit(false)) {
      this.pada.y--;
      this.zkusPolozit(false); // put it back where it landed
      this.pada.druh = 0; // and let go of it
      this.score += 10;
    } else if (this.pada.rychle) {
      this.score += 2;
    } else {
      this.score += 1;
    }
  }

  /** `FormKeyDown` (Ttr.pas:458). Note that Down ROTATES — it is not a soft drop. */
  key(k: TetrisKey): void {
    if (this.pada.druh <= 0) return;
    if (k === 'drop') {
      this.pada.rychle = true;
      return;
    }
    this.odstran();
    if (k === 'left') {
      this.pada.x--;
      if (!this.zkusPolozit(false)) {
        this.pada.x++;
        this.zkusPolozit(false);
      }
    } else if (k === 'right') {
      this.pada.x++;
      if (!this.zkusPolozit(false)) {
        this.pada.x--;
        this.zkusPolozit(false);
      }
    } else {
      this.pada.smer = this.pada.smer === 1 ? 4 : this.pada.smer - 1;
      if (!this.zkusPolozit(false)) {
        this.pada.smer = this.pada.smer === 4 ? 1 : this.pada.smer + 1;
        this.zkusPolozit(false);
      }
    }
  }
}

/** Coerce a stored table to exactly MAX_HISC finite, non-negative numbers. */
function normaliseHiscore(raw: number[] | undefined): number[] {
  const out = new Array<number>(MAX_HISC).fill(0);
  if (!raw) return out;
  for (let i = 0; i < MAX_HISC; i++) {
    const v = raw[i];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[i] = Math.floor(v);
  }
  return out;
}
