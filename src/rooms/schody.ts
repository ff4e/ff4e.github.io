/**
 * SCHODY ("Plants on the Stairs") room script — a faithful port of
 * SCHODY_InitProgramky / SCHODY_Programky (URoom.pas:6793-6826, 15886-16006).
 *
 * Two scripted creatures animate purely from per-tick state machines: the slug
 * (plzik) reacts to being pushed (dir) and to sitting over water (FArray grid
 * query), and the snail (snecek) crawls left/right by advancing a sub-position
 * (sour) with a direction (smer). Object/var constants are the generated
 * r_SCHODY_* values (URoom.pas:4131-4140).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { ITEM_WATER } from '../core/room.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_setk: 2,
  room_prehnala: 3,
  plzik: 1, // slug
  plzik_stav: 1,
  snecek: 8, // snail
  snecek_cinnost: 1,
  snecek_smer: 2,
  snecek_sour: 3,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 3);
  switch (s.pokus) {
    case 1:
      v[R.room_uvod] = 0;
      break;
    case 2:
      v[R.room_uvod] = 1;
      break;
    default:
      v[R.room_uvod] = s.random(4);
  }
  v[R.room_setk] = 0;
  v[R.room_prehnala] = s.pokus === 1 ? 22 : 21;

  s.vars(R.plzik, 1)[R.plzik_stav] = 0;

  const sn = s.vars(R.snecek, 3);
  sn[R.snecek_cinnost] = 0;
  sn[R.snecek_sour] = s.random(6) * 3;
  sn[R.snecek_smer] = s.random(2) * 2 - 1;
  // cinnost: 0 = resting, 1 = staring, 2 = crawling, 3 = ...
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // --- room dialogue ---
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_uvod]! < 3) {
      switch (v[R.room_uvod]) {
        case 0:
          s.addm(s.random(30), 'sch-m-spadlo');
          break;
        case 1:
          s.addm(s.random(30), 'sch-m-spadlo');
          s.addv(s.random(30), 'sch-v-lastura');
          break;
        case 2:
          s.addv(s.random(30), 'sch-v-lastura');
          break;
      }
      v[R.room_uvod] = 3;
    } else if (s.item(R.plzik).x >= v[R.room_prehnala]!) {
      s.addm(s.random(40), 'sch-m-moc' + String(s.random(3)));
      v[R.room_prehnala] = 100;
    } else if (v[R.room_setk] === 0 && s.item(R.plzik).x === 10 && s.item(R.plzik).y === 14) {
      s.addv(s.random(40), 'sch-v-setkani');
      v[R.room_setk] = 1;
    }
  }

  // --- plzik (slug) ---
  {
    const it = s.item(R.plzik);
    const pv = s.vars(R.plzik);
    if (it.dir !== Dir.no) pv[R.plzik_stav] = 15;
    if (s.farray(it.x + 1, it.y + 2) === ITEM_WATER) pv[R.plzik_stav] = 10;

    switch (pv[R.plzik_stav]) {
      case 0:
        it.afaze = 0;
        if (s.random(100) < 2) pv[R.plzik_stav]!++;
        break;
      case 1:
        it.afaze = 5;
        pv[R.plzik_stav]!++;
        break;
      case 2:
        it.afaze = s.random(3) + 1;
        pv[R.plzik_stav]!++;
        break;
      case 3:
        if (s.count % 2 === 1) {
          if (s.random(100) < 20) it.afaze = s.random(3) + 1;
        }
        if (s.random(1000) < 5) pv[R.plzik_stav]!++;
        break;
      case 4:
        it.afaze = 5;
        pv[R.plzik_stav] = 0;
        break;
      case 10:
        it.afaze = 4;
        if (s.farray(it.x + 1, it.y + 2) !== ITEM_WATER) pv[R.plzik_stav] = 21 + s.random(20);
        break;
      case 15:
        it.afaze = 5;
        if (it.dir === Dir.no) pv[R.plzik_stav] = 21 + s.random(20);
        break;
      case 20:
        pv[R.plzik_stav] = 3;
        break;
      default:
        if (pv[R.plzik_stav]! >= 21 && pv[R.plzik_stav]! <= 100) pv[R.plzik_stav]!--;
    }
  }

  // --- snecek (snail) ---
  {
    const it = s.item(R.snecek);
    const nv = s.vars(R.snecek);
    switch (nv[R.snecek_cinnost]) {
      case 0:
        if (s.random(100) < 1) nv[R.snecek_cinnost] = 1;
        else if (s.random(100) < 2) nv[R.snecek_cinnost] = 2;
        break;
      case 1:
        if (s.random(100) < 3) nv[R.snecek_cinnost] = 0;
        break;
      case 2:
        if (nv[R.snecek_sour]! % 3 === 0 && s.random(100) < 30) nv[R.snecek_cinnost] = 0;
        else if (nv[R.snecek_sour]! % 3 === 0 && s.random(100) < 10) nv[R.snecek_cinnost] = 3;
        else if (
          s.random(100) < 2 ||
          (nv[R.snecek_smer] === -1 && nv[R.snecek_sour] === 0) ||
          (nv[R.snecek_smer] === 1 && nv[R.snecek_sour] === 15)
        )
          nv[R.snecek_smer] = -nv[R.snecek_smer]!;
        else if (nv[R.snecek_smer]! < 0) nv[R.snecek_sour]!--;
        else if (nv[R.snecek_smer]! > 0) nv[R.snecek_sour]!++;
        break;
      case 3:
        if (s.random(100) < 3) nv[R.snecek_cinnost] = 2;
        break;
    }

    switch (nv[R.snecek_cinnost]) {
      case 0:
      case 2:
        it.afaze = nv[R.snecek_smer]! < 0 ? 15 - nv[R.snecek_sour]! : 22 + nv[R.snecek_sour]!;
        break;
      case 1:
      case 3:
        it.afaze =
          nv[R.snecek_smer]! < 0
            ? 21 - Math.floor(nv[R.snecek_sour]! / 3)
            : 38 + Math.floor(nv[R.snecek_sour]! / 3);
        break;
    }
  }
}

export const SCHODY: RoomScript = { name: 'SCHODY', init, prog };
