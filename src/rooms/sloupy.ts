/**
 * SLOUPY ("The Columns", room 23) — a faithful port of SLOUPY_InitProgramky /
 * SLOUPY_Programky (URoom.pas:6829-6899, 16006-16285).
 *
 * A colonnade: two long rows of statue-columns (rada1 = items 9..26, rada2 =
 * 27..50) run "waves" of facial expressions — left-to-right, right-to-left, a
 * double wave from both ends, and random flicker/siren modes — driven by a state
 * machine stored in each row's first item Vars (cinnost/faze/xicht1/xicht2). A
 * rising statue (sochoradi, 52) and a toppling figure (chlapik, 53) each play a
 * short scripted sequence and, at their climax, kick rada1 into a scripted double
 * wave (cinnost=7). The fish are malar (7, little) and velkar (8, big). Uses only
 * existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_kochani: 2,
  room_pady: 3,
  room_osose: 4,
  ocel: 2,
  samotna: 3,
  malar: 7, // little fish
  velkar: 8, // big fish
  rada1beg: 9,
  rada1end: 26,
  rada2beg: 27,
  rada2end: 50,
  sochoradi: 52,
  chlapik: 53,
} as const;

// Per-row Vars (on the row's first item): cinnost/faze/xicht1/xicht2.
const CIN = 1;
const FAZE = 2;
const X1 = 3;
const X2 = 4;

/**
 * The per-row wave state machine (identical for rada1 and rada2), keyed off the
 * first item's Vars. cinnost: 0 idle -> pick; 1 pick; 2 wave L->R; 3 wave R->L;
 * 4 double wave; 5 random flicker; 6 "siren" (flicker + neighbour copy); 7 a
 * scripted double wave (xicht=1) triggered by the statue/figure climax.
 */
function waveRow(s: Script, begIdx: number, endIdx: number): void {
  const v = s.vars(begIdx);
  const begAfaze = s.item(begIdx).afaze;
  switch (v[CIN]) {
    case 0:
      if (s.random(1000) < 15) {
        v[CIN] = s.random(5) + 2;
        if (v[CIN] === 2 || v[CIN] === 3) {
          do {
            v[X1] = s.random(3);
          } while (v[X1] === begAfaze);
        } else if (v[CIN] === 4) {
          do {
            v[X1] = s.random(3);
          } while (v[X1] === begAfaze);
          do {
            v[X2] = s.random(3);
          } while (v[X2] === begAfaze);
        }
        v[FAZE] = 0;
      }
      break;
    case 1:
      v[CIN] = s.random(3) + 2;
      v[X1] = s.random(3);
      v[X2] = s.random(3);
      v[FAZE] = 0;
      break;
    case 2:
      if (s.count % 2 === 1) {
        s.item(begIdx + v[FAZE]!).afaze = v[X1]!;
        v[FAZE]!++;
        if (begIdx + v[FAZE]! > endIdx) v[CIN] = 0;
      }
      break;
    case 3:
      if (s.count % 2 === 1) {
        s.item(endIdx - v[FAZE]!).afaze = v[X1]!;
        v[FAZE]!++;
        if (endIdx - v[FAZE]! < begIdx) v[CIN] = 0;
      }
      break;
    case 4:
      if (s.count % 2 === 1) {
        s.item(begIdx + v[FAZE]!).afaze = v[X1]!;
        s.item(endIdx - v[FAZE]!).afaze = v[X2]!;
        v[FAZE]!++;
        if (begIdx + v[FAZE]! > endIdx) v[CIN] = 0;
      }
      break;
    case 5:
      if (s.random(1000) < 15) v[CIN] = 1;
      else if (s.random(100) < 20) {
        const p = s.random(endIdx - begIdx + 1) + begIdx;
        s.item(p).afaze = s.random(3);
      }
      break;
    case 6:
      if (s.random(1000) < 15) v[CIN] = 1;
      else if (s.random(100) < 50) {
        const p = s.random(endIdx - begIdx + 1) + begIdx;
        if (s.random(100) < 20) s.item(p).afaze = s.random(3);
        else {
          switch (s.random(2)) {
            case 0:
              if (p > begIdx) s.item(p).afaze = s.item(p - 1).afaze;
              break;
            case 1:
              if (p < endIdx) s.item(p).afaze = s.item(p + 1).afaze;
              break;
          }
        }
      }
      break;
    case 7:
      v[CIN] = 4;
      v[X1] = 1;
      v[X2] = 1;
      v[FAZE] = 0;
      break;
  }
}

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  v[R.room_uvod] = s.pokus === 1 ? 12 : s.random(4) + s.random(2) * 10;
  v[R.room_kochani] = s.random(2);
  v[R.room_pady] = 0;
  v[R.room_osose] = s.random(1500) + 500;

  s.vars(R.rada1beg, 4)[CIN] = 0;
  s.vars(R.rada2beg, 4)[CIN] = 0;
  s.vars(R.sochoradi, 1)[CIN] = 0;
  s.vars(R.chlapik, 1)[CIN] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const thud = () => s.snd('sp-zuch' + String.fromCharCode(49 + s.random(2)), 202);

  // ---- room dialogue (single else-if chain) ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_osose]! > 0) v[R.room_osose]!--;

    if (v[R.room_uvod]! > 0) {
      if (v[R.room_uvod]! >= 10 && s.random(100) < 40) {
        s.addm(10 + s.random(40), 'sl-m-velkolepe');
        v[R.room_uvod]! -= 10;
      }
      if (v[R.room_uvod]! % 10 >= 1) s.addv(20, 'sl-v-stopa');
      if (v[R.room_uvod]! > 10) {
        s.addm(5 + s.random(30), 'sl-m-velkolepe');
        v[R.room_uvod]! -= 10;
      }
      if (v[R.room_uvod]! >= 2) s.addv(5, 'sl-v-vkapse');
      if (v[R.room_uvod]! >= 3) s.addm(s.random(20) + 5, 'sl-m-trvat');
      v[R.room_uvod] = 0;
    } else if (v[R.room_osose] === 0 && s.vars(R.chlapik)[CIN] === 0) {
      s.addm(20, 'sl-m-sedi');
      s.addv(5, 'sl-v-feidios');
      s.addm(20 + s.random(50), 'sl-m-tehdy');
      v[R.room_osose] = -1;
    } else if (
      v[R.room_kochani] === 0 &&
      v[R.room_pady]! <= 1 &&
      s.item(R.velkar).dir !== Dir.no &&
      s.random(100) < 2
    ) {
      v[R.room_kochani] = 1;
      s.setBusy('big', 1);
      s.addv(0, 'sl-v-nechme');
      s.adddel(s.random(90) + 30);
      s.addset((val) => s.setBusy('big', val), 0);
    } else if (
      v[R.room_pady]! <= 0 &&
      s.item(R.malar).x === 33 &&
      s.item(R.malar).y === 27 &&
      s.item(R.ocel).y < 26
    ) {
      s.addv(0, 'sl-v-opatrne');
      v[R.room_pady] = 1;
    } else if (v[R.room_pady]! <= 1 && s.vars(R.sochoradi)[CIN]! >= 8) {
      s.addv(0, 'sl-v-skoda');
      v[R.room_pady] = 2;
    } else if (
      v[R.room_pady]! <= 2 &&
      s.item(R.sochoradi).y === 16 &&
      s.item(R.samotna).x >= 14 &&
      s.vars(R.chlapik)[CIN] === 0
    ) {
      v[R.room_pady] = 3;
      s.addv(0, 'sl-v-pust');
    }
  }

  // ---- samotna (the lone column): idle flicker; frame 1 while pushed ----
  {
    const sam = s.item(R.samotna);
    if (s.random(100) < 2) sam.afaze = s.random(2) * 2;
    if (sam.dir !== Dir.no) sam.afaze = 1;
  }

  // ---- the two colonnade rows ----
  waveRow(s, R.rada1beg, R.rada1end);
  waveRow(s, R.rada2beg, R.rada2end);

  // ---- sochoradi (rising statue): plays its rise, then kicks rada1 into a wave ----
  {
    const sv = s.vars(R.sochoradi);
    const soch = s.item(R.sochoradi);
    if (sv[CIN] === 4 || sv[CIN] === 5 || sv[CIN] === 7) thud();
    switch (sv[CIN]) {
      case 0:
        if (soch.dir === Dir.up) sv[CIN]!++;
        break;
      case 1:
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
        soch.afaze = sv[CIN]!;
        sv[CIN]!++;
        break;
      case 8:
        s.vars(R.rada1beg)[CIN] = 7;
        sv[CIN]!++;
        break;
    }
  }

  // ---- chlapik (toppling figure): topples, shrieks the fish, then kicks a wave ----
  {
    const cv = s.vars(R.chlapik);
    const chl = s.item(R.chlapik);
    if (cv[CIN] === 5 || cv[CIN] === 9) thud();
    switch (cv[CIN]) {
      case 0:
        if (chl.dir === Dir.down) cv[CIN]!++;
        break;
      case 1:
        if (chl.dir === Dir.no) {
          chl.afaze = 1;
          cv[CIN]!++;
          s.ksnd(1); // ksnd(mala): cut the little fish off
          s.clearDialog();
          if (s.alive('little')) {
            s.addm(2, 'sl-m-jekot');
            if (s.alive('big')) s.addv(0, 'sl-v-barbarka');
            s.addm(20 + s.random(20), 'sl-m-nelibila');
          }
        }
        break;
      case 2:
      case 3:
      case 4:
      case 5:
      case 6:
      case 7:
      case 8:
      case 9:
        chl.afaze = cv[CIN]!;
        cv[CIN]!++;
        break;
      case 10:
        s.vars(R.rada1beg)[CIN] = 7;
        cv[CIN]!++;
        break;
    }
  }
}

export const SLOUPY: RoomScript = { name: 'SLOUPY', init, prog };
