/**
 * NCP ("Imprisoned", room 32) — a faithful port of NCP_InitProgramky /
 * NCP_Programky (URoom.pas:4942-5006, 8958-9275).
 *
 * A cramped coral cell. The two fish (malar = item 21 = little, velkar = item 22 =
 * big) squeeze past corals and comment on their hardness/colours. Three decorative
 * creatures run their own state machines: a sea-anemone (sasanka = 8) that waves
 * its leg and opens/closes its bloom (with a "tup" plop sound), a snail (snek = 10)
 * that pokes out when nudged, and a clockwork seahorse (konik = 23) that ticks,
 * blinks and neighs — and reacts (stav 7) when a fish smiles at it. Uses only
 * existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const LITTLE_USMEV = 4;
const BIG_USMEV = 6;

const R = {
  room: 0,
  room_uvod: 1,
  room_sas: 2,
  room_kuk: 3,
  room_okoralech: 4,
  room_obarvach: 5,
  room_neprojedes: 6,
  room_mohlabys: 7,
  koral1: 1,
  koral2: 2,
  koral3: 3,
  elko: 5,
  valec: 6,
  sasanka: 8,
  sasanka_cinnost: 1,
  sasanka_fazec: 2,
  sasanka_noha: 3,
  sasanka_kvet: 4,
  sasanka_counts: 5,
  sasanka_akcnost: 6,
  snek: 10,
  snek_stav: 1,
  snek_count: 2,
  malar: 21, // little fish
  velkar: 22, // big fish
  konik: 23,
  konik_stav: 1,
  konik_mrkani: 2,
  koral0: 24,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 7);
  v[R.room_uvod] = 0;
  v[R.room_sas] = 0;
  v[R.room_kuk] = 0;
  v[R.room_okoralech] = 0;
  v[R.room_obarvach] = 0;
  v[R.room_neprojedes] = 0;
  v[R.room_mohlabys] = 0;

  const sa = s.vars(R.sasanka, 6);
  sa[R.sasanka_cinnost] = 0;
  sa[R.sasanka_noha] = 0;
  sa[R.sasanka_kvet] = 1;
  sa[R.sasanka_akcnost] = 1;

  s.vars(R.snek, 2)[R.snek_stav] = 0;

  const ko = s.vars(R.konik, 2);
  ko[R.konik_stav] = 0;
  ko[R.konik_mrkani] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room: ambient dialogue chain ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      // random(1) is always 0, so only tesno0 ever plays (faithful to original).
      switch (s.random(1)) {
        case 0:
          s.addm(20 + s.random(30), 'ncp-m-tesno0');
          break;
        case 1:
          s.addm(20 + s.random(30), 'ncp-m-tesno1');
          break;
      }
      if (s.random(100) < 30) s.addv(s.random(8), 'ncp-v-dostala');
    } else if (
      s.lookAt(R.malar, R.sasanka) &&
      s.dist(R.malar, R.sasanka) < 3 &&
      v[R.room_sas] === 0 &&
      s.random(100) < 20
    ) {
      s.addv(s.random(5), 'ncp-v-sasanka');
      v[R.room_sas] = 1;
    } else if (
      s.lookAt(R.malar, R.konik) &&
      s.item(R.konik).afaze === 3 &&
      s.dist(R.malar, R.konik) < 4 &&
      v[R.room_kuk] === 0
    ) {
      s.addm(s.random(5), 'ncp-m-nekoukej');
      v[R.room_kuk] = 1;
    } else if (
      (s.item(R.koral1).dir !== Dir.no ||
        s.item(R.koral2).dir !== Dir.no ||
        s.item(R.koral3).dir !== Dir.no ||
        s.item(R.koral0).dir !== Dir.no) &&
      v[R.room_okoralech] === 0 &&
      s.random(100) < 2
    ) {
      v[R.room_okoralech] = 1;
      if (s.aktivni() === 'big') {
        s.addv(0, 'ncp-v-mekky');
      } else {
        switch (s.random(5)) {
          case 0:
          case 1:
          case 2:
          case 3:
            s.addm(0, 'ncp-m-tvrdy');
            break;
          case 4:
            s.addm(0, 'ncp-m-komari');
            s.addv(s.random(3), 'ncp-v-ceho');
            s.addm(s.random(3), 'ncp-m-koraly');
            break;
        }
      }
    } else if (
      s.item(R.velkar).x === 4 &&
      s.item(R.velkar).y === 29 &&
      s.aktivni() === 'big' &&
      v[R.room_neprojedes] === 0 &&
      s.random(100) < 10
    ) {
      s.addv(s.random(3), 'ncp-v-neprojedu');
      v[R.room_neprojedes] = 1;
    } else if (v[R.room_obarvach] === 0 && s.random(10000) < 5) {
      v[R.room_obarvach] = 1;
      s.addm(s.random(10), 'ncp-m-barvy');
    } else if (
      s.item(R.valec).x === 3 &&
      s.item(R.valec).y === 34 &&
      v[R.room_mohlabys] === 0
    ) {
      v[R.room_mohlabys] = 1;
      s.addv(s.random(3), 'ncp-v-tak');
      if (s.random(100) < 80) s.addm(s.random(10), 'ncp-m-muzes');
    }
  }

  // ---- sasanka (sea-anemone): leg-wave + bloom, plops when fish approach ----
  {
    const sa = s.vars(R.sasanka);
    const it = s.item(R.sasanka);
    if (
      sa[R.sasanka_cinnost] !== 5 &&
      (s.dist(R.malar, R.sasanka) < 3 || s.dist(R.velkar, R.sasanka) < 3)
    ) {
      sa[R.sasanka_cinnost] = 5;
      sa[R.sasanka_counts] = s.random(10) + 15;
      sa[R.sasanka_akcnost] = 1;
    }
    if (sa[R.sasanka_cinnost] === 0) {
      sa[R.sasanka_cinnost] = s.random(4) + 1;
      sa[R.sasanka_fazec] = 0;
      sa[R.sasanka_akcnost] = 2 + s.random(2);
    }
    if (s.count % sa[R.sasanka_akcnost]! === 0) {
      switch (sa[R.sasanka_cinnost]) {
        case 1:
        case 2:
          sa[R.sasanka_noha] = Math.floor(sa[R.sasanka_fazec]! / 4);
          if (sa[R.sasanka_cinnost] === 1) {
            sa[R.sasanka_kvet] = (sa[R.sasanka_fazec]! % 2) + 1;
            sa[R.sasanka_akcnost] = 2;
            if (sa[R.sasanka_kvet] === 2) s.snd('ncp-x-tup', 500);
          } else {
            sa[R.sasanka_kvet] = (sa[R.sasanka_fazec]! % 2) * 2 + 1;
            sa[R.sasanka_akcnost] = 3;
          }
          sa[R.sasanka_fazec]!++;
          if (sa[R.sasanka_fazec] === 8) {
            if (s.random(100) < 30) sa[R.sasanka_cinnost] = 0;
            else sa[R.sasanka_fazec] = 0;
          }
          break;
        case 3:
        case 4:
          switch (sa[R.sasanka_fazec]) {
            case 0:
              sa[R.sasanka_counts] = s.random(10) + 7;
              sa[R.sasanka_fazec]!++;
              sa[R.sasanka_kvet] = 1;
              break;
            case 1:
              sa[R.sasanka_noha] = 1 - sa[R.sasanka_noha]!;
              sa[R.sasanka_counts]!--;
              if (sa[R.sasanka_counts] === 0) sa[R.sasanka_fazec]!++;
              break;
            case 2:
              if (sa[R.sasanka_cinnost] === 3) {
                sa[R.sasanka_kvet] = 0;
                sa[R.sasanka_counts] = s.random(8) + 5;
              } else {
                sa[R.sasanka_kvet] = 3;
                sa[R.sasanka_counts] = s.random(6) + 3;
              }
              sa[R.sasanka_fazec]!++;
              break;
            case 3:
              sa[R.sasanka_counts]!--;
              if (sa[R.sasanka_counts] === 0) {
                if (s.random(100) < 30) sa[R.sasanka_cinnost] = 0;
                else sa[R.sasanka_fazec] = 0;
              }
              break;
          }
          break;
        case 5:
          sa[R.sasanka_akcnost] = 2;
          sa[R.sasanka_counts]!--;
          switch (sa[R.sasanka_counts]) {
            case 0:
              sa[R.sasanka_cinnost] = 0;
              break;
            case 1:
              sa[R.sasanka_kvet] = 1;
              sa[R.sasanka_noha] = 1 - sa[R.sasanka_noha]!;
              break;
            default:
              sa[R.sasanka_kvet] = 0;
              break;
          }
          break;
      }
    }
    it.afaze = sa[R.sasanka_noha]! * 4 + sa[R.sasanka_kvet]!;
  }

  // ---- snek (snail): pokes out when nudged, then retracts ----
  {
    const sn = s.vars(R.snek);
    const it = s.item(R.snek);
    switch (sn[R.snek_stav]) {
      case 0:
        if (it.dir !== Dir.no) sn[R.snek_stav] = 1;
        break;
      case 1:
        it.afaze = 3;
        sn[R.snek_stav]!++;
        break;
      case 2:
        it.afaze = 1;
        sn[R.snek_stav]!++;
        break;
      case 3:
        it.afaze = 2;
        if (it.dir === Dir.no) {
          sn[R.snek_stav] = 4;
          sn[R.snek_count] = 20;
        }
        break;
      case 4:
        sn[R.snek_count]!--;
        if (sn[R.snek_count] === 0) {
          sn[R.snek_stav] = 5;
          sn[R.snek_count] = 5;
        }
        if (it.dir !== Dir.no) sn[R.snek_stav] = 2;
        break;
      case 5:
        it.afaze = 1;
        sn[R.snek_count]!--;
        if (sn[R.snek_count] === 0) {
          it.afaze = 0;
          sn[R.snek_stav] = 0;
        }
        if (it.dir !== Dir.no) sn[R.snek_stav] = 1;
        break;
    }
  }

  // ---- malar/velkar: a fish grinning at the seahorse triggers its reaction ----
  {
    if (
      s.delay('little') >= 15 &&
      s.delay('little') < 40 &&
      s.lookAt(R.malar, R.konik) &&
      s.ydist(R.malar, R.konik) === 0 &&
      s.xdist(R.malar, R.konik) < 3
    ) {
      if (s.xicht('little') !== LITTLE_USMEV) {
        s.setXicht('little', LITTLE_USMEV);
        s.vars(R.konik)[R.konik_stav] = 7;
      }
    } else {
      s.setXicht('little', 0);
    }
  }
  {
    if (
      s.delay('big') >= 15 &&
      s.delay('big') < 40 &&
      s.lookAt(R.velkar, R.konik) &&
      s.ydist(R.velkar, R.konik) === 0 &&
      s.xdist(R.velkar, R.konik) < 3
    ) {
      if (s.xicht('big') !== BIG_USMEV) {
        s.setXicht('big', BIG_USMEV);
        s.vars(R.konik)[R.konik_stav] = 7;
      }
    } else {
      s.setXicht('big', 0);
    }
  }

  // ---- konik (clockwork seahorse): tick/blink/neigh state machine ----
  {
    const ko = s.vars(R.konik);
    const it = s.item(R.konik);
    if (ko[R.konik_stav] !== 2 && it.dir === Dir.down) s.snd('ncp-x-ihaha', 300);
    if (it.dir === Dir.down || s.item(R.elko).dir === Dir.down) {
      ko[R.konik_stav] = 2;
    } else if (ko[R.konik_stav] === 2) {
      ko[R.konik_stav] = 0;
    }

    switch (ko[R.konik_stav]) {
      case 0: {
        let pom1 = 15;
        if (
          s.lookAt(R.malar, R.konik) &&
          Math.abs(s.xdist(R.malar, R.konik)) <= 3 &&
          Math.abs(s.ydist(R.malar, R.konik)) <= 1
        ) {
          pom1 = 0;
        }
        if (
          s.lookAt(R.velkar, R.konik) &&
          Math.abs(s.xdist(R.velkar, R.konik)) <= 3 &&
          Math.abs(s.ydist(R.velkar, R.konik)) <= 1
        ) {
          pom1 = 0;
        }
        if (s.random(100) < pom1) {
          ko[R.konik_stav] = 1;
          ko[R.konik_mrkani] = 0;
        }
        it.afaze = 0;
        break;
      }
      case 1:
      case 3:
      case 4:
      case 5:
        switch (ko[R.konik_mrkani]) {
          case 0:
          case 2:
            it.afaze = 2;
            break;
          case 1:
            it.afaze = 1;
            s.snd('ncp-x-tik', 2000);
            break;
          case 3:
            it.afaze = 0;
            ko[R.konik_mrkani] = -1;
            if (ko[R.konik_stav] === 1) ko[R.konik_stav] = 0;
            else ko[R.konik_stav]!++;
            break;
        }
        ko[R.konik_mrkani]!++;
        break;
      case 2:
        it.afaze = 3;
        break;
      case 6:
        ko[R.konik_stav] = 10;
        ko[R.konik_mrkani] = 10;
        break;
      case 7:
        ko[R.konik_mrkani] = 10;
        ko[R.konik_stav] = 8;
        break;
      case 8:
        ko[R.konik_mrkani]!--;
        if (ko[R.konik_mrkani] === 0) ko[R.konik_stav] = 3;
        break;
      case 10:
        if (ko[R.konik_mrkani]! > 0) ko[R.konik_mrkani]!--;
        else ko[R.konik_stav] = 11;
        break;
      case 11:
        it.afaze = 3;
        ko[R.konik_mrkani] = s.random(10) + 10;
        ko[R.konik_stav]!++;
        break;
      case 12:
        if (ko[R.konik_mrkani]! > 0) {
          ko[R.konik_mrkani]!--;
        } else {
          it.afaze = 0;
          ko[R.konik_stav] = 0;
        }
        break;
    }
  }
}

export const NCP: RoomScript = { name: 'NCP', init, prog };
