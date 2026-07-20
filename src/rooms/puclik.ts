/**
 * PUCLIK ("Shredded Stickman", room 42) — a faithful port of PUCLIK_InitProgramky /
 * PUCLIK_Programky (URoom.pas:5356-5394, 10486-10652).
 *
 * The puzzle: reassemble a 4×5 grid of 20 shredded picture pieces (prvni = items
 * 1..20). When every piece sits at its correct relative offset the picture is
 * `hotovo`, and all 20 pieces play a shared reveal animation (`faze`). A blobby
 * creature (pld = "pldik", 25) ripples when pushed (`vlnit`), sulks when shoved down
 * (`smutny`), and idles with a blink (`ocko`) + drift (`smer`) FSM. The fish comment
 * on the picture, the blob, and the big fish's hauling effort (`tahy`, bumped once
 * per move via gfaze). Uses existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_tahy: 2,
  room_opldovi: 3,
  prvni: 1,
  prvni_hotovo: 1,
  prvni_faze: 2,
  pld: 25,
  pld_del: 1,
  pld_vlnit: 2,
  pld_ocko: 3,
  pld_faze: 4,
  pld_smer: 5,
  pld_smutny: 6,
  malar: 32, // little fish
  velkar: 33, // big fish
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 3);
  v[R.room_uvod] = 1;
  v[R.room_tahy] = s.random(500) + 500;
  v[R.room_opldovi] = 0;

  const pr = s.vars(R.prvni, 2);
  pr[R.prvni_hotovo] = 0;
  pr[R.prvni_faze] = 0;

  const pl = s.vars(R.pld, 6);
  pl[R.pld_vlnit] = 0;
  pl[R.pld_del] = 0;
  pl[R.pld_ocko] = 0;
  pl[R.pld_smer] = 0;
  pl[R.pld_faze] = 0;
  pl[R.pld_smutny] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room dialogue chain ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_uvod] === 1) {
      v[R.room_uvod] = 0;
      let pom1: number;
      switch (s.pokus) {
        case 1:
          pom1 = s.random(2) + 1;
          break;
        case 2:
          pom1 = s.random(2) + 1;
          break;
        default:
          pom1 = s.random(3);
          break;
      }
      s.adddel(10 + s.random(20));
      switch (pom1) {
        case 1:
          if (s.random(2) === 0) s.addm(0, 'puc-m-koukej');
          else s.addv(0, 'puc-v-podivej');
          break;
        case 2:
          s.addv(0, 'puc-v-videl');
          s.addm(10, 'puc-m-oblicej');
          break;
      }
    } else if (
      v[R.room_opldovi] === 0 &&
      s.dist(R.malar, R.pld) < 4 &&
      s.lookAt(R.malar, R.pld) &&
      s.random(100) < 1
    ) {
      v[R.room_opldovi] = 1;
      switch (s.random(3)) {
        case 0:
          s.addm(10, 'puc-m-pld0');
          break;
        case 1:
          s.addm(10, 'puc-m-pld1');
          break;
        case 2:
          s.addm(10, 'puc-m-hele');
          break;
      }
      s.addm(s.random(30) + 5, 'puc-m-slizka');
      s.addset((val) => (s.vars(R.pld)[R.pld_smutny] = val), 60 + s.random(60));
      s.addd(3, 'puc-x-pldik', 101);
    } else if (
      v[R.room_tahy] === 1 &&
      s.aktivni() === 'big' &&
      s.item(R.velkar).dir !== Dir.no
    ) {
      s.addv(10, 'puc-v-fuska' + digit(s.random(2)));
      v[R.room_tahy] = s.random(500) + 500;
    } else if (s.vars(R.prvni)[R.prvni_hotovo] === 1) {
      s.addv(5, 'puc-v-fuska2');
      s.addm(s.random(10) + 3, 'puc-m-stalo');
      s.addm(s.random(20) + 5, 'puc-m-obraz');
      s.adddel(5);
      s.addset((val) => (s.vars(R.prvni)[R.prvni_faze] = val), 1);
      s.addv(20, 'puc-v-nesmysl');
      s.vars(R.prvni)[R.prvni_hotovo] = 2;
    }
  }

  // ---- prvni (the 20-piece picture): solved-check + shared reveal animation ----
  {
    const pr = s.vars(R.prvni);
    const base = s.item(R.prvni);
    let pomb1 = true;
    for (let pom1 = 0; pom1 <= 3; pom1++) {
      for (let pom2 = 0; pom2 <= 4; pom2++) {
        const piece = s.item(R.prvni + pom1 + pom2 * 4);
        pomb1 = pomb1 && base.x + pom1 * 4 === piece.x && base.y - pom2 * 4 === piece.y;
      }
    }
    if (pr[R.prvni_hotovo] === 0 && pomb1) pr[R.prvni_hotovo]!++;
    for (let i = R.prvni; i <= R.prvni + 19; i++) s.item(i).afaze = pr[R.prvni_faze]!;
    if (pr[R.prvni_faze]! > 0 && pr[R.prvni_faze]! < 4) pr[R.prvni_faze]!++;
  }

  // ---- pld (the blob): ripple / sulk / idle-blink state machine ----
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

  // ---- malar/velkar: the big-fish haul counter (once per move, gfaze==0) ----
  for (const which of [R.malar, R.velkar]) {
    if (v[R.room_tahy]! > 1 && s.item(which).dir !== Dir.no && s.gfaze === 0) v[R.room_tahy]!--;
  }
}

export const PUCLIK: RoomScript = { name: 'PUCLIK', init, prog };
