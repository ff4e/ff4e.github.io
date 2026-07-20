/**
 * MAPA ("Silver's Hideout", room 51) — a faithful port of MAPA_InitProgramky /
 * MAPA_Programky (URoom.pas:8403-8437, 21594-21709).
 *
 * A gspec=9 "push it out" room: shove the treasure map (mapous = 2) off the edge
 * (Spec9(mapous,7,4)). A `pom2` topic selector (edge-hint / intro / map-moved / near-
 * exit / periodic `obec` chatter) drives the dialogue. Decorative life fills the cave:
 * two blinking eyes (voko1 = 10..11), two crabs (kr1/kr2 = 12/13), and nine snails
 * (sneci = 17..25) that poke out on their own little FSM (and all freeze at afaze 2
 * while the snail line plays or one is pushed). Uses existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_poh: 1,
  room_utb: 2,
  room_obec: 3,
  mapous: 2,
  voko1: 10,
  kr1: 12,
  kr2: 13,
  sneci: 17,
  sneci_mluvi: 1,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 3);
  s.room.gspec = 9;
  v[R.room_poh] = 0;
  v[R.room_obec] = 1000 + s.random(3000);
  v[R.room_utb] = 0;

  s.setanim(R.kr1, 'd?1-50a0a1a2a3d1a3a2a1a0R');
  s.setanim(R.kr2, 'd?1-50a0a1a2a3d1a3a2a1a0R');
  s.vars(R.sneci, 1)[R.sneci_mluvi] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  let pom2 = 0;

  // ---- room dialogue: one topic (pom2) per tick, then speak it ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (s.stdKrajniHlaska()) {
      s.addv(10, 'map-v-ukol');
      s.stdKonecKrajniHlasky();
    } else if (s.count === 10 + s.pokus) {
      pom2 = 1;
    } else if (v[R.room_poh] === 0 && s.item(R.mapous).x !== s.item(R.mapous).xStart) {
      pom2 = 6;
      v[R.room_poh] = 1;
    } else if (v[R.room_utb] === 0 && [1, 2, 28].includes(s.item(R.mapous).x)) {
      v[R.room_utb] = 1;
      pom2 = 7;
    } else if (v[R.room_obec]! > 0) {
      v[R.room_obec]!--;
    } else {
      v[R.room_obec] = 1000 + s.random(1000 + Math.floor(s.count / 5));
      pom2 = s.random(4) + 2;
    }
  }

  switch (pom2) {
    case 1:
      if (s.random(3) > 0) s.addv(7, 'map-v-mapa');
      else s.addm(7, 'map-m-mapa');
      if (s.pokus < 4 || s.random(100) < 60) {
        s.addm(7, 'map-m-ukol');
        s.addv(7, 'map-v-jasne');
        s.addm(7, 'map-m-neplacej');
      }
      break;
    case 2:
      s.addv(7, 'map-v-cojetam');
      s.addv(7, 'map-v-poklady');
      s.addm(7, 'map-m-uvidime');
      break;
    case 3:
      s.addm(7, 'map-m-sneci');
      s.addd(8, 'map-x-hlemyzdi', 111, (val) => (s.vars(R.sneci)[R.sneci_mluvi] = val));
      break;
    case 4:
      s.addv(8, 'map-v-oci');
      break;
    case 5:
      s.addv(8, 'map-v-restart');
      s.addm(8, 'map-m-pravidla');
      break;
    case 6:
      s.addm(7, 'map-m-pohnout');
      s.addv(7, 'map-v-dal');
      break;
    case 7:
      s.addm(7, 'map-m-uz');
      break;
  }

  // ---- mapous (the map): gspec=9 push-out target ----
  s.spec9(R.mapous, 7, 4);

  // ---- voko1..2 (blinking eyes): each runs its own random setanim loop ----
  for (let pom1 = 0; pom1 <= 1; pom1++) {
    const idx = R.voko1 + pom1;
    if (s.item(idx).anim === '') {
      switch (s.random(7)) {
        case 0:
          s.setanim(idx, 'd10-99a1d?2-3a2d?2-3a1d?2-3a2d?2-3a1d?2-3a2d?2-3a1d?2-3a2d?2-3a0');
          break;
        case 1:
          s.setanim(idx, 'd10-99a3d?2-3a4d?2-3a3d?2-3a4d?2-3a3d?2-3a4d?2-3a3d?2-3a4d?2-3a0');
          break;
        case 2:
        case 3:
          s.setanim(idx, 'd10-99a?1-4d10-30a0');
          break;
        case 4:
        case 5:
          s.setanim(idx, 'd10-99a3a1a4a1a3a2a4a1a3a1a4a1a3a1a4a1a0');
          break;
        case 6:
          s.setanim(idx, 'd10-99a?0-4d2-8a?0-4d2-8a?0-4d2-8a?0-4d2-8a0');
          break;
      }
    }
    s.goanim(idx);
  }

  // ---- kr1/kr2 (crabs): idle scuttle animation ----
  s.goanim(R.kr1);
  s.goanim(R.kr2);

  // ---- sneci (nine snails): poke-out FSM; all freeze while the snail line plays ----
  {
    const mluvi = s.vars(R.sneci)[R.sneci_mluvi]!;
    for (let pom1 = 0; pom1 <= 8; pom1++) {
      const it = s.item(R.sneci + pom1);
      if (mluvi !== 0 || it.dir !== Dir.no) {
        it.afaze = 2;
      } else {
        switch (it.afaze) {
          case 0:
            if (s.random(100) === 1) it.afaze = 1;
            break;
          case 1:
            switch (s.random(6)) {
              case 1:
                it.afaze = 3;
                break;
              case 2:
                it.afaze = 2;
                break;
            }
            break;
          case 2:
            if (s.random(10) === 1) it.afaze = 1;
            break;
          case 3:
            if (s.random(4) === 1) it.afaze = 0;
            break;
        }
      }
    }
  }
}

export const MAPA: RoomScript = { name: 'MAPA', init, prog };
