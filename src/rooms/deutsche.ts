/**
 * DEUTSCHE ("Sunken U-boat", room 11) — a faithful port of DEUTSCHE_InitProgramky
 * / DEUTSCHE_Programky (URoom.pas:8438-8476, 21710-21881).
 *
 * A dialogue room where two caricature NPCs — a parrot (papouch) barking German
 * orders and an elk/moose (loos) mumbling Russian — periodically pipe up. Each
 * NPC's "cinnost" var doubles as its speaking flag (set to the voice priority via
 * addd's prom-reference while it talks, reset to 0 when done) which drives its
 * mouth/idle animation. A snail (snecik) peeks when nudged. Item indices are the
 * generated r_DEUTSCHE_* values (URoom.pas:4735-4747).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { carryItem } from './carry.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_olosech: 2,
  room_poslhlaska: 3,
  room_dalsihlaska: 4,
  room_pochlasek: 5,
  papouch: 1,
  papouch_cinnost: 1,
  snecik: 2,
  snecik_kouka: 1,
  loos: 3,
  loos_cinnost: 1,
  malar: 6,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 5);
  v[R.room_uvod] = 0;
  v[R.room_olosech] = 0;
  v[R.room_poslhlaska] = 0;
  v[R.room_dalsihlaska] = s.random(300) + 50;
  v[R.room_pochlasek] = 0;
  s.vars(R.papouch, 1)[R.papouch_cinnost] = 0;
  s.vars(R.snecik, 1)[R.snecik_kouka] = 0;
  s.vars(R.loos, 1)[R.loos_cinnost] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const setLoos = (x: number, cur: Script) => (cur.vars(R.loos)[R.loos_cinnost] = x);
  const setPap = (x: number, cur: Script) => (cur.vars(R.papouch)[R.papouch_cinnost] = x);

  // ---- room dialogue ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      let pom1: number;
      if (s.pokus === 1) pom1 = 2;
      else if (s.pokus === 2) pom1 = 1;
      else pom1 = s.random(3);
      s.adddel(10 + s.random(20));
      if (pom1 >= 1) {
        s.addm(0, 'deu-m-valka');
        s.addv(10, 'deu-v-nepratelstvi');
      }
      if (pom1 >= 2) {
        s.addm(s.random(20) + 5, 'deu-m-bojovat');
        s.addv(3, 'deu-v-losa');
      }
    } else if (
      v[R.room_olosech] === 0 &&
      s.dist(R.malar, R.loos) <= 2 &&
      s.random(100) < 3
    ) {
      v[R.room_olosech] = 1;
      let pom1: number;
      if (s.pokus === 1) pom1 = 1;
      else if (s.pokus === 2) pom1 = 2;
      else pom1 = s.random(3);
      if (pom1 === 1) {
        s.addv(10, 'deu-v-radsi');
        s.addd(s.random(10) + 5, 'deu-l-pozalsta', 101, setLoos);
        s.addd(0, 'deu-p-schnell', 111, setPap);
      } else if (pom1 === 2) {
        s.addm(10, 'deu-m-zvlastni');
        s.addv(8, 'deu-v-slysel');
        s.addd(10, 'deu-l-los', 101, setLoos);
        s.addset(setLoos, 30);
      }
    }
  }

  // ---- periodic background chatter (independent of the story flags) ----
  if (s.noDialog()) {
    if (v[R.room_dalsihlaska]! > 0) v[R.room_dalsihlaska]!--;

    if (v[R.room_dalsihlaska] === 0) {
      v[R.room_pochlasek]!++;
      v[R.room_dalsihlaska] = s.random(300) + v[R.room_pochlasek]! * 30;
      let pom1 = s.random(2);
      if (pom1 === v[R.room_poslhlaska]) pom1 = 2;
      v[R.room_poslhlaska] = pom1;
      if (pom1 === 0) {
        if (s.random(2) === 0) {
          s.addd(20, 'deu-p-trinken' + digit(s.random(2)), 111, setPap);
        } else {
          s.addd(20, 'deu-p-los', 111, setPap);
          s.addd(s.random(20) + 5, 'deu-l-los' + digit(s.random(2)), 101, setLoos);
        }
      } else if (pom1 === 1) {
        switch (s.random(6)) {
          case 0:
            s.addd(20, 'deu-p-schnell', 111, setPap);
            break;
          case 1:
            s.addd(20, 'deu-p-jawohl', 111, setPap);
            break;
          case 2:
            s.addd(20, 'deu-p-stimmt', 111, setPap);
            break;
          case 3:
            s.addd(20, 'deu-p-streng', 111, setPap);
            break;
          case 4:
            s.addd(20, 'deu-p-ordnung', 111, setPap);
            break;
          case 5:
            s.addd(20, 'deu-p-skoll', 111, setPap);
            break;
        }
      } else if (pom1 === 2) {
        switch (s.random(6)) {
          case 0:
            s.addd(20, 'deu-l-ja', 101, setLoos);
            break;
          case 1:
            s.addd(20, 'deu-l-neznaju', 101, setLoos);
            break;
          case 2:
            s.addd(20, 'deu-l-nesmotrel', 101, setLoos);
            break;
          case 3:
            s.addd(20, 'deu-l-zivjot', 101, setLoos);
            s.addset(setLoos, 30);
            break;
          case 4:
            s.addd(20, 'deu-l-necital', 101, setLoos);
            break;
          case 5:
            s.addd(20, 'deu-l-tovarisci', 101, setLoos);
            s.addset(setLoos, 30);
            break;
        }
      }
    }
  }

  // ---- papouch (parrot): flaps its beak while speaking (cinnost=111) ----
  if (s.vars(R.papouch)[R.papouch_cinnost] === 111) s.item(R.papouch).afaze = s.random(2);

  // ---- snecik (snail): peeks out (afaze up to 2) for a while after being nudged ----
  {
    const sn = s.item(R.snecik);
    const sv = s.vars(R.snecik);
    if (sn.dir !== Dir.no) sv[R.snecik_kouka] = s.random(100) + 10;
    else if (sv[R.snecik_kouka]! > 0) sv[R.snecik_kouka]!--;
    if (sv[R.snecik_kouka]! > 0) {
      if (sn.afaze < 2) sn.afaze++;
    } else if (sn.afaze > 0) sn.afaze--;
  }

  // ---- loos (elk): idle chewing, mouth animation while speaking (cinnost=101), wiggles ----
  {
    const lo = s.item(R.loos);
    const lv = s.vars(R.loos);
    const pomb1 = s.count % 3 === 0;
    switch (lv[R.loos_cinnost]) {
      case 0:
        lo.afaze = 3;
        if (s.random(1000) < 3) lv[R.loos_cinnost] = 1;
        break;
      case 1:
        if (pomb1) {
          if (s.random(100) < 5) lo.afaze = 3;
          else lo.afaze = 0;
        }
        if (s.random(1000) < 2) lv[R.loos_cinnost] = 0;
        break;
      case 10:
        s.setanim(R.loos, 'a3d3a4a5a6a7d2a6a5a4a3');
        lv[R.loos_cinnost] = 11;
        break;
      case 11:
        s.goanim(R.loos);
        if (lo.anim === '') {
          if (s.random(100) < 30) lv[R.loos_cinnost] = 10;
          else lv[R.loos_cinnost] = 0;
        }
        break;
      case 20:
        s.setanim(R.loos, 'a3d5a4d1a5d1a6d1a7d12a6d1a5d1a4d1a3');
        lv[R.loos_cinnost] = 21;
        break;
      case 21:
        s.goanim(R.loos);
        if (lo.anim === '') lv[R.loos_cinnost] = 0;
        break;
      case 30:
        lv[R.loos_cinnost] = s.random(2) * 10 + 10;
        break;
      case 101:
        if (pomb1) {
          let pom1 = s.random(2);
          if (pom1 === lo.afaze) pom1 = 2;
          if (pom1 === 0 && s.random(100) < 8) lo.afaze = 3;
          else lo.afaze = pom1;
        }
        break;
    }
  }
}

/**
 * Undo (a port addition) and the U-boat's crew. The parrot's orders and the elk's mumbling
 * come on the room's timer (and the elk's aside on a random roll while the little fish is
 * near), and the fish speak on time, so an undo leaves the conversation where it is: the
 * pending lines, the room's dialogue flags and timers, the elk and the parrot. Before, the
 * rebuild dropped the queue, and a point banked mid-line kept `loos_cinnost` = 101 or
 * `papouch_cinnost` = 111 without the callback that ends it: the elk or the parrot mouthed
 * until its next line, and an elk banked before `addset(setLoos, 30)` never shook his head.
 *
 * The snail peeks when nudged, which is the fish's doing, so it is left as the target had
 * it. With a fish dead, the fish's own lines (the death lines) are not carried. A load has
 * no queue, so it leaves the elk and the parrot quiet.
 */
const TALK_SOUNDS = [1, 2, 101, 111];

function restorePresentation(s: Script, previous?: Script): void {
  if (!previous) {
    if (s.vars(R.loos)[R.loos_cinnost] === 101) s.vars(R.loos)[R.loos_cinnost] = 0;
    s.vars(R.papouch)[R.papouch_cinnost] = 0;
    return;
  }
  s.item(R.room).vars = [...previous.item(R.room).vars];
  carryItem(s, previous, R.loos);
  s.vars(R.papouch)[R.papouch_cinnost] = previous.vars(R.papouch)[R.papouch_cinnost]!;
  s.item(R.papouch).afaze = previous.item(R.papouch).afaze;
  const dead = previous.room.anyFishDead ? [1, 2] : [];
  for (const p of dead) s.ksnd(p);
  s.adoptDialogue(previous, dead);
}

export const DEUTSCHE: RoomScript = { name: 'DEUTSCHE', init, prog, restorePresentation, carriedSounds: TALK_SOUNDS };
