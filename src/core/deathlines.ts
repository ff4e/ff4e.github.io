/**
 * Death commentary — a faithful port of TRoom.StdSmrt (URoom.pas:3028-3206).
 * When one fish dies while the other lives, ~8 ticks later the survivor comments
 * on the loss (a "smrt-*" line from the global x02 bank); the line mix depends on
 * the room's Depth (deeper rooms add jokes / love / "from beyond the grave"
 * lines). When both die at depth >= 9 there's a small chance of a joint line.
 */
import type { Script } from './script.js';

type Hlaska = 'none' | 'normal' | 'joke' | 'love' | 'grave' | 'auto' | 'both';

export interface DeathState {
  hlasitSmrt: number; // count while both fish were last alive
  poslMale: number; // last little-fish death line index (avoid repeats)
  poslVelke: number; // last big-fish death line index
  poslObou: number; // both-dead line guard
}

export function newDeathState(): DeathState {
  return { hlasitSmrt: 0, poslMale: -1, poslVelke: -1, poslObou: 0 };
}

/** Alive/exited flags mirroring zije[]/venku[]. */
export interface FishFlags {
  aliveLittle: boolean;
  aliveBig: boolean;
  venkuLittle: boolean;
  venkuBig: boolean;
}

/**
 * Advance StdSmrt one tick. `depth` is the room's Hloubka; `now` the tick count.
 * Enqueues at most one commentary conversation into the Script.
 */
export function stdSmrt(s: Script, st: DeathState, now: number, depth: number, f: FishFlags): void {
  if (depth === 2) return; // no death lines in the tutorial room (Depth=2)

  if (f.aliveLittle && f.aliveBig) {
    st.hlasitSmrt = now; // both alive: keep the timer fresh
    return;
  }

  let hlaska: Hlaska = 'none';
  let hlrestart = false;
  const rnd = (n: number) => s.random(n);

  const oneDeadNotExited =
    (!f.aliveLittle && !f.venkuLittle) || (!f.aliveBig && !f.venkuBig);

  if (oneDeadNotExited && st.hlasitSmrt + 8 === now) {
    if (f.aliveBig || f.aliveLittle) {
      // One fish dead, the other alive — the survivor comments (Depth-dependent).
      if (depth >= 1 && depth <= 2) {
        hlaska = 'normal';
        hlrestart = true;
      } else if (depth === 3) {
        if (rnd(100) < 70) hlaska = 'normal';
        if (rnd(100) < 50 || (st.poslMale === -1 && st.poslVelke === -1)) hlrestart = true;
      } else if (depth >= 4 && depth <= 8) {
        if (rnd(100) < 80 - 5 * depth) {
          if (f.aliveLittle) hlaska = rnd(100) < 5 ? 'joke' : 'normal';
          else hlaska = rnd(100) < 10 ? 'joke' : 'normal';
        } else {
          hlaska = 'none';
        }
        hlrestart = rnd(100) < 90 - 10 * depth;
        if (hlaska !== 'none') {
          if ((f.aliveLittle && rnd(100) < 6) || (f.aliveBig && rnd(100) < 10)) {
            hlaska = 'grave';
            hlrestart = false;
          }
        }
      } else if (depth >= 9 && depth <= 14) {
        if (rnd(100) < 30) {
          if (f.aliveLittle) {
            if (rnd(100) < 8) hlaska = rnd(8) < 5 ? 'joke' : 'love';
            else hlaska = 'normal';
          } else {
            hlaska = rnd(100) < 10 ? 'joke' : 'normal';
          }
        } else {
          hlaska = 'none';
        }
        hlrestart = rnd(100) < 5;
        if (hlaska !== 'none') {
          if ((f.aliveLittle && rnd(100) < 10) || (f.aliveBig && rnd(100) < 18)) {
            hlaska = 'grave';
            hlrestart = false;
          }
        }
      } else if (depth === 15) {
        hlaska = 'auto';
        hlrestart = false;
      }
    } else if (!f.venkuLittle && !f.venkuBig) {
      // Both dead (neither exited): a small chance of a joint line at depth >= 9.
      hlaska = depth >= 9 && rnd(100) < 25 ? 'both' : 'none';
      hlrestart = false;
    }

    if (f.aliveLittle) {
      // Big fish died — the little fish speaks (smrt-m-*).
      switch (hlaska) {
        case 'normal': {
          let h: number;
          do {
            h = rnd(5) + 1;
          } while (h === st.poslVelke);
          st.poslVelke = h;
          s.addm(rnd(5), `smrt-m-${h}`);
          break;
        }
        case 'joke':
          st.poslVelke = 0;
          s.addm(rnd(5), 'smrt-m-0');
          break;
        case 'love': {
          const h = st.poslVelke === 6 ? 0 : 6;
          st.poslVelke = h;
          s.addm(rnd(5), `smrt-m-${h}`);
          break;
        }
        case 'grave':
          if (st.poslVelke !== 10) {
            st.poslVelke = 10;
            s.addv(rnd(30) + 20, 'smrt-v-zahrobi');
          }
          break;
        case 'auto':
          st.poslVelke = 20;
          s.addm(0, 'smrt-m-autorest');
          break;
      }
    } else if (f.aliveBig) {
      // Little fish died — the big fish speaks (smrt-v-*).
      switch (hlaska) {
        case 'normal': {
          let h: number;
          do {
            h = rnd(4) + 1;
          } while (h === st.poslMale);
          st.poslMale = h;
          s.addv(rnd(5), `smrt-v-${h}`);
          break;
        }
        case 'joke': {
          let h: number;
          do {
            h = rnd(4);
            if (h > 0) h += 4;
          } while (h === st.poslMale);
          st.poslMale = h;
          s.addv(rnd(5), `smrt-v-${h}`);
          break;
        }
        case 'grave':
          if (st.poslMale !== 10 && (st.poslMale === 11 || rnd(100) < 50)) {
            st.poslMale = 10;
            s.addm(rnd(30) + 20, 'smrt-m-zahrobi');
          } else {
            st.poslMale = 11;
            s.addv(rnd(30) + 20, 'smrt-v-posmrtny');
            s.addm(rnd(30) + 20, 'smrt-m-posmrtny');
          }
          break;
        case 'auto':
          st.poslMale = 20;
          s.addv(0, 'smrt-v-autorest');
          break;
      }
    } else if (hlaska === 'both' && st.poslObou !== 1) {
      st.poslObou = 1;
      s.addd(0, 'smrt-x-obe', 50);
      s.addv(2, 'smrt-v-obe');
      s.addm(0, 'smrt-m-obe');
    }

    if (hlrestart) {
      if (f.aliveBig) s.addv(rnd(20) + 10, 'smrt-v-restart');
      else if (f.aliveLittle) s.addm(rnd(20) + 10, 'smrt-m-restart');
    }
  }
}
