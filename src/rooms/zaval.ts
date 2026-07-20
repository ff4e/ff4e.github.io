/**
 * ZAVAL ("Shiny Cave-in", room 60) — a faithful port of ZAVAL_InitProgramky /
 * ZAVAL_Programky (URoom.pas:6996-7020, 16549-16610).
 *
 * A cave packed with ~109 twinkling gemstones (items 3..111), all sharing one bitmap
 * and shimmering on independent globpole timers. The room periodically nudges the fish
 * with a random remark (`uz` timer); a restart-latch (roompole[1]) counts consecutive
 * no-progress attempts and, past 4, offers the "want me to save the player?" hint.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uz: 1,
  velkar: 2,
  drahokamy: 3,
} as const;

const GEM_LAST = 111; // last gemstone item (URoom.pas hardcodes 3..111)

function init(s: Script): void {
  const v = s.vars(R.room, 1);
  if (s.pokus <= 1) s.roompole[1] = 0;
  else s.roompole[1] = s.roompole[1]! + 1;
  v[R.room_uz] = 30 + s.random(20);

  const last = Math.min(GEM_LAST, s.room.itemCount);
  const bmp = s.item(R.drahokamy).bmp;
  for (let i = R.drahokamy; i <= last; i++) {
    s.item(i).bmp = bmp;
    s.globpole[i] = -s.random(100);
    s.item(i).afaze = s.random(6) * 4;
  }
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.item(R.room).dir !== Dir.no) s.roompole[1] = 0;

  if (s.count === v[R.room_uz] && s.alive('little') && s.alive('big')) {
    if (s.roompole[1]! > 4) {
      s.roompole[1] = -1;
      s.addm(1, 'zav-m-hrac');
      s.addv(9, 'zav-v-zachranit');
      v[R.room_uz]! += 222 + s.random(1111);
    } else {
      if (s.roompole[1]! > 0) s.roompole[1] = s.roompole[1]! - 1;
      let pom1 = s.random(s.pokus + 1);
      if (pom1 > 4 || s.roompole[1] === -1) pom1 = s.random(3);
      switch (pom1) {
        case 0:
          s.addv(1, 'zav-v-sto');
          if (s.random(3) > 0) s.addv(6, 'zav-v-trpyt');
          if (s.item(R.velkar).y === s.item(R.velkar).yStart) s.addm(9, 'zav-m-pohnout');
          break;
        case 1:
          s.addm(1, 'zav-m-krasa');
          s.addv(9, 'zav-v-venku');
          break;
        case 2:
          s.addv(1, 'zav-v-zaval');
          s.addm(9, 'zav-m-hopskok');
          break;
        case 3:
          s.addm(1, 'zav-m-kameny');
          s.addv(9, 'zav-v-zeleny');
          break;
        case 4:
          s.addv(1, 'zav-v-restart');
          s.addm(8, 'zav-m-pravda');
          break;
      }
      v[R.room_uz]! += 666 + s.random(2222);
    }
  }

  // Twinkling gems: each cycles up 3 frames, down 3, then re-arms on a random delay.
  const last = Math.min(GEM_LAST, s.room.itemCount);
  for (let i = R.drahokamy; i <= last; i++) {
    s.globpole[i]!++;
    switch (s.globpole[i]) {
      case 1:
      case 2:
      case 3:
        s.item(i).afaze++;
        break;
      case 4:
      case 5:
      case 6:
        s.item(i).afaze--;
        break;
      case 7:
        s.globpole[i] = -s.random(100) - 10;
        break;
    }
  }
}

export const ZAVAL: RoomScript = { name: 'ZAVAL', init, prog };
