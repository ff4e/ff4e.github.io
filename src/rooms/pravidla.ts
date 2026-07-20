/**
 * PRAVIDLA ("Rehearsal in Cellar") room script — a faithful port of
 * PRAVIDLA_InitProgramky / PRAVIDLA_Programky (URoom.pas:7462-7524, 18101-18265).
 *
 * A dialogue-heavy puzzle room: a long else-if chain fires positional hints and
 * "you did it wrong, restart" warnings as the fish move the objects (plates,
 * rollers, a book, a candle, a soup pot). Object/var constants are the generated
 * r_PRAVIDLA_* values (URoom.pas:4366-4391). The two fish are items 1 (little)
 * and 2 (big). Uses roompole[0] as a per-room restart-latch.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_cast1: 1,
  room_ocel1: 2,
  room_osejvu: 3,
  room_cast2: 4,
  room_restartovat: 5,
  room_neuvazovat: 6,
  room_nepoustej: 7,
  room_uhnimi: 8,
  room_mamstrach: 9,
  room_oknize: 10,
  room_delayrada: 11,
  room_poslrada: 12,
  malar: 1, // little fish
  velkar: 2, // big fish
  tal: 3, // plate
  snek: 5, // snail
  val1: 6, // roller 1
  sek: 7, // (hatchet/wedge)
  jah: 8,
  med: 9,
  mer: 10,
  soup: 13, // soup pot
  knih: 14, // book
  val2: 15, // roller 2
  svic: 16, // candle
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 12);
  v[R.room_cast1] = s.pokus === 1 ? 0 : 2;
  v[R.room_ocel1] = 0;
  v[R.room_osejvu] = 0;
  v[R.room_cast2] = 0;
  v[R.room_restartovat] = 0;
  v[R.room_neuvazovat] = 0;
  v[R.room_nepoustej] = 0;
  v[R.room_uhnimi] = 0;
  v[R.room_mamstrach] = 0;
  v[R.room_oknize] = 0;
  v[R.room_delayrada] = -1;
  v[R.room_poslrada] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const it = (i: number) => s.item(i);
  const alive = s.alive('little') && s.alive('big');

  // Post-restart-latch quip (roompole[0] == 1): the fish tell you to try again.
  if (s.roompole[0] === 1 && v[R.room_restartovat] === 0 && alive && s.noDialog()) {
    s.roompole[0] = 2;
    s.addv(10, 'pra-v-schvalne');
    s.addm(5, 'pra-m-znovu');
  }

  if (s.noDialog() && alive && s.roompole[0] === 0) {
    if (v[R.room_delayrada]! > 0) v[R.room_delayrada]!--;

    if (v[R.room_cast1] === 0) {
      v[R.room_cast1] = 1;
      s.addm(s.random(20) + 10, 'pra-m-pravidla');
    } else if (
      v[R.room_cast1] === 1 &&
      it(R.velkar).y === it(R.tal).y + 1 &&
      it(R.malar).y > it(R.tal).y + 1
    ) {
      v[R.room_cast1] = 2;
      s.addv(5, 'pra-v-klesnout');
    } else if (
      v[R.room_cast1]! <= 2 &&
      it(R.snek).x === 5 &&
      it(R.tal).y === 26 &&
      it(R.velkar).y === 27
    ) {
      v[R.room_cast1] = 3;
      s.addv(5, 'pra-v-nahore');
    } else if (
      v[R.room_ocel1] === 0 &&
      it(R.val1).x === 11 &&
      it(R.malar).x === 8 &&
      s.facingRight('little')
    ) {
      v[R.room_ocel1] = 1;
      s.addm(5, 'pra-m-nepohnu');
    } else if (v[R.room_cast1]! <= 3 && it(R.velkar).x === 9 && it(R.sek).y === 24) {
      v[R.room_cast1] = 4;
      s.addm(0, 'pra-m-zpatky');
    } else if (
      v[R.room_osejvu] === 0 &&
      it(R.sek).y === 27 &&
      (it(R.malar).x > 15 || it(R.velkar).x > 15)
    ) {
      v[R.room_osejvu] = 1;
      s.addv(5, 'pra-v-problem');
      s.addm(5, 'pra-m-reseni');
    } else if (
      v[R.room_cast2] === 0 &&
      (it(R.malar).x >= 22 || it(R.velkar).x >= 21) &&
      it(R.jah).x === 22
    ) {
      v[R.room_cast2] = 1;
      s.addv(15, 'pra-v-zapeklita');
      s.addm(15 + s.random(15), 'pra-m-vyrazit');
      s.addv(5, 'pra-v-dobrynapad');
    } else if (
      v[R.room_cast2]! < 2 &&
      it(R.sek).x === 14 &&
      it(R.sek).y === 27 &&
      it(R.malar).x === 15 &&
      it(R.malar).y === 28
    ) {
      if (it(R.jah).x > 19) {
        v[R.room_cast2] = 3;
        s.addv(0, 'pra-v-vzit');
        s.addm(5, 'pra-m-prisun');
      }
    } else if (
      v[R.room_cast2]! < 2 &&
      it(R.sek).x === 14 &&
      it(R.sek).y === 27 &&
      it(R.jah).x < 22 &&
      (it(R.malar).x >= 20 || it(R.malar).y <= 28)
    ) {
      v[R.room_cast2] = 3;
      s.addm(10, 'pra-m-chytit');
      s.addv(20 + s.random(60), 'pra-v-spatne');
      v[R.room_restartovat] = 1;
    } else if (v[R.room_restartovat] === 0 && it(R.mer).x === 35 && it(R.mer).y === 30) {
      s.addv(10 + s.random(30), 'pra-v-spatne');
      v[R.room_restartovat] = 1;
    } else if (
      v[R.room_osejvu] === 1 &&
      it(R.malar).x >= 29 &&
      it(R.velkar).x >= 29 &&
      (it(R.malar).y < 19 || it(R.velkar).y < 19)
    ) {
      s.addv(s.random(40), 'pra-v-ukladani');
      v[R.room_osejvu] = 2;
    } else if (
      v[R.room_neuvazovat] === 0 &&
      it(R.malar).y === 21 &&
      it(R.malar).x >= 23 &&
      it(R.malar).x <= 28 &&
      !s.facingRight('little')
    ) {
      v[R.room_neuvazovat] = 1;
      s.addm(2, 'pra-m-uvazovat');
    } else if (
      v[R.room_nepoustej] === 0 &&
      it(R.soup).y <= 10 &&
      it(R.malar).y >= 14 &&
      it(R.malar).x >= 22
    ) {
      v[R.room_nepoustej] = 1;
      s.addm(5, 'pra-m-pustis');
    } else if (
      v[R.room_uhnimi] !== 1 &&
      it(R.soup).y === 9 &&
      it(R.malar).x >= 22 &&
      it(R.malar).x <= 24 &&
      it(R.malar).y >= 11 &&
      it(R.malar).y <= 12
    ) {
      v[R.room_uhnimi] = 1;
      s.addv(5, 'pra-v-zavazis');
    } else if (
      v[R.room_uhnimi] === 1 &&
      it(R.soup).y === 9 &&
      (it(R.malar).x > 26 || it(R.malar).y > 13)
    ) {
      v[R.room_uhnimi] = 2;
    } else if (
      v[R.room_mamstrach] === 0 &&
      v[R.room_uhnimi]! > 0 &&
      it(R.soup).y <= 10 &&
      it(R.malar).x >= 32 &&
      it(R.malar).y >= 13 &&
      it(R.malar).y <= 14
    ) {
      v[R.room_mamstrach] = 1;
      s.addm(5, 'pra-m-strach');
      s.addv(5, 'pra-v-prekvapit');
    } else if (
      v[R.room_restartovat] === 0 &&
      it(R.malar).y >= 14 &&
      it(R.malar).x >= 23 &&
      it(R.malar).x < 34 &&
      it(R.velkar).y < it(R.soup).y
    ) {
      s.addv(10 + s.random(30), 'pra-v-spatne');
      v[R.room_restartovat] = 1;
    } else if (v[R.room_oknize] === 0 && it(R.malar).y < 10) {
      v[R.room_oknize] = 1;
      s.addm(20, 'pra-m-kniha');
      s.addv(2, 'pra-v-valec');
      s.addm(10, 'pra-m-jakudelat');
      s.addv(5, 'pra-v-nezapomen');
    } else if (v[R.room_oknize] === 1 && it(R.knih).x === 26 && it(R.knih).y === 7) {
      v[R.room_oknize] = 2;
      v[R.room_delayrada] = s.random(50) + 100;
    } else if (v[R.room_delayrada] === 0 && it(R.knih).x === 26) {
      if (it(R.velkar).y <= 3 || v[R.room_poslrada] === 2) {
        s.addv(10, 'pra-v-nezapomen');
        v[R.room_poslrada] = 1;
        v[R.room_delayrada] = s.random(300) + 150;
      } else {
        s.addv(10, 'pra-v-objet');
        if (v[R.room_poslrada] === 0) s.addm(0, 'pra-m-neradit');
        v[R.room_poslrada] = 2;
        v[R.room_delayrada] = s.random(50) + 50;
      }
    } else if (
      v[R.room_restartovat] === 0 &&
      it(R.svic).x === 3 &&
      it(R.svic).y >= 21 &&
      it(R.svic).y <= 22 &&
      it(R.svic).dir === Dir.no
    ) {
      v[R.room_restartovat] = 1;
      s.roompole[0] = 1;
      s.addm(10, 'pra-m-stava');
      s.addv(0, 'pra-v-dopredu');
      s.addm(5, 'pra-m-restart');
    } else if (v[R.room_restartovat] === 0 && it(R.val2).x === 15 && it(R.val2).y === 11) {
      s.addv(10 + s.random(30), 'pra-v-spatne');
      v[R.room_restartovat] = 1;
    }
  }

  // soup pot: any push flags the "put it away" state (osejvu = 2).
  if (it(R.soup).dir !== Dir.no) v[R.room_osejvu] = 2;
}

export const PRAVIDLA: RoomScript = { name: 'PRAVIDLA', init, prog };
