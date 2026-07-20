/**
 * WARCR2 ("Garden of War", room 67) — a faithful port of WARCR2_InitProgramky /
 * WARCR2_Programky (URoom.pas:7022-7082, 16612-16787).
 *
 * A WarCraft-parody garden guarded by two knights and two archers. Each unit barks a
 * "ready" line when a fish first steps next to it and a "move" line when it's shoved
 * (classic RTS unit acknowledgements). The room chatters about the familiar setting,
 * the mines, and a hidden "blizzard" cheat when the big fish reaches a magic tile.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_oregistry: 2,
  room_odolech: 3,
  room_oblizardu: 4,
  knight1: 1,
  dul2: 3,
  dul1: 11,
  malar: 16,
  velkar: 17,
  knight2: 21,
  archer1: 22,
  archer2: 23,
  // shared unit var slots
  unejmala: 1,
  unejvelka: 2,
  hybese: 3,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function initUnit(s: Script, idx: number, unejvelka: number): void {
  const v = s.vars(idx, 3);
  v[R.hybese] = 0;
  v[R.unejvelka] = unejvelka;
  v[R.unejmala] = 0;
}

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  if (s.pokus === 1) v[R.room_uvod] = 3;
  else v[R.room_uvod] = s.random(3);
  v[R.room_oregistry] = s.random(5000) + 500;
  v[R.room_odolech] = 0;
  v[R.room_oblizardu] = 0;

  initUnit(s, R.knight1, 1);
  initUnit(s, R.knight2, 0);
  initUnit(s, R.archer1, 1);
  initUnit(s, R.archer2, 1);
}

/** A guard unit: barks "ready" when a fish first arrives adjacent, "move" when shoved. */
function unitProg(s: Script, idx: number, prefix: string, digits: number, prior: number): void {
  const v = s.vars(idx);
  const it = s.item(idx);
  let pom2 = 0;

  let pom1 = s.dist(R.velkar, idx) <= 1 ? 1 : 0;
  if (v[R.unejvelka] === 0 && pom1 === 1) pom2 = 1;
  v[R.unejvelka] = pom1;

  pom1 = s.dist(R.malar, idx) <= 1 ? 1 : 0;
  if (v[R.unejmala] === 0 && pom1 === 1) pom2 = 1;
  v[R.unejmala] = pom1;

  if (it.dir !== Dir.no && v[R.hybese] === 0) pom2 = 2;
  if (it.dir !== Dir.no) v[R.hybese] = 1;
  else v[R.hybese] = 0;

  switch (pom2) {
    case 1:
      s.snd(prefix + 'ready' + digit(s.random(digits)), prior);
      break;
    case 2:
      s.snd(prefix + 'move' + digit(s.random(digits)), prior);
      break;
  }
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // Hidden "blizzard" cheat: the big fish on the magic tile (47,11).
  if (
    v[R.room_oblizardu] === 0 &&
    s.alive('big') &&
    s.item(R.velkar).x === 47 &&
    s.item(R.velkar).y === 11
  ) {
    v[R.room_oblizardu] = 1;
    s.setBusy('big', 1);
    s.addv(5, 'war-v-blizzard');
    if (s.alive('little')) {
      s.setBusy('little', 1);
      s.addm(4, 'war-m-hodiny');
    }
    s.addset((val) => s.setBusy('big', val), 0);
    s.addset((val) => s.setBusy('little', val), 0);
  }

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    for (let pom1 = 1; pom1 <= 10; pom1++)
      if (v[R.room_oregistry]! > 0) v[R.room_oregistry]!--;

    if (v[R.room_uvod]! > 0) {
      switch (v[R.room_uvod]) {
        case 1:
        case 3:
          s.addm(s.random(30) + 10, 'war-m-kam');
          s.addv(s.random(30) + 10, 'war-v-povedome');
          break;
      }
      switch (v[R.room_uvod]) {
        case 2:
        case 3:
          switch (s.random(2)) {
            case 0: s.addm(s.random(30) + 20, 'war-m-hrad'); break;
            case 1: s.addm(s.random(30) + 20, 'war-m-ocel'); break;
          }
          if (s.random(100) < 50 || s.pokus === 1) {
            s.addv(s.random(200) + 10, 'war-v-vesnicane');
            s.addm(4, 'war-m-peoni');
          }
          break;
      }
      v[R.room_uvod] = 0;
    } else if (
      v[R.room_odolech] === 0 &&
      (s.item(R.dul1).dir !== Dir.no || s.item(R.dul2).dir !== Dir.no) &&
      s.random(100) < 10
    ) {
      v[R.room_odolech] = 0; // (verbatim: stays 0, so this line can re-fire)
      s.addv(s.random(30) + 10, 'war-v-doly');
      s.addm(s.random(20), 'war-m-povazuji');
    } else if (v[R.room_oregistry] === 0) {
      v[R.room_oregistry] = -1;
      s.addv(20, 'war-v-pohadka');
      s.addm(s.random(40) + 10, 'war-m-pichat');
      s.addv(2, 'war-v-prozradit');
      s.addm(4, 'war-m-aznato');
    }
  }

  unitProg(s, R.knight1, 'war-k-', 3, 501);
  unitProg(s, R.knight2, 'war-k-', 3, 502);
  unitProg(s, R.archer1, 'war-a-', 2, 401);
  unitProg(s, R.archer2, 'war-a-', 2, 402);
}

export const WARCR2: RoomScript = { name: 'WARCR2', init, prog };
