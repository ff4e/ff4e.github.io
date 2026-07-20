/**
 * PAPRSKY ("Strange Forces", room 53) — a faithful port of PAPRSKY_InitProgramky /
 * PAPRSKY_Programky (URoom.pas:8606-8658, 22465-22679).
 *
 * A ray-gun lab. A long else-if chain of positional/timed triggers drives banter about
 * the magnet (magnetek = 3), the radio device (superpristroj = 5), the iron beams
 * (konstrukce1/2), lightning fields, the tight spot, and the ray pistol (bambitka = 4).
 * The magnet flexes an setanim burst sized by a random `kolik`, and the device (super-
 * pristroj) oscillates its dish 0..6 back and forth. Uses existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  paprskomet: 0,
  p_zacatek: 1,
  p_vyresime: 2,
  p_pristrojek: 3,
  p_nahoda: 4,
  p_zelezo: 5,
  p_nezvlada: 6,
  p_cas: 7,
  p_cas1: 8,
  p_blesky: 9,
  p_spatne: 10,
  p_husikuze: 11,
  p_bouchacka: 12,
  p_hybe: 13,
  p_malomista: 14,
  malar: 1, // little fish
  velkar: 2, // big fish
  magnetek: 3,
  magnetek_kolik: 1,
  bambitka: 4,
  superpristroj: 5,
  super_faze: 1,
  super_smer: 2,
  konstrukce1: 7,
  konstrukce2: 9,
} as const;

function init(s: Script): void {
  const v = s.vars(R.paprskomet, 14);
  v[R.p_zacatek] = 0;
  v[R.p_vyresime] = 0;
  v[R.p_pristrojek] = 0;
  v[R.p_nahoda] = 0;
  v[R.p_zelezo] = 0;
  v[R.p_nezvlada] = 0;
  v[R.p_cas] = 500 + s.random(4000);
  v[R.p_cas1] = 500 + s.random(7000);
  v[R.p_blesky] = 0;
  v[R.p_spatne] = 0;
  v[R.p_husikuze] = 0;
  v[R.p_bouchacka] = 0;
  v[R.p_hybe] = 0;
  v[R.p_malomista] = 0;

  s.vars(R.magnetek, 1)[R.magnetek_kolik] = 0;

  const su = s.vars(R.superpristroj, 2);
  su[R.super_faze] = 0;
  su[R.super_smer] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.paprskomet);

  // ---- paprskomet (room): the long banter chain ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.p_cas]! > 0) v[R.p_cas]!--;
    if (v[R.p_cas1]! > 0) v[R.p_cas1]!--;

    if (
      v[R.p_hybe] === 0 &&
      s.item(R.malar).dir !== Dir.no &&
      s.item(R.magnetek).dir !== Dir.no
    ) {
      v[R.p_hybe] = 1;
      s.addm(s.random(42) + 9, 'pap-m-zvlastni');
      s.addv(9, 'pap-v-prekvapeni');
      if (v[R.p_vyresime] === 0 && s.random(100) < 50) {
        v[R.p_vyresime] = 1;
        s.addm(5 + s.random(4), 'pap-m-teorie');
      }
    } else if (v[R.p_zacatek] === 0) {
      v[R.p_zacatek] = 1;
      s.addv(42 + 9, 'pap-v-ha');
      s.addm(5 + s.random(4), 'pap-m-magnet');
      if (s.random(100) < 35) s.addv(5 + s.random(4), 'pap-v-potrebovat');
    } else if (
      v[R.p_pristrojek] === 0 &&
      s.dist(R.superpristroj, R.malar) < 2 &&
      s.random(100) < 30
    ) {
      v[R.p_pristrojek] = 1;
      s.addm(9, 'pap-m-radio');
      v[R.p_nahoda] = s.random(3);
      if (s.pokus > 5 && s.random(100) < 40) v[R.p_nahoda] = 4;
      switch (v[R.p_nahoda]) {
        case 0:
          s.addv(5 + s.random(4), 'pap-v-radio');
          if (s.random(100) < 60) s.addm(5 + s.random(4), 'pap-m-nechme');
          s.addv(16, 'pap-v-divny');
          break;
        case 1:
          s.addv(5 + s.random(4), 'pap-v-divny');
          if (s.random(100) < 50) s.addm(5 + s.random(4), 'pap-m-nechme');
          break;
        case 2:
          s.addv(5 + s.random(4), 'pap-v-radio');
          if (v[R.p_vyresime] === 0 && s.random(100) < 50) {
            v[R.p_vyresime] = 1;
            s.addm(5 + s.random(4), 'pap-m-teorie');
          }
          break;
      }
    } else if (
      v[R.p_zelezo] === 0 &&
      (s.dist(R.konstrukce1, R.malar) < 1 || s.dist(R.konstrukce2, R.malar) < 1) &&
      s.random(100) < 10
    ) {
      v[R.p_zelezo] = 1;
      s.addm(9, 'pap-m-ocel');
      v[R.p_nahoda] = s.random(2);
      if (s.pokus > 5 && s.random(100) < 40) v[R.p_nahoda] = 2;
      switch (v[R.p_nahoda]) {
        case 0:
          s.addv(5 + s.random(4), 'pap-v-vufu');
          if (v[R.p_nezvlada] === 0 && s.random(100) < 40) {
            v[R.p_nezvlada] = 1;
            s.addm(9, 'pap-m-naucit');
            s.addm(15 + s.random(8), 'pap-m-nepohnu');
          }
          break;
        case 1:
          v[R.p_nezvlada] = 1;
          s.addm(9, 'pap-m-naucit');
          s.addm(15 + s.random(8), 'pap-m-nepohnu');
          break;
      }
    } else if (v[R.p_nezvlada] === 0 && v[R.p_cas] === 0) {
      v[R.p_nezvlada] = 1;
      s.addm(9, 'pap-m-naucit');
      s.addm(15 + s.random(8), 'pap-m-nepohnu');
    } else if (
      v[R.p_blesky] === 0 &&
      s.vars(R.magnetek)[R.magnetek_kolik] !== 0 &&
      v[R.p_cas1] === 0
    ) {
      if (s.pokus < 6 || s.random(100) < 60) {
        v[R.p_blesky] = 1;
        s.addv(9, 'pap-v-pole');
        if (s.random(100) < 70) {
          v[R.p_spatne] = 1;
          s.addm(5 + s.random(4), 'pap-m-nedobre');
        } else {
          v[R.p_husikuze] = 1;
          s.addm(5 + s.random(4), 'pap-m-mraz');
        }
      }
    } else if (
      v[R.p_malomista] === 0 &&
      s.item(R.velkar).x === 26 &&
      s.item(R.velkar).y >= 14 &&
      s.item(R.velkar).y <= 17 &&
      s.item(R.bambitka).x === s.item(R.bambitka).xStart &&
      s.item(R.bambitka).y === s.item(R.bambitka).yStart &&
      s.random(100) < 30
    ) {
      v[R.p_malomista] = 1;
      s.addv(9, 'pap-v-tesno');
    } else if (v[R.p_bouchacka] === 0 && s.dist(R.bambitka, R.malar) < 3) {
      v[R.p_bouchacka] = 1;
      if (s.pokus < 4 || s.random(100) < 30) {
        s.addm(9, 'pap-m-coje');
        v[R.p_nahoda] = s.random(5);
        switch (v[R.p_nahoda]) {
          case 0:
            s.addm(16, 'pap-m-pistole');
            s.addv(5 + s.random(4), 'pap-v-laserova');
            s.addm(12, 'pap-m-jejedno');
            s.addv(5 + s.random(4), 'pap-v-nemir');
            s.addm(5 + s.random(4), 'pap-m-nejde');
            break;
          case 1:
            s.addm(16, 'pap-m-pistole');
            break;
          case 2:
            s.addv(5 + s.random(4), 'pap-v-laserova');
            if (s.random(100) < 40) s.addm(12, 'pap-m-jejedno');
            break;
        }
      }
    }
  }

  // ---- magnetek (magnet): a random setanim flex burst sized by `kolik` ----
  {
    const mv = s.vars(R.magnetek);
    const it = s.item(R.magnetek);
    mv[R.magnetek_kolik] = 0;
    if (it.anim === '' && (it.x === 12 || it.x === 11) && s.random(100) < 10) {
      mv[R.magnetek_kolik] = s.random(11) + 1;
    }
    switch (mv[R.magnetek_kolik]) {
      case 1:
      case 2:
        s.setanim(R.magnetek, 'a1d?0-2a0S1,0');
        break;
      case 3:
      case 4:
        s.setanim(R.magnetek, 'a1d?0-2a2a1a0S1,0');
        break;
      case 5:
      case 6:
        s.setanim(R.magnetek, 'a1d?0-2a2a3a2a1a0S11,0');
        break;
      case 7:
      case 8:
        s.setanim(R.magnetek, 'a1d?0-2a2a3a4a2a1a0S1,0');
        break;
      case 9:
        s.setanim(R.magnetek, 'a1d?0-2a?1-4a?1-4a1a0S1,0');
        break;
      case 10:
        s.setanim(R.magnetek, 'a1d?0-2a?1-4a?1-4a?1-4a1a0S1,0');
        break;
      case 11:
        s.setanim(R.magnetek, 'a1d?0-2a?1-4a?1-4a?1-4a?1-4a1a0S1,0');
        break;
    }
    if (it.anim !== '') s.goanim(R.magnetek);
  }

  // ---- superpristroj (device): the dish oscillates 0..6 back and forth ----
  {
    const su = s.vars(R.superpristroj);
    const it = s.item(R.superpristroj);
    if (su[R.super_faze]! < 6 && s.random(3) === 0) su[R.super_smer] = 1 - su[R.super_smer]!;

    if (it.anim !== '') {
      s.goanim(R.superpristroj);
    } else if (su[R.super_smer] === 0 && su[R.super_faze]! < 6) {
      su[R.super_faze]!++;
      it.afaze = su[R.super_faze]!;
    } else if (su[R.super_smer] === 0 && su[R.super_faze] === 6) {
      su[R.super_faze]!--;
      su[R.super_smer] = 1 - su[R.super_smer]!;
      s.setanim(R.superpristroj, 'a6a7a8a7a6');
    } else if (su[R.super_smer] === 1 && su[R.super_faze]! > 0) {
      su[R.super_faze]!--;
      it.afaze = su[R.super_faze]!;
    } else {
      su[R.super_smer] = 1 - su[R.super_smer]!;
      su[R.super_faze]!++;
      it.afaze = su[R.super_faze]!;
    }
  }
}

export const PAPRSKY: RoomScript = { name: 'PAPRSKY', init, prog };
