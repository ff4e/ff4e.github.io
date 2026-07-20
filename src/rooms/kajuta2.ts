/**
 * KAJUTA2 ("Second Mate's Cabin", room 49) — a faithful port of KAJUTA2_InitProgramky
 * / KAJUTA2_Programky (URoom.pas:5081-5145, 9526-9779).
 *
 * A cabin with a stuffed parrot (papouch = 2, squawks canned pirate phrases), a live
 * parrot (papzivy = 10, flaps and reacts — via `gstav=stav_otocka` — when the little
 * fish turns near it), and an octopus (chobot = 4, waves tentacles + tracks the fish
 * with its eyes, `k1-chob-*` sounds). The fish comment on the treasure chest, the
 * octopus tentacle, the skeletons, the lamp, and the trapdoor hump. Uses existing
 * primitives (incl. the by-ref `prom` in addd).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_zivy: 2,
  room_poklad: 3,
  room_chobotnicka: 4,
  room_chobotnicka1: 5,
  room_kostricky: 6,
  room_mysleni: 7,
  room_posvitime: 8,
  room_hrbet: 9,
  room_operenej: 10,
  truhla: 1,
  papouch: 2,
  papouch_stav: 1,
  lampa: 3,
  chobot: 4,
  chobot_chapadla: 1,
  chobot_oci: 2,
  chobot_akcnost: 3,
  chobot_lastdir: 4,
  poklop: 7,
  malar: 8, // little fish
  velkar: 9, // big fish
  papzivy: 10,
  papzivy_cinnost: 1,
  papzivy_pocet: 2,
  papzivy_delay: 3,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 10);
  v[R.room_uvod] = 0;
  v[R.room_zivy] = 0;
  v[R.room_poklad] = 0;
  v[R.room_chobotnicka] = 0;
  v[R.room_chobotnicka1] = 0;
  v[R.room_kostricky] = s.nah(200, 1000);
  v[R.room_mysleni] = s.nah(1000, 5000);
  v[R.room_posvitime] = 0;
  v[R.room_hrbet] = s.nah(25, 100);
  v[R.room_operenej] = 0;

  s.vars(R.papouch, 1)[R.papouch_stav] = 0;

  const ch = s.vars(R.chobot, 4);
  ch[R.chobot_lastdir] = Dir.no;
  ch[R.chobot_oci] = 0;
  ch[R.chobot_chapadla] = 0;
  ch[R.chobot_akcnost] = 2;

  s.vars(R.malar, 1);

  const pz = s.vars(R.papzivy, 3);
  pz[R.papzivy_cinnost] = 0;
  pz[R.papzivy_pocet] = 0;
  s.item(R.papzivy).afaze = 9;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room dialogue chain ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_zivy]! > 0) v[R.room_zivy]!++;
    if (v[R.room_zivy]! > 50) v[R.room_zivy] = 0;
    if (v[R.room_kostricky]! > 0) v[R.room_kostricky]!--;
    if (v[R.room_mysleni]! > 0) v[R.room_mysleni]!--;
    if (
      v[R.room_hrbet]! > 0 &&
      s.item(R.velkar).y === s.item(R.poklop).y + 1 &&
      s.item(R.poklop).y < s.item(R.poklop).yStart
    ) {
      v[R.room_hrbet]!--;
    }

    if (v[R.room_uvod] === 0) {
      if (s.pokus === 1 || s.random(100) < 50) {
        s.addv(s.nah(20, 30), 'ka2-v-nekde');
        if (s.random(100) < 40) s.addm(s.random(5), 'ka2-m-kdepak');
      }
      v[R.room_uvod] = 1;
    } else if (s.item(R.papzivy).afaze >= 0 && s.item(R.papzivy).afaze <= 8 && v[R.room_operenej] === 0) {
      s.addv(0, 'ka2-v-papousek');
      v[R.room_operenej] = 1;
      v[R.room_zivy] = 1;
    } else if (
      s.lookAt(R.malar, R.papzivy) &&
      v[R.room_zivy]! > 0 &&
      v[R.room_zivy]! < 50 &&
      v[R.room_operenej] === 1
    ) {
      s.addm(0, 'ka2-m-kostra');
      v[R.room_zivy] = 0;
      v[R.room_operenej] = 0;
    } else if (
      s.dist(R.malar, R.truhla) <= 3 &&
      v[R.room_poklad] === 0 &&
      s.lookAt(R.malar, R.truhla) &&
      s.random(100) < 10
    ) {
      v[R.room_poklad] = 1;
      s.addm(s.random(5), 'ka2-m-posledni');
      switch (s.random(7)) {
        case 0:
        case 1:
          s.addv(s.random(5), 'ka2-v-mapa0');
          break;
        case 2:
        case 3:
          s.addv(s.random(5), 'ka2-v-mapa1');
          break;
        case 4:
        case 5:
          s.addv(s.random(5), 'ka2-v-mapa2');
          break;
      }
    } else if (
      s.item(R.malar).x >= s.item(R.chobot).x &&
      s.item(R.malar).x <= s.item(R.chobot).x + 4 &&
      s.item(R.malar).y === s.item(R.chobot).y - 1 &&
      v[R.room_chobotnicka] === 0 &&
      s.random(100) < 2
    ) {
      v[R.room_chobotnicka] = 1;
      s.addm(1, 'ka2-m-chapadlo');
      switch (s.random(3)) {
        case 0:
          s.addv(s.random(5) + 10, 'ka2-v-fik');
          break;
        case 1:
          s.addv(s.random(5) + 10, 'ka2-v-fik');
          s.addd(5, 'k1-chob-p', 301);
          s.addv(s.random(5), 'ka2-v-napad');
          break;
      }
    } else if (
      s.dist(R.malar, R.chobot) <= 2 &&
      s.lookAt(R.malar, R.chobot) &&
      v[R.room_chobotnicka1] === 0 &&
      v[R.room_chobotnicka] === 1 &&
      s.random(100) < 3
    ) {
      v[R.room_chobotnicka1] = -1;
      s.addm(1, 'ka2-m-hej');
      switch (s.random(3)) {
        case 0:
        case 1:
          s.addm(s.nah(30, 50), 'ka2-m-diky');
          break;
      }
    } else if (v[R.room_kostricky] === 0 && s.item(R.malar).x > 8 && s.item(R.velkar).x > 8) {
      v[R.room_kostricky] = -1;
      s.addv(s.random(5), 'ka2-v-kostry');
      if (s.random(100) < 70) s.addm(s.random(5), 'ka2-m-patrne');
    } else if (v[R.room_mysleni] === 0 && s.delay('little') > 40 && s.delay('big') > 40) {
      v[R.room_mysleni] = -1;
      s.addv(s.random(10), 'ka2-v-myslet');
      s.addm(s.random(5), 'ka2-m-tezko');
    } else if (s.item(R.lampa).dir !== Dir.no && v[R.room_posvitime] === 0 && s.random(100) < 40) {
      s.addm(10, 'ka2-m-svitit');
      v[R.room_posvitime] = 1;
    } else if (
      v[R.room_hrbet] === 0 &&
      s.item(R.velkar).y === s.item(R.poklop).y + 1 &&
      s.item(R.poklop).y < s.item(R.poklop).yStart
    ) {
      v[R.room_hrbet] = -1;
      s.addv(0, 'ka2-v-hrbet');
    }
  }

  // ---- truhla (chest): creaks when pushed ----
  if (s.item(R.truhla).dir !== Dir.no && s.gfaze === 0) s.snd('k1-x-vrz', 300);

  // ---- papouch (stuffed parrot): squawks a canned pirate phrase now and then ----
  {
    const pv = s.vars(R.papouch);
    const it = s.item(R.papouch);
    const setStav = (val: number): void => {
      pv[R.papouch_stav] = val;
    };
    if (pv[R.papouch_stav] === 0 && s.random(250) === 0 && s.noDialog()) {
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
    } else if (pv[R.papouch_stav] === 101) {
      it.afaze = s.random(2);
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

  // ---- papzivy (live parrot): idle flap FSM, startled when the little fish turns ----
  {
    const pz = s.vars(R.papzivy);
    const it = s.item(R.papzivy);
    if (
      pz[R.papzivy_cinnost]! > 0 &&
      pz[R.papzivy_cinnost]! < 20 &&
      s.aktivni() === 'little' &&
      s.turning
    ) {
      if (pz[R.papzivy_cinnost]! < 5) pz[R.papzivy_cinnost] = 24 - pz[R.papzivy_cinnost]!;
      else pz[R.papzivy_cinnost] = 20;
    }
    switch (pz[R.papzivy_cinnost]) {
      case 0:
        if (s.random(1000) < 4) {
          if (
            (s.xdist(R.malar, R.papzivy) > 1 && s.facingRight('little')) ||
            (s.xdist(R.malar, R.papzivy) < -1 && !s.facingRight('little'))
          ) {
            pz[R.papzivy_cinnost] = 1;
          }
        }
        break;
      case 1:
      case 2:
      case 3:
      case 4:
        it.afaze = 9 - pz[R.papzivy_cinnost]!;
        pz[R.papzivy_cinnost]!++;
        break;
      case 5:
        pz[R.papzivy_delay] = s.random(5) + 2;
        pz[R.papzivy_cinnost]!++;
        break;
      case 6:
        if (pz[R.papzivy_delay]! > 0) pz[R.papzivy_delay]!--;
        else pz[R.papzivy_cinnost]!++;
        break;
      case 7:
        it.afaze = 0;
        pz[R.papzivy_cinnost]!++;
        pz[R.papzivy_delay] = s.random(100) + 10;
        break;
      case 8:
        if (pz[R.papzivy_delay]! > 0) {
          pz[R.papzivy_delay]!--;
        } else {
          pz[R.papzivy_cinnost]!++;
          pz[R.papzivy_delay] = s.random(60) + 20;
        }
        break;
      case 9:
        if (s.count % 2 === 1) it.afaze = s.random(4) + 1;
        if (pz[R.papzivy_delay]! > 0) pz[R.papzivy_delay]!--;
        else pz[R.papzivy_cinnost] = 7;
        break;
      case 20:
      case 21:
      case 22:
      case 23:
        it.afaze = pz[R.papzivy_cinnost]! - 14;
        pz[R.papzivy_cinnost]!++;
        break;
      case 24:
        pz[R.papzivy_cinnost] = 0;
        break;
    }
  }
}

export const KAJUTA2: RoomScript = { name: 'KAJUTA2', init, prog };
