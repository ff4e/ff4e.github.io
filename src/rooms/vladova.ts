/**
 * VLADOVA ("Captain's Cabin", room 50) — a faithful port of VLADOVA_InitProgramky /
 * VLADOVA_Programky (URoom.pas:5650-5725, 11720-11999).
 *
 * A treasure cabin. Four staggered chatter topics (`kec1..4`, four distinct randoms
 * on `kecdel` timers) plus a hook remark and a wandering-eye remark feed a "talking
 * skull" (lebkic = 14): each line is spoken at prior 101/102, which drives the skull's
 * jaw animation (`lebkic_cinnost` via the dialogue prom). Sparkly diamonds
 * (diamant1/2/3/v) twinkle, a wandering eye (ocko = 11) opens/rolls/blinks, and a hook
 * creature (hakahak = 16) flaps while its `vl-x-site` line plays (prior 301). Uses
 * existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_kec1: 2,
  room_kec2: 3,
  room_kec3: 4,
  room_kec4: 5,
  room_kecdel1: 6,
  room_kecdel2: 7,
  room_kecdel3: 8,
  room_kecdel4: 9,
  room_ohaku: 10,
  room_ooku: 11,
  malar: 3, // little fish
  velkar: 4, // big fish
  diamant3: 9,
  diamant3_faze: 1,
  ocko: 11,
  ocko_cinnost: 1,
  ocko_faze: 2,
  ocko_citac: 3,
  lebkic: 14,
  lebkic_cinnost: 1,
  diamant1: 15,
  diamant1_faze: 1,
  hakahak: 16,
  hakahak_cinnost: 1,
  diamantv: 22,
  diamantv_faze: 1,
  diamant2: 23,
  diamant2_faze: 1,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

/** The shared twinkle FSM used by diamant1/2/3 (faze 0..7 → afaze up-then-down). */
function diamondSparkle(s: Script, idx: number, fazeSlot: number): void {
  const dv = s.vars(idx);
  const it = s.item(idx);
  switch (dv[fazeSlot]) {
    case 0:
      if (s.random(100) < 5) dv[fazeSlot]!++;
      break;
    case 1:
    case 2:
    case 3:
      it.afaze++;
      dv[fazeSlot]!++;
      break;
    case 4:
    case 5:
    case 6:
      it.afaze--;
      dv[fazeSlot]!++;
      break;
    case 7:
      dv[fazeSlot] = 0;
      break;
  }
}

function init(s: Script): void {
  const v = s.vars(R.room, 11);
  v[R.room_kec1] = s.random(5);
  do {
    v[R.room_kec2] = s.random(5);
  } while (v[R.room_kec2] === v[R.room_kec1]);
  do {
    v[R.room_kec3] = s.random(5);
  } while (v[R.room_kec3] === v[R.room_kec1] || v[R.room_kec3] === v[R.room_kec2]);
  do {
    v[R.room_kec4] = s.random(5);
  } while (
    v[R.room_kec4] === v[R.room_kec1] ||
    v[R.room_kec4] === v[R.room_kec2] ||
    v[R.room_kec4] === v[R.room_kec3]
  );
  v[R.room_kecdel1] = s.random(300) + 300;
  v[R.room_kecdel2] = s.random(1000) + 1000;
  v[R.room_kecdel3] = s.random(3000) + 3000;
  v[R.room_kecdel4] = s.random(10000) + 10000;
  v[R.room_uvod] = 0;
  v[R.room_ohaku] = 0;
  v[R.room_ooku] = 0;

  s.vars(R.diamant3, 1)[R.diamant3_faze] = 0;
  s.vars(R.ocko, 3)[R.ocko_cinnost] = 0;
  s.vars(R.lebkic, 1)[R.lebkic_cinnost] = 0;
  s.vars(R.diamant1, 1)[R.diamant1_faze] = 0;
  s.vars(R.hakahak, 1)[R.hakahak_cinnost] = 0;
  s.vars(R.diamantv, 1)[R.diamantv_faze] = 0;
  s.vars(R.diamant2, 1)[R.diamant2_faze] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room: staggered chatter topics + hook/eye remarks → the talking skull ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_kecdel1]! > 0) v[R.room_kecdel1]!--;
    if (v[R.room_kecdel2]! > 0) v[R.room_kecdel2]!--;
    if (v[R.room_kecdel3]! > 0) v[R.room_kecdel3]!--;
    if (v[R.room_kecdel4]! > 0) v[R.room_kecdel4]!--;

    let pom1 = -1;
    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      pom1 = s.random(4);
      s.adddel(10 + s.random(30));
      switch (pom1) {
        case 0:
          s.addm(0, 'vl-m-hara');
          break;
        case 1:
        case 2:
          s.addm(0, 'vl-m-hara');
          s.addv(5 + s.random(10), 'vl-v-kaj' + digit(pom1));
          break;
        case 3:
          s.addv(0, 'vl-v-kaj1');
          break;
      }
      pom1 = -1;
    } else if (
      v[R.room_ohaku] === 0 &&
      s.lookAt(R.malar, R.hakahak) &&
      s.dist(R.malar, R.hakahak) <= 2 &&
      s.random(100) < 1
    ) {
      v[R.room_ohaku] = 1;
      s.addm(20, 'vl-m-hak');
      s.addv(s.random(10) + 5, 'vl-v-lodni');
      s.addd(3, 'vl-x-site', 301, (val) => (s.vars(R.hakahak)[R.hakahak_cinnost] = val));
    } else if (v[R.room_kecdel1] === 0) {
      v[R.room_kecdel1] = -1;
      pom1 = v[R.room_kec1]!;
    } else if (v[R.room_kecdel2] === 0) {
      v[R.room_kecdel2] = -1;
      pom1 = v[R.room_kec2]!;
    } else if (v[R.room_kecdel3] === 0) {
      v[R.room_kecdel3] = -1;
      pom1 = v[R.room_kec3]!;
    } else if (v[R.room_kecdel4] === 0) {
      v[R.room_kecdel4] = -1;
      pom1 = v[R.room_kec4]!;
    } else if (v[R.room_ooku] === 0 && s.dist(R.malar, R.ocko) <= 3 && s.random(100) < 1) {
      v[R.room_ooku] = 1;
      s.addm(10, 'vl-m-oko');
      if (s.random(100) < 25) s.addv(10, 'vl-v-silha');
    } else if (v[R.room_ooku] === 0 && s.dist(R.velkar, R.ocko) <= 4 && s.random(100) < 1) {
      v[R.room_ooku] = 1;
      s.addv(10, 'vl-v-silha');
    }

    if (pom1 >= 0) {
      const pom2 = pom1 === 4 ? 102 : 101;
      s.addd(
        30,
        'vl-leb-kecy' + digit(pom1),
        pom2,
        (val) => (s.vars(R.lebkic)[R.lebkic_cinnost] = val),
      );
    }
  }

  // ---- diamant3 / diamant1 / diamant2: shared twinkle ----
  diamondSparkle(s, R.diamant3, R.diamant3_faze);

  // ---- ocko (wandering eye): open/roll/blink FSM ----
  {
    const oc = s.vars(R.ocko);
    const it = s.item(R.ocko);
    switch (oc[R.ocko_cinnost]) {
      case 0:
        if (s.random(100) < 10) {
          switch (s.random(8)) {
            case 0:
            case 1:
            case 2:
              oc[R.ocko_citac] = s.random(5) + 5;
              oc[R.ocko_cinnost] = 1;
              oc[R.ocko_faze] = s.random(2) * 2;
              break;
            case 3:
              oc[R.ocko_citac] = s.random(3) + 2;
              oc[R.ocko_cinnost] = 2;
              oc[R.ocko_faze] = s.random(2) * 2;
              break;
            case 4:
            case 5:
            case 6:
              oc[R.ocko_citac] = s.random(12) + 12;
              oc[R.ocko_cinnost] = 3 + s.random(2);
              break;
            case 7:
              oc[R.ocko_citac] = s.random(10) + 2;
              oc[R.ocko_cinnost] = 5;
              break;
          }
        }
        break;
      case 1:
      case 2:
        switch (oc[R.ocko_faze]) {
          case 0:
            if (oc[R.ocko_cinnost] === 1) it.afaze = 1;
            else it.afaze = 3;
            if (s.random(100) < 20) oc[R.ocko_faze]!++;
            break;
          case 1:
            it.afaze = 0;
            oc[R.ocko_faze]!++;
            break;
          case 2:
            if (oc[R.ocko_cinnost] === 1) it.afaze = 2;
            else it.afaze = 4;
            if (s.random(100) < 20) oc[R.ocko_faze]!++;
            break;
          case 3:
            it.afaze = 0;
            oc[R.ocko_citac]!--;
            if (oc[R.ocko_citac] === 0) oc[R.ocko_cinnost] = 0;
            else oc[R.ocko_faze] = 0;
            break;
        }
        break;
      case 3:
      case 4:
      case 5:
        switch (oc[R.ocko_cinnost]) {
          case 3:
            switch (it.afaze) {
              case 0:
                it.afaze = s.random(4) + 1;
                break;
              case 1:
                it.afaze = 3;
                break;
              case 2:
                it.afaze = 4;
                break;
              case 3:
                it.afaze = 2;
                break;
              case 4:
                it.afaze = 1;
                break;
            }
            break;
          case 4:
            switch (it.afaze) {
              case 0:
                it.afaze = s.random(4) + 1;
                break;
              case 1:
                it.afaze = 4;
                break;
              case 2:
                it.afaze = 3;
                break;
              case 3:
                it.afaze = 1;
                break;
              case 4:
                it.afaze = 2;
                break;
            }
            break;
          case 5:
            if (s.random(100) < 40) it.afaze = s.random(5);
            break;
        }
        oc[R.ocko_citac]!--;
        if (oc[R.ocko_citac] === 0) {
          oc[R.ocko_cinnost] = 0;
          it.afaze = 0;
        }
        break;
    }
  }

  // ---- lebkic (talking skull): jaw driven by the spoken line's prior (101/102) ----
  {
    const lv = s.vars(R.lebkic);
    const it = s.item(R.lebkic);
    if (s.count % 2 === 1) {
      switch (lv[R.lebkic_cinnost]) {
        case 0:
          if (s.random(100) < 3) it.afaze = 1;
          else it.afaze = 0;
          break;
        case 101:
          it.afaze = s.random(3);
          if (it.afaze > 0) it.afaze++;
          break;
        case 102:
          it.afaze = s.random(4);
          break;
      }
    }
  }

  diamondSparkle(s, R.diamant1, R.diamant1_faze);

  // ---- hakahak (hook creature): flaps while its line (prior 301) plays ----
  {
    const hv = s.vars(R.hakahak);
    const it = s.item(R.hakahak);
    switch (hv[R.hakahak_cinnost]) {
      case 0:
        it.afaze = 0;
        break;
      case 301:
        switch (it.afaze) {
          case 0:
          case 2:
            it.afaze = 1;
            break;
          case 1:
            it.afaze = s.random(2) * 2;
            break;
        }
        break;
    }
  }

  // ---- diamantv: twinkle with a second (blink) variant (faze 11..14) ----
  {
    const dv = s.vars(R.diamantv);
    const it = s.item(R.diamantv);
    switch (dv[R.diamantv_faze]) {
      case 0:
        if (s.random(100) < 10) {
          if (s.random(2) === 0) dv[R.diamantv_faze] = 1;
          else dv[R.diamantv_faze] = 11;
        }
        break;
      case 1:
      case 2:
      case 3:
        it.afaze++;
        dv[R.diamantv_faze]!++;
        break;
      case 4:
      case 5:
      case 6:
        it.afaze--;
        dv[R.diamantv_faze]!++;
        break;
      case 7:
        dv[R.diamantv_faze] = 0;
        break;
      case 11:
      case 13:
        it.afaze = 4;
        dv[R.diamantv_faze]!++;
        break;
      case 12:
        it.afaze = 5;
        dv[R.diamantv_faze]!++;
        break;
      case 14:
        it.afaze = 0;
        dv[R.diamantv_faze] = 0;
        break;
    }
  }

  diamondSparkle(s, R.diamant2, R.diamant2_faze);
}

export const VLADOVA: RoomScript = { name: 'VLADOVA', init, prog };
