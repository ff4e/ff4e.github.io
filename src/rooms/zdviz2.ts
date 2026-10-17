/**
 * ZDVIZ2 ("Another Elevator", room 28) — a faithful port of ZDVIZ2_InitProgramky
 * / ZDVIZ2_Programky (URoom.pas:6132-6178, 13409-13561).
 *
 * The City branch's second elevator room: the two painter fish share the shaft
 * with a grumpy old man (dedek) who waves and shouts as they crowd him. As in
 * ZDVIZ1 the gear (stroj, item spec=3) spins with the lift (vytah, item spec=4)
 * and the pair is joined by the rope drawn in renderRoom's specs[] pass; malar
 * (item 7) and velkar (item 8) ARE the little and big fish (the original look_at
 * only works on the fish, URoom.pas:2138). dedek's `mluvi` var doubles as his
 * speaking flag (set to the voice priority via addd's prom-reference), driving his
 * wave/shout animation together with `mavani` (a wave countdown).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_odedkovi: 2,
  room_ritual: 3,
  room_ohlavem: 4,
  room_ohlavev: 5,
  room_blizko: 6,
  room_jikry: 7,
  room_curat: 8,
  vytah: 1,
  stroj: 2,
  dedek: 6,
  dedek_mluvi: 1,
  dedek_pohlse: 2,
  dedek_mavani: 3,
  malar: 7, // the little fish
  velkar: 8, // the big fish
  hlava: 9,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 8);
  v[R.room_uvod] = 0;
  v[R.room_odedkovi] = 0;
  v[R.room_ritual] = 0;
  v[R.room_ohlavem] = 0;
  v[R.room_ohlavev] = 0;
  v[R.room_blizko] = 0;
  v[R.room_jikry] = 0;
  v[R.room_curat] = 0;

  s.item(R.vytah).spec = 4;
  s.item(R.stroj).spec = 3;

  const d = s.vars(R.dedek, 3);
  d[R.dedek_mluvi] = 0;
  d[R.dedek_pohlse] = 0;
  d[R.dedek_mavani] = s.nah(1, 3);
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const setDedekMluvi = (x: number, cur: Script) => (cur.vars(R.dedek)[R.dedek_mluvi] = x);
  const malar = s.item(R.malar);
  const dedek = s.item(R.dedek);

  // ---- room dialogue (a single else-if chain: at most one line per tick) ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_blizko]! > 0) v[R.room_blizko]!--;

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      s.addm(s.nah(5, 20), 'zd2-m-dalsi');
      switch (s.random(2)) {
        case 0:
          s.addv(s.random(5), 'zd2-v-odlis0');
          break;
        case 1:
          s.addv(s.random(5), 'zd2-v-odlis1');
          break;
      }
    } else if (
      v[R.room_odedkovi] === 0 &&
      malar.x > 20 &&
      malar.y < 30 &&
      s.lookAt(R.velkar, R.dedek)
    ) {
      v[R.room_odedkovi] = 1;
      s.addv(s.nah(5, 10), 'zd2-v-vlevo');
      switch (s.random(2)) {
        case 0:
          s.addm(s.nah(1, 5), 'zd2-m-nevid0');
          break;
        case 1:
          s.addm(s.nah(1, 5), 'zd2-m-nevid1');
          break;
      }
    } else if (
      v[R.room_ritual] === 0 &&
      s.random(100) < 5 &&
      v[R.room_odedkovi] === 1 &&
      s.vars(R.dedek)[R.dedek_pohlse] === 0
    ) {
      s.addv(1, 'zd2-v-symbol');
      s.addm(s.nah(1, 5), 'zd2-m-douf');
      v[R.room_ritual] = 1;
    } else if (
      v[R.room_ohlavem] === 0 &&
      s.dist(R.malar, R.hlava) < 3 &&
      s.lookAt(R.malar, R.hlava) &&
      s.random(100) < 5
    ) {
      v[R.room_ohlavem] = 1;
      s.addm(1, 'zd2-m-lebka');
    } else if (
      v[R.room_ohlavev] === 0 &&
      s.dist(R.velkar, R.hlava) < 3 &&
      s.lookAt(R.velkar, R.hlava) &&
      s.random(100) < 5
    ) {
      v[R.room_ohlavev] = 1;
      s.addv(1, 'zd2-v-haml');
    } else if (
      v[R.room_blizko] === 0 &&
      // NB: the original repeats the malar test verbatim in both OR operands
      // (a copy-paste; velkar was presumably intended) — kept faithfully.
      ((s.dist(R.malar, R.dedek) < 5 && s.lookAt(R.malar, R.dedek)) ||
        (s.dist(R.malar, R.dedek) < 5 && s.lookAt(R.malar, R.dedek)))
    ) {
      v[R.room_blizko] = s.random(400) + 100;
      switch (s.random(3)) {
        case 0:
          s.addd(s.random(3), 'zd2-x-hus0', 101, setDedekMluvi);
          break;
        case 1:
          s.addd(s.random(3), 'zd2-x-hus1', 102, setDedekMluvi);
          break;
        case 2:
          s.addd(s.random(3), 'zd2-x-kricet', 102, setDedekMluvi);
          break;
      }
    } else if (dedek.dir !== Dir.no && s.random(100) < 2) {
      switch (s.random(3)) {
        case 0:
          s.addd(s.nah(2, 6), 'zd2-x-krik0', 101, setDedekMluvi);
          break;
        case 1:
          s.addd(s.nah(2, 6), 'zd2-x-krik1', 102, setDedekMluvi);
          break;
        case 2:
          if (v[R.room_ritual] === 1) {
            s.addd(s.nah(2, 6), 'zd2-x-ritual', 102, setDedekMluvi);
          }
          break;
      }
    } else if (
      s.dist(R.malar, R.dedek) < 3 &&
      s.dist(R.velkar, R.dedek) < 3 &&
      s.random(100) < 1
    ) {
      s.addd(s.nah(2, 6), 'zd2-x-nechteme', 102, setDedekMluvi);
    } else if (
      (s.dist(R.malar, R.dedek) <= 1 || s.dist(R.velkar, R.dedek) <= 1) &&
      s.random(100) < 2
    ) {
      switch (s.random(3)) {
        case 0:
          s.addd(s.nah(2, 6), 'zd2-x-nechme', 102, setDedekMluvi);
          break;
        case 1:
          s.addd(s.nah(2, 6), 'zd2-x-pokoj', 102, setDedekMluvi);
          break;
        case 2:
          s.addd(s.nah(2, 6), 'zd2-x-fuj', 102, setDedekMluvi);
          break;
      }
    } else if (
      s.dist(R.malar, R.dedek) < 3 &&
      s.lookAt(R.malar, R.dedek) &&
      v[R.room_jikry] === 0 &&
      s.random(100) < 1
    ) {
      v[R.room_jikry] = 1;
      s.addd(s.random(3), 'zd2-x-neklast', 102, setDedekMluvi);
    } else if (
      s.dist(R.velkar, R.dedek) < 3 &&
      s.lookAt(R.velkar, R.dedek) &&
      v[R.room_curat] === 0 &&
      s.random(100) < 1
    ) {
      v[R.room_curat] = 1;
      s.addd(s.random(3), 'zd2-x-necurat', 102, setDedekMluvi);
    }
  }

  // ---- stroj (gear): rotate (afaze 0..5) in step with the lift's direction ----
  {
    const stroj = s.item(R.stroj);
    const vytah = s.item(R.vytah);
    if (stroj.x === vytah.x - 1) {
      let pom1: number;
      if (stroj.dir === Dir.no && vytah.dir === Dir.down) pom1 = 2;
      else if (stroj.dir === Dir.up && vytah.dir === Dir.no) pom1 = 1;
      else if (stroj.dir === Dir.no && vytah.dir === Dir.up) pom1 = -1;
      else if (stroj.dir === Dir.down && vytah.dir === Dir.no) pom1 = -2;
      else pom1 = 0;
      stroj.afaze += pom1;
      if (stroj.afaze > 5) stroj.afaze -= 6;
      else if (stroj.afaze < 0) stroj.afaze += 6;
    }
  }

  // ---- dedek (old man): waves/shouts; `mluvi` (speaking prio) drives the frame ----
  {
    const dv = s.vars(R.dedek);
    if (dedek.dir !== Dir.no) dv[R.dedek_pohlse] = 1;
    if (dv[R.dedek_mavani] === 0) {
      dedek.afaze = dv[R.dedek_mluvi] === 102 ? 1 : 0;
      dv[R.dedek_mavani] = s.nah(1, 3);
    } else {
      switch (dv[R.dedek_mluvi]) {
        case 101:
          dedek.afaze = 1;
          dv[R.dedek_mavani]!--;
          break;
        case 102:
          dedek.afaze = 2;
          dv[R.dedek_mavani]!--;
          break;
        default:
          dedek.afaze = 0;
          break;
      }
    }
  }
}

/**
 * Undo (a port addition) and the old man. His shouts come on a random roll while the
 * painters crowd him, and the painters' chatter on time, so an undo leaves the conversation
 * where it is: the pending lines, the room's dialogue flags and timers, and the old man's
 * voice and wave. Before, the rebuild dropped the queue, and a point banked mid-shout kept
 * `dedek_mluvi` = 101/102 without the callback that ends it: he waved and shouted until his
 * next line.
 *
 * Whether he has been moved (`pohlse`) is the fish's doing and stays the target's, and so
 * is the remark on spotting him: it fires the moment the painters take up their places, so
 * when the undone move set it off (`odedkovi` set since the target) it goes with the move.
 * A push sets off shouts too (`dir <> dir_no`, 2% a tick): when the undone move shifted him,
 * his lines go with it, while the fish's carry. With a fish dead, the fish's own lines (the death lines) are not carried. A load has no
 * queue, so it leaves the old man quiet.
 */
const TALK_SOUNDS = [1, 2, 101, 102];

function restorePresentation(s: Script, previous?: Script): void {
  const d = s.vars(R.dedek);
  if (!previous) {
    d[R.dedek_mluvi] = 0;
    return;
  }
  const v = s.vars(R.room);
  if (previous.vars(R.room)[R.room_odedkovi] !== v[R.room_odedkovi]) {
    d[R.dedek_mluvi] = 0;
    for (const p of TALK_SOUNDS) s.ksnd(p);
    return;
  }
  s.item(R.room).vars = [...previous.item(R.room).vars];
  const was = previous.item(R.dedek);
  const shifted = was.x !== s.item(R.dedek).x || was.y !== s.item(R.dedek).y;
  if (shifted) {
    d[R.dedek_mluvi] = 0;
  } else {
    const live = previous.vars(R.dedek);
    d[R.dedek_mluvi] = live[R.dedek_mluvi]!;
    d[R.dedek_mavani] = live[R.dedek_mavani]!;
    s.item(R.dedek).afaze = was.afaze;
  }
  const drop = [...(previous.room.anyFishDead ? [1, 2] : []), ...(shifted ? [101, 102] : [])];
  for (const p of drop) s.ksnd(p);
  s.adoptDialogue(previous, drop);
}

export const ZDVIZ2: RoomScript = { name: 'ZDVIZ2', init, prog, restorePresentation, carriedSounds: TALK_SOUNDS };
