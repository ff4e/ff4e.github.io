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

/** Scripts an undo rebuilt after the opening's moment had passed (`restorePresentation`). */
const opened = new WeakSet<Script>();

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
    } else if (s.count === 10 + s.pokus && !opened.has(s)) {
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
      s.addd(8, 'map-x-hlemyzdi', 111, (val, cur) => (cur.vars(R.sneci)[R.sneci_mluvi] = val));
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

/**
 * Undo (a port addition) and the snails. The snails' line, the fish's chatter and its timer
 * (`obec`) run on time, so an undo leaves the conversation where it is: the pending lines
 * and the snails' `mluvi`. Before, the rebuild dropped the queue, and a point banked while
 * the snails spoke kept `mluvi` = 111 without the callback that ends it: all nine snails
 * froze until the next snail line, minutes later.
 *
 * The opening is timed on `count` alone (`count = 10 + pokus`), and the rebuild starts
 * `count` again from 0, so every undo replayed it. A script rebuilt once that moment has
 * passed is marked, and the opening is not said again; a load is left as the original's.
 *
 * The map is the fish's doing: when the undone move shifted it, or brought it to the exit,
 * the remark goes with the move and the room is the target's. With a fish dead, the fish's
 * own lines (the death lines) are not carried. A load has no queue, so it leaves the snails
 * quiet.
 */
const TALK_SOUNDS = [1, 2, 111];

function restorePresentation(s: Script, previous?: Script): void {
  const sneci = s.vars(R.sneci);
  if (!previous) {
    sneci[R.sneci_mluvi] = 0;
    return;
  }
  if (opened.has(previous) || previous.count >= 10 + s.pokus) opened.add(s);
  const v = s.vars(R.room);
  const live = previous.vars(R.room);
  if (live[R.room_poh] !== v[R.room_poh] || live[R.room_utb] !== v[R.room_utb]) {
    sneci[R.sneci_mluvi] = 0;
    for (const p of TALK_SOUNDS) s.ksnd(p);
    return;
  }
  v[R.room_obec] = live[R.room_obec]!;
  sneci[R.sneci_mluvi] = previous.vars(R.sneci)[R.sneci_mluvi]!;
  const dead = previous.room.anyFishDead ? [1, 2] : [];
  for (const p of dead) s.ksnd(p);
  s.adoptDialogue(previous, dead);
}

export const MAPA: RoomScript = { name: 'MAPA', init, prog, restorePresentation, carriedSounds: TALK_SOUNDS };
