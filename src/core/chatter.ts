/**
 * Ambient idle chatter — a faithful port of TRoom.StdKecej + vyber_hlasku
 * (URoom.pas:3207-3375). When the fish are left alone (no active dialogue) for
 * ~60-120s (growing each time), they spontaneously say a random line from the
 * global `x03` speech bank ("ob-*" = obecné/global). This runs in every room,
 * independent of the room's own Programky.
 */
import type { Script } from './script.js';

/** nah(a,b) (URoom.pas:3207): a random integer in [a,b]. */
const nah = (s: Script, a: number, b: number): number => a + s.random(b - a + 1);

/**
 * vyber_hlasku(druh) (URoom.pas:3212): enqueue one of six random ambient
 * conversations. `depth15` gates group 0 (the original checks Room.Depth<>15).
 */
export function vyberHlasku(s: Script, druh: number, depth15 = false): void {
  const setBusyBig = (v: number) => s.setBusy('big', v);
  const setBusyLittle = (v: number) => s.setBusy('little', v);
  const setTrepat = (v: number) => {
    s.trepat = v;
  };

  switch (druh) {
    case 0:
      if (!depth15) {
        if (s.random(100) < 30) s.addm(20, 'ob-m-neverim');
        if (s.random(100) < 30) s.addm(20, 'ob-m-nedosataneme');
        if (s.random(100) < 30) s.addm(20, 'ob-m-naveky');
        switch (s.random(4)) {
          case 0:
            s.addv(s.random(15) + 5, 'ob-v-jit0');
            break;
          case 1:
            s.addv(s.random(15) + 5, 'ob-v-jit1');
            break;
          case 2:
            s.addv(s.random(15) + 5, 'ob-v-musi');
            break;
          case 3:
            s.addv(s.random(15) + 5, 'ob-v-klid');
            break;
        }
      }
      break;
    case 1:
      switch (s.random(3)) {
        case 0:
          s.addv(20, 'ob-v-neobvykle');
          s.addm(nah(s, 5, 10), 'ob-m-teorie');
          break;
        case 1:
          s.addv(20, 'ob-v-mamto');
          s.addm(nah(s, 10, 20), 'ob-m-pokracuj');
          s.addv(5, 'ob-v-napad');
          if (s.random(100) < 40) s.addm(6, 'ob-m-zase');
          break;
        case 2:
          s.addv(20, 'ob-v-vyzkousej');
          s.addm(0, 'ob-m-co');
          s.addv(nah(s, 5, 15), 'ob-v-alenic');
          if (s.random(100) < 40) s.addm(6, 'ob-m-zase');
          break;
      }
      break;
    case 2:
      switch (s.random(3)) {
        case 0:
          s.addv(10, 'ob-v-nebavi');
          break;
        case 1:
          s.addv(10, 'ob-v-hrej');
          break;
        case 2:
          s.addv(10, 'ob-v-sami');
          break;
      }
      switch (s.random(3)) {
        case 0:
          s.addm(5, 'ob-m-pst');
          break;
        case 1:
          s.addm(5, 'ob-m-hlavu');
          break;
        case 2:
          s.addm(5, 'ob-m-klid');
          break;
      }
      break;
    case 3:
      switch (s.random(4)) {
        case 0:
          s.addm(10, 'ob-m-jesteneco');
          break;
        case 1:
          s.addm(10, 'ob-m-nedeje');
          break;
        case 2:
          s.addm(10, 'ob-m-proc');
          break;
        case 3:
          s.addm(10, 'ob-m-ceka');
          break;
      }
      switch (s.random(3)) {
        case 0:
        case 1:
          s.addv(5, 'ob-v-nerus');
          break;
        case 2:
          s.addm(15, 'ob-m-jetam');
          s.addset(setBusyBig, 1);
          s.addv(nah(s, 5, 25), 'ob-v-leskne');
          s.addset(setBusyBig, 0);
          break;
      }
      break;
    case 4:
      switch (s.random(5)) {
        case 0:
          s.addv(10, 'ob-v-prestavka');
          break;
        case 1:
          s.addd(10, 'ob-o-nebavi', 3); // a narrator "both" line (prior 3)
          break;
        case 2:
          s.addset(setBusyBig, 1);
          s.addset(setBusyLittle, 1);
          s.addd(10, 'ob-o-halo', 3);
          s.addv(10, 'ob-v-nelekl');
          s.addm(6, 'ob-m-mysleli');
          s.addset(setBusyBig, 0);
          s.addset(setBusyLittle, 0);
          break;
        case 3:
          s.addset(setBusyBig, 1);
          s.addv(10, 'ob-v-nehybes');
          s.addset(setBusyBig, 0);
          s.addm(10, 'ob-m-resit');
          s.addv(5, 'ob-v-akvarium');
          break;
        case 4:
          s.addset(setTrepat, 1); // shake the room
          s.addv(5, 'ob-v-halo');
          s.adddel(5);
          s.addset(setTrepat, 0);
          break;
      }
      break;
    case 5:
      switch (s.random(6)) {
        case 0:
          s.addset(setBusyLittle, 1);
          s.addm(5, 'ob-m-tezky');
          s.addset(setBusyLittle, 0);
          break;
        case 1:
          s.addset(setBusyBig, 1);
          s.addv(5, 'ob-v-jidlo');
          s.addset(setBusyBig, 0);
          break;
        case 2:
          s.addset(setBusyLittle, 1);
          s.addm(5, 'ob-m-strach');
          s.addset(setBusyLittle, 0);
          break;
        case 3:
          s.addm(10, 'ob-m-jakdlouho');
          s.addv(5, 'ob-v-zvykacka');
          s.zvykacka = true; // the gum easter egg — pays off on exit (ob-m-zvykacka)
          break;
        case 4:
          s.addv(5, 'ob-v-ostani');
          s.addm(5, 'ob-m-kdo');
          s.addv(5, 'ob-v-kdoresi');
          s.addm(10, 'ob-m-pravdepodobne');
          break;
        case 5:
          s.addm(10, 'ob-m-ach');
          s.addv(5, 'ob-v-copak');
          s.addm(15, 'ob-m-lito');
          s.addv(5, 'ob-v-colito');
          s.addm(5, 'ob-m-vsechno');
          s.addv(5, 'ob-v-covsechno');
          s.addm(1, 'ob-m-uplnevse');
          break;
      }
      break;
  }
}

/**
 * StdKecej (URoom.pas:3351): the ambient-chatter timer. Fires vyber_hlasku once
 * every `interval` ticks (CasKecu) while no dialogue is active, choosing a group
 * different from the last three (the `poslhlasky` rotation) and growing the
 * interval by 0-50% each time. Wall-clock in the original (60-120s); here paced
 * in game ticks. Returns the updated timer state.
 */
export interface ChatterState {
  interval: number; // CasKecu, in game ticks
  last: number; // count of the last chatter (posldialog)
  poslhlasky: number; // packed history of the last three group numbers (1..6), 3 bits each
}

/** A fresh chatter timer for a room entry: CasKecu = random(60)+60 seconds. */
export function newChatter(s: Script, ticksPerSecond: number): ChatterState {
  return {
    interval: Math.round((s.random(61) + 60) * ticksPerSecond),
    last: 0,
    poslhlasky: 0,
  };
}

/**
 * Advance the chatter timer by one tick. If it fires, enqueues a chatter group
 * into the Script and returns true. `now` is the current game-tick count;
 * `dialogActive` mirrors `is_dialog` (suppress while a line is playing).
 */
export function tickChatter(
  s: Script,
  st: ChatterState,
  now: number,
  ticksPerSecond: number,
  dialogActive: boolean,
  depth15 = false,
): boolean {
  if (dialogActive) return false;
  if (now - st.last < st.interval) return false;
  st.last = now;
  st.interval = Math.round((st.interval * (100 + s.random(51))) / 100);
  const m = st.poslhlasky;
  let n: number;
  // Avoid repeating any of the last THREE groups (URoom.pas:3370): the packed history
  // holds three 3-bit slots — m&7, (m div 8)&7, (m div 64)&7.
  do {
    n = s.random(6) + 1; // 1..6
  } while (n === (m & 7) || n === ((m >> 3) & 7) || n === ((m >> 6) & 7));
  st.poslhlasky = (m >> 3) + 64 * n;
  vyberHlasku(s, n - 1, depth15);
  return true;
}
