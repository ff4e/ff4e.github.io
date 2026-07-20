/**
 * KAJUTA1 ("The First Mate's Cabin", room 45) — a faithful port of KAJUTA1_InitProgramky
 * / KAJUTA1_Programky (URoom.pas:5007-5080, 9276-9525).
 *
 * A pirate cabin with a cheeky stuffed parrot (papouch = 2) that heckles the fish for
 * shoving it, blocking the hatch, staring, etc. (canned `k1-pap-*` phrases via the
 * dialogue prom), an octopus (chobot = 4, tentacle wave + eye-tracking, `k1-chob-*`),
 * and a skull (lebka = 5) the little fish recoils from ("fuj!"). Atmosphere/thanks/
 * treasure lines fire on timers/positions. This room disables the standard death lines
 * (`StdHlaskySmrti := false`) — instead the parrot squawks "karamba" when a fish dies.
 *
 * Features the gspec=3/4 SCREEN-SHOVE easter egg: the room arms it (`gspec := 3`, 1%);
 * when the big fish then shoves a wall the host slides the view and sets gspec := 4,
 * and here the fish notice ("what are you doing?" / "sorry") and reset it.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_podekovat: 1,
  room_atmosf: 2,
  room_podiv: 3,
  room_chob: 4,
  room_truh: 5,
  room_mov: 6,
  room_nekro: 7,
  truhla: 1,
  papouch: 2,
  papouch_strcil: 1,
  papouch_stav: 2,
  papouch_smalse: 3,
  papouch_nekoukej: 4,
  papouch_tlustej: 5,
  chobot: 4,
  chobot_chapadla: 1,
  chobot_oci: 2,
  chobot_akcnost: 3,
  chobot_lastdir: 4,
  lebka: 5,
  trubka: 6,
  poklop: 7,
  malar: 8, // little fish
  malar_leb: 1,
  malar_cinnost: 2,
  malar_delay: 3,
  velkar: 9, // big fish
  velkar_cinnost: 1,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 7);
  v[R.room_podekovat] = 0;
  if (s.random(100) < 50) {
    v[R.room_atmosf] = s.random(200) + 100;
    v[R.room_podiv] = -1;
  } else {
    v[R.room_podiv] = 20;
    v[R.room_atmosf] = -1;
  }
  v[R.room_chob] = s.random(2) + 1;
  v[R.room_truh] = s.random(40) + 10;
  v[R.room_mov] = 0;
  v[R.room_nekro] = 0;
  s.stdHlaskySmrti = false;

  const pv = s.vars(R.papouch, 5);
  pv[R.papouch_stav] = 0;
  pv[R.papouch_strcil] = 0;
  pv[R.papouch_smalse] = 0;
  pv[R.papouch_nekoukej] = 0;
  pv[R.papouch_tlustej] = 0;

  const ch = s.vars(R.chobot, 4);
  ch[R.chobot_lastdir] = Dir.no;
  ch[R.chobot_oci] = 0;
  ch[R.chobot_chapadla] = 0;
  ch[R.chobot_akcnost] = 2;

  const mv = s.vars(R.malar, 3);
  mv[R.malar_leb] = 0;
  mv[R.malar_cinnost] = 0;
  mv[R.malar_delay] = 0;

  s.vars(R.velkar, 1)[R.velkar_cinnost] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const setStav = (val: number): void => {
    s.vars(R.papouch)[R.papouch_stav] = val;
  };

  // ---- room: death squawk, else the ambient chain + the screen-shove reaction ----
  if (
    (!s.alive('little') && !s.venku('little')) ||
    (!s.alive('big') && !s.venku('big'))
  ) {
    if (v[R.room_nekro] === 0) s.addd(6, 'k1-pap-karamba', 101, setStav);
    v[R.room_nekro] = 1;
  } else {
    if (s.item(R.chobot).dir !== Dir.no) v[R.room_podekovat] = 1;

    if (v[R.room_atmosf]! >= 0) {
      if (v[R.room_atmosf] === 0) {
        if (s.noDialog()) {
          s.addv(50, 'k1-v-citis');
          s.addm(1, 'k1-m-kolebku');
          s.addv(2, 'k1-v-cit');
        } else {
          v[R.room_atmosf]! += 20;
        }
      }
      v[R.room_atmosf]!--;
    }

    if (v[R.room_podiv]! >= 0) {
      if (
        s.xdist(R.malar, R.lebka) <= 2 &&
        s.lookAt(R.malar, R.lebka) &&
        s.item(R.lebka).dir === Dir.no
      ) {
        if (v[R.room_podiv] === 0 && s.vars(R.malar)[R.malar_cinnost] === 0) {
          if (s.noDialog()) {
            s.addm(20, 'k1-m-podivin');
            s.addv(2, 'k1-v-proc');
            s.addm(2, 'k1-m-lebku');
            s.addv(2, 'k1-v-jejeho');
            if (s.random(2) === 0) s.addm(5, 'k1-m-mysli');
          } else {
            v[R.room_podiv]! += 10;
          }
        }
        v[R.room_podiv]!--;
      }
    }

    if (v[R.room_podekovat] === 0 && s.item(R.malar).y <= 7 && s.item(R.malar).x === 17) {
      v[R.room_podekovat] = 1;
      if (s.noDialog()) {
        s.addm(5, 'k1-m-diky');
        s.addv(3, 'k1-v-radose');
      }
    }

    switch (v[R.room_chob]) {
      case 1:
        if (
          s.item(R.malar).x === s.item(R.chobot).x + 1 &&
          s.item(R.malar).y === s.item(R.chobot).y
        ) {
          if (s.noDialog()) {
            s.addv(0, 'k1-v-opatrne');
            s.addm(3, 'k1-m-tospisona');
          }
          v[R.room_chob] = 0;
        }
        break;
      case 2:
        if (s.lookAt(R.malar, R.chobot) && s.dist(R.malar, R.chobot) === 2) {
          if (s.noDialog()) {
            s.addm(4, 'k1-m-chobotnice');
            s.addv(6, 'k1-v-patrila');
            s.addd(8, 'k1-pap-drahousek', 101, setStav);
          }
          v[R.room_chob] = 0;
        }
        break;
    }

    if (v[R.room_truh]! >= 0) {
      if (s.dist(R.malar, R.truhla) < 2) {
        if (v[R.room_truh] === 0) {
          if (s.noDialog()) {
            v[R.room_truh]!--;
            switch (s.random(2)) {
              case 0:
                s.addm(0, 'k1-m-copak');
                s.addv(3, 'k1-v-kdovi');
                s.addd(6, 'k1-pap-drahokamy', 101, setStav);
                break;
              case 1:
                s.addm(0, 'k1-m-myslis');
                s.addv(s.random(10), 'k1-v-bedna');
                break;
            }
          } else {
            v[R.room_truh]! += 10;
          }
        } else {
          v[R.room_truh]!--;
        }
      }
    }

    // gspec=3/4 screen-shove: arm it, then react once the host has slid the view.
    if (v[R.room_mov] === 0 && s.random(100) < 1) s.room.gspec = 3;
    if (s.room.gspec === 4) {
      if (s.isDialog()) {
        s.room.gspec = 3;
      } else {
        v[R.room_mov] = 1;
        s.addm(4, 'k1-m-codelas');
        s.addset((val) => (s.room.gspec = val), 0);
        s.addv(3, 'k1-v-promin');
      }
    }
  }

  // ---- truhla (chest): creaks when pushed ----
  if (s.item(R.truhla).dir !== Dir.no && s.gfaze === 0) s.snd('k1-x-vrz', 300);

  // ---- papouch (stuffed parrot): a heckle chain, then the spoken-line jaw flap ----
  {
    const pv = s.vars(R.papouch);
    const it = s.item(R.papouch);
    switch (pv[R.papouch_stav]) {
      case 0:
        if (s.noDialog()) {
          if (
            (it.dir === Dir.left || it.dir === Dir.right) &&
            pv[R.papouch_strcil] === 0 &&
            s.random(6) === 0
          ) {
            pv[R.papouch_strcil] = 1;
            s.addd(0, 'k1-pap-nestrkej', 101, setStav);
          } else if (it.y === 18 && pv[R.papouch_smalse] === 0) {
            pv[R.papouch_smalse] = 1;
            s.addd(0, 'k1-pap-prekazet', 101, setStav);
          } else if (
            s.item(R.poklop).y === 7 &&
            s.item(R.malar).y > 7 &&
            s.item(R.malar).y < 17 &&
            s.item(R.malar).x > 7 &&
            s.item(R.velkar).y < 7 &&
            pv[R.papouch_smalse] === 0
          ) {
            pv[R.papouch_smalse] = 1;
            s.addd(0, 'k1-pap-prcice', 101, setStav);
          } else if (
            pv[R.papouch_nekoukej] === 0 &&
            s.dist(s.littleIdx, R.papouch) <= 1 &&
            s.random(100) < 5
          ) {
            pv[R.papouch_nekoukej] = 1;
            s.addd(0, 'k1-pap-vodprejskni', 102, setStav);
          } else if (
            pv[R.papouch_nekoukej] === 0 &&
            s.dist(s.bigIdx, R.papouch) <= 1 &&
            s.random(100) < 5
          ) {
            pv[R.papouch_nekoukej] = 2;
            s.addd(0, 'k1-pap-vodprejskni', 102, setStav);
          } else if (
            pv[R.papouch_nekoukej] === 1 &&
            s.dist(s.littleIdx, R.papouch) > 2 &&
            s.random(100) < 25
          ) {
            s.addd(0, 'k1-pap-noproto', 101, setStav);
          } else if (
            pv[R.papouch_nekoukej] === 2 &&
            s.dist(s.bigIdx, R.papouch) > 2 &&
            s.random(100) < 25
          ) {
            s.addd(0, 'k1-pap-noproto', 101, setStav);
          } else if (
            pv[R.papouch_tlustej] === 0 &&
            s.item(R.trubka).x >= 13 &&
            s.item(R.trubka).y === 18
          ) {
            pv[R.papouch_tlustej] = 1;
            s.addd(0, 'k1-pap-sestlustej', 101, setStav);
            pv[R.papouch_stav] = 1;
          } else if (s.random(250) === 0) {
            switch (s.random(7)) {
              case 0:
                s.addd(0, 'k1-pap-sucharek', 101, setStav);
                break;
              case 1:
                s.addd(0, 'k1-pap-kruty', 101, setStav);
                break;
              case 2:
                s.addd(0, 'k1-pap-3xkruty', 101, setStav);
                break;
              case 3:
                s.addd(0, 'k1-pap-kruci', 101, setStav);
                break;
              case 4:
                s.addd(0, 'k1-pap-sakris', 101, setStav);
                break;
              case 5:
                s.addd(0, 'k1-pap-trhnisi', 101, setStav);
                break;
              case 6:
                s.addd(0, 'k1-pap-problem', 101, setStav);
                break;
            }
            pv[R.papouch_stav] = 1;
          }
        }
        break;
      case 101:
        if (pv[R.papouch_nekoukej]! > 0) pv[R.papouch_nekoukej] = 3;
        it.afaze = s.random(2);
        break;
      case 102:
        it.afaze = s.random(2);
        break;
    }
  }

  // ---- chobot (octopus): tentacle wave + eye-tracking + push sounds ----
  {
    const ch = s.vars(R.chobot);
    const it = s.item(R.chobot);
    if (it.dir !== Dir.no) {
      ch[R.chobot_akcnost] = 7;
    } else if (ch[R.chobot_akcnost]! > 2 && s.count % 5 === 0) {
      ch[R.chobot_akcnost]!--;
    }

    if (it.dir !== ch[R.chobot_lastdir]) {
      if (!s.playing(301)) {
        if (it.dir === Dir.down) {
          s.snd('k1-chob-p', 301);
        } else if (it.dir !== Dir.no) {
          switch (s.random(3)) {
            case 0:
              s.snd('k1-chob-1', 301);
              break;
            case 1:
              s.snd('k1-chob-2', 301);
              break;
            case 2:
              s.snd('k1-chob-3', 301);
              break;
          }
        }
      }
      ch[R.chobot_lastdir] = it.dir;
    }

    if (it.dir === Dir.no && s.count % ch[R.chobot_akcnost]! === 0) {
      if (s.random(2) === 0) {
        if (ch[R.chobot_chapadla]! < 2) ch[R.chobot_chapadla]!++;
        else ch[R.chobot_chapadla] = 0;
      } else {
        if (ch[R.chobot_chapadla]! > 0) ch[R.chobot_chapadla]!--;
        else ch[R.chobot_chapadla] = 2;
      }
    }

    let pomb1 =
      (s.xdist(s.littleIdx, R.chobot) === 0 && s.ydist(s.littleIdx, R.chobot) <= 0) ||
      (s.xdist(s.bigIdx, R.chobot) === 0 && s.ydist(s.bigIdx, R.chobot) <= 0);
    pomb1 = pomb1 || it.dir !== Dir.no;

    if (pomb1) ch[R.chobot_oci] = 1;
    switch (ch[R.chobot_oci]) {
      case 0:
        if (s.random(100) < 10) ch[R.chobot_oci] = 2;
        break;
      case 2:
        if (s.random(100) < 10) ch[R.chobot_oci] = 0;
        break;
      case 1:
        if (!pomb1 && s.random(100) < 20) ch[R.chobot_oci] = 0;
        break;
    }
    it.afaze = ch[R.chobot_oci]! + 3 * ch[R.chobot_chapadla]!;
  }

  // ---- malar: the little fish recoils "fuj!" from the skull it just budged ----
  if (s.noDialog()) {
    const mv = s.vars(R.malar);
    if (mv[R.malar_cinnost] === 0) {
      if (
        s.item(R.lebka).dir !== Dir.no &&
        s.item(R.lebka).dir !== Dir.down &&
        s.aktivni() === 'little' &&
        (mv[R.malar_leb] === 0 || s.random(100) < 10) &&
        s.gfaze === 0
      ) {
        mv[R.malar_leb] = 1;
        s.talkNow('k1-m-fuj', 2);
      }
    }
  }
}

export const KAJUTA1: RoomScript = { name: 'KAJUTA1', init, prog };
