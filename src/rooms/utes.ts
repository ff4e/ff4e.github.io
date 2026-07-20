/**
 * UTES ("Under the Reef") room script — a faithful port of
 * UTES_InitProgramky / UTES_Programky (URoom.pas:8747-8790, 23070-23207).
 *
 * Object/var constants are the generated r_UTES_* values (URoom.pas:4881-4900):
 * object names map to item indices, var names to Vars^ slots.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_mzaval: 1,
  room_vzaval: 2,
  room_nezvladnu: 3,
  room_lastu: 4,
  room_matr: 5,
  room_rozhovor: 6,
  room_snm: 7,
  room_nezv: 8,
  room_uz: 9,
  room_chud: 10,
  room_vymena: 11,
  room_pomv: 12,
  matrace: 2,
  malar: 3, // small fish
  velkar: 4, // big fish
  lastura: 5, // shell
  snek1: 6, // snail
  snek2: 7,
  dvere: 8, // door
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 12);
  v[R.room_mzaval] = s.pokus < 3 ? 0 : s.random(s.pokus) < 4 ? 0 : 1;
  v[R.room_vzaval] = 0;
  v[R.room_nezvladnu] = 0;
  v[R.room_lastu] = 0;
  v[R.room_matr] = 0;
  v[R.room_rozhovor] = 500 + s.random(500 + s.pokus * 42);
  v[R.room_snm] = 0;
  v[R.room_nezv] = 0;
  v[R.room_uz] = 0;
  v[R.room_chud] = s.random(s.pokus + 1) > 3 ? 1 : 0;
  v[R.room_vymena] = 0;
  v[R.room_pomv] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const item = (i: number) => s.item(i);

  if (s.noDialog()) {
    if (s.alive('little') && s.alive('big')) {
      if (v[R.room_mzaval] === 0 && item(R.malar).x > 43 && s.facingRight('little')) {
        if (s.random(s.count) < 100) s.addm(4, 'uts-m-otresy');
        v[R.room_mzaval] = 1;
      }
      if (v[R.room_vzaval] === 0 && item(R.velkar).x > 43 && s.facingRight('big')) {
        if (s.random(3 + s.pokus) < 4) s.addv(2, 'uts-v-projet0');
        else s.addv(2, 'uts-v-projet1');
        v[R.room_vzaval] = 1;
        v[R.room_mzaval] = 1;
      }
      if (v[R.room_lastu] === 0 && item(R.velkar).x < 7 && item(R.lastura).x < 3 && item(R.lastura).y === 11) {
        v[R.room_lastu] = 1;
        s.addm(11, 'uts-m-lastura');
      }
      if (v[R.room_rozhovor]! <= s.count) {
        v[R.room_rozhovor] = v[R.room_rozhovor]! + 6666 + s.random(s.pokus * 42);
        s.addv(10, 'uts-v-koraly');
        if (s.pokus < 4 || s.random(6) > 0) s.addm(10, 'uts-m-tvorove');
        if (s.pokus === 1 || s.random(4) > 0) {
          s.addv(10, 'uts-v-mikroskop');
          s.addm(10, 'uts-m-zivocich');
          if (s.random(3) > 0) s.addm(10, 'uts-m-zelvy');
          if (s.random(3) > 0) s.addm(10, 'uts-m-batyskaf');
        }
      }
      if (
        v[R.room_snm] === 0 &&
        item(R.matrace).x === 37 &&
        ((item(R.snek1).x > 40 && item(R.snek1).y === 6) || (item(R.snek2).x > 40 && item(R.snek2).y === 6))
      ) {
        v[R.room_snm] = 1;
        s.addm(0, 'uts-m-snek');
      }
      if (v[R.room_nezv] === 0 && (item(R.snek1).y === 13 || item(R.snek2).y === 13)) {
        v[R.room_nezv] = 1;
        s.addm(2, 'uts-m-nezvedneme');
      }
      if (
        v[R.room_uz] === 0 &&
        (item(R.dvere).x > item(R.snek1).x || item(R.dvere).x > item(R.snek2).x) &&
        item(R.dvere).y === 10
      ) {
        v[R.room_uz] = 1;
        s.addv(6, 'uts-v-konecne');
        if (s.random(s.pokus + v[R.room_chud]! * 6) < 4) s.addm(7, 'uts-m-chudak');
        v[R.room_chud] = 1;
      }
      if (
        v[R.room_chud] === 0 &&
        (item(R.snek1).dir !== Dir.no || item(R.snek2).dir !== Dir.no) &&
        s.random(100) === 1
      ) {
        v[R.room_chud] = 1;
        s.addm(5, 'uts-m-chudak');
      }
      if (
        v[R.room_vymena] === 0 &&
        item(R.matrace).x > 15 &&
        item(R.matrace).x < 21 &&
        s.xdist(R.matrace, R.snek1) === 0 &&
        s.xdist(R.matrace, R.snek2) === 0
      ) {
        const pomb1 = item(R.snek1).y + 1 === item(R.snek2).y && item(R.snek2).y + 1 === item(R.matrace).y;
        const pomb2 = item(R.snek2).y + 1 === item(R.snek1).y && item(R.snek1).y + 1 === item(R.matrace).y;
        if (pomb1 || pomb2) {
          if (v[R.room_pomv] === 0) {
            v[R.room_pomv] = 1;
            v[R.room_vymena] = 20 + s.random(300 + s.pokus);
          } else {
            v[R.room_pomv] = 2;
          }
        }
      }
      if (v[R.room_pomv] === 2) {
        v[R.room_vymena] = -1;
        v[R.room_pomv] = 0;
        s.addv(5, 'uts-v-poradi');
      }
    }

    if (v[R.room_vymena]! > 0) v[R.room_vymena] = v[R.room_vymena]! - 1;
    if (v[R.room_matr] === 0 && s.alive('little') && s.dist(R.malar, R.matrace) < 2) {
      v[R.room_matr] = 1;
      s.addm(7, 'uts-m-matrace');
    }
    if (v[R.room_nezvladnu] === 0 && s.venku('little') && s.alive('big') && item(R.lastura).x === 11) {
      v[R.room_nezvladnu] = 1;
      s.addv(20, 'uts-v-sam');
    }
  }

  // lastura (shell) idle animation
  {
    const it = item(R.lastura);
    switch (it.afaze) {
      case 0:
        if (s.random(100) === 1) it.afaze = 1;
        break;
      case 1:
      case 2:
      case 3:
      case 4:
        if (s.random(10) === 1) it.afaze = s.random(5);
        break;
      case 5:
        it.afaze = 4;
        break;
      case 6:
        if (s.random(10) === 1) it.afaze = s.random(2) + 2;
        break;
    }
    switch (it.dir) {
      case Dir.up:
        it.afaze = 5;
        break;
      case Dir.down:
        it.afaze = 0;
        break;
      case Dir.left:
        it.afaze = 6;
        break;
      case Dir.right:
        it.afaze = 1;
        break;
    }
  }

  // snails
  for (const idx of [R.snek1, R.snek2]) {
    const it = item(idx);
    switch (it.afaze) {
      case 0:
        if (it.dir !== Dir.no) it.afaze = 1;
        else if (s.random(50) === 1) it.afaze = 2;
        break;
      case 1:
        if (it.dir === Dir.no && s.random(15) === 1) it.afaze = 2;
        break;
      case 2:
        switch (s.random(20)) {
          case 1:
            it.afaze = 1;
            break;
          case 2:
          case 3:
          case 4:
            it.afaze = 3;
            break;
        }
        break;
      case 3:
        if (s.random(5) === 1) it.afaze = 0;
        break;
    }
  }
}

export const UTES: RoomScript = { name: 'UTES', init, prog };
