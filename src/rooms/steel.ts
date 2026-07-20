/**
 * STEEL ("Nothing but steel", room 55) — a faithful port of STEEL_InitProgramky /
 * STEEL_Programky (URoom.pas:5190-5205, 9955-10002).
 *
 * A steel press hall. Silent until the roller (valec = 1) is shoved left, which starts
 * a droning hum (`steel-x-ticho`) and a red-alert klaxon cycle (`houk`): every 10 ticks
 * a "redalert" blares at full volume and the whole room's machinery flashes to an alert
 * frame (`bgfaze` applied to every item afaze, except the fish). Adds the `sndvol`
 * primitive; `bgfaze` is kept in a room var.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const MAX_VOLUME = 64;

const R = {
  main: 0,
  main_houk: 1,
  main_citac: 2,
  main_bgfaze: 3,
  valec: 1,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.main, 3);
  v[R.main_houk] = -1;
  v[R.main_citac] = s.random(40) + 40;
  v[R.main_bgfaze] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.main);
  let pom1 = 0;
  if (v[R.main_citac]! > 0) v[R.main_citac]!--;

  if (v[R.main_houk] === -1) {
    if (s.item(R.valec).dir === Dir.left) {
      s.sndcyc('steel-x-ticho', -2);
      s.sndcyc('steel-x-ticho', -2);
      v[R.main_houk]!++;
    } else if (v[R.main_citac] === 0 && s.alive('little')) {
      s.addm(0, 'steel-m-' + digit(s.random(2)));
      v[R.main_citac] = -1;
    }
  } else {
    switch (v[R.main_houk]! % 10) {
      case 2:
        s.sndvol('steel-x-redalert', -1, MAX_VOLUME);
        v[R.main_bgfaze] = 1;
        pom1 = 1;
        break;
      case 4:
        s.sndvol('steel-x-redalert', -1, MAX_VOLUME);
        break;
      case 9:
        v[R.main_bgfaze] = 2;
        pom1 = 1;
        break;
    }
    v[R.main_houk]!++;
  }

  if (pom1 === 1) {
    for (let i = 0; i <= s.room.itemCount - 2; i++) s.item(i).afaze = v[R.main_bgfaze]!;
  }
}

export const STEEL: RoomScript = { name: 'STEEL', init, prog };
