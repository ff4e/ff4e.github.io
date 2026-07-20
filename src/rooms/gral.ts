/**
 * GRAL ("What Would King Arthur Say?", room 64) — a faithful port of GRAL_InitProgramky /
 * GRAL_Programky (URoom.pas:8130-8168, 20285-20399).
 *
 * A gspec=9 "push it out" grail room: several identical 4-cell chalices (list.num=4)
 * must all be shoved off the edge. A holy aura hovers in the hall; whichever chalice
 * sits directly beneath it glows (its light bitmap, roompole[2]) — that is the true
 * grail — while the rest show their dark bitmap (roompole[3]). The fish philosophise
 * about whether to save only the holy one or all of them (uvod/pokr/tusili chatter).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_uztovedi: 1,
  room_uvod: 2,
  room_pokr: 3,
  room_jestejeden: 4,
  room_uztobude: 5,
  room_tusili: 6,
  light: 1,
  aura: 2,
  dark: 7,
} as const;

const digit = (n: number): string => String.fromCharCode(n);

function init(s: Script): void {
  const v = s.vars(R.room, 6);
  s.room.gspec = 9;
  let vytlacit = 0;
  for (let pom1 = 1; pom1 <= s.room.itemCount; pom1++)
    if (s.item(pom1).fields.length === 4) vytlacit++;
  s.room.vytlacit = vytlacit;

  if (s.roompole[1] === 0) {
    s.roompole[2] = s.item(R.light).bmp;
    s.roompole[3] = s.item(R.dark).bmp;
    s.roompole[1] = 1;
  }

  v[R.room_uztovedi] = 0;
  v[R.room_jestejeden] = 0;
  v[R.room_uztobude] = 0;
  v[R.room_tusili] = 0;
  if (s.pokus > 7) {
    if (s.pokus % 2 === 1) {
      v[R.room_uvod] = -1;
      v[R.room_pokr] = 20 + s.random(20);
    } else {
      v[R.room_uvod] = 20 + s.random(25);
      v[R.room_pokr] = -1;
    }
  } else {
    v[R.room_uvod] = 15 + s.random(20);
    v[R.room_pokr] = 20 + s.random(50);
  }
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // Each chalice: push-out check + light/dark bitmap based on the aura's position.
  const aura = s.item(R.aura);
  for (let pom1 = 1; pom1 <= s.room.itemCount; pom1++) {
    const it = s.item(pom1);
    if (it.fields.length !== 4) continue;
    s.spec9(pom1, 2, 2);
    if (it.x === aura.x && it.y === aura.y + 1) {
      it.bmp = s.roompole[2]!;
      if (v[R.room_uztovedi]! < 3 && pom1 !== 1) v[R.room_uztovedi] = 3;
    } else {
      it.bmp = s.roompole[3]!;
    }
  }

  let pom2 = 0;
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_uvod]! > 0) {
      v[R.room_uvod]!--;
    } else if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = -1;
      pom2 = 1;
    } else if (v[R.room_pokr]! > 0) {
      v[R.room_pokr]!--;
    } else if (v[R.room_pokr] === 0) {
      v[R.room_pokr] = -1;
      pom2 = 3;
    } else if (s.stdKrajniHlaska()) {
      if (v[R.room_uztovedi]! > 2) {
        s.addm(8, 'gr-m-vsechny1'); // "our task is to carry them all out..."
      } else {
        s.addm(10, 'gr-m-svaty1'); // "we carry the holy one, or all of them"
        s.addv(6, 'gr-v-vsechny1');
        if (s.pokus < 2 || s.random(100) < 70) s.addm(8, 'gr-m-jensvaty');
      }
      s.stdKonecKrajniHlasky();
    } else if (v[R.room_tusili] === 0 && v[R.room_uztovedi]! < 2 && s.random(1000) === 1) {
      v[R.room_tusili] = 1;
      pom2 = 2;
    } else if (v[R.room_uztovedi] === 3 && s.random(30) === 1) {
      v[R.room_uztovedi] = 4;
      pom2 = 5;
    } else if (v[R.room_jestejeden] === 0 && s.room.vytlacit === 1 && s.random(30) === 1) {
      v[R.room_jestejeden] = 1;
      pom2 = 7;
    } else if (
      v[R.room_uztobude] === 0 &&
      [1, 2, 3].includes(s.room.vytlacit) &&
      s.random(150) === 1
    ) {
      v[R.room_uztobude] = 1;
      pom2 = 6;
    }
  }

  switch (pom2) {
    case 1: {
      s.addm(10, 'gr-m-gral');
      s.addv(8, 'gr-v-jiste');
      const pom1 = 48 + s.random(2);
      s.addm(8, 'gr-m-zare' + digit(pom1));
      s.addv(8, 'gr-v-nic' + digit(pom1));
      break;
    }
    case 2:
      s.addv(10, 'gr-v-tuseni');
      s.addv(10, 'gr-m-tuseni'); // verbatim: an m-named line spoken via addv (URoom.pas:20370)
      break;
    case 3:
      s.addm(10, 'gr-m-svaty0');
      s.addv(8, 'gr-v-vsechny0');
      break;
    case 5:
      s.addm(8, 'gr-m-vsechny0');
      break;
    case 6:
      s.addv(10, 'gr-v-skoro0');
      break;
    case 7:
      s.addv(10, 'gr-v-skoro1');
      break;
  }

  // light: once its bitmap changes from the cached light bmp, the fish "know" (uztovedi).
  if (v[R.room_uztovedi] === 0 && s.item(R.light).bmp !== s.roompole[2]) v[R.room_uztovedi] = 1;

  // aura: the holy glow's animation cycle.
  {
    const it = s.item(R.aura);
    if (it.afaze >= 11) it.afaze = 0;
    else it.afaze++;
  }
}

export const GRAL: RoomScript = { name: 'GRAL', init, prog };
