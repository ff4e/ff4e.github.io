/**
 * UFO ("Independence Day", room 22) — a faithful port of UFO_InitProgramky /
 * UFO_Programky (URoom.pas:8023-8043, 19850-19912).
 *
 * A short, dialogue-only room: two aliens (the fish) banter about their downed
 * saucer. The intro (`uvod`, varied by attempt) fires once, then two one-off
 * remarks (`hlaska1`/`hlaska2`) are scheduled — the first once the long wreck
 * piece (`dlouha`, item 15) has been pushed down past Y>9, the second after a
 * long random `hlaskacount` cooldown. The remark payload (case pom1) speaks a
 * canned exchange, briefly flagging the little fish busy (addset busy) so it turns
 * to talk. No fish item-index references — everything keys off role.
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_hlaska1: 2,
  room_hlaska2: 3,
  room_hlaskacount: 4,
  dlouha: 15,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  switch (s.pokus) {
    case 1:
      v[R.room_uvod] = 1;
      break;
    case 2:
      v[R.room_uvod] = 2;
      break;
    default:
      v[R.room_uvod] = s.random(4);
      break;
  }
  v[R.room_hlaska1] = s.random(2) + 1;
  v[R.room_hlaska2] = 3 - v[R.room_hlaska1]!;
  v[R.room_hlaskacount] = -1;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_hlaskacount]! > 0) v[R.room_hlaskacount]!--;
    let pom1 = 0;

    if (v[R.room_uvod]! > 0) {
      if (v[R.room_uvod]! % 2 === 1) {
        s.addv(20 + s.random(20), 'ufo-v-znicilo');
        s.addm(s.random(10) + 2, 'ufo-m-osmy');
      }
      if (v[R.room_uvod]! >= 2) {
        s.adddel(s.random(300) + 40);
        if (s.random(2) === 0) s.addm(0, 'ufo-m-valce');
        else s.addm(0, 'ufo-m-moc');
        s.addv(10, 'ufo-v-hur');
        s.addm(1, 'ufo-m-ne');
        s.addv(3, 'ufo-v-vpredu');
      }
      v[R.room_uvod] = 0;
    } else if (v[R.room_hlaska1]! > 0 && s.item(R.dlouha).y > 9) {
      pom1 = v[R.room_hlaska1]!;
      s.adddel(s.random(200) + 50);
      v[R.room_hlaska1] = 0;
      v[R.room_hlaskacount] = 1000 + s.random(2000);
    } else if (v[R.room_hlaskacount] === 0) {
      pom1 = v[R.room_hlaska2]!;
      s.adddel(20);
      v[R.room_hlaska2] = 0;
      v[R.room_hlaskacount] = -1;
    }

    switch (pom1) {
      case 1:
        s.addm(0, 'ufo-m-zvlastni');
        s.addv(5 + s.random(15), 'ufo-v-rikam');
        s.addset((val) => s.setBusy('little', val), 1);
        s.addm(10, 'ufo-m-vidim');
        s.addset((val) => s.setBusy('little', val), 0);
        break;
      case 2:
        s.addv(0, 'ufo-v-dovnitr');
        s.addm(5 + s.random(10), 'ufo-m-tajemstvi');
        s.addv(10 + s.random(90), 'ufo-v-zjistit' + digit(s.random(2)));
        if (s.random(2) === 0) s.addm(5, 'ufo-m-tady');
        else s.addm(5, 'ufo-m-nevim');
        break;
    }
  }
}

export const UFO: RoomScript = { name: 'UFO', init, prog };
