/**
 * KOSTE ("A Mess in the Boiler Room") room script — a faithful port of
 * KOSTE_InitProgramky / KOSTE_Programky (URoom.pas:6777-6790, 15829-15884).
 *
 * A light dialogue room: the fish comment on tidying up and on sweeping with the
 * broom (metla). Constants are the generated r_KOSTE_* values (URoom.pas:4126-
 * 4129); the broom is item 2, the fish are found by kind. `roompole[0]` latches a
 * broom-position state. (The `uvod` decrement is commented out in the original,
 * so `uvod` acts as a one-shot latch and the `uvod=2` branch is unreachable —
 * ported faithfully.)
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_namet: 2,
  metla: 2, // broom
} as const;

const digit = (n: number): string => String(n);

function init(s: Script): void {
  const v = s.vars(R.room, 2);
  v[R.room_uvod] = 0;
  v[R.room_namet] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const metla = s.item(R.metla);

  if (
    metla.x === 12 &&
    (metla.y === 12 || metla.y === 13 || metla.y === 14) &&
    !s.alive('big') &&
    !s.venku('little')
  ) {
    s.roompole[0] = 1;
  }

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_uvod] === 0) {
      s.addm(s.random(40) + 10, 'kos-m-uklid' + digit(s.random(3)));
      s.addv(s.random(20), 'kos-v-poradek' + digit(s.random(3)));
      v[R.room_uvod] = s.random(150) + 50;
    } else if (v[R.room_uvod] === 2) {
      v[R.room_uvod] = 1;
      let pom1: number;
      switch (s.roompole[0]) {
        case 0:
          pom1 = s.random(2);
          break;
        case 1:
          pom1 = 2;
          s.roompole[0]!++;
          break;
        default:
          pom1 = s.random(5);
      }
      if (pom1 < 3) s.addv(0, 'kos-v-koste' + digit(pom1));
    } else if (v[R.room_namet] === 0 && s.random(100) < 3 && metla.y >= 15) {
      v[R.room_namet] = 1;
      let pom1 = s.random(3);
      if (pom1 > 0) pom1++;
      s.addm(40, 'kos-m-zamet' + digit(pom1));
      if (s.random(100) < 70) s.addm(s.random(20) + 10, 'kos-m-zamet1');
    }
  }

  // broom (metla) sweeping animation, every other tick.
  if (s.count % 2 === 1) {
    switch (metla.afaze) {
      case 0:
        if (metla.dir === Dir.left || metla.dir === Dir.right) metla.afaze = 2;
        break;
      case 1:
      case 2:
        if (metla.dir === Dir.left || metla.dir === Dir.right) metla.afaze = 3 - metla.afaze;
        else metla.afaze = 0;
        break;
    }
  }
}

export const KOSTE: RoomScript = { name: 'KOSTE', init, prog };
