/**
 * SCORE ("Special Score", room 72) — a faithful port of SCORE_InitProgramky /
 * SCORE_Programky (URoom.pas:8319-8365, 21282-21467).
 *
 * A hidden bonus level: assemble five blocks (prvnikostka + the next four items) into
 * a row and the level is solved — the fish cheer, a short countdown runs, then the room
 * ends as a win recording the move count as the score (konec / RoomVysl). A reef of
 * idle creatures decorates it: a crab (krab), an octopus (chobka), a stingray (rejnok)
 * and a sea-anemone (sasanka) with a rich sway/bloom state machine.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { MLUVI_MALA, MLUVI_VELKA } from '../core/script.js';

const R = {
  room: 0,
  room_uvod: 1,
  prvnikostka: 1,
  prvnikostka_odpocet: 1,
  krab: 7,
  chobka: 8,
  chobka_oci: 1,
  rejnok: 9,
  rejnok_oci: 1,
  rejnok_vlna: 2,
  malar: 11,
  velkar: 12,
  sasanka: 14,
  sasanka_cinnost: 1,
  sasanka_fazec: 2,
  sasanka_noha: 3,
  sasanka_kvet: 4,
  sasanka_counts: 5,
  sasanka_akcnost: 6,
} as const;

const chr = (n: number): string => String.fromCharCode(n);

function init(s: Script): void {
  s.vars(R.room, 1)[R.room_uvod] = 0;
  s.vars(R.prvnikostka, 1)[R.prvnikostka_odpocet] = 0;
  s.vars(R.chobka, 1)[R.chobka_oci] = 0;
  const rv = s.vars(R.rejnok, 2);
  rv[R.rejnok_oci] = 0;
  rv[R.rejnok_vlna] = 0;
  const sv = s.vars(R.sasanka, 6);
  sv[R.sasanka_cinnost] = 0;
  sv[R.sasanka_noha] = 0;
  sv[R.sasanka_kvet] = 1;
  sv[R.sasanka_akcnost] = 1;
}

function prog(s: Script): void {
  // ----- room: intro banter -----
  {
    const v = s.vars(R.room);
    if (s.alive('little') && s.alive('big') && v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      if (s.pokus === 1 || s.random(100) < 60) {
        switch (s.random(2)) {
          case 0: s.addv(s.random(20) + 10, 'sc-v-typicka'); break;
          case 1: s.addm(s.random(20) + 10, 'sc-m-orisek'); break;
        }
      }
      if (s.pokus === 1 || s.random(100) < 40) {
        s.addv(s.random(40) + 10, 'sc-v-pismena');
        s.addm(5, 'sc-m-napis');
      }
      s.addv(20, 'sc-v-poskladat');
      if (s.pokus === 1 || s.random(100) < 60) {
        s.addm(s.random(100) + 50, 'sc-m-tezky');
        if (s.pokus === 1 || s.random(100) < 60) {
          s.addv(5, 'sc-v-casopis');
          s.addm(1, 'sc-m-pst');
        }
      }
      s.addm(10, 'sc-m-mezery');
    }
  }

  // ----- prvnikostka: the block-row puzzle -> win -----
  {
    const it = s.item(R.prvnikostka);
    const v = s.vars(R.prvnikostka);
    let pom1 = 4;
    for (let pom2 = 1; pom2 <= 4; pom2++) {
      const b = s.item(R.prvnikostka + pom2);
      if (b.y === it.y && b.x === it.x + 4 * pom2 && b.dir === Dir.no) pom1--;
    }
    if (pom1 === 0 && v[R.prvnikostka_odpocet] === 0) {
      v[R.prvnikostka_odpocet] = 20;
      if (!s.talking(MLUVI_MALA)) s.talkNow('jo-m-' + chr(48 + s.random(4)), MLUVI_MALA);
      if (!s.talking(MLUVI_VELKA)) s.talkNow('jo-v-' + chr(48 + s.random(4)), MLUVI_VELKA);
    }
    if (v[R.prvnikostka_odpocet]! > 0) {
      v[R.prvnikostka_odpocet]!--;
      if (v[R.prvnikostka_odpocet] === 0) s.onWin?.(); // konec:=1; RoomVysl:=LengthOfRecord
    }
  }

  // ----- krab: the crab -----
  {
    const it = s.item(R.krab);
    if (it.dir === Dir.down) {
      it.afaze = it.afaze === 7 ? 9 : 7;
    } else if (it.afaze > 5) {
      it.afaze = 0;
    } else if (s.random(10) === 1) {
      it.afaze = s.random(6);
    }
  }

  // ----- chobka: the octopus (watches the little fish) -----
  {
    const it = s.item(R.chobka);
    const v = s.vars(R.chobka);
    if (it.x + 1 === s.item(R.malar).x && it.y === s.item(R.malar).y) {
      v[R.chobka_oci] = 1;
    } else {
      switch (s.random(6)) {
        case 1: v[R.chobka_oci] = 0; break;
        case 2: v[R.chobka_oci] = 2; break;
      }
    }
    it.afaze = v[R.chobka_oci]! + s.random(3) * 3;
  }

  // ----- rejnok: the stingray -----
  {
    const it = s.item(R.rejnok);
    const v = s.vars(R.rejnok);
    if (it.dir !== Dir.no) v[R.rejnok_oci] = 1;
    else if (v[R.rejnok_oci] === 1 && s.random(30) === 1) v[R.rejnok_oci] = 0;
    if (s.count % 2 === 1) {
      if (v[R.rejnok_vlna] === 5) v[R.rejnok_vlna] = 0;
      else v[R.rejnok_vlna]!++;
    }
    it.afaze = v[R.rejnok_oci]! * 6 + v[R.rejnok_vlna]!;
  }

  // ----- sasanka: the sea-anemone -----
  sasankaProg(s);
}

function sasankaProg(s: Script): void {
  const it = s.item(R.sasanka);
  const v = s.vars(R.sasanka);

  if (
    v[R.sasanka_cinnost] !== 5 &&
    (s.dist(s.littleIdx, R.sasanka) < 2 || s.dist(s.bigIdx, R.sasanka) < 2)
  ) {
    v[R.sasanka_cinnost] = 5;
    v[R.sasanka_counts] = s.random(10) + 15;
    v[R.sasanka_akcnost] = 1;
  }
  if (v[R.sasanka_cinnost] === 0) {
    v[R.sasanka_cinnost] = s.random(4) + 1;
    v[R.sasanka_fazec] = 0;
    v[R.sasanka_akcnost] = 2 + s.random(2);
  }

  if (s.count % v[R.sasanka_akcnost]! === 0) {
    switch (v[R.sasanka_cinnost]) {
      case 1:
      case 2:
        v[R.sasanka_noha] = Math.floor(v[R.sasanka_fazec]! / 4);
        if (v[R.sasanka_cinnost] === 1) {
          v[R.sasanka_kvet] = (v[R.sasanka_fazec]! % 2) + 1;
          v[R.sasanka_akcnost] = 2;
        } else {
          v[R.sasanka_kvet] = (v[R.sasanka_fazec]! % 2) * 2 + 1;
          v[R.sasanka_akcnost] = 3;
        }
        v[R.sasanka_fazec]!++;
        if (v[R.sasanka_fazec] === 8) {
          if (s.random(100) < 30) v[R.sasanka_cinnost] = 0;
          else v[R.sasanka_fazec] = 0;
        }
        break;
      case 3:
      case 4:
        switch (v[R.sasanka_fazec]) {
          case 0:
            v[R.sasanka_counts] = s.random(10) + 7;
            v[R.sasanka_fazec]!++;
            v[R.sasanka_kvet] = 1;
            break;
          case 1:
            v[R.sasanka_noha] = 1 - v[R.sasanka_noha]!;
            v[R.sasanka_counts]!--;
            if (v[R.sasanka_counts] === 0) v[R.sasanka_fazec]!++;
            break;
          case 2:
            if (v[R.sasanka_cinnost] === 3) {
              v[R.sasanka_kvet] = 0;
              v[R.sasanka_counts] = s.random(8) + 5;
            } else {
              v[R.sasanka_kvet] = 3;
              v[R.sasanka_counts] = s.random(6) + 3;
            }
            v[R.sasanka_fazec]!++;
            break;
          case 3:
            v[R.sasanka_counts]!--;
            if (v[R.sasanka_counts] === 0) {
              if (s.random(100) < 30) v[R.sasanka_cinnost] = 0;
              else v[R.sasanka_fazec] = 0;
            }
            break;
        }
        break;
      case 5:
        v[R.sasanka_akcnost] = 2;
        v[R.sasanka_counts]!--;
        switch (v[R.sasanka_counts]) {
          case 0:
            v[R.sasanka_cinnost] = 0;
            break;
          case 1:
            v[R.sasanka_kvet] = 1;
            v[R.sasanka_noha] = 1 - v[R.sasanka_noha]!;
            break;
          default:
            v[R.sasanka_kvet] = 0;
            break;
        }
        break;
    }
  }
  it.afaze = v[R.sasanka_noha]! * 4 + v[R.sasanka_kvet]!;
}

export const SCORE: RoomScript = { name: 'SCORE', init, prog };
