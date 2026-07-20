/**
 * NOGROUND ("Almost No Wall", room 39) — a faithful port of NOGROUND_InitProgramky
 * / NOGROUND_Programky (URoom.pas:6630-6653, 15348-15383).
 *
 * A tiny dialogue-only room: the fish remark on the strange near-wall-less cavern
 * (`uvod`), and after a `smet` countdown one comments on the rubbish heap. Both the
 * intro and the heap remark can be pre-suppressed on later attempts. No creatures.
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_smet: 2,
  velkar: 2, // big fish
  malar: 3, // little fish
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 2);
  v[R.room_uvod] = 0;
  v[R.room_smet] = s.random(1000) + 200;
  if (s.random(100) < 10 * s.pokus - 10) v[R.room_uvod] = 1;
  if (s.random(100) < 10 * s.pokus - 10) v[R.room_smet] = -1;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_smet]! > 0) v[R.room_smet]!--;
    if (v[R.room_uvod] === 0) {
      s.addv(10 + s.random(30), 'nog-v-zvlastni');
      switch (s.random(6)) {
        case 0:
        case 1:
          s.addm(s.random(5), 'nog-m-uvedom0');
          break;
        case 2:
        case 3:
          s.addm(s.random(5), 'nog-m-uvedom1');
          break;
        case 4:
          s.addm(s.random(5), 'nog-m-uvedom0');
          s.addm(s.random(5), 'nog-m-uvedom1');
          break;
      }
      v[R.room_uvod] = 1;
    } else if (v[R.room_smet] === 0) {
      switch (s.random(2)) {
        case 0:
          s.addv(0, 'nog-v-smetiste0');
          break;
        case 1:
          s.addv(0, 'nog-v-smetiste1');
          break;
      }
      v[R.room_smet] = -1;
    }
  }
}

export const NOGROUND: RoomScript = { name: 'NOGROUND', init, prog };
