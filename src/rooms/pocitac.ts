/**
 * POCITAC ("The Deep Server", room 38) — a faithful port of POCITAC_InitProgramky
 * / POCITAC_Programky (URoom.pas:7828-7860, 19061-19144).
 *
 * A dialogue-only server room. The fish banter about climbing in, "finding" things
 * on the monitor (`onachazeni`), two long computer-musing timers (`opocitaci1/2`)
 * that alternate a scripted exchange via roompole[0], a corkscrew gag (`ovyvrtce`,
 * positional on velkar over the drill vrtidlo=6), and a junk remark when the monitor
 * or PC is lifted. No creatures.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_onachazeni: 2,
  room_opocitaci1: 3,
  room_opocitaci2: 4,
  room_okramu: 5,
  room_ovyvrtce: 6,
  monitoor: 1,
  pociitac: 2,
  vrtidlo: 6,
  malar: 7, // little fish
  velkar: 8, // big fish
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 6);
  v[R.room_uvod] = 0;
  v[R.room_opocitaci1] = s.random(300) + 100;
  v[R.room_opocitaci2] = s.random(2000) + 1500;
  v[R.room_onachazeni] = 0;
  v[R.room_okramu] = 0;
  v[R.room_ovyvrtce] = 1;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  if (!(s.noDialog() && s.alive('little') && s.alive('big'))) return;

  if (v[R.room_opocitaci1]! > 0) v[R.room_opocitaci1]!--;
  if (v[R.room_opocitaci2]! > 0) v[R.room_opocitaci2]!--;

  if (v[R.room_uvod] === 0) {
    v[R.room_uvod] = 1;
    if (s.random(100) < Math.floor(200 / s.pokus)) {
      s.addm(s.random(10) + 5, 'poc-m-lezt' + digit(s.random(3)));
      s.addv(s.random(10), 'poc-v-kam' + digit(s.random(4)));
    }
  } else if (
    v[R.room_onachazeni] === 0 &&
    s.dist(R.velkar, R.monitoor) <= 1 &&
    s.lookAt(R.velkar, R.monitoor) &&
    s.random(100) < 7
  ) {
    v[R.room_onachazeni] = 1;
    if (s.random(100) < 60) s.addv(5, 'poc-v-nenajde');
  } else if (v[R.room_opocitaci1] === 0 || v[R.room_opocitaci2] === 0) {
    if (v[R.room_opocitaci1] === 0) v[R.room_opocitaci1] = s.random(5000) + 5000;
    else v[R.room_opocitaci2] = s.random(5000) + 5000;

    if (s.roompole[0] === 0) s.roompole[0] = s.random(2) + 1;
    else s.roompole[0] = 3 - s.roompole[0]!;

    switch (s.roompole[0]) {
      case 1:
        s.addm(30, 'poc-m-myslis');
        s.addv(4, 'poc-v-multimed');
        s.addv(s.random(20) + 5, 'poc-v-vyresil');
        s.addm(s.random(10) + 5, 'poc-m-kcemu');
        s.addv(0, 'poc-v-pssst');
        break;
      case 2:
        s.addv(30, 'poc-v-napad');
        s.addm(5 + s.random(20), 'poc-m-mohlby');
        s.addv(2, 'poc-v-stahni');
        s.addm(s.random(10) + 4, 'poc-m-ukryta');
        switch (s.random(3)) {
          case 0:
            s.addv(s.random(200) + 20, 'poc-v-dira');
            s.addm(5, 'poc-m-mechanika');
            s.addm(s.random(30) + 5, 'poc-m-zezadu');
            break;
          case 1:
            s.addm(s.random(60) + 20, 'poc-m-zezadu');
            break;
          case 2:
            s.addm(s.random(30) + 5, 'poc-m-zezadu');
            s.addv(s.random(50) + 20, 'poc-v-dira');
            s.addm(5, 'poc-m-mechanika');
            break;
        }
        v[R.room_ovyvrtce] = 0;
        break;
    }
  } else if (
    v[R.room_ovyvrtce] === 0 &&
    s.item(R.velkar).y === s.item(R.vrtidlo).y + 2 &&
    s.dist(R.velkar, R.vrtidlo) === 0 &&
    s.dist(R.malar, R.vrtidlo) > 2 &&
    s.random(100) < 2
  ) {
    v[R.room_ovyvrtce] = 1;
    s.addm(4, 'poc-m-vyvrtka');
  } else if (
    v[R.room_okramu] === 0 &&
    (s.item(R.monitoor).dir === Dir.up || s.item(R.pociitac).dir === Dir.up) &&
    s.random(100) < 8
  ) {
    v[R.room_okramu] = 1;
    s.addm(10, 'poc-m-kram');
    s.addv(5, 'poc-v-mono');
  }
}

export const POCITAC: RoomScript = { name: 'POCITAC', init, prog };
