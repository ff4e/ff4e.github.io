/**
 * DISKETA ("Read Only", room 70) — a faithful port of DISKETA_InitProgramky /
 * DISKETA_Programky (URoom.pas:8077-8127, 20068-20283).
 *
 * A gspec=9 "push it out" room: shove the giant floppy disk (disketa, a 10x10 block)
 * off the edge. The disk is infested with two chittering viruses (vir1/vir2) and a
 * cockroach (svab) that squeaks when trodden on and, after enough shoves, earns a
 * grudging compliment. The room narrates the fish's data-recovery mission.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_zv: 2,
  room_kr: 3,
  room_obecna: 4,
  room_nepo: 5,
  disketa: 1,
  ocelkriz: 2,
  vir1: 5,
  malar: 8,
  velkar: 9,
  svab: 10,
  svab_stav: 1,
  svab_pam: 2,
  svab_pohyby: 3,
  vir2: 12,
  // shared virus var slots
  vir_stav: 1,
  vir_oci: 2,
  vir_huba: 3,
} as const;

const chr = (n: number): string => String.fromCharCode(n);

function init(s: Script): void {
  const v = s.vars(R.room, 5);
  s.room.gspec = 9;
  if (s.pokus > 7 && s.pokus % 2 === 1) v[R.room_uvod] = 1;
  else v[R.room_uvod] = 0;
  v[R.room_zv] = 0;
  v[R.room_kr] = 0;
  v[R.room_obecna] = 500 + s.random(2000);
  v[R.room_nepo] = 0;

  for (const vir of [R.vir1, R.vir2]) {
    const vv = s.vars(vir, 3);
    vv[R.vir_stav] = 1;
    vv[R.vir_oci] = 0;
    vv[R.vir_huba] = 0;
  }

  const sv = s.vars(R.svab, 3);
  sv[R.svab_stav] = 1;
  sv[R.svab_pam] = 0;
  sv[R.svab_pohyby] = 0;
}

function roomBlock(s: Script): void {
  const v = s.vars(R.room);
  let pom2 = 0;

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_uvod] === 0 && s.random(50) === 1) {
      v[R.room_uvod] = 1;
      pom2 = 1;
    } else if (v[R.room_zv] === 0 && s.dist(R.malar, R.disketa) < 3 && s.random(30) === 1) {
      v[R.room_zv] = 1;
      s.roompole[1]!++;
      if (s.roompole[1]! % 2 === 1 || s.roompole[1] === 2) pom2 = 2;
    } else if (v[R.room_kr] === 0 && s.dist(R.velkar, R.ocelkriz) < 2 && s.random(60) === 1) {
      v[R.room_kr] = 1;
      pom2 = 3;
    } else if (
      v[R.room_nepo] === 0 &&
      (s.dist(R.malar, R.svab) < 2 || s.dist(R.velkar, R.svab) < 2) &&
      s.random(20) === 1
    ) {
      v[R.room_nepo] = 1;
      pom2 = 7;
    } else if (v[R.room_nepo] === 2) {
      v[R.room_nepo] = 3;
      pom2 = 8;
    } else if (s.vars(R.svab)[R.svab_pohyby]! % 121 === 120) {
      s.vars(R.svab)[R.svab_pohyby]!++;
      pom2 = 9;
    } else if (s.stdKrajniHlaska()) {
      s.addm(13, 'disk-m-ukol');
      s.stdKonecKrajniHlasky();
    } else if (v[R.room_obecna]! > 0) {
      v[R.room_obecna]!--;
    } else {
      v[R.room_obecna] = 1500 + s.random(s.count);
      pom2 = s.random(3) + 4;
    }
  }

  const svabStav = (val: number): void => {
    s.vars(R.svab)[R.svab_stav] = val;
  };
  switch (pom2) {
    case 1:
      s.addv(10, 'disk-v-tady');
      s.addm(8, 'disk-m-tady');
      s.addm(6, 'disk-m-vejit');
      s.addv(8, 'disk-v-metrova');
      s.addm(6, 'disk-m-velka');
      if (s.random(s.pokus + 1) < 2) s.addm(20, 'disk-m-ukol');
      break;
    case 2:
      s.addm(10, 'disk-m-zvednem');
      s.addv(7, 'disk-v-tezko');
      if (s.random(4) > 0) s.addv(8, 'disk-v-nejde');
      break;
    case 3:
      s.addv(10, 'disk-v-kriz');
      s.addm(7, 'disk-m-depres');
      break;
    case 4:
      s.addm(10, 'disk-m-nahrat');
      s.addv(7, 'disk-v-mas');
      s.addm(10, 'disk-m-sakra');
      s.addv(7, 'disk-v-vratime');
      s.addv(10, 'disk-v-naano');
      break;
    case 5:
      s.addm(10, 'disk-m-zmatlo');
      s.addv(7, 'disk-v-neverim');
      break;
    case 6:
      s.addm(10, 'disk-m-tvorecci');
      s.addv(8, 'disk-v-viry');
      s.addm(9, 'disk-m-potvory');
      s.addv(8, 'disk-v-pozor');
      break;
    case 7:
      s.addd(10, 'disk-x-nepohnes', 120, svabStav);
      break;
    case 8:
      if (s.random(4) > 0) s.addd(3, 'disk-x-jejda' + chr(48 + s.random(2)), 120, svabStav);
      if (s.random(4) > 0) s.addd(6, 'disk-x-mazany', 120, svabStav);
      break;
    case 9:
      s.addd(3, 'disk-x-uzne', 120, svabStav);
      if (s.random(3) > 0) s.addv(7, 'disk-v-ulamu');
      break;
  }
}

/** A virus: sleeps (1), watches (0, occasionally chittering), or talks (mouth anim). */
function virProg(s: Script, idx: number): void {
  const v = s.vars(idx);
  const it = s.item(idx);
  const setStav = (val: number): void => {
    v[R.vir_stav] = val;
  };
  switch (v[R.vir_stav]) {
    case 0: // kouka (watching)
      if (s.noDialog() && s.random(600) === 1) {
        const pom1 = 48 + s.random(3);
        const pom2 = 48 + s.random(3);
        s.addset(setStav, 110);
        s.addd(2, 'disk-x-vir' + chr(pom1), 110);
        if (pom1 !== pom2) s.addd(4, 'disk-x-vir' + chr(pom2), 110);
        s.adddel(2);
        s.addset(setStav, 0);
      } else if (s.random(4) === 1) {
        v[R.vir_oci] = s.random(3);
      }
      break;
    case 1: // spi (sleeping)
      if (it.dir !== Dir.no && s.count > 10) v[R.vir_stav] = 0;
      break;
    default: // mluvi (talking)
      if (s.random(4) === 1) v[R.vir_oci] = s.random(3);
      if (v[R.vir_huba] === 0) v[R.vir_huba] = 2;
      else if (s.random(3) === 1) v[R.vir_huba] = 3 - v[R.vir_huba]!;
      break;
  }
  if (v[R.vir_stav]! < 2) v[R.vir_huba] = 0;
  it.afaze = v[R.vir_huba]! * 3 + v[R.vir_oci]!;
}

function prog(s: Script): void {
  roomBlock(s);

  // disketa: the gspec=9 push-out target (a 10x10 block).
  s.spec9(R.disketa, 10, 10);

  virProg(s, R.vir1);

  // svab: the cockroach — watches/sleeps/talks + squeaks when stepped on.
  {
    const v = s.vars(R.svab);
    const it = s.item(R.svab);
    switch (v[R.svab_stav]) {
      case 0: // kouka
        if (s.random(100) === 1) {
          v[R.svab_stav] = 1;
          it.afaze = 3;
        } else if (it.afaze === 3) {
          it.afaze = s.random(2) === 1 ? 3 : 2;
        } else {
          it.afaze = s.random(7) === 1 ? 3 : 2;
        }
        break;
      case 1: // spi
        if (s.random(1000) === 1) v[R.svab_stav] = 0;
        else it.afaze = 0;
        break;
      default: // mluvi
        if (it.afaze === 2) it.afaze = s.random(3) === 1 ? 1 : 2;
        else it.afaze = s.random(3) === 1 ? 2 : 1;
        break;
    }

    if (s.count > 20) {
      if (it.dir !== Dir.no) {
        if (s.vars(R.room)[R.room_nepo]! < 2) s.vars(R.room)[R.room_nepo] = 2;
        v[R.svab_pohyby]!++;
      }
      if (it.dir === Dir.down) v[R.svab_pam] = 1;
      else if (v[R.svab_pam] === 1) {
        v[R.svab_pam] = 0;
        if (s.noDialog())
          s.addd(0, 'disk-x-au' + chr(48 + s.random(3)), 120, (val) => (v[R.svab_stav] = val));
      }
    }
  }

  virProg(s, R.vir2);
}

export const DISKETA: RoomScript = { name: 'DISKETA', init, prog };
