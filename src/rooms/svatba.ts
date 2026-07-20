/**
 * SVATBA ("Underwater Wedding", room 16) — a faithful port of SVATBA_InitProgramky
 * / SVATBA_Programky (URoom.pas:7715-..., 18854-18914).
 *
 * A dialogue room: an intro (varies by attempt), a timed "tank" remark, and two
 * proximity-triggered comments — the little fish near the munitions (mun1/2/3) and
 * the big fish near the ladder (zebr). Lifting the ladder off its start also arms
 * the ladder flag. Item indices are the generated r_SVATBA_* values
 * (URoom.pas:4465-4475).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_otanku: 2,
  room_omunici: 3,
  room_ozebriku: 4,
  malar: 1,
  velkar: 2,
  zebr: 10,
  mun3: 12,
  mun2: 18,
  mun1: 19,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  if (s.pokus === 1 || s.pokus === 2) v[R.room_uvod] = s.pokus;
  else v[R.room_uvod] = s.random(s.pokus);
  v[R.room_omunici] = 0;
  v[R.room_ozebriku] = s.random(3);
  v[R.room_otanku] = s.random(1000 * s.pokus) + 1000;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_otanku]! > 0) v[R.room_otanku]!--;

    if (v[R.room_uvod]! > 0) {
      switch (v[R.room_uvod]) {
        case 1:
          if (s.pokus === 1 || s.random(100) < 30) s.addm(10, 'sv-m-pomohli');
          s.addv(5 + s.random(10), 'sv-v-bezsneku');
          s.addm(5, 'sv-m-utecha');
          break;
        case 2:
          s.addv(30 + s.random(70), 'sv-v-chtel');
          s.addm(5, 'sv-m-doscasu');
          break;
      }
      v[R.room_uvod] = 0;
    } else if (v[R.room_otanku] === 0) {
      v[R.room_otanku] = -1;
      s.addm(30, 'sv-m-tank');
      s.addv(5, 'sv-v-obojzivelny');
      s.addm(5, 'sv-m-kecy');
      s.addv(0, 'sv-v-proc');
      s.addv(s.random(40) + 20, 'sv-v-potopena');
      s.addm(5, 'sv-m-pravdepodob');
    } else if (
      v[R.room_omunici] === 0 &&
      s.random(100) < 10 &&
      (s.dist(R.malar, R.mun1) <= 1 ||
        s.dist(R.malar, R.mun2) <= 1 ||
        s.dist(R.malar, R.mun3) <= 1)
    ) {
      v[R.room_omunici] = 1;
      s.addm(s.random(20), 'sv-m-munice');
      s.addv(5, 'sv-v-nevim');
    } else if (
      v[R.room_ozebriku] === 0 &&
      s.dist(R.velkar, R.zebr) <= 2 &&
      s.random(100) < 10
    ) {
      v[R.room_ozebriku] = 1;
      s.addv(10, 'sv-v-zebrik');
      s.addm(6, 'sv-m-ven');
      s.addv(4, 'sv-v-ucpat');
    }
  }

  // Lifting the ladder off its authored position arms the ladder flag.
  const zebr = s.item(R.zebr);
  if (zebr.y < zebr.yStart) v[R.room_ozebriku] = 1;
}

export const SVATBA: RoomScript = { name: 'SVATBA', init, prog };
