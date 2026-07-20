/**
 * VITEJTE1 ("Welcome To Our City", room 21) — a faithful port of
 * VITEJTE1_InitProgramky / VITEJTE1_Programky (URoom.pas:8170-8238, 20401-20858).
 *
 * The City branch's grand finale: a giant stone RULER (vladce, item 1) presides
 * over the drowned city and delivers a stream of PA announcements — welcomes,
 * warnings, ads, "keep calm" sequences — chosen by a `cinnost` scheduler that
 * balances "obecne" (general) and "specialni" (special) topic bitmasks, growing
 * the pause (`prodleva`) as the pool empties. His face runs the shared `vladce`
 * ksichty machine (also used by DIRY). The fish (malar=9=little, velkar=10=big)
 * occasionally comment on his speeches. A row of seven audience CRABS (krabi,
 * items 11..17, tracked via globpole[0..6]) wakes and bops while he talks, then
 * dozes off again. Uses only existing primitives (talk/talking, globpole,
 * bitpole-style masks) plus the shared vladce face helper.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { vladceKsichtyFrame } from './vladce.js';

const R = {
  room: 0,
  room_qnevsimla: 1,
  room_qautomat: 2,
  room_qnezkusime: 3,
  room_qhlava: 4,
  room_komentovaly: 5,
  vladce: 1,
  vladce_ksichty: 1,
  vladce_cinnost: 2,
  vladce_faze: 3,
  vladce_delay: 4,
  vladce_vital: 5,
  vladce_obecne: 6,
  vladce_specialni: 7,
  vladce_prodleva: 8,
  vladce_promluvila: 9,
  malar: 9, // little fish
  velkar: 10, // big fish
  krabi: 11, // first of seven audience crabs (11..17)
} as const;

const upperA = (n: number): string => String.fromCharCode(65 + n); // 'A'+n
const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 5);
  v[R.room_qnevsimla] = 0;
  v[R.room_qautomat] = 0;
  v[R.room_qnezkusime] = 0;
  v[R.room_qhlava] = 0;
  v[R.room_komentovaly] = 0;

  const vl = s.vars(R.vladce, 9);
  vl[R.vladce_promluvila] = 0;
  vl[R.vladce_delay] = s.random(80) + 80;
  vl[R.vladce_ksichty] = 0;
  vl[R.vladce_vital] = 0;
  vl[R.vladce_obecne] = 0;
  vl[R.vladce_specialni] = 0;
  vl[R.vladce_prodleva] = 100;
  vl[R.vladce_cinnost] = 0;

  for (let p = 0; p <= 6; p++) {
    s.globpole[p] = 0;
  }
  // The original's `afaze:=1` sits inside `with Items[r_VITEJTE1_krabi]` (item 11)
  // within the loop, so it only ever sets item 11's afaze (redundantly), NOT items
  // 12..17 (URoom.pas:8229-8233). Match that exactly.
  s.item(R.krabi).afaze = 1;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const vl = s.vars(R.vladce);
  const vladce = s.item(R.vladce);

  // ---- room: the fish comment on the ruler's speeches ----
  if (
    s.alive('little') &&
    s.alive('big') &&
    s.noDialog() &&
    vl[R.vladce_cinnost] === 0 &&
    !s.playing(302)
  ) {
    if (v[R.room_komentovaly]! < vl[R.vladce_promluvila]!) {
      v[R.room_komentovaly] = vl[R.vladce_promluvila]!;
      if (v[R.room_komentovaly]! > 1 && s.random(100) < 50) {
        switch (s.random(4)) {
          case 0:
            v[R.room_qnevsimla] = (v[R.room_qnevsimla]! + 1) % 4;
            if (v[R.room_qnevsimla] === 1) s.addv(8, 'vit-v-nevsimla');
            break;
          case 1:
            v[R.room_qautomat] = (v[R.room_qautomat]! + 1) % 6;
            if (v[R.room_qautomat] === 1) {
              s.addv(8, 'vit-v-automat');
              s.addm(9, 'vit-m-nebo');
            }
            break;
          case 2:
            v[R.room_qnezkusime] = (v[R.room_qnezkusime]! + 1) % 8;
            if (v[R.room_qnezkusime] === 2) {
              s.addm(8, 'vit-m-nezkusime');
              if (v[R.room_komentovaly]! < 15) s.addv(5, 'vit-v-proc');
            }
            break;
          case 3:
            v[R.room_qhlava] = (v[R.room_qhlava]! + 1) % 2;
            if (v[R.room_qautomat] === 0) {
              switch (s.random(2)) {
                case 0:
                  s.addm(8, 'vit-m-hlava');
                  break;
                case 1:
                  s.addv(8, 'vit-v-hlava');
                  break;
              }
            }
            break;
        }
      }
    }
  }

  // ---- vladce (the ruler): announcement scheduler + face machine ----
  vladce.afaze++;

  if (vl[R.vladce_obecne] === 31 && vl[R.vladce_specialni] === 31) {
    vl[R.vladce_prodleva] = 2 * vl[R.vladce_prodleva]!;
    vl[R.vladce_obecne] = 0;
    vl[R.vladce_specialni] = 0;
  }

  if (vl[R.vladce_delay]! < 0) {
    vl[R.vladce_delay] = s.random(vl[R.vladce_prodleva]!) + vl[R.vladce_prodleva]!;
  }

  // Idle scheduler: while resting, count down the delay then pick the next topic,
  // preferring "obecne" (general) topics, occasionally a "specialni" one.
  if (vl[R.vladce_ksichty] === 0 && vl[R.vladce_cinnost] === 0) {
    if (vl[R.vladce_delay]! > 0) {
      vl[R.vladce_delay]!--;
    } else if (s.noDialog()) {
      if (vl[R.vladce_vital] === 0) {
        vl[R.vladce_cinnost] = 1;
        vl[R.vladce_vital] = 1;
      } else if (vl[R.vladce_obecne] === 0 || s.random(100) < 60) {
        const pom1 = s.random(5);
        if ((vl[R.vladce_obecne]! & (1 << pom1)) === 0) {
          vl[R.vladce_obecne]! |= 1 << pom1;
          vl[R.vladce_cinnost] = 2 + pom1;
          vl[R.vladce_promluvila]!++;
        }
      } else {
        const pom1 = s.random(5);
        if ((vl[R.vladce_specialni]! & (1 << pom1)) === 0) {
          vl[R.vladce_specialni]! |= 1 << pom1;
          vl[R.vladce_cinnost] = 7 + pom1;
          vl[R.vladce_promluvila]!++;
        }
      }
    }
  }

  // Topic dispatcher: only advances while the face is idle (ksichty === 0).
  if (vl[R.vladce_ksichty] === 0) {
    dispatchCinnost(s, vladce, vl);
  }

  // Face animation (shared with DIRY): ksichty 1..4 mouth + 10..22 sequences.
  vladceKsichtyFrame(s, R.vladce, R.vladce_ksichty, R.vladce_faze, 302);

  vladce.afaze--;

  // ---- krabi (seven audience crabs 11..17): wake and bop while the ruler talks ----
  {
    const pomb1 = s.talking(302) || s.talking(303);
    for (let pom1 = 0; pom1 <= 6; pom1++) {
      const crab = s.item(R.krabi + pom1);
      const pom2 = s.dist(R.vladce, R.krabi + pom1);
      if (crab.dir === Dir.left || crab.dir === Dir.right) {
        if (s.globpole[pom1]! < 3) s.globpole[pom1] = 3;
        s.globpole[pom1] = ((s.globpole[pom1]! - 2) % 4) + 3;
        switch (s.globpole[pom1]) {
          case 3:
          case 5:
            crab.afaze = 0;
            break;
          case 4:
            crab.afaze = 6;
            break;
          case 6:
            crab.afaze = 8;
            break;
        }
      } else if (pom2 <= 4 && pomb1) {
        s.globpole[pom1] = 1;
        crab.afaze = s.random(5) + 1;
        if (crab.afaze === 1) crab.afaze = 0;
      } else if (pom2 <= 10 && pomb1) {
        s.globpole[pom1] = 2;
        if (crab.afaze === 1 || s.random(100) < 10) {
          crab.afaze = s.random(5) + 1;
          if (crab.afaze === 1) crab.afaze = 0;
        }
        if (s.random(100) < 5) crab.afaze = 1;
      } else {
        switch (s.globpole[pom1]) {
          case 0:
            crab.afaze = 1;
            break;
          case 1:
            s.globpole[pom1] = -s.random(20) - 20;
            break;
          case 2:
            s.globpole[pom1] = -s.random(20) - 5;
            break;
          case 3:
          case 4:
          case 5:
          case 6:
            s.globpole[pom1] = -s.random(10) - 4;
            crab.afaze = 0;
            break;
          default:
            // globpole[pom1] < 0: a sleep countdown ticking back toward 0.
            if (s.random(-s.globpole[pom1]!) < 4) crab.afaze = 1;
            else if (s.random(100) < s.globpole[pom1]! || crab.afaze === 1) {
              crab.afaze = s.random(5) + 1;
              if (crab.afaze === 1) crab.afaze = 0;
            }
            s.globpole[pom1]!++;
            break;
        }
      }
    }
  }
}

/**
 * The ruler's topic dispatcher (URoom.pas:20490-20655): each `cinnost` value
 * `talk`s a line at priority 302 (or 303 for the ad stinger), sets the face
 * `ksichty`, and chains to the next state. Multi-line topics (dining 6/61..63,
 * ads 9/91..96, keep-calm 10/101..109) walk their own sub-states.
 */
function dispatchCinnost(s: Script, vladce: { afaze: number }, vl: number[]): void {
  const K = R.vladce_ksichty;
  const C = R.vladce_cinnost;
  const F = R.vladce_faze;
  const D = R.vladce_delay;
  switch (vl[C]) {
    case 0:
      if (s.random(50) === 0) {
        vl[F] = 0;
        switch (vladce.afaze) {
          case 1:
            switch (s.random(5)) {
              case 0:
                vl[K] = 20;
                break;
              case 1:
                vl[K] = 10;
                break;
              case 2:
                vl[K] = 12;
                break;
              case 3:
                vladce.afaze = 2;
                break;
              case 4:
                vl[K] = 21;
                break;
            }
            break;
          case 10:
            switch (s.random(2)) {
              case 0:
                vl[K] = 11;
                break;
              case 1:
                vl[K] = 14;
                break;
            }
            break;
          case 11:
            switch (s.random(2)) {
              case 0:
                vl[K] = 13;
                break;
              case 1:
                vl[K] = 22;
                break;
            }
            break;
          case 14:
            switch (s.random(3)) {
              case 0:
              case 1:
                vl[K] = 1;
                break;
              case 2:
                vladce.afaze = 1;
                vl[C] = 10;
                vl[F]!--;
                break;
            }
            break;
          case 6:
            switch (s.random(3)) {
              case 0:
                vl[K] = 12;
                break;
              case 1:
                vladce.afaze = 1;
                break;
            }
            break;
          default:
            vladce.afaze = 1;
            break;
        }
      }
      break;
    case 1:
      vl[D] = -1;
      s.talkNow('vit-hs-vitejte' + upperA(s.random(4)), 302);
      vl[K] = 2;
      vl[C] = 0;
      break;
    case 2:
      vl[D] = -1;
      s.talkNow('vit-hs-demoni0', 302);
      vl[K] = 1;
      vl[C] = 0;
      break;
    case 3:
      vl[D] = -1;
      s.talkNow('vit-hs-dite0', 302);
      vl[K] = 3;
      vl[C] = 0;
      break;
    case 4:
      vl[D] = -1;
      s.talkNow('vit-hs-lod0', 302);
      vl[K] = 1;
      vl[C] = 0;
      break;
    case 5:
      vl[D] = -1;
      s.talkNow('vit-hs-soud0', 302);
      vl[K] = 4;
      vl[C] = 0;
      break;
    case 6:
      s.talkNow('vit-hs-jidelna1', 302);
      vl[K] = 1;
      vl[C] = 61;
      break;
    case 61:
      s.addm(0, 'vit-m-jakze');
      s.addv(0, 'vit-v-vazne');
      s.addm(0, 'vit-m-nechutne');
      s.addset((val) => (vl[C] = val), 63);
      vl[C] = 62;
      break;
    case 63:
      s.talkNow('vit-hs-jidelna2', 302);
      vl[K] = 4;
      vl[C] = 0;
      vl[D] = -1;
      break;
    case 7:
      vl[D] = -1;
      s.talkNow('vit-hs-kacir', 302);
      vl[K] = 4;
      vl[C] = 0;
      break;
    case 8:
      vl[D] = -1;
      s.talkNow('vit-hs-vodovod0', 302);
      vl[K] = 2;
      vl[C] = 0;
      break;
    case 9:
      s.talkNow('vit-x-beg', 303);
      vl[K] = 10;
      vl[F] = 0;
      vl[C] = 91;
      break;
    case 91:
      if (!s.playing(303)) {
        vl[C]!++;
        vl[K] = 3;
        s.talkNow('vit-hs-reklama1', 302);
      }
      break;
    case 92:
      vl[C]!++;
      vl[K] = 4;
      s.talkNow('vit-hs-reklama2', 302);
      break;
    case 93:
      vl[C]!++;
      vl[K] = 3;
      s.talkNow('vit-hs-reklama3', 302);
      break;
    case 94:
      vl[C]!++;
      vl[K] = 4;
      s.talkNow('vit-hs-reklama4', 302);
      break;
    case 95:
      vl[C]!++;
      vl[K] = 2;
      s.talkNow('vit-hs-reklama5', 302);
      break;
    case 96:
      vl[C] = 0;
      vl[D] = -1;
      vl[K] = 10;
      vl[F] = 0;
      s.talkNow('vit-x-end', 303);
      break;
    case 10:
      vl[C] = 101;
      vl[K] = 2;
      s.talkNow('vit-hs-klid1', 302);
      break;
    case 101:
      vl[C]!++;
      vl[K] = 4;
      s.talkNow('vit-hs-klid2', 302);
      break;
    case 102:
      vl[C]!++;
      vl[K] = 12;
      vl[F] = 0;
      vl[D] = 5;
      break;
    case 103:
      if (vl[D]! > 0) vl[D]!--;
      else {
        vl[C]!++;
        vl[K] = 13;
        vl[F] = 0;
      }
      break;
    case 104:
      vl[C]!++;
      vl[K] = 3;
      s.talkNow('vit-hs-klid3', 302);
      break;
    case 105:
      vl[C]!++;
      vl[K] = 2;
      s.talkNow('vit-hs-klid4', 302);
      break;
    case 106:
      vl[C]!++;
      vl[K] = 12;
      vl[F] = 0;
      vl[D] = 3;
      break;
    case 107:
    case 108:
      if (vl[D]! > 0) vl[D]!--;
      else {
        vl[C]!++;
        vl[K] = 22;
        vl[F] = 0;
        vl[D] = 1;
      }
      break;
    case 109:
      vl[D] = -1;
      vl[C] = 0;
      break;
    case 11:
      vl[D] = -1;
      s.talkNow('vit-hs-pojis0', 302);
      vl[K] = 2;
      vl[C] = 0;
      break;
    default:
      vl[C] = 0;
      break;
  }
}

export const VITEJTE1: RoomScript = { name: 'VITEJTE1', init, prog };
