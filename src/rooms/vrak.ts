/**
 * VRAK ("Library Flotsam") room script — a faithful port of VRAK_InitProgramky /
 * VRAK_Programky (URoom.pas:8714-8744, 22951-23067).
 *
 * A dialogue room: the fish chatter about the wrecked library — random "which
 * books to keep / throw out" lists (a unique-random pick via a bitmask), snail
 * (sklibak) proximity remarks, and restart warnings. Constants are the generated
 * r_VRAK_* values (URoom.pas:4866-4879). Fish are items 1 (big) and 2 (little).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_oknihach: 1,
  room_vyber: 2, // bitmask accumulator for the unique-random book pick
  room_rada: 3,
  room_uvod: 4,
  room_restrt: 5,
  room_oost: 6,
  room_zavazim: 7,
  room_zavaziv: 8,
  room_vlevo: 9,
  velkar: 1, // big fish
  malar: 2, // little fish
  sklibak: 3, // snail-ish critter
  trubka: 4, // pipe
} as const;

const digit = (n: number): string => String(n); // chr(48+n) for a single digit

function init(s: Script): void {
  const v = s.vars(R.room, 9);
  v[R.room_oknihach] = s.random(1000) + 500;
  if (s.pokus > 1 && s.random(100) < 20) v[R.room_oknihach] = -1;
  v[R.room_rada] = s.random(1000) + 1000;
  v[R.room_uvod] = 0;
  v[R.room_restrt] = 0;
  v[R.room_oost] = 0;
  v[R.room_zavazim] = 0;
  v[R.room_zavaziv] = 0;
  v[R.room_vlevo] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const it = (i: number) => s.item(i);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_oknihach]! > 0) v[R.room_oknihach]!--;
    if (v[R.room_oknihach]! < -2) v[R.room_oknihach]!++;
    if (v[R.room_rada]! > 0) v[R.room_rada]!--;

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      if (s.pokus === 1 || s.random(100) < 70) s.addv(10, 'vrak-v-vraky' + digit(s.random(3)));
      if (s.pokus === 1 || s.random(100) < 70) s.addm(10, 'vrak-m-vrak' + digit(s.random(3)));
    } else if (
      v[R.room_oknihach] === 0 ||
      (v[R.room_oknihach]! > 0 && it(R.velkar).x >= 12)
    ) {
      v[R.room_oknihach] = -100;
      if (it(R.velkar).x >= 12) s.addv(3, 'vrak-v-nevejdu' + digit(s.random(2)));
      s.addm(10, 'vrak-m-kupovat' + digit(s.random(2)));
      s.addm(10, 'vrak-m-naco');
      // Pick 3..4 distinct "books to keep" lines.
      v[R.room_vyber] = 0;
      const keep = 3 + s.random(2);
      for (let k = 0; k < keep; k++) {
        let pom1: number;
        do {
          pom1 = s.random(7);
        } while ((v[R.room_vyber]! & (1 << pom1)) !== 0);
        v[R.room_vyber]! |= 1 << pom1;
        s.addm(s.random(10) + 5, 'vrak-m-knihy' + digit(pom1));
      }
      s.addv(20 + s.random(20), 'vrak-v-vyhodit');
      // Pick 2..3 distinct "books to throw out" lines.
      v[R.room_vyber] = 0;
      const toss = 2 + s.random(2);
      for (let k = 0; k < toss; k++) {
        let pom1: number;
        do {
          pom1 = s.random(5);
        } while ((v[R.room_vyber]! & (1 << pom1)) !== 0);
        v[R.room_vyber]! |= 1 << pom1;
        s.addv(s.random(10) + 5, 'vrak-v-knihy' + digit(pom1));
      }
      s.addm(0, 'vrak-m-pohadky');
    } else if (v[R.room_rada] === 0) {
      v[R.room_rada] = -1;
      const pom1 = s.random(3) + 1;
      if (pom1 % 2 === 1) s.addv(s.random(20) + 20, 'vrak-v-policky');
      if (pom1 >= 2) s.addm(s.random(20) + 20, 'vrak-m-predmety');
    } else if (v[R.room_oknihach] === -2 && it(R.velkar).x >= 12) {
      v[R.room_oknihach] = -500;
      s.addm(5, 'vrak-m-cteni' + digit(s.random(3)));
    } else if (v[R.room_oost] === 0 && s.dist(R.malar, R.sklibak) < 5 && s.random(100) < 3) {
      v[R.room_oost] = 1;
      s.addm(s.random(10) + 5, 'vrak-m-ostnatec');
    } else if (
      v[R.room_zavazim] === 0 &&
      it(R.sklibak).x === 10 &&
      it(R.sklibak).y === 31 &&
      s.dist(R.malar, R.sklibak) <= 1
    ) {
      v[R.room_oost] = 1;
      v[R.room_zavazim] = 1;
      s.addm(3, 'vrak-m-zivocich');
    } else if (
      v[R.room_zavaziv] === 0 &&
      ((it(R.sklibak).x === 8 && it(R.sklibak).y === 5) ||
        (it(R.sklibak).x === 10 && it(R.sklibak).y === 31)) &&
      s.dist(R.velkar, R.sklibak) <= 1
    ) {
      v[R.room_oost] = 1;
      v[R.room_zavaziv] = 1;
      s.addm(3, 'vrak-v-potvurka');
    } else if (
      v[R.room_vlevo] === 0 &&
      it(R.sklibak).x === 10 &&
      it(R.sklibak).y === 31 &&
      s.random(100) < 2
    ) {
      v[R.room_vlevo] = 1;
      s.addv(5, 'vrak-v-snek');
      if (it(R.trubka).x === it(R.trubka).xStart && it(R.trubka).y === it(R.trubka).yStart) {
        s.addm(3, 'vrak-m-ocel');
        s.addm(40 + s.random(40), 'vrak-m-restart');
        v[R.room_restrt] = 1;
      }
    } else if (v[R.room_restrt] === 0 && it(R.sklibak).x < 8 && it(R.sklibak).y === 5) {
      s.addm(40 + s.random(40), 'vrak-m-restart');
      v[R.room_restrt] = 1;
    } else if (v[R.room_restrt] === 0 && it(R.sklibak).x > 10 && it(R.sklibak).y === 31) {
      s.addm(40 + s.random(40), 'vrak-m-restart');
      v[R.room_restrt] = 1;
    }
  }

  // sklibak idle animation (afaze state machine, every other tick).
  {
    const sk = it(R.sklibak);
    if (s.count % 2 === 0) {
      switch (sk.afaze) {
        case 0:
        case 1:
          if (s.random(100) < 5) sk.afaze = 1 - sk.afaze;
          if (sk.dir !== Dir.no) sk.afaze = 2;
          break;
        case 2:
          if (s.random(100) < 3) sk.afaze = s.random(2);
          break;
      }
    }
  }
}

export const VRAK: RoomScript = { name: 'VRAK', init, prog };
