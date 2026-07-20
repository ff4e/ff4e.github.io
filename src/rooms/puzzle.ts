/**
 * PUZZLE ("A Hardware Problem", room 69) — a faithful port of PUZZLE_InitProgramky /
 * PUZZLE_Programky (URoom.pas:5470-5507, 10948-11024).
 *
 * A circuit-board puzzle. When the "computer" speaks (`pz-x-pocitac`, tracked by the
 * `mluveni` prom), the background water violently jitters (wamp/wper spike) as a glitch
 * effect, then settles back to the room's stored amplitude/period. The room narrates
 * the fish assembling the board, nags if the little fish fidgets too long (pohyby vs
 * trpelivost), and warns when a chip (k1/k2/k3) doesn't fit.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_hlaska: 2,
  room_oldwamp: 3,
  room_oldwper: 4,
  room_mluveni: 5,
  room_nudise: 6,
  room_nepas: 7,
  k1: 9,
  k2: 10,
  k3: 11,
  malar: 18,
  malar_pohyby: 1,
  malar_trpelivost: 2,
  velkar: 19,
} as const;

const d1 = (n: number): string => String.fromCharCode(49 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 7);
  if (s.pokus === 1) v[R.room_uvod] = 0;
  else if (s.random(100) < 80) v[R.room_uvod] = 0;
  else v[R.room_uvod] = 1;
  v[R.room_hlaska] = s.random(1000) + 500;
  v[R.room_oldwamp] = s.wamp;
  v[R.room_oldwper] = s.wper;
  v[R.room_mluveni] = 0;
  v[R.room_nudise] = 0;
  v[R.room_nepas] = 0;

  const mv = s.vars(R.malar, 2);
  mv[R.malar_pohyby] = 0;
  mv[R.malar_trpelivost] = 300 + s.random(700);
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (v[R.room_mluveni] !== 0) {
    s.wamp = s.random(4) + 4;
    s.wper = s.random(4) + 1;
  } else {
    s.wamp = v[R.room_oldwamp]!;
    s.wper = v[R.room_oldwper]!;
  }

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_hlaska]! > 0) v[R.room_hlaska]!--;
    if (v[R.room_uvod]! > 2) v[R.room_uvod]!--;

    if (v[R.room_uvod] === 0) {
      if (s.random(100) < 30) v[R.room_uvod] = s.random(100) + 20;
      else v[R.room_uvod] = 1;
      if (s.random(100) < 30) s.addv(s.random(20) + 5, 'pz-v-zaskladanej');
      else s.adddel(s.random(20));
      if (s.random(100) < 40) {
        s.addm(s.random(8) + 3, 'pz-m-co');
        s.addv(s.random(4), 'pz-v-klice' + d1(s.random(2)));
      } else {
        s.addv(s.random(8) + 3, 'pz-v-co' + d1(s.random(2)));
        s.addm(s.random(4), 'pz-m-spoje' + d1(s.random(3)));
      }
    } else if (v[R.room_uvod] === 2) {
      v[R.room_uvod] = 1;
      s.addm(8, 'pz-m-vylez');
      s.addv(10, 'pz-v-dat');
    } else if (v[R.room_hlaska] === 0) {
      v[R.room_hlaska] = -1;
      s.addm(20, 'pz-m-pocitace');
      s.addd(s.random(20) + 30, 'pz-x-pocitac', 5, (val) => (v[R.room_mluveni] = val));
    } else if (
      v[R.room_nudise] === 0 &&
      s.vars(R.malar)[R.malar_pohyby]! >= s.vars(R.malar)[R.malar_trpelivost]! &&
      s.item(R.velkar).y <= 8
    ) {
      s.addv(20, 'pz-v-hej');
      s.addm(0, 'pz-m-nech');
      v[R.room_nudise] = 1;
    } else if (
      v[R.room_nepas] === 0 &&
      ((s.item(R.k1).y > 5 && s.item(R.k1).y < 20 && s.item(R.k1).dir === Dir.no) ||
        (s.item(R.k2).y > 5 && s.item(R.k2).y < 20 && s.item(R.k2).dir === Dir.no) ||
        (s.item(R.k3).y > 5 && s.item(R.k3).y < 20 && s.item(R.k3).dir === Dir.no))
    ) {
      v[R.room_nepas] = 1;
      s.addm(10, 'pz-m-nepasuje');
    }
  }

  // The little fish's fidget counter (only its own deliberate moves).
  if (s.gfaze === 0 && s.aktivni() === 'little' && s.item(R.malar).dir !== Dir.no)
    s.vars(R.malar)[R.malar_pohyby]!++;
}

export const PUZZLE: RoomScript = { name: 'PUZZLE', init, prog };
