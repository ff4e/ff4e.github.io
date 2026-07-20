/**
 * DRAKAR1 ("Rock Band", room 13) — a faithful port of DRAKAR1_InitProgramky /
 * DRAKAR1_Programky (URoom.pas:6256-6314, 13845-14068).
 *
 * A dragon-boat stage where a four-piece band (melodak1/melodak2 keyboardists, a
 * bassist basak, a whistler piskac, fronted by a singer hlavni) plays a looping
 * 16-block arrangement. The room drives the arrangement: while a "blok" is active
 * it advances each time the lead whistle track (prior 111) finishes, and each
 * musician layers in its own music track + play animation for that block. Between
 * songs the players mutter random "brb" phrases (talk) and blink (mrk). Background
 * music 'rybky04' plays until the band starts. Item indices are the generated
 * r_DRAKAR1_* values (URoom.pas:3911-3935).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_blok: 1,
  room_startblok: 2,
  room_dohrat: 3,
  room_uvod: 4,
  melodak1: 1,
  melodak1_hrat: 1,
  melodak1_mrk: 2,
  melodak1_hlasky: 3,
  melodak1_posl: 4,
  hlavni: 2,
  basak: 3,
  basak_hrat: 1,
  basak_mrk: 2,
  basak_hlasky: 3,
  basak_posl: 4,
  piskac: 4,
  piskac_hrat: 1,
  piskac_xicht: 2,
  piskac_hlasky: 3,
  piskac_posl: 4,
  melodak2: 5,
  melodak2_hrat: 1,
  melodak2_mrk: 2,
  snecek: 11,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  v[R.room_blok] = -1;
  v[R.room_startblok] = 0;
  v[R.room_uvod] = 0;
  v[R.room_dohrat] = s.nah(300, 700);
  s.music('rybky04', -998);

  const m1 = s.vars(R.melodak1, 4);
  m1[R.melodak1_hrat] = -1;
  m1[R.melodak1_mrk] = 0;
  m1[R.melodak1_hlasky] = 0;
  m1[R.melodak1_posl] = -1;

  s.item(R.hlavni).spec = 10;

  const ba = s.vars(R.basak, 4);
  ba[R.basak_hrat] = -1;
  ba[R.basak_mrk] = 0;
  s.item(R.basak).afaze = 2;
  ba[R.basak_hlasky] = 0;
  ba[R.basak_posl] = -1;

  const pi = s.vars(R.piskac, 4);
  pi[R.piskac_hrat] = -1;
  pi[R.piskac_xicht] = 0;
  pi[R.piskac_hlasky] = 0;
  pi[R.piskac_posl] = -1;

  const m2 = s.vars(R.melodak2, 2);
  m2[R.melodak2_hrat] = -1;
  m2[R.melodak2_mrk] = 0;
  s.item(R.melodak2).spec = 10;
}

function prog(s: Script): void {
  const rv = s.vars(R.room);
  const blok = () => rv[R.room_blok]!;

  // ---- room: arrangement clock ----
  rv[R.room_startblok] = 0;
  if (rv[R.room_blok]! >= 0) {
    if (!s.playing(111)) {
      rv[R.room_blok]!++;
      if (rv[R.room_blok] === 17) rv[R.room_blok] = 1;
      rv[R.room_startblok] = 1;
    }
  }
  if (rv[R.room_blok]! > 0) s.ksnd(-998);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (rv[R.room_dohrat]! > 0) rv[R.room_dohrat]!--;

    if (rv[R.room_uvod] === 0) {
      rv[R.room_uvod] = 1;
      let pom1: number;
      if (s.pokus === 1) pom1 = 4;
      else if (s.pokus === 2 || s.pokus === 3) pom1 = s.random(5);
      else if (s.random(2) === 0) pom1 = 0;
      else pom1 = s.random(5);
      if (pom1 > 0) {
        s.addm(20, 'dr-m-tojesnad');
        if (s.random(2) === 0) s.addv(3, 'dr-v-jiste');
      }
      if (pom1 >= 2) s.addm(s.random(20) + 5, 'dr-m-musela');
      if (pom1 >= 4) s.addv(s.random(15) + 3, 'dr-v-mozna');
      else s.adddel(s.random(20) + 25);
      if (pom1 >= 3) s.addm(0, 'dr-m-hruza');
    } else if (rv[R.room_dohrat] === 0) {
      rv[R.room_dohrat] = -1;
      s.ksnd(-998);
      s.adddel(10);
      s.addset((x) => (s.item(R.melodak1).afaze = x), 3);
      s.addd(s.random(10) + 5, 'd1-1-hud' + 'ba' + digit(s.random(3)), 132);
      s.adddel(5);
      s.addset((x) => (s.vars(R.basak)[R.basak_hlasky] = x), 2);
      s.addset((x) => (s.vars(R.piskac)[R.piskac_hlasky] = x), 2);
      s.adddel(10);
      s.addset((x) => (s.vars(R.melodak1)[R.melodak1_hlasky] = x), 1);
      s.addd(30 + s.random(10), 'd1-5-nevadi' + digit(s.random(3)), 102);
      s.adddel(10);
      s.addset((x) => (rv[R.room_blok] = x), 0);
    }
  }

  // ---- melodak1 (lead keyboard) ----
  {
    const it = s.item(R.melodak1);
    const mv = s.vars(R.melodak1);
    if (mv[R.melodak1_hlasky]! > 0 && !s.playing(133)) {
      let pom1: number;
      do {
        pom1 = s.random(3);
      } while (pom1 === mv[R.melodak1_posl]);
      mv[R.melodak1_posl] = pom1;
      s.talkNow('d1-2-brb' + digit(pom1), 133);
      mv[R.melodak1_hlasky]!--;
    }
    if (rv[R.room_startblok] === 1) {
      switch (blok()) {
        case 7:
        case 8:
        case 11:
        case 12:
        case 15:
        case 16:
          mv[R.melodak1_hrat] = 0;
          break;
        default:
          mv[R.melodak1_hrat] = -1;
      }
      if (mv[R.melodak1_hrat]! > -1) {
        s.ksnd(131);
        s.music('d1-z-v' + digit(mv[R.melodak1_hrat]!), 131);
        s.setanim(
          R.melodak1,
          'a4a2a4a2a4a2a4a2a4a2d2a4a2d2a4a2d2a4a2d2a4a2d2a4a2d2' +
            'a4a2a4a2a4a2a4a2a4a2d2a4a2d2a4a2d2a4a2d2a4a2d4a4',
        );
      } else {
        s.setanim(R.melodak1, 'd?5-10a0');
      }
    }
    if (mv[R.melodak1_mrk] === 1 && it.afaze !== 0) it.afaze++;
    s.goanim(R.melodak1);
    if (s.talking(132)) {
      it.afaze = s.random(2) * 2 + 2;
    } else if (blok() < 0 && s.random(100) < 5) it.afaze = 0;
    if (s.random(100) < 5) mv[R.melodak1_mrk] = 1;
    else mv[R.melodak1_mrk] = 0;
    if (mv[R.melodak1_mrk] === 1 && it.afaze > 0) it.afaze--;
  }

  // ---- hlavni (singer): mouths while its verse (prior 102) plays ----
  {
    const it = s.item(R.hlavni);
    if (s.talking(102)) it.afaze = s.random(3);
    else it.afaze = 0;
  }

  // ---- basak (bassist) ----
  {
    const it = s.item(R.basak);
    const bv = s.vars(R.basak);
    if (bv[R.basak_hlasky]! > 0 && !s.playing(122)) {
      let pom1: number;
      do {
        pom1 = s.random(3);
      } while (pom1 === bv[R.basak_posl]);
      bv[R.basak_posl] = pom1;
      s.talkNow('d1-4-brb' + digit(pom1), 122);
      bv[R.basak_hlasky]!--;
    }
    if (rv[R.room_startblok] === 1) {
      switch (blok()) {
        case 1:
        case 2:
        case 3:
          bv[R.basak_hrat] = -1;
          break;
        case 4:
          bv[R.basak_hrat] = 1;
          break;
        case 5:
        case 6:
        case 9:
        case 10:
        case 13:
        case 14:
          bv[R.basak_hrat] = 2;
          break;
        default:
          bv[R.basak_hrat] = 3;
      }
      if (bv[R.basak_hrat]! > -1) {
        s.ksnd(121);
        s.music('d1-z-b' + digit(bv[R.basak_hrat]!), 121);
        if (bv[R.basak_hrat] === 1) s.setanim(R.basak, 'a0d3a2d3a0d19a2d3a0d3a2d3a0d19a2d3');
        else s.setanim(R.basak, 'a0d3a2d3a0d19a2d3a0d3a2d3a0d6a2a0d3a2d3a0d6a2');
      }
    }
    if (bv[R.basak_mrk] === 1) it.afaze--;
    if (s.talking(122)) {
      it.afaze = s.random(2) * 2;
    } else if (blok() < 0) it.afaze = 2;
    s.goanim(R.basak);
    if (s.random(100) < 5) bv[R.basak_mrk] = 1;
    else bv[R.basak_mrk] = 0;
    if (bv[R.basak_mrk] === 1) it.afaze++;
  }

  // ---- piskac (whistler): drives xicht face + lead-whistle track (prior 111/112) ----
  {
    const it = s.item(R.piskac);
    const pv = s.vars(R.piskac);
    if (pv[R.piskac_hlasky]! > 0 && !s.playing(112)) {
      let pom1: number;
      do {
        pom1 = s.random(3);
      } while (pom1 === pv[R.piskac_posl]);
      pv[R.piskac_posl] = pom1;
      s.talkNow('d1-3-brb' + digit(pom1), 112);
      pv[R.piskac_hlasky]!--;
    }
    if (s.talking(112)) pv[R.piskac_xicht] = s.random(2) * 2;
    else pv[R.piskac_xicht] = 0;
    if (blok() > -1) pv[R.piskac_xicht] = 6;
    if (rv[R.room_startblok] === 1) {
      switch (blok()) {
        case 1:
        case 2:
        case 5:
        case 6:
        case 9:
        case 10:
        case 13:
        case 14:
          pv[R.piskac_hrat] = 1;
          break;
        default:
          pv[R.piskac_hrat] = 2;
      }
      pv[R.piskac_xicht] = 4;
      s.ksnd(111);
      s.music('d1-z-p' + digit(pv[R.piskac_hrat]!), 111);
    }
    if (s.random(100) < 5) it.afaze = pv[R.piskac_xicht]! + 1;
    else it.afaze = pv[R.piskac_xicht]!;
  }

  // ---- melodak2 (second keyboard): only in a few blocks ----
  {
    const it = s.item(R.melodak2);
    const mv = s.vars(R.melodak2);
    if (rv[R.room_startblok] === 1) {
      switch (blok()) {
        case 9:
        case 13:
          mv[R.melodak2_hrat] = 1;
          break;
        case 10:
        case 14:
          mv[R.melodak2_hrat] = 2;
          break;
        default:
          mv[R.melodak2_hrat] = -1;
      }
      if (mv[R.melodak2_hrat]! > -1) {
        s.ksnd(131);
        s.music('d1-z-v' + digit(mv[R.melodak2_hrat]!), 131);
        if (mv[R.melodak2_hrat] === 1) s.setanim(R.melodak2, 'a2d15a3d15a2d28a0');
        else s.setanim(R.melodak2, 'a3d15a2d15a3d15a2d7');
      } else {
        it.afaze = 0;
      }
    }
    if (mv[R.melodak2_mrk] === 1 && it.afaze === 1) it.afaze--;
    s.goanim(R.melodak2);
    if (s.random(100) < 5) mv[R.melodak2_mrk] = 1;
    else mv[R.melodak2_mrk] = 0;
    if (mv[R.melodak2_mrk] === 1 && it.afaze === 0) it.afaze++;
  }

  // ---- snecek (snail): pops up while the band is playing ----
  {
    const it = s.item(R.snecek);
    if (blok() > 0) {
      if (it.afaze < 2) it.afaze++;
    }
  }
}

export const DRAKAR1: RoomScript = { name: 'DRAKAR1', init, prog };
