/**
 * PrgPldici — the "pldik" blob-reproduction cellular automaton (URoom.pas:2150-2437).
 *
 * A colony of gelatinous blobs lives on a small hidden grid (`klec`, dxklec×dyklec).
 * Each blob (`pldik[i]`) has a state machine (cinnost): idle → fall / divide (spawns a
 * child) / shove / hop-down / hop-up, animating a run of frames per transition and
 * writing to a strip of items (`fazeplda` maps a grid cell to one item's afaze). Used
 * only by BANKA (room 57). Ported faithfully from TRoom.InitPldici / TRoom.PrgPldici.
 *
 * Save/restore of the live colony (the original's uloz_speciality writes klec+pldik) is
 * deferred: on load the colony re-initialises, like the LODE battleship grid.
 */
import type { Script } from './script.js';

const NPLDIKU = 27;
const DXKLEC = 5;
const DYKLEC = 6;
// klec cell codes
const PLDNIC = 0;
const PLDJDU = 1;
const PLDJSEM = 2;
const PLDODCH = 3;
const PLDZUST = 4;
const PLDZED = 5;

interface Pldik {
  xs: number;
  ys: number;
  cinnost: number;
  faze: number;
  smer: number;
  delit: number;
  otec: number;
}

export class PldiciState {
  private klec: number[][] = [];
  private pldik: Pldik[] = [];
  private pocet = 0;

  constructor(
    private readonly s: Script,
    private readonly cislo: number,
  ) {
    for (let i = 0; i < NPLDIKU; i++)
      this.pldik.push({ xs: 0, ys: 0, cinnost: 0, faze: 0, smer: 0, delit: 0, otec: 0 });
    this.init();
  }

  /** InitPldici (URoom.pas:2150). */
  private init(): void {
    const s = this.s;
    for (let i = 0; i < NPLDIKU; i++) s.item(this.cislo + i).afaze = 36;
    for (let x = 0; x <= DXKLEC + 1; x++) {
      this.klec[x] = [];
      for (let y = 0; y <= DYKLEC + 1; y++) {
        if (x === 0 || x > DXKLEC || y === 0 || y > DYKLEC || (x === 3 && y >= 4))
          this.klec[x]![y] = PLDZED;
        else this.klec[x]![y] = PLDNIC;
      }
    }
    s.item(this.cislo + 12).afaze = 0;
    this.pocet = 1;
    const p = this.pldik[0]!;
    p.xs = 3;
    p.ys = 1;
    p.cinnost = 0;
    p.faze = 0;
    p.delit = s.random(200) + 200;
  }

  /** fazeplda (URoom.pas:2179): map grid cell (x,y) to its item and set its frame. */
  private fazeplda(x: number, y: number, anim: number): void {
    let p = (x - 1) * DYKLEC + y;
    if (p > 15) p -= 3;
    this.s.item(p + this.cislo - 1).afaze = anim;
  }

  /** PrgPldici (URoom.pas:2175): advance the whole colony one tick. */
  step(): void {
    const s = this.s;
    const klec = this.klec;
    for (let i = 0; i < NPLDIKU; i++) s.item(this.cislo + i).afaze = 36;

    // Pascal fixes the loop bound at entry, so blobs born this tick wait until next.
    const n = this.pocet;
    for (let i = 0; i < n; i++) {
      const b = this.pldik[i]!;
      if (b.delit > 0) b.delit--;
      else b.delit = 10 + s.random(10);
      const musibyt = klec[b.xs]![b.ys] === PLDZUST;
      const kliddole = klec[b.xs]![b.ys + 1] === PLDJSEM || klec[b.xs]![b.ys + 1] === PLDZED;
      const sm = s.random(2);
      let nx = sm === 1 ? b.xs - 1 : b.xs + 1;

      switch (b.cinnost) {
        case 0: // nic (idle)
          if (klec[b.xs]![b.ys + 1] === 0) {
            b.cinnost = 1; // pad
            b.faze = 0;
            klec[b.xs]![b.ys] = PLDODCH;
            klec[b.xs]![b.ys + 1] = PLDJDU;
            this.fazeplda(b.xs, b.ys, 20);
            this.fazeplda(b.xs, b.ys + 1, 19);
          } else if (kliddole && b.delit === 0 && klec[nx]![b.ys] === 0 && this.pocet < NPLDIKU) {
            b.delit = s.random(300) + 100;
            b.cinnost = 2; // deleni
            b.faze = 0;
            b.smer = sm;
            klec[b.xs]![b.ys] = PLDJSEM;
            if (klec[b.xs]![b.ys + 1] === PLDJSEM) klec[b.xs]![b.ys + 1] = PLDZUST;
            const child = this.pldik[this.pocet]!;
            child.xs = nx;
            child.ys = b.ys;
            child.cinnost = 3; // vznik
            child.faze = 0;
            child.smer = sm;
            child.delit = s.random(300) + 100;
            child.otec = i;
            klec[nx]![b.ys] = PLDJDU;
            this.fazeplda(b.xs, b.ys, 4 - sm);
            this.fazeplda(nx, b.ys, 36);
            this.pocet++;
          } else if (s.random(100) < 4 && kliddole && !musibyt) {
            if (klec[nx]![b.ys] === 0 && (klec[nx]![b.ys + 1] === 2 || klec[nx]![b.ys + 1] === 5)) {
              b.cinnost = 4; // posun
              b.faze = 0;
              b.smer = sm;
              klec[b.xs]![b.ys] = PLDODCH;
              klec[nx]![b.ys] = PLDJDU;
              this.fazeplda(b.xs, b.ys, 4 - sm);
            } else if (klec[nx]![b.ys] === 0 && klec[nx]![b.ys + 1] === 0) {
              b.cinnost = 5; // seskok
              b.faze = 0;
              b.smer = sm;
              klec[b.xs]![b.ys] = PLDODCH;
              klec[nx]![b.ys] = PLDJDU;
              this.fazeplda(b.xs, b.ys, 10 + sm * 18);
            } else if (
              (klec[nx]![b.ys] === PLDJSEM || klec[nx]![b.ys] === PLDZED) &&
              klec[b.xs]![b.ys - 1] === 0 &&
              klec[nx]![b.ys - 1] === 0
            ) {
              b.cinnost = 6; // naskok
              b.faze = 0;
              b.smer = sm;
              if (klec[nx]![b.ys] === PLDJSEM) klec[nx]![b.ys] = PLDZUST;
              klec[b.xs]![b.ys] = PLDODCH;
              klec[b.xs]![b.ys - 1] = PLDJDU;
              this.fazeplda(b.xs, b.ys, 18);
            } else {
              this.fazeplda(b.xs, b.ys, b.faze);
            }
          } else {
            if (s.random(100) < 10) b.faze = s.random(5);
            if (s.random(100) < 2) this.fazeplda(b.xs, b.ys, 5);
            else this.fazeplda(b.xs, b.ys, b.faze);
          }
          break;

        case 1: // pad (fall)
          if (b.faze === 0) {
            klec[b.xs]![b.ys] = 0;
            b.ys++;
            klec[b.xs]![b.ys] = PLDODCH;
            this.fazeplda(b.xs, b.ys, 2);
            b.faze++;
          } else {
            switch (klec[b.xs]![b.ys + 1]) {
              case 0:
                klec[b.xs]![b.ys] = PLDODCH;
                klec[b.xs]![b.ys + 1] = PLDJDU;
                this.fazeplda(b.xs, b.ys, 20);
                this.fazeplda(b.xs, b.ys + 1, 19);
                b.faze--;
                break;
              case 1:
              case 3:
                klec[b.xs]![b.ys] = PLDODCH;
                this.fazeplda(b.xs, b.ys, 2);
                b.cinnost = 0;
                b.faze = 2;
                break;
              default:
                b.cinnost = 0;
                b.faze = 0;
                klec[b.xs]![b.ys] = PLDJSEM;
                this.fazeplda(b.xs, b.ys, 18);
                break;
            }
          }
          break;

        case 3: // vznik (being born)
          b.faze++;
          if (b.faze >= 1 && b.faze <= 3) this.fazeplda(b.xs, b.ys, 12 + b.smer * 18);
          else if (b.faze === 4) {
            this.fazeplda(b.xs, b.ys, 14 + b.smer * 18);
            klec[b.xs]![b.ys] = PLDJSEM;
          } else if (b.faze >= 5 && b.faze <= 6) this.fazeplda(b.xs, b.ys, 14 + b.smer * 18);
          else if (b.faze >= 7 && b.faze <= 9) this.fazeplda(b.xs, b.ys, 15 + b.smer * 18);
          else if (b.faze >= 10 && b.faze <= 15) {
            this.fazeplda(b.xs, b.ys, 16 + b.smer * 18);
            if (s.random(100) < 10) b.faze = 20;
          } else if (b.faze === 16) {
            b.cinnost = 0;
            b.faze = 0;
            this.fazeplda(b.xs, b.ys, 0);
            const otec = this.pldik[b.otec]!;
            otec.cinnost = 0;
            this.fazeplda(otec.xs, otec.ys, 4 - b.smer);
            if (klec[otec.xs]![otec.ys + 1] === 4) klec[otec.xs]![otec.ys + 1] = 2;
          } else if (b.faze === 21) {
            this.fazeplda(b.xs, b.ys, 17 + b.smer * 18);
            if (s.random(100) < 20) b.faze = 15;
            else b.faze--;
          }
          break;

        case 2: // deleni (dividing)
          if (s.random(100) < 4) this.fazeplda(b.xs, b.ys, 13 + b.smer * 18);
          else this.fazeplda(b.xs, b.ys, 11 + b.smer * 18);
          break;

        case 4: // posun (shove sideways)
          b.faze++;
          nx = b.smer === 0 ? b.xs + 1 : b.xs - 1;
          if (b.faze === 1) {
            this.fazeplda(b.xs, b.ys, 6 + b.smer * 18);
            this.fazeplda(nx, b.ys, 7 + b.smer * 18);
          } else if (b.faze === 2) {
            this.fazeplda(b.xs, b.ys, 8 + b.smer * 18);
            this.fazeplda(nx, b.ys, 9 + b.smer * 18);
          } else if (b.faze === 3) {
            klec[b.xs]![b.ys] = 0;
            b.xs = nx;
            klec[b.xs]![b.ys] = PLDJSEM;
            this.fazeplda(b.xs, b.ys, 0);
            b.cinnost = 0;
            b.faze = 0;
          }
          break;

        case 5: // seskok (hop down)
          b.faze++;
          nx = b.smer === 0 ? b.xs + 1 : b.xs - 1;
          if (b.faze >= 1 && b.faze <= 2) this.fazeplda(b.xs, b.ys, 10 + b.smer * 18);
          else if (b.faze === 3) {
            this.fazeplda(b.xs, b.ys, 21 + b.smer);
            this.fazeplda(nx, b.ys, 22 - b.smer);
          } else if (b.faze === 4) {
            klec[b.xs]![b.ys] = 0;
            b.xs = nx;
            klec[b.xs]![b.ys] = PLDODCH;
            this.fazeplda(b.xs, b.ys, 2);
            b.cinnost = 1; // pad
            b.faze = 1;
          }
          break;

        case 6: // vyskok / naskok (hop up)
          b.faze++;
          nx = b.smer === 0 ? b.xs + 1 : b.xs - 1;
          if (b.faze === 1) {
            this.fazeplda(b.xs, b.ys - 1, 20);
            this.fazeplda(b.xs, b.ys, 19);
          } else if (b.faze === 2) {
            klec[b.xs]![b.ys] = 0;
            b.ys--;
            klec[b.xs]![b.ys] = PLDODCH;
            if (klec[nx]![b.ys] === 0) {
              this.fazeplda(b.xs, b.ys, 21 + b.smer);
              this.fazeplda(nx, b.ys, 22 + b.smer);
              klec[nx]![b.ys] = PLDJDU;
            } else {
              b.cinnost = 1;
              b.faze = 1;
              this.fazeplda(b.xs, b.ys, 2);
              if (klec[nx]![b.ys + 1] === 4) klec[nx]![b.ys + 1] = 2;
            }
          } else if (b.faze === 3) {
            klec[b.xs]![b.ys] = 0;
            b.xs = nx;
            klec[b.xs]![b.ys] = PLDJSEM;
            this.fazeplda(b.xs, b.ys, 18);
            b.cinnost = 0;
            b.faze = 0;
            if (klec[b.xs]![b.ys + 1] === 4) klec[b.xs]![b.ys + 1] = 2;
          }
          break;
      }
    }
  }
}
