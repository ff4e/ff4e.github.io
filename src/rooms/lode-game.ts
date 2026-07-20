/**
 * LODE Battleship engine — a faithful port of `initLode` (URoom.pas:2476-2557) and
 * `hrajlode` (URoom.pas:2558-2741), plus the ship-shape tables (URoom.pas:1613-1625).
 *
 * Two 10×10 grids (one per god). `planek[h][1]` holds ship placement (ship-type 1..7
 * per occupied cell, 0 = water); `planek[h][2]` holds the shots fired at grid h
 * (0 = unshot, 1 = miss, 2 = can't-be, 3 = hit, 4 = sunk, 6 = "cheat" hit). Indices
 * are 1-based to mirror the Pascal exactly (arrays are oversized by one; index 0 is
 * unused). Randomness is injected so the room can seed it and tests are deterministic.
 */

const MAXLODEX = 10;
const MAXLODEY = 10;
const NLODI = 7;

/** nkostek (URoom.pas:1616): cell count per ship 1..7 (index 0 unused). */
const NKOSTEK: readonly number[] = [0, 4, 4, 4, 6, 6, 5, 7];

/**
 * tvary (URoom.pas:1617-1624): the (dx,dy) cells of each ship 1..7 (index 0 unused;
 * cells 1..nkostek). Only the first `NKOSTEK[ship]` cells of each row are meaningful.
 */
const TVARY: readonly (readonly (readonly [number, number])[])[] = [
  [], // 0 unused
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [0, 0], [0, 0], [0, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [0, 0], [0, 0], [0, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [0, 0], [0, 0], [0, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [3, 1], [0, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2], [3, 1], [0, 0]],
  [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [0, 0], [0, 0]],
  [[0, 0], [1, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
];

/** hrajlode result codes (URoom.pas:2559-2561). */
export const LODE = {
  VODA: 1, // miss
  NEMUZE: 2, // can't be (already excluded)
  ZASAH: 3, // hit
  POTOPENA: 4, // sunk
  PODVOD_POTOPENA: 5, // cheat: claims sunk
  ZASAH_PODVOD: 6, // cheat: claims a hit is elsewhere
  POTOPENA_PODVOD: 7, // cheat: sunk
  UZ_VODA: 8, // "you already said that" + miss
  UZ_ZASAH: 9, // "you already said that" + hit
} as const;

export type Rnd = (n: number) => number;
const defaultRnd: Rnd = (n) => (n <= 0 ? 0 : Math.floor(Math.random() * n));

export class LodeGame {
  /** planek[h][s][x][y]: h,s in 1..2; x,y in 1..10. Oversized by one (0 unused). */
  private planek: number[][][][] = LodeGame.zeros();
  /** posltrefena (URoom.pas:2557): last-hit ship "kind" (feeds ShodLod). */
  posltrefena = -1;

  constructor(private readonly rnd: Rnd = defaultRnd) {}

  private static zeros(): number[][][][] {
    const mk = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
    return mk(3, () => mk(3, () => mk(MAXLODEX + 1, () => mk(MAXLODEY + 1, () => 0))));
  }

  /** Read/write helpers for the 1-based grid. */
  ships(h: number, x: number, y: number): number {
    return this.planek[h]![1]![x]![y]!;
  }
  shots(h: number, x: number, y: number): number {
    return this.planek[h]![2]![x]![y]!;
  }

  /**
   * umistilod (nested in initLode): place/test ship `cislo` at (x,y) rotated by `sm`.
   * With `zkouset` only tests legality (in-bounds + no adjacent ship); else stamps it.
   */
  private umistilod(h: number, x: number, y: number, sm: number, cislo: number, zkouset: boolean): boolean {
    const P = this.planek[h]![1]!;
    let vysl = true;
    for (let i = 1; i <= NKOSTEK[cislo]!; i++) {
      const pi = TVARY[cislo]![i]![0];
      const pj = TVARY[cislo]![i]![1];
      let px: number;
      let py: number;
      switch (sm) {
        case 0:
          px = x + pi;
          py = y + pj;
          break;
        case 1:
          px = x - pj;
          py = y + pi;
          break;
        case 2:
          px = x - pi;
          py = y - pj;
          break;
        default:
          px = x + pj;
          py = y - pi;
          break;
      }
      if (zkouset) {
        if (px > 0 && px <= MAXLODEX && py > 0 && py <= MAXLODEY) {
          vysl =
            vysl &&
            P[px]![py]! === 0 &&
            (px === 1 || P[px - 1]![py]! === 0) &&
            (px === MAXLODEX || P[px + 1]![py]! === 0) &&
            (py === 1 || P[px]![py - 1]! === 0) &&
            (py === MAXLODEY || P[px]![py + 1]! === 0);
        } else {
          vysl = false;
        }
      } else {
        P[px]![py] = cislo;
      }
    }
    return vysl;
  }

  /** initLode (URoom.pas:2476-2557): randomly place all 7 ships on both grids. */
  initLode(): void {
    this.planek = LodeGame.zeros();
    for (let h = 1; h <= 2; h++) {
      let pocet = 0;
      do {
        // Clear this grid and retry if a ship can't be placed.
        for (let i = 1; i <= MAXLODEX; i++) {
          for (let j = 1; j <= MAXLODEY; j++) {
            this.planek[h]![1]![i]![j] = 0;
            this.planek[h]![2]![i]![j] = 0;
          }
        }
        let n = 8;
        do {
          n--;
          pocet = 0;
          const pom: [number, number, number][] = [];
          for (let i = 1; i <= MAXLODEX; i++) {
            for (let j = 1; j <= MAXLODEY; j++) {
              for (let sm = 0; sm <= 3; sm++) {
                if (this.umistilod(h, i, j, sm, n, true)) {
                  pocet++;
                  pom.push([i, j, sm]);
                }
              }
            }
          }
          if (pocet > 0) {
            const p = this.rnd(pocet); // 0..pocet-1 (Pascal random(pocet)+1, 1-based)
            const [pi, pj, psm] = pom[p]!;
            this.umistilod(h, pi, pj, psm, n, false);
          }
        } while (!(pocet === 0 || n === 1));
      } while (pocet === 0);
    }
  }

  /**
   * hrajlode (URoom.pas:2558-2741): compute a move for god `h` (1 or 2). Returns the
   * result code and the shot cell (sx,sy). Mutates planek[h][2] with the shot, and
   * on a sink marks the surrounding water as "can't be". Player 2 may "cheat" (codes
   * 5/6/7). Also sets `posltrefena` from the hit ship's kind.
   */
  hrajlode(h: number): { result: number; sx: number; sy: number } {
    let nacata = false;
    for (let i = 1; i <= MAXLODEX; i++)
      for (let j = 1; j <= MAXLODEY; j++) if (this.shots(h, i, j) === 3) nacata = true;

    let cinnost = 0;
    if (h === 1) {
      if (nacata) {
        const r = this.rnd(100);
        if (r <= 49) cinnost = 1;
        else if (r <= 69) cinnost = 2;
        else cinnost = 3;
      } else {
        cinnost = this.rnd(100) <= 69 ? 2 : 3;
      }
    } else {
      if (nacata) cinnost = this.rnd(100) <= 89 ? 1 : 2;
      else cinnost = 2;
    }

    let pocet = 0;
    let sx = -1;
    let sy = -1;
    const pom: [number, number][] = [];
    const push = (i: number, j: number) => {
      pocet++;
      pom.push([i, j]);
    };

    if (cinnost === 1) {
      for (let i = 1; i <= MAXLODEX; i++)
        for (let j = 1; j <= MAXLODEY; j++)
          if (this.shots(h, i, j) === 0)
            if (
              (i > 1 && this.shots(h, i - 1, j) === 3) ||
              (i < MAXLODEX && this.shots(h, i + 1, j) === 3) ||
              (j > 1 && this.shots(h, i, j - 1) === 3) ||
              (j < MAXLODEY && this.shots(h, i, j + 1) === 3)
            )
              push(i, j);
      if (pocet === 0)
        for (let i = 1; i <= MAXLODEX; i++)
          for (let j = 1; j <= MAXLODEY; j++) if (this.shots(h, i, j) === 6) push(i, j);
      if (pocet > 0) {
        const p = this.rnd(pocet);
        sx = pom[p]![0];
        sy = pom[p]![1];
      }
    } else if (cinnost === 2) {
      if (h === 2 && this.rnd(100) < 75)
        for (let i = 2; i <= MAXLODEX - 1; i++)
          for (let j = 2; j <= MAXLODEY - 1; j++) if (this.shots(h, i, j) === 0) push(i, j);
      if (pocet === 0)
        for (let i = 1; i <= MAXLODEX; i++)
          for (let j = 1; j <= MAXLODEY; j++) if (this.shots(h, i, j) === 0) push(i, j);
      if (pocet > 0) {
        const p = this.rnd(pocet);
        sx = pom[p]![0];
        sy = pom[p]![1];
      }
    }
    if (sx === -1) {
      sx = this.rnd(MAXLODEX) + 1;
      sy = this.rnd(MAXLODEY) + 1;
    }

    const lod = this.ships(3 - h, sx, sy);
    if (lod >= 1 && lod <= 3) this.posltrefena = 3 + this.rnd(2);
    else if (lod >= 4 && lod <= 5) this.posltrefena = 0;
    else if (lod === 6) this.posltrefena = 1;
    else if (lod === 7) this.posltrefena = 2;
    else this.posltrefena = -1;

    let vysl: number;
    const shot = this.shots(h, sx, sy);
    if (shot !== 0 && shot !== 2 && h === 1) {
      vysl = lod === 0 ? LODE.UZ_VODA : LODE.UZ_ZASAH;
    } else if (lod === 0) {
      vysl = LODE.VODA;
      this.planek[h]![2]![sx]![sy] = 1;
    } else {
      // A hit — is the ship fully sunk?
      let potopena = true;
      for (let i = 1; i <= MAXLODEX; i++)
        for (let j = 1; j <= MAXLODEY; j++)
          if (i !== sx || j !== sy)
            if (this.ships(3 - h, i, j) === lod && this.shots(h, i, j) !== 3) potopena = false;
      vysl = potopena ? LODE.POTOPENA : LODE.ZASAH;
      if (this.shots(h, sx, sy) === 6) {
        this.planek[h]![2]![sx]![sy] = vysl;
        vysl = vysl + 3; // cheat variants 5/6/7
      } else {
        this.planek[h]![2]![sx]![sy] = vysl;
      }
      if (vysl === LODE.POTOPENA && h === 2) {
        // player 2, sinking: if it's the last plausible spot, escalate to "cheat sunk".
        let cnt = 0;
        for (let i = 1; i <= MAXLODEX; i++)
          for (let j = 1; j <= MAXLODEY; j++)
            if (i !== sx && j !== sy && this.ships(3 - h, i, j) === lod)
              if (
                (i > 1 && (this.shots(h, i - 1, j) === 0 || this.shots(h, i - 1, j) === 6)) ||
                (i < MAXLODEX && (this.shots(h, i + 1, j) === 0 || this.shots(h, i + 1, j) === 6)) ||
                (j > 1 && (this.shots(h, i, j - 1) === 0 || this.shots(h, i, j - 1) === 6)) ||
                (j < MAXLODEY && (this.shots(h, i, j + 1) === 0 || this.shots(h, i, j + 1) === 6))
              )
                cnt++;
        if (cnt === 0) vysl = LODE.PODVOD_POTOPENA;
      }
      if (vysl === LODE.ZASAH && h === 2) {
        // player 2, mid-ship hit: small chance to lie and call it water (mark 6).
        let cnt = 0;
        for (let i = 1; i <= MAXLODEX; i++)
          for (let j = 1; j <= MAXLODEY; j++)
            if (i !== sx && j !== sy && this.ships(3 - h, i, j) === lod)
              if (this.shots(h, i, j) === 3) cnt++;
        if (cnt > 0 && this.rnd(100) < 10) {
          vysl = LODE.VODA;
          this.planek[h]![2]![sx]![sy] = 6;
        }
      }
      if (this.shots(h, sx, sy) === 4) {
        // Sunk: reveal the whole ship and ring it with "can't be" water.
        for (let i = 1; i <= MAXLODEX; i++)
          for (let j = 1; j <= MAXLODEY; j++)
            if (this.ships(3 - h, i, j) === lod) {
              this.planek[h]![2]![i]![j] = 4;
              if (i > 1 && this.shots(h, i - 1, j) === 0) this.planek[h]![2]![i - 1]![j] = 2;
              if (i < MAXLODEX && this.shots(h, i + 1, j) === 0) this.planek[h]![2]![i + 1]![j] = 2;
              if (j > 1 && this.shots(h, i, j - 1) === 0) this.planek[h]![2]![i]![j - 1] = 2;
              if (j < MAXLODEY && this.shots(h, i, j - 1) === 0) this.planek[h]![2]![i]![j + 1] = 2;
            }
      }
    }
    return { result: vysl, sx, sy };
  }
}
