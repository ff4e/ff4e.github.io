/**
 * BATHROOM ("Plumbman's Refuse", room 40) — a faithful port of BATHROOM_InitProgramky
 * / BATHROOM_Programky (URoom.pas:7675-7714, 18732-18853).
 *
 * A flooded bathroom. Each tick a `pom1` topic selector (1..7) is chosen by several
 * INDEPENDENT conditions (last match wins), then a `case pom1` speaks that exchange:
 * (1/2) alternating "someone lives here / two toilets" via `switch`, (3) shower
 * proximity, (4) treasures spotted when the little fish is above-left of the shower,
 * (5) shower pushed down, (6/7) chatting to the washing-machine "creature" in the
 * whirlpool (9). The whirlpool runs a long setanim loop and gurgles (`br-x-pracka`,
 * prior 105). Uses existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_switch: 1,
  room_kdy: 2,
  room_bav: 3,
  room_sprs: 4,
  room_sp: 5,
  room_pokl: 6,
  malar: 1, // little fish
  velkar: 2, // big fish
  whirlpool: 9,
  whirlpool_tvor: 1,
  sprc: 15,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 6);
  v[R.room_switch] = 2 - (s.pokus % 2);
  v[R.room_kdy] = 20 + s.random(20);
  v[R.room_bav] = s.random(150);
  v[R.room_sprs] = 0;
  v[R.room_sp] = 0;
  v[R.room_pokl] = 0;
  s.vars(R.whirlpool, 1)[R.whirlpool_tvor] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const wv = s.vars(R.whirlpool);
  let pom1 = 0;
  if (v[R.room_kdy]! > 0) v[R.room_kdy]!--;
  if (v[R.room_bav]! > 0) v[R.room_bav]!--;

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    // Independent selectors (NOT else-if): several may run; the LAST-set pom1 wins.
    if (v[R.room_kdy] === 0) {
      pom1 = v[R.room_switch]!;
      v[R.room_switch] = 3 - v[R.room_switch]!;
      v[R.room_kdy] = 500 + s.random(1000);
    }
    if (v[R.room_sprs] === 0) {
      if (s.dist(R.malar, R.sprc) < 2 || s.item(R.sprc).dir !== Dir.no) {
        if (s.random(20) === 1) {
          v[R.room_sprs] = 1;
          pom1 = 3;
        }
      }
    }
    if (
      v[R.room_bav] === 0 &&
      ((wv[R.whirlpool_tvor]! > 0 && s.dist(R.malar, R.whirlpool) < 2) ||
        s.item(R.whirlpool).dir !== Dir.no)
    ) {
      const pom2 =
        s.playing(105) || s.item(R.whirlpool).dir !== Dir.no ? s.random(200) : s.random(500);
      if (pom2 === 6) pom1 = 6;
      else if (pom2 === 7) pom1 = 7;
    }
    if (v[R.room_sp] === 0 && s.item(R.sprc).dir === Dir.down && s.random(10) === 1) {
      v[R.room_sp] = 1;
      pom1 = 5;
    }
    if (
      v[R.room_pokl] === 0 &&
      s.item(R.malar).x <= s.item(R.sprc).x &&
      s.item(R.malar).y <= s.item(R.sprc).y
    ) {
      v[R.room_pokl] = 1;
      pom1 = 4;
    }
  }

  if (pom1 >= 6) v[R.room_bav] = s.random(1000) + 1000;

  switch (pom1) {
    case 1:
      if (s.random(4) > 0) s.addv(7, 'br-v-komfort');
      s.addm(7, 'br-m-bydli');
      if (s.random(5) > 0) {
        s.addv(7, 'br-v-santusak');
        if (s.random(6) > 0) s.addm(7, 'br-m-podvodnik');
      }
      break;
    case 2:
      s.addm(7, 'br-m-vsim' + digit(s.random(3)));
      s.addv(0, 'br-v-nerozvadet' + digit(s.random(3)));
      if (s.random(7) > 0) {
        s.addm(10, 'br-m-dva');
        s.addv(5, 'br-v-dost');
      }
      break;
    case 3:
      s.addm(7, 'br-m-sprcha');
      s.addv(7, 'br-v-lazen');
      if (s.random(7) > 0) {
        s.addm(9, 'br-m-zapnout');
        s.addv(6, 'br-v-shodit');
      }
      break;
    case 4:
      s.addm(s.random(10) + 2, 'br-m-poklady');
      break;
    case 5:
      s.addv(7, 'br-v-nechat');
      if (s.random(7) > 0) s.addm(7, 'br-m-nefunguje');
      break;
    case 6:
      if (s.playing(105)) s.adddel(13);
      if (s.random(7) > 0) s.addm(7, 'br-m-ahoj');
      s.addv(7, 'br-v-draha');
      if (s.random(6) > 0) s.addm(7, 'br-m-zkusit');
      break;
    case 7:
      if (s.playing(105)) s.adddel(16);
      s.addm(7, 'br-m-bavi');
      break;
  }

  // ---- whirlpool (washing-machine creature): a long setanim loop + gurgle ----
  {
    const it = s.item(R.whirlpool);
    if (it.anim === '') {
      switch (s.random(5)) {
        case 0:
        case 1:
        case 2:
          s.setanim(
            R.whirlpool,
            'd13a0a1a2a3a0a1a2a3a0a1a2a3a0a1a2a3d8a3a2a1a0a3a2a1a0a3a2a1a0a3a2a1a0',
          );
          break;
        case 3:
          if (s.count > 20) {
            s.setanim(R.whirlpool, 'd?2-8S1,1a4d?2-5a5a4d?1-3a5d?1-3a4d?2-7a5d?1-3S1,0a0d?2-4');
          }
          break;
        case 4:
          if (s.count > 20) {
            s.setanim(
              R.whirlpool,
              'd?1-3S1,1a4d?1-5a5d?1-5a4d?1-5' +
                'a6a7a8a9a6a7a8a9a6a7a8a9a6a7a8a9d?2-5a4d?1-3a5d1a4d?1-3' +
                'a9a8a7a6a9a8a7a6a9a8a7a6a9a8a7a6d?1-3a4d?1-3S1,0a0',
            );
          }
          break;
      }
    }

    if (s.count % 2 === 1) {
      s.goanim(R.whirlpool);
    } else if (
      wv[R.whirlpool_tvor] === 1 &&
      it.afaze > 5 &&
      !s.playing(105) &&
      s.random(20) === 1
    ) {
      s.snd('br-x-pracka', 105);
    }
  }
}

export const BATHROOM: RoomScript = { name: 'BATHROOM', init, prog };
