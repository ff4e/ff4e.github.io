/**
 * DELA ("Fire!", room 47) — a faithful port of DELA_InitProgramky / DELA_Programky
 * (URoom.pas:6035-6068, 13204-13285).
 *
 * A cannon deck. Two intro variants (`uvod`, coin-flip in init) and a "sword" foreboding
 * line on a `pocitadlo` countdown. Once the little fish is alone (big fish swum out,
 * `venku[velka]`) and reaches a side edge, it gets a one-off aside (busy little). Four
 * cannons (delo1..4) flicker their burning fuses on staggered `count mod 4` phases.
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_tuseni: 2,
  room_pocitadlo: 3,
  room_jo: 4,
  delo1: 2,
  delo3: 6,
  malar: 10, // little fish
  velkar: 11, // big fish
  delo2: 13,
  delo4: 14,
} as const;

/** The shared cannon-fuse afaze cycle (URoom.pas): phases 0/2 → 2, 1 → 0, 3 → 1. */
function fuse(s: Script, idx: number, phase: number): void {
  switch (phase) {
    case 0:
    case 2:
      s.item(idx).afaze = 2;
      break;
    case 1:
      s.item(idx).afaze = 0;
      break;
    case 3:
      s.item(idx).afaze = 1;
      break;
  }
}

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  if (s.random(100) < 50) v[R.room_uvod] = 0;
  else v[R.room_uvod] = 1;
  v[R.room_tuseni] = 0;
  v[R.room_jo] = 0;
  v[R.room_pocitadlo] = s.random(500) + 500;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    switch (v[R.room_uvod]) {
      case 0:
        s.addv(20 + s.random(30), 'del-v-dve');
        s.addm(s.random(5), 'del-m-voda');
        v[R.room_uvod] = 2;
        break;
      case 1:
        s.addm(20 + s.random(30), 'del-m-ci');
        s.addv(s.random(5), 'del-v-splet');
        v[R.room_uvod] = 2;
        break;
    }
    if (v[R.room_pocitadlo]! < 1 && v[R.room_tuseni] === 0) {
      s.addv(s.random(5), 'del-v-mec');
      s.addm(s.random(5), 'del-m-tus');
      v[R.room_tuseni] = 1;
    }
    v[R.room_pocitadlo]!--;
  } else if (
    s.alive('little') &&
    s.venku('big') &&
    v[R.room_jo] === 0 &&
    (s.item(R.malar).x < 2 || s.item(R.malar).x > 25)
  ) {
    s.setBusy('little', 1);
    switch (s.random(2)) {
      case 0:
        s.addm(0, 'del-m-jedn0');
        break;
      case 1:
        s.addm(0, 'del-m-jedn1');
        break;
    }
    s.addm(s.random(5), 'del-m-jedn2');
    v[R.room_jo] = 1;
    s.addset((val) => s.setBusy('little', val), 0);
  }

  // ---- delo1..4: burning fuses on staggered count%4 phases ----
  fuse(s, R.delo1, (s.count + 1) % 4);
  fuse(s, R.delo3, s.count % 4);
  fuse(s, R.delo2, (s.count + 3) % 4);
  fuse(s, R.delo4, (s.count + 1) % 4);
}

export const DELA: RoomScript = { name: 'DELA', init, prog };
