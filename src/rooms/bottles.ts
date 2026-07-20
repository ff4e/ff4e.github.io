/**
 * BOTTLES ("Aztec Art Hall", room 59) — a faithful port of BOTTLES_InitProgramky /
 * BOTTLES_Programky (URoom.pas:6416-6456, 14458-14576).
 *
 * A gallery of Aztec relics: a golden horse-idol (zlaty, a looping anim), a grinning
 * totem (sklebak) that laughs or growls on a timer, and a skull (lebzna). The room
 * narrates the fish exploring, and comments when the stacked "bottle" relics (2-cell
 * items) start toppling.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_olebce: 2,
  room_odrackovi: 3,
  room_osklebakovi: 4,
  room_osklebu: 5,
  room_opadu: 6,
  malar: 1,
  velkar: 2,
  sklebak: 10,
  sklebak_cinnost: 1,
  zlaty: 11,
  konik: 16,
  lebzna: 31,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 6);
  v[R.room_olebce] = 0;
  v[R.room_odrackovi] = 0;
  if (s.pokus > 1 && s.random(100) < 50) v[R.room_odrackovi] = 1;
  v[R.room_osklebakovi] = s.random(2000) + 500;
  v[R.room_osklebu] = 0;
  v[R.room_opadu] = 0;
  if (s.pokus === 1) v[R.room_uvod] = 1;
  else v[R.room_uvod] = s.random(3);

  s.vars(R.sklebak, 1)[R.sklebak_cinnost] = 0;
  s.setanim(R.zlaty, 'a0d2a1d2R');
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    // Count the toppling 2-cell "bottle" relics (falling, low in the room).
    let pom1 = 0;
    for (let pom2 = 1; pom2 <= s.room.itemCount; pom2++) {
      if (pom2 === R.konik) continue;
      const it = s.item(pom2);
      if (it.fields.length === 2 && it.dir === Dir.down && it.y >= 10) pom1++;
    }
    if (v[R.room_osklebakovi]! > 0) v[R.room_osklebakovi]!--;

    if (v[R.room_uvod] === 1) {
      v[R.room_uvod] = 0;
      s.addm(s.random(40) + 20, 'bot-m-vidis');
      s.addv(s.random(10), 'bot-v-uveznen' + digit(s.random(2)));
      s.addm(s.random(50) + 10, 'bot-m-zajem');
      s.addv(s.random(10), 'bot-v-podivat');
    } else if (v[R.room_uvod] === 2 && s.item(R.malar).y <= 9) {
      v[R.room_uvod] = 0;
      s.addm(s.random(40) + 20, 'bot-m-vidis');
      s.addv(s.random(10), 'bot-v-uveznen' + digit(s.random(2)));
    } else if (v[R.room_olebce] === 0 && s.dist(R.malar, R.lebzna) < 4) {
      v[R.room_olebce] = 1;
      switch (s.random(2)) {
        case 0: s.addm(5, 'bot-m-lebka'); break;
        case 1: s.addm(5, 'bot-m-vidim'); break;
      }
    } else if (
      v[R.room_odrackovi] === 0 &&
      s.lookAt(R.malar, R.zlaty) &&
      s.dist(R.malar, R.zlaty) < 4 &&
      s.random(100) < 6
    ) {
      v[R.room_odrackovi] = 1;
      s.addm(5, 'bot-m-zivy');
    } else if (v[R.room_osklebakovi] === 0) {
      s.addv(50, 'bot-v-vsim');
      s.addm(s.random(20), 'bot-m-vypada');
      s.addset((val) => (s.vars(R.sklebak)[R.sklebak_cinnost] = val), 10);
      v[R.room_osklebakovi] = -1;
    } else if (v[R.room_osklebu] === 0 && s.playing(110)) {
      v[R.room_osklebu] = 1;
    } else if (v[R.room_osklebu] === 1 && !s.playing(110)) {
      if (s.dist(R.malar, R.sklebak) < 3) {
        v[R.room_osklebu] = 2;
        s.addm(10, 'bot-m-ble');
        if (s.random(100) < 60) s.addv(s.random(10) + 5, 'bot-v-totem');
      } else {
        v[R.room_osklebu] = 0;
      }
    } else if (v[R.room_opadu] === 0 && pom1 === 1 && s.random(100) < 5) {
      v[R.room_opadu] = 1;
      s.addm(10, 'bot-m-padaji');
      s.addv(s.random(20), 'bot-v-vsak' + digit(s.random(2)));
    }
  }

  // sklebak: the grinning totem — laughs (10) or growls (20) at random, then settles.
  {
    const cv = s.vars(R.sklebak);
    const it = s.item(R.sklebak);
    switch (cv[R.sklebak_cinnost]) {
      case 0:
        it.afaze = 0;
        if (s.random(1000) < 5) {
          switch (s.random(2)) {
            case 0: cv[R.sklebak_cinnost] = 10; break;
            case 1: cv[R.sklebak_cinnost] = 20; break;
          }
        }
        break;
      case 10:
        s.setanim(R.sklebak, 'a2a3a4R');
        s.snd('bot-x-smich', 110);
        cv[R.sklebak_cinnost]!++;
        break;
      case 11:
        s.goanim(R.sklebak);
        if (!s.talking(110)) cv[R.sklebak_cinnost] = 100;
        break;
      case 20:
        it.afaze = 5;
        s.snd('bot-x-gr' + digit(s.random(2)), 110);
        cv[R.sklebak_cinnost]!++;
        break;
      case 21:
        if (!s.talking(110)) cv[R.sklebak_cinnost] = 100;
        break;
      case 100:
        it.afaze = 0;
        cv[R.sklebak_cinnost]!++;
        break;
      case 120:
        cv[R.sklebak_cinnost] = 0;
        break;
      default:
        cv[R.sklebak_cinnost]!++;
        break;
    }
  }

  // zlaty: the golden idol's looping animation.
  s.goanim(R.zlaty);

  // lebzna: the skull's slow eye-roll.
  if (s.count % 2 === 1) s.item(R.lebzna).afaze = (s.item(R.lebzna).afaze + 1) % 4;
}

export const BOTTLES: RoomScript = { name: 'BOTTLES', init, prog };
