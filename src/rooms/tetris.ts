/**
 * TETRIS ("TETRIS", room 65) — a faithful port of TETRIS_InitProgramky /
 * TETRIS_Programky (URoom.pas:8006-8021, 19789-19848).
 *
 * A block-stacking puzzle homage. Despite the name it is a standard dialogue room: the
 * fish reminisce about the falling blocks, then (after a timer) muse about "improving"
 * the level, and finally — once the pipe (trubka) is parked at x=29 with the blocks
 * stacked high — remark on how neatly it came together.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_zacatek: 1,
  room_pocitadlo: 2,
  room_konec: 3,
  trubka: 12,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 3);
  v[R.room_zacatek] = 0;
  v[R.room_pocitadlo] = 300 + s.random(400 + s.pokus * 500);
  v[R.room_konec] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  if (!(s.noDialog() && s.alive('little') && s.alive('big'))) return;

  if (v[R.room_pocitadlo]! > 1) v[R.room_pocitadlo]!--;

  if (v[R.room_zacatek] === 0) {
    s.addm(9 + s.random(35), 'tet-m-vypadala');
    if (s.pokus < 5 || s.random(100) < 50) {
      s.addv(5, 'tet-v-ucta');
      s.addm(9, 'tet-m-usudek');
    }
    v[R.room_zacatek] = 1;
  } else if (v[R.room_pocitadlo] === 0) {
    v[R.room_pocitadlo] = -1;
    s.addv(9, 'tet-v-myslim');
    if (s.random(100) < 50) s.addm(9, 'tet-m-ano');
    s.addv(9, 'tet-v-lepsi');
    if (s.random(100) < 50) {
      s.addm(16, 'tet-m-jaklepsi');
      s.addv(6, 'tet-v-hybat');
    }
    if (s.random(100) < 70) s.addm(16, 'tet-m-predmety');
    s.addv(16, 'tet-v-uprava');
    s.addm(6, 'tet-m-program');
    if (s.random(100) < 50) s.addm(60, 'tet-m-pozor');
    s.addv(60, 'tet-v-hotovo');
  } else if (
    v[R.room_konec] === 0 &&
    s.item(R.trubka).x === 29 &&
    s.item(R.trubka).dir === Dir.no
  ) {
    v[R.room_konec] = 1;
    let pom2 = 100;
    for (let pom1 = 1; pom1 <= 10; pom1++) if (s.item(pom1).y < pom2) pom2 = s.item(pom1).y;
    if (pom2 < 17) {
      s.addv(9, 'tet-v-kostky');
      if (s.random(100) > 10 * (s.pokus - 3) || s.random(100) < 50)
        s.addm(15 + s.random(7), 'tet-m-lepe');
    }
  }
}

export const TETRIS: RoomScript = { name: 'TETRIS', init, prog };
