/**
 * REAKTOR ("Power Plant", room 52) — a faithful port of REAKTOR_InitProgramky /
 * REAKTOR_Programky (URoom.pas:5726-5758, 12000-12165).
 *
 * The reactor hall. The fish speculate nervously about the blob (pld = 18) and the
 * reactor; a scripted worry exchange fires once (`zacni`). Thirteen control rods
 * (tyc = items 1..13) glow (a shared `count`-driven afaze) and clank into place when
 * they stop falling (`pada` bitmask → `padlo` placed-count + `rea-x-reakttyc`); once
 * enough are seated the fish gulp. The blob (pld) runs the standard ripple/sulk/idle
 * FSM (same shape as PUCLIK/BARELY). Uses existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  wall: 0,
  wall_zacni: 1,
  wall_pldpred: 2,
  wall_tyce: 3,
  tyc: 1,
  tyc_pada: 1,
  tyc_padlo: 2,
  pld: 18,
  pld_del: 1,
  pld_vlnit: 2,
  pld_ocko: 3,
  pld_faze: 4,
  pld_smer: 5,
  pld_smutny: 6,
} as const;

function init(s: Script): void {
  const w = s.vars(R.wall, 3);
  w[R.wall_pldpred] = s.random(2);
  w[R.wall_zacni] = 0;
  w[R.wall_tyce] = s.random(5) + 4;

  const t = s.vars(R.tyc, 2);
  t[R.tyc_pada] = 0;
  t[R.tyc_padlo] = 0;

  const pl = s.vars(R.pld, 6);
  pl[R.pld_vlnit] = 0;
  pl[R.pld_del] = 0;
  pl[R.pld_ocko] = 0;
  pl[R.pld_smer] = 0;
  pl[R.pld_faze] = 0;
  pl[R.pld_smutny] = 0;
}

function prog(s: Script): void {
  // ---- wall: the worry dialogue + the "rods seated" gulp ----
  {
    const w = s.vars(R.wall);
    if (
      (w[R.wall_pldpred] === 1 && w[R.wall_zacni] === 0) ||
      (w[R.wall_pldpred] === 0 && w[R.wall_zacni] === 1)
    ) {
      w[R.wall_pldpred] = -1;
      if (w[R.wall_zacni] === 0) s.addm(s.random(30) + 20, 'rea-m-proboha');
      else s.addm(s.random(100) + 50, 'rea-m-proboha');
      s.addv(14, 'rea-v-coto');
      s.addm(6, 'rea-m-nevim');
      s.addset((val) => (s.vars(R.pld)[R.pld_smutny] = val), 60);
      s.addd(3, 'rea-x-pldik', 101);
    }
    if (w[R.wall_zacni] === 0) {
      w[R.wall_zacni] = 1;
      if (w[R.wall_pldpred] === 1) s.addm(s.random(150) + 60, 'rea-m-comyslis');
      else s.addm(s.random(30) + 20, 'rea-m-comyslis');
      s.addv(6, 'rea-v-patrne');
      s.addv(s.random(130) + 30, 'rea-v-ledaze');
      s.addm(s.random(70), 'rea-m-mohl');
      s.addv(6, 'rea-v-tozni');
      s.addm(s.random(200) + 20, 'rea-m-anebo');
      s.addv(2, 'rea-v-acoby');
      s.addm(12, 'rea-m-cojavim');
      s.addv(s.random(20) + 2, 'rea-v-radeji');
      s.addm(5, 'rea-m-jakmuzes');
      s.addv(4, 'rea-v-kolik');
      s.addv(s.random(10) + 15, 'rea-v-takvidis');
    }
    if (s.alive('little') && s.alive('big')) {
      if (
        w[R.wall_zacni] === 1 &&
        s.noDialog() &&
        s.vars(R.tyc)[R.tyc_padlo]! >= w[R.wall_tyce]! &&
        s.playing(199)
      ) {
        w[R.wall_tyce] = 1000;
        s.addm(9, 'rea-m-doufam');
        s.addv(5, 'rea-v-nemudruj');
      }
    }
  }

  // ---- tyc (control rods, items 1..13): glow + clank into place on landing ----
  {
    const t = s.vars(R.tyc);
    const glow = 2 - Math.floor((s.count % 6) / 2);
    for (let i = R.tyc; i <= R.tyc + 12; i++) s.item(i).afaze = glow;

    for (let pom1 = 1; pom1 <= 13; pom1++) {
      if (s.item(pom1).dir === Dir.down) {
        t[R.tyc_pada] = t[R.tyc_pada]! | (1 << pom1);
      } else if ((t[R.tyc_pada]! & (1 << pom1)) > 0) {
        t[R.tyc_pada] = t[R.tyc_pada]! - (1 << pom1);
        s.snd('rea-x-reakttyc', 199);
        t[R.tyc_padlo]!++;
      }
    }
  }

  // ---- pld (blob): ripple / sulk / idle-blink FSM ----
  {
    const pl = s.vars(R.pld);
    const it = s.item(R.pld);
    switch (it.dir) {
      case Dir.no:
        if (pl[R.pld_vlnit] === -1) pl[R.pld_vlnit] = 8;
        break;
      case Dir.down:
        pl[R.pld_vlnit] = -1;
        break;
      default:
        pl[R.pld_vlnit] = 8;
        break;
    }

    if (pl[R.pld_vlnit]! > 0) pl[R.pld_smutny] = 0;

    if (pl[R.pld_vlnit]! > 0) {
      if (pl[R.pld_del] === 0) {
        switch (pl[R.pld_vlnit]) {
          case 8:
          case 7:
          case 6:
            pl[R.pld_del] = 1;
            break;
          case 5:
          case 4:
          case 3:
            pl[R.pld_del] = 2;
            break;
          default:
            pl[R.pld_del] = 3;
            break;
        }
        if (s.random(2) === 0) it.afaze = (it.afaze + 1) % 4;
        else it.afaze = (it.afaze + 3) % 4;
        pl[R.pld_vlnit]!--;
        if (pl[R.pld_vlnit] === 0) pl[R.pld_del] = 0;
        if (pl[R.pld_vlnit] === 0) it.afaze = 0;
        else if (pl[R.pld_vlnit] === 1) it.afaze = 3;
      } else {
        pl[R.pld_del]!--;
      }
    } else if (pl[R.pld_smutny]! > 0) {
      if (pl[R.pld_ocko] === 0) {
        if (s.random(100) < 10) pl[R.pld_ocko] = 3;
      }
      if (pl[R.pld_ocko]! > 0) pl[R.pld_ocko]!--;
      if (pl[R.pld_ocko]! > 0) it.afaze = 15;
      else it.afaze = 14;
      pl[R.pld_smutny]!--;
    } else {
      if (s.random(100) < 10) pl[R.pld_smer] = 1 - pl[R.pld_smer]!;
      switch (pl[R.pld_faze]) {
        case 0:
          it.afaze = 0;
          if (s.random(100) < 10) pl[R.pld_faze] = 1;
          break;
        case 1:
        case 4:
          pl[R.pld_faze]!++;
          it.afaze = 4;
          break;
        case 2:
        case 3:
          pl[R.pld_faze]!++;
          it.afaze = 5;
          break;
        case 5:
          it.afaze = 0;
          pl[R.pld_faze] = 0;
          break;
      }
      switch (it.afaze) {
        case 0:
          if (pl[R.pld_smer] === 1) it.afaze = 6;
          break;
        case 4:
          if (pl[R.pld_smer] === 1) it.afaze = 7;
          break;
      }
      if (pl[R.pld_ocko] === 0) {
        if (s.random(100) < 10) pl[R.pld_ocko] = 3;
      }
      if (pl[R.pld_ocko]! > 0) pl[R.pld_ocko]!--;
      if (pl[R.pld_ocko]! > 0) {
        if (it.afaze === 0) it.afaze = 9;
        else it.afaze = it.afaze + 6;
      }
    }
  }
}

export const REAKTOR: RoomScript = { name: 'REAKTOR', init, prog };
