/**
 * POHON ("The Real Propulsion", room 58) — a faithful port of POHON_InitProgramky /
 * POHON_Programky (URoom.pas:8659-8713, 22680-22950).
 *
 * A gspec=9 "push it out" room: shove the big propulsion beast (veve = 1) off the edge
 * (Spec9(veve,5,4)). The fish discuss the project on staggered timers. Two prisoners —
 * an angry one (nasrany = 6) and a sad one (smutny = 10) — pace and pull faces; when
 * they collide (`obadva`) the fish greet them. A bubble tube (bublik = 2), a hose
 * (hadice = 3) synced to the beast + bubbler, and a spinning fin (plut1 = 18) fill the
 * room. Uses existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_oprojektu: 2,
  room_oforme: 3,
  room_ohadce: 4,
  room_obadva: 5,
  room_kteraprosba: 6,
  veve: 1,
  veve_cinnost: 1,
  veve_vydrz: 2,
  veve_kouka: 3,
  veve_makoukat: 4,
  bublik: 2,
  bublik_bublat: 1,
  hadice: 3,
  nasrany: 6,
  nasrany_hybese: 1,
  nasrany_nohy: 2,
  nasrany_kamjde: 3,
  nasrany_vyraz: 4,
  smutny: 10,
  smutny_hybese: 1,
  smutny_strana: 2,
  smutny_vyraz: 3,
  smutny_cinnost: 4,
  plut1: 18,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 6);
  s.room.gspec = 9;
  v[R.room_uvod] = 0;
  v[R.room_oprojektu] = s.random(10 * s.pokus) + 10 * s.pokus;
  v[R.room_oforme] = s.random(1500) + 300;
  v[R.room_ohadce] = s.random(3000) + 1000;
  v[R.room_obadva] = 0;
  v[R.room_kteraprosba] = 0;

  const ve = s.vars(R.veve, 4);
  ve[R.veve_cinnost] = 0;
  ve[R.veve_vydrz] = s.random(200) + 200;

  s.vars(R.bublik, 1)[R.bublik_bublat] = -s.random(30) - 10;

  const na = s.vars(R.nasrany, 4);
  na[R.nasrany_nohy] = s.random(2) * 2;
  na[R.nasrany_vyraz] = s.random(4);
  na[R.nasrany_kamjde] = na[R.nasrany_nohy]!;
  na[R.nasrany_hybese] = 0;

  const sm = s.vars(R.smutny, 4);
  sm[R.smutny_strana] = s.random(2);
  sm[R.smutny_cinnost] = 0;
  sm[R.smutny_vyraz] = s.random(4) + 1;
  sm[R.smutny_hybese] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room dialogue: edge hint + staggered project talk + prisoner greetings ----
  if (s.stdKrajniHlaska()) {
    s.addv(s.random(10) + 5, 'poh-v-ukol');
    s.stdKonecKrajniHlasky();
  }

  if (s.noDialog() && s.alive('big') && s.alive('little')) {
    if (v[R.room_oprojektu]! > 0) v[R.room_oprojektu]!--;
    if (v[R.room_oforme]! > 0) v[R.room_oforme]!--;
    if (v[R.room_ohadce]! > 0) v[R.room_ohadce]!--;

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      s.adddel(10 + s.random(14));
      let pom1 = 0;
      switch (s.pokus) {
        case 1:
          pom1 = 3;
          break;
        case 2:
          pom1 = s.random(2) + 1;
          break;
        default:
          if (s.random(100) < 30) pom1 = s.random(2) + 1;
          break;
      }
      if (pom1 % 2 === 1) s.addv(5, 'poh-v-takhle');
      if (pom1 >= 2) s.addm(5, 'poh-m-tosnadne');
      if (pom1 > 0 && s.random(100) < 100 / s.pokus) {
        s.addv(10, 'poh-v-biosila');
        if (s.pokus === 1 || s.random(100) < 20) {
          s.addm(s.random(40) + 10, 'poh-m-reaktor');
          s.addv(7, 'poh-v-automat');
          s.addm(s.random(20) + 7, 'poh-m-motor');
          s.addv(7, 'poh-v-tocit');
        }
      }
    } else if (v[R.room_oprojektu] === 0) {
      v[R.room_oprojektu] = -1;
      let pom1 = 0;
      switch (s.pokus) {
        case 1:
          pom1 = 6;
          break;
        case 2:
          pom1 = s.nah(4, 6);
          break;
        case 3:
          pom1 = s.nah(2, 6);
          break;
        case 4:
          pom1 = s.nah(1, 6);
          break;
        default:
          pom1 = s.nah(0, 6);
          break;
      }
      s.adddel(10);
      if (pom1 >= 5) s.addv(0, 'poh-v-neuveri');
      if (pom1 >= 6) s.addm(5, 'poh-m-projekt');
      if (pom1 >= 1) s.addv(10, 'poh-v-zarizeni');
      if (pom1 >= 4) s.addm(4, 'poh-m-sest');
      if (pom1 >= 2) s.addv(10, 'poh-v-klec');
      if (pom1 >= 3) s.addm(6, 'poh-m-dobre');
    } else if (v[R.room_oforme] === 0) {
      s.addv(20, 'poh-v-forma');
      s.addm(3, 'poh-m-princip');
      s.addv(s.random(30) + 10, 'poh-v-pomoct');
      v[R.room_oforme] = -1;
    } else if (
      (s.vars(R.smutny)[R.smutny_hybese] === 1 || s.vars(R.nasrany)[R.nasrany_hybese] === 1) &&
      s.aktivni() === 'little'
    ) {
      if (v[R.room_kteraprosba] === 0) v[R.room_kteraprosba] = s.random(2) + 1;
      else v[R.room_kteraprosba] = 3 - v[R.room_kteraprosba]!;
      s.addm(0, 'poh-m-dobryden' + digit(v[R.room_kteraprosba]! - 1));
      if (s.vars(R.smutny)[R.smutny_hybese] === 1) s.vars(R.smutny)[R.smutny_hybese] = 2;
      if (s.vars(R.nasrany)[R.nasrany_hybese] === 1) s.vars(R.nasrany)[R.nasrany_hybese] = 2;
    } else if (v[R.room_ohadce] === 0) {
      v[R.room_ohadce] = s.random(5000) + 2000;
      s.addset((val) => (s.vars(R.room)[R.room_obadva] = val), 1);
      s.adddel(s.random(100) + 50);
      s.addm(0, 'poh-m-pohadali');
      if (s.random(100) < 60) {
        s.addv(10, 'poh-v-setkani');
        if (s.random(100) < 60) s.addm(5, 'poh-m-sestra');
      }
      s.adddel(s.random(100) + 50);
      s.addset((val) => (s.vars(R.room)[R.room_obadva] = val), 0);
    }
  }

  // ---- veve (the beast): gspec=9 push-out + its blink/breathe FSM ----
  {
    const ve = s.vars(R.veve);
    const it = s.item(R.veve);
    s.spec9(R.veve, 5, 4);
    switch (ve[R.veve_cinnost]) {
      case 0:
        if (it.afaze >= 8 && it.afaze <= 10) it.afaze++;
        else it.afaze = 8;
        if (ve[R.veve_vydrz]! > 0) ve[R.veve_vydrz]!--;
        else {
          ve[R.veve_cinnost] = 1;
          ve[R.veve_vydrz] = 15 + s.random(20);
        }
        break;
      case 1:
        if (s.count % 2 === 1) {
          if (it.afaze === 6) it.afaze = 7;
          else it.afaze = 6;
        }
        if (ve[R.veve_vydrz]! > 0) ve[R.veve_vydrz]!--;
        else {
          ve[R.veve_cinnost] = 2;
          ve[R.veve_vydrz] = 20 + s.random(25);
        }
        break;
      case 2:
        if (s.count % 4 === 0) {
          if (it.afaze === 6) it.afaze = 7;
          else it.afaze = 6;
        }
        if (ve[R.veve_vydrz]! > 0) ve[R.veve_vydrz]!--;
        else {
          ve[R.veve_cinnost] = 3;
          ve[R.veve_vydrz] = s.random(400) + 50;
          ve[R.veve_kouka] = 0;
          ve[R.veve_makoukat] = 0;
        }
        break;
      case 3:
        if (s.random(100) < 5) ve[R.veve_makoukat] = s.random(3);
        if (ve[R.veve_kouka] !== ve[R.veve_makoukat]) {
          if (ve[R.veve_makoukat] === 0 || ve[R.veve_kouka] === 0) ve[R.veve_kouka] = ve[R.veve_makoukat]!;
          else ve[R.veve_kouka] = 0;
        }
        it.afaze = 2 * ve[R.veve_kouka]!;
        if (s.random(100) < 5) it.afaze++;
        if (ve[R.veve_vydrz]! > 0) ve[R.veve_vydrz]!--;
        else {
          ve[R.veve_cinnost] = 0;
          ve[R.veve_vydrz] = s.random(300) + 100;
        }
        break;
    }
  }

  // ---- bublik (bubble tube): bubbles on/off cycle ----
  {
    const bv = s.vars(R.bublik);
    const it = s.item(R.bublik);
    if (bv[R.bublik_bublat]! > 0) {
      const pom1 = s.random(2) + 1;
      if (pom1 === it.afaze) it.afaze = 3;
      else it.afaze = pom1;
    } else {
      it.afaze = 0;
    }
    if (bv[R.bublik_bublat]! > 0) {
      bv[R.bublik_bublat]!--;
      if (bv[R.bublik_bublat] === 0) bv[R.bublik_bublat] = -10 - s.random(30);
    } else if (bv[R.bublik_bublat]! < 0) {
      bv[R.bublik_bublat]!++;
      if (bv[R.bublik_bublat] === 0) bv[R.bublik_bublat] = 10 + s.random(30);
    }
  }

  // ---- hadice (hose): flutters when aligned with the beast + bubbler ----
  {
    const it = s.item(R.hadice);
    const ve = s.item(R.veve);
    const bu = s.item(R.bublik);
    if (
      s.count % 2 === 1 &&
      s.vars(R.veve)[R.veve_cinnost] === 0 &&
      it.x + 2 === ve.x &&
      it.y === ve.y + 1 &&
      it.x === bu.x + 1 &&
      it.y + 3 === bu.y
    ) {
      it.afaze = 1 - it.afaze;
    }
  }

  // ---- nasrany (the angry prisoner): pacing legs + expression ----
  {
    const na = s.vars(R.nasrany);
    const it = s.item(R.nasrany);
    switch (na[R.nasrany_hybese]) {
      case 0:
        if (it.dir !== Dir.no) na[R.nasrany_hybese]!++;
        break;
      case 1:
        if (it.dir === Dir.no) na[R.nasrany_hybese]!++;
        break;
    }
    if (v[R.room_obadva] === 1) {
      na[R.nasrany_vyraz] = 3;
      if (na[R.nasrany_nohy] === 1) na[R.nasrany_nohy] = na[R.nasrany_kamjde]!;
    } else {
      if (na[R.nasrany_kamjde] !== na[R.nasrany_nohy]) {
        if (na[R.nasrany_kamjde] === 1 || na[R.nasrany_nohy] === 1) na[R.nasrany_nohy] = na[R.nasrany_kamjde]!;
        else na[R.nasrany_nohy] = 1;
      } else if (s.count % 3 === 0 && s.random(100) < 9) {
        na[R.nasrany_vyraz] = s.random(4);
      }
      if (na[R.nasrany_vyraz] !== 4 && s.random(100) < 1 && na[R.nasrany_nohy]! % 2 === 0) {
        na[R.nasrany_kamjde] = 2 - na[R.nasrany_nohy]!;
      }
    }
    switch (na[R.nasrany_nohy]) {
      case 0:
        it.afaze = na[R.nasrany_vyraz]!;
        break;
      case 1:
        it.afaze = 4 + na[R.nasrany_vyraz]!;
        break;
      case 2:
        it.afaze = 7 + na[R.nasrany_vyraz]!;
        break;
    }
  }

  // ---- smutny (the sad prisoner): sways + expression ----
  {
    const sm = s.vars(R.smutny);
    const it = s.item(R.smutny);
    switch (sm[R.smutny_hybese]) {
      case 0:
        if (it.dir !== Dir.no) sm[R.smutny_hybese]!++;
        break;
      case 1:
        if (it.dir === Dir.no) sm[R.smutny_hybese]!++;
        break;
    }
    if (v[R.room_obadva] === 1) {
      sm[R.smutny_vyraz] = 4;
    } else {
      switch (sm[R.smutny_cinnost]) {
        case 0:
          if (s.random(100) < 1) sm[R.smutny_strana] = 1 - sm[R.smutny_strana]!;
          if (s.random(1000) < 5) sm[R.smutny_cinnost] = 2;
          break;
        case 1:
          if (s.random(100) < 5) sm[R.smutny_cinnost] = 0;
          if (s.count % 3 === 0) sm[R.smutny_strana] = 1 - sm[R.smutny_strana]!;
          break;
      }
      if (s.count % 3 === 0 && s.random(100) < 6) sm[R.smutny_vyraz] = s.random(4) + 1;
    }
    if (s.random(100) < 4) it.afaze = sm[R.smutny_strana]! * 5;
    else it.afaze = sm[R.smutny_strana]! * 5 + sm[R.smutny_vyraz]!;
  }

  // ---- plut1 (spinning fin) ----
  {
    const it = s.item(R.plut1);
    it.afaze = (it.afaze + 1) % 3;
  }
}

export const POHON: RoomScript = { name: 'POHON', init, prog };
