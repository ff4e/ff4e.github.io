/**
 * DRAKAR ("Viking Longship", room 17) — a faithful port of DRAKAR_InitProgramky /
 * DRAKAR_Programky (URoom.pas:5509-5599, 11026-11536).
 *
 * A longship crewed by eight bickering vikings (viking1..8), a barking dog (pesos)
 * and a talking dragon figurehead (hlavadr). The room orchestrates layered banter:
 * an intro roll-call, a recurring "proper beard" argument (viking3/viking4), rowing
 * chants (viking1/viking2), a coward-taunt cycle (viking5→viking6 laughter→
 * viking1), and viking8's rising irritation that eventually clobbers viking7. Each
 * viking's "cinnost" var doubles as its speaking flag (set to the voice priority
 * while it talks). Item indices are the generated r_DRAKAR_* values
 * (URoom.pas:3614-3655).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_quvod: 1,
  room_chechtoni: 2,
  room_chechthlaska: 3,
  room_moczbabelcu: 4,
  room_qvousy: 5,
  room_pravvousy: 6,
  room_qpejsek: 7,
  room_lastval: 8,
  viking1: 1,
  viking1_cinnost: 1,
  viking3: 2,
  viking3_cinnost: 1,
  viking4: 3,
  viking4_cinnost: 1,
  viking5: 4,
  viking5_cinnost: 1,
  viking5_faze: 2,
  viking5_delay: 3,
  viking5_poslhlaska: 4,
  viking5_pochlasek: 5,
  viking6: 5,
  viking6_smich: 1,
  viking7: 6,
  viking7_dostal: 1,
  viking7_otrne: 2,
  viking8: 7,
  viking8_nervozita: 1,
  viking8_cinnost: 2,
  viking8_mira1: 3,
  viking8_mira2: 4,
  viking8_mira0: 5,
  viking8_delay: 6,
  pesos: 13,
  pesos_cinnost: 1,
  pesos_delay: 2,
  viking2: 18,
  viking2_cinnost: 1,
  viking2_faze: 2,
  viking2_delay: 3,
  hlavadr: 19,
  hlavadr_mluvi: 1,
} as const;

const str = (n: number): string => String(n);

function init(s: Script): void {
  const v = s.vars(R.room, 8);
  if (s.pokus === 1 || s.random(100) < 40) v[R.room_quvod] = s.random(10) + 10;
  else v[R.room_quvod] = -2;
  v[R.room_chechtoni] = 0;
  v[R.room_chechthlaska] = 0;
  v[R.room_moczbabelcu] = 0;
  v[R.room_qvousy] = 0;
  v[R.room_pravvousy] = 70;
  v[R.room_qpejsek] = 300 + s.random(600);
  v[R.room_lastval] = 0;

  s.vars(R.viking1, 1)[R.viking1_cinnost] = 0;
  s.vars(R.viking3, 1)[R.viking3_cinnost] = 0;
  s.vars(R.viking4, 1)[R.viking4_cinnost] = 0;
  const v5 = s.vars(R.viking5, 5);
  v5[R.viking5_cinnost] = 0;
  v5[R.viking5_poslhlaska] = 0;
  v5[R.viking5_pochlasek] = 0;
  s.vars(R.viking6, 1)[R.viking6_smich] = 0;
  const v7 = s.vars(R.viking7, 2);
  v7[R.viking7_dostal] = -1;
  s.item(R.viking7).afaze = 1;
  const v8 = s.vars(R.viking8, 6);
  v8[R.viking8_nervozita] = 0;
  v8[R.viking8_cinnost] = 0;
  s.vars(R.pesos, 2)[R.pesos_cinnost] = 0;
  s.vars(R.viking2, 3)[R.viking2_cinnost] = 0;
  s.vars(R.hlavadr, 1)[R.hlavadr_mluvi] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const setV1 = (x: number) => (s.vars(R.viking1)[R.viking1_cinnost] = x);
  const setV2 = (x: number) => (s.vars(R.viking2)[R.viking2_cinnost] = x);
  const setV3 = (x: number) => (s.vars(R.viking3)[R.viking3_cinnost] = x);
  const setV4 = (x: number) => (s.vars(R.viking4)[R.viking4_cinnost] = x);
  const setHd = (x: number) => (s.vars(R.hlavadr)[R.hlavadr_mluvi] = x);

  // ---- room orchestration ----
  {
    if (!s.alive('little') || !s.alive('big')) {
      v[R.room_quvod] = -1;
      v[R.room_qpejsek] = -1;
    }

    if (v[R.room_quvod]! > 0) v[R.room_quvod]!--;
    else if (v[R.room_quvod] === 0) {
      v[R.room_quvod] = -1;
      s.addm(5, 'dr1-m-dlouho');
      s.addv(5, 'dr1-v-urcite');
      if (s.random(4) > 0) s.addv(30 + s.random(30), 'dr1-v-olaf');
      if (s.random(4) > 0) s.addv(30 + s.random(30), 'dr1-v-leif');
      if (s.random(4) > 0) s.addv(30 + s.random(30), 'dr1-v-harold');
      if (s.random(4) > 0) s.addv(30 + s.random(30), 'dr1-v-snorr');
      if (s.random(4) > 0) s.addv(30 + s.random(30), 'dr1-v-thorson');
      if (s.random(6) > 0) s.addd(50 + s.random(30), 'dr1-x-erik', 116, setHd);
      s.addset((x) => (v[R.room_quvod] = x), -2);
    } else if (v[R.room_quvod] === -2) {
      if (s.vars(R.viking7)[R.viking7_dostal] === -1) s.vars(R.viking7)[R.viking7_dostal] = 0;
    }

    if (!s.playing(351) && v[R.room_qpejsek]! > 0) v[R.room_qpejsek]!--;

    if (v[R.room_quvod] === -2) {
      if (v[R.room_moczbabelcu] === 1) {
        if (s.noDialog()) s.addd(2 + s.random(20), 'dr-1-achjo', 210, setV1);
        v[R.room_moczbabelcu] = 0;
      } else if (v[R.room_chechtoni] === 1) {
        if (s.noDialog()) {
          v[R.room_chechthlaska]!++;
          switch (v[R.room_chechthlaska]) {
            case 1:
              s.addd(5 + s.random(20), 'dr-1-procja', 210, setV1);
              break;
            case 2:
              s.addd(5 + s.random(20), 'dr-1-chechtajici', 210, setV1);
              break;
          }
        }
        v[R.room_chechtoni] = 0;
      } else if (s.noDialog()) {
        if (s.random(1000) < 7 && s.vars(R.viking5)[R.viking5_cinnost] === 0) {
          s.vars(R.viking5)[R.viking5_cinnost] = 1;
        } else if (s.random(10000) < v[R.room_pravvousy]!) {
          // The recurring "what's a proper beard" argument.
          switch (v[R.room_qvousy]) {
            case 0: {
              if (s.random(2) === 0) s.addd(10, 'dr-3-spravny', 230, setV3);
              else s.addd(10, 'dr-3-cojeto', 230, setV3);
              if (s.random(2) === 0) s.addd(6, 'dr-4-magazin', 240, setV4);
              else s.addd(6, 'dr-4-copy', 240, setV4);
              v[R.room_qvousy] = 10;
              v[R.room_pravvousy] = 50;
              break;
            }
            case 10:
            case 11:
            case 12:
            case 13: {
              let pom1: number;
              do {
                pom1 = s.random(3) + 1;
              } while (pom1 === v[R.room_qvousy]! - 10);
              if (v[R.room_qvousy] === 10) v[R.room_qvousy] = pom1 + 10;
              else v[R.room_qvousy] = 20;
              if (pom1 === 1) {
                s.addd(6, 'dr-3-radeji', 230, setV3);
                s.addd(3, 'dr-4-moderni', 240, setV4);
              } else if (pom1 === 2) {
                s.addd(6, 'dr-4-myslis', 240, setV4);
                s.addd(0, 'dr-3-samozrejme', 230, setV3);
                s.addd(10, 'dr-4-budu', 240, setV4);
                s.addd(5, 'dr-4-hmmm', 241, setV4);
                s.addd(2, 'dr-4-ne', 240, setV4);
              } else if (pom1 === 3) {
                s.addd(6, 'dr-4-erik', 240, setV4);
                s.addd(0, 'dr-3-nesmysl', 230, setV3);
                s.addd(0, 'dr-4-taky', 240, setV4);
                s.addd(0, 'dr-3-nemel', 230, setV3);
              }
              v[R.room_pravvousy] = 40;
              break;
            }
            case 20: {
              v[R.room_pravvousy]! -= 5;
              switch (s.random(4)) {
                case 0:
                  s.addd(10, 'dr-3-mladez', 230, setV3);
                  break;
                case 1:
                  s.addd(10, 'dr-3-chlap', 230, setV3);
                  break;
                case 2:
                  s.addd(10, 'dr-3-mladi', 230, setV3);
                  break;
                case 3:
                  s.addd(10, 'dr-4-stejne', 240, setV4);
                  break;
              }
              break;
            }
          }
        } else if (s.random(1000) < 4) {
          // Rowing chants (viking2 groans, viking1 reassures).
          let pom1 = s.random(3) + 1;
          if (pom1 === v[R.room_lastval]) pom1 = 4;
          v[R.room_lastval] = pom1;
          switch (pom1) {
            case 1:
              s.addset(setV2, -1);
              s.addd(5, 'dr-2-uzbudeme' + str(s.random(2) + 1), 220);
              s.addd(3, 'dr-1-aztambudem', 210, setV1);
              break;
            case 2:
              s.addset(setV2, -1);
              s.addd(5, 'dr-2-odskocit', 220);
              s.addd(3, 'dr-1-pockej', 210, setV1);
              break;
            case 3:
              s.addset(setV2, -1);
              s.addd(5, 'dr-2-netrva', 220);
              s.addd(3, 'dr-1-trpelivost', 210, setV1);
              break;
            case 4:
              s.addset(setV2, -1);
              s.addd(5, 'dr-2-urcite', 220);
              s.addd(3, 'dr-1-bojovnik', 210, setV1);
              break;
          }
        } else if (v[R.room_qpejsek] === 0 && s.playing(351)) {
          v[R.room_qpejsek] = -1;
          s.addm(10 + s.random(30), 'dr-m-podivej');
          const pom1 = s.random(2);
          if (pom1 === 0 || s.random(2) === 0) s.addm(3, 'dr-m-nedycha');
          if (pom1 === 0) s.addv(6, 'dr-v-napsa');
          else s.addv(7, 'dr-v-nato');
        }
      }
    }
  }

  // ---- viking1: idle / talking flap ----
  {
    const it = s.item(R.viking1);
    switch (s.vars(R.viking1)[R.viking1_cinnost]) {
      case 0:
        if (s.random(100) < 5) it.afaze = s.random(3);
        break;
      case 210:
        it.afaze = s.random(3);
        break;
    }
  }

  // ---- viking3 ----
  {
    const it = s.item(R.viking3);
    switch (s.vars(R.viking3)[R.viking3_cinnost]) {
      case 0:
        it.afaze = 0;
        break;
      case 230:
        it.afaze = s.random(2) * 2;
        break;
    }
    if (s.random(100) < 5) it.afaze++;
  }

  // ---- viking4 ----
  {
    const it = s.item(R.viking4);
    switch (s.vars(R.viking4)[R.viking4_cinnost]) {
      case 0:
        it.afaze = 0;
        break;
      case 240:
        if (s.count % 2 === 1) {
          it.afaze = Math.floor(it.afaze / 2);
          if (it.afaze === 0 || it.afaze === 1) {
            if (s.random(100) < 20) it.afaze = 2 + s.random(2);
            else it.afaze = 1 - it.afaze;
          } else if (it.afaze === 2 || it.afaze === 3) {
            if (s.random(100) < 35) it.afaze = s.random(2);
            else it.afaze = 5 - it.afaze;
          }
          it.afaze = it.afaze + it.afaze;
        }
        break;
      case 241:
        it.afaze = 6;
        break;
    }
    if (s.random(100) < 5) it.afaze++;
  }

  // ---- viking5: coward taunt cycle ----
  {
    const it = s.item(R.viking5);
    const vv = s.vars(R.viking5);
    switch (vv[R.viking5_cinnost]) {
      case 0:
        vv[R.viking5_faze] = 0;
        if (s.random(1000) < 3) vv[R.viking5_cinnost] = 2;
        break;
      case 1:
        switch (vv[R.viking5_faze]) {
          case 0: {
            it.afaze = 4;
            let pom1 = s.random(4) + 1;
            if (pom1 === vv[R.viking5_poslhlaska]) pom1 = 5;
            s.addd(0, 'dr-5-srab' + str(pom1), 252);
            vv[R.viking5_poslhlaska] = pom1;
            vv[R.viking5_faze]!++;
            vv[R.viking5_pochlasek]!++;
            break;
          }
          case 1:
            if (s.playing(252)) {
              it.afaze = 2 + s.random(2) * 2;
              if (it.afaze === 2) {
                if (s.random(100) < 20) it.afaze = it.afaze - 1 + 2 * s.random(2);
              }
            } else vv[R.viking5_faze]!++;
            break;
          case 2:
            switch (vv[R.viking5_pochlasek]) {
              case 3:
              case 8:
              case 15:
              case 20:
              case 30:
              case 50:
                s.vars(R.room)[R.room_moczbabelcu] = 1;
                break;
            }
            vv[R.viking5_cinnost] = 2;
            vv[R.viking5_faze] = 0;
            break;
        }
        break;
      case 2:
        switch (vv[R.viking5_faze]) {
          case 0:
            vv[R.viking5_delay] = s.random(5) + 10;
            vv[R.viking5_faze]!++;
            break;
          case 1:
            if (it.afaze === 3) {
              if (s.random(2) === 0) it.afaze = 2;
              // else: keep frame 3
            } else {
              if (s.random(100) < 10) {
                if (s.random(2) === 0) it.afaze = 3;
                else it.afaze = 1;
              } else it.afaze = 2;
            }
            if (vv[R.viking5_delay] === 0) vv[R.viking5_faze] = 2;
            else vv[R.viking5_delay]!--;
            break;
          case 2:
            it.afaze = 0;
            vv[R.viking5_cinnost] = 0;
            break;
        }
        break;
    }
  }

  // ---- viking6: bursts out laughing ----
  {
    const it = s.item(R.viking6);
    const vv = s.vars(R.viking6);
    switch (vv[R.viking6_smich]) {
      case 0:
        if (s.random(100) < 5) it.afaze = 1;
        else it.afaze = 0;
        break;
      case 1:
        s.clearDialog();
        s.addd(0, 'dr-6-checheche', 260);
        vv[R.viking6_smich]!++;
        break;
      case 2:
        if (s.talking(260)) {
          if (it.afaze === 2) it.afaze = 3;
          else it.afaze = 2;
        } else {
          it.afaze = 0;
          vv[R.viking6_smich] = 0;
          s.vars(R.room)[R.room_chechtoni] = 1;
        }
        break;
    }
  }

  // ---- viking7: gets whacked by viking8, then grumbles ----
  {
    const it = s.item(R.viking7);
    const vv = s.vars(R.viking7);
    switch (vv[R.viking7_dostal]) {
      case 0:
        if (s.playing(270)) {
          if (it.afaze === 1) it.afaze = 2;
          else it.afaze = 1;
        } else {
          it.afaze = 1;
          if (s.random(100) < 10) s.snd('dr-7-sm' + str(s.random(8) + 1), 270);
        }
        break;
      case 1:
      case 2:
      case 3:
        vv[R.viking7_dostal]!++;
        it.afaze = 0;
        break;
      case 4:
        vv[R.viking7_otrne] = s.random(1200) + 600;
        vv[R.viking7_dostal]!++;
        s.vars(R.viking6)[R.viking6_smich] = 1;
        break;
      case 5:
        if (vv[R.viking7_otrne]! > 0) vv[R.viking7_otrne]!--;
        if (s.playing(271)) {
          it.afaze = s.random(2) * 2 + 3;
          if (s.random(100) < 7) it.afaze++;
        } else {
          it.afaze = 3;
          if (s.random(100) < 7) it.afaze++;
          if (vv[R.viking7_otrne] === 0) vv[R.viking7_dostal] = 0;
          else if (s.random(100) < 3) s.snd('dr-7-brble' + str(s.random(5) + 1), 271);
        }
        break;
    }
  }

  // ---- viking8: rising irritation, eventually whacks viking7 ----
  {
    const it = s.item(R.viking8);
    const vv = s.vars(R.viking8);
    if (vv[R.viking8_nervozita] === 0) {
      vv[R.viking8_nervozita] = 1;
      vv[R.viking8_mira1] = s.random(200) + 200;
      vv[R.viking8_mira2] = vv[R.viking8_mira1]! + s.random(150) + 150;
      vv[R.viking8_mira0] = s.random(vv[R.viking8_mira1]! - 80) + 90;
    }
    if (s.playing(270)) vv[R.viking8_nervozita]!++;
    switch (vv[R.viking8_cinnost]) {
      case 0:
        if (vv[R.viking8_nervozita] === vv[R.viking8_mira1]) {
          vv[R.viking8_nervozita]!++;
          if (s.noDialog()) vv[R.viking8_cinnost] = 10;
          else vv[R.viking8_nervozita]! -= 20;
        } else if (vv[R.viking8_nervozita] === vv[R.viking8_mira2]) {
          vv[R.viking8_nervozita]!++;
          if (s.noDialog()) vv[R.viking8_cinnost] = 20;
          else vv[R.viking8_nervozita]! -= 20;
        } else if (vv[R.viking8_nervozita] === vv[R.viking8_mira0]) {
          vv[R.viking8_nervozita]!++;
          vv[R.viking8_cinnost] = 5;
        }
        break;
      case 5:
        it.afaze = 3;
        vv[R.viking8_delay] = 5;
        vv[R.viking8_cinnost]!++;
        break;
      case 6:
        if (vv[R.viking8_delay]! > 0) vv[R.viking8_delay]!--;
        else vv[R.viking8_cinnost]!++;
        break;
      case 7:
        vv[R.viking8_cinnost] = 0;
        it.afaze = 0;
        break;
      case 10:
        it.afaze = 3;
        s.talkNow('dr-8-ztichni' + str(s.random(2) + 1), 280);
        vv[R.viking8_cinnost]!++;
        break;
      case 11:
        if (s.playing(280)) it.afaze = s.random(3) + 3;
        else {
          it.afaze = 0;
          vv[R.viking8_cinnost] = 0;
        }
        break;
      case 20:
        it.afaze = 3;
        s.talkNow('dr-8-nenechas', 280);
        vv[R.viking8_cinnost]!++;
        break;
      case 21:
        if (s.playing(280)) it.afaze = s.random(3) + 3;
        else {
          vv[R.viking8_cinnost]!++;
          vv[R.viking8_delay] = 20;
        }
        break;
      case 22:
        it.afaze = 1;
        s.talkNow('dr-8-aaa', 280);
        vv[R.viking8_cinnost]!++;
        vv[R.viking8_delay] = 9;
        break;
      case 23:
        if (vv[R.viking8_delay] === 0) vv[R.viking8_cinnost]!++;
        else vv[R.viking8_delay]!--;
        break;
      case 24:
        it.afaze = 2;
        s.snd('dr-x-buch', 281);
        s.vars(R.viking7)[R.viking7_dostal] = 1;
        vv[R.viking8_nervozita] = 0;
        vv[R.viking8_cinnost]!++;
        vv[R.viking8_delay] = 4;
        break;
      case 25:
        if (vv[R.viking8_delay] === 0) {
          it.afaze = 1;
          vv[R.viking8_cinnost]!++;
          vv[R.viking8_delay] = 3;
        } else vv[R.viking8_delay]!--;
        break;
      case 26:
        if (vv[R.viking8_delay] === 0) {
          it.afaze = 0;
          vv[R.viking8_cinnost] = 0;
          vv[R.viking8_delay] = 3;
        } else vv[R.viking8_delay]!--;
        break;
    }
  }

  // ---- pesos (dog): periodic barking ----
  {
    const it = s.item(R.pesos);
    const vv = s.vars(R.pesos);
    switch (vv[R.pesos_cinnost]) {
      case 0:
        it.afaze = 2;
        vv[R.pesos_cinnost] = 1;
        vv[R.pesos_delay] = s.random(100) + 50;
        break;
      case 1:
        if (vv[R.pesos_delay] === 0) vv[R.pesos_cinnost]!++;
        else vv[R.pesos_delay]!--;
        break;
      case 2:
        s.sndcyc('dr-x-pes', 351);
        vv[R.pesos_delay] = s.random(100) + 20;
        vv[R.pesos_cinnost]!++;
        break;
      case 3:
        if (vv[R.pesos_delay] === 0) {
          s.ksnd(351);
          vv[R.pesos_cinnost] = 0;
        } else {
          if (it.afaze === 0) it.afaze = 1;
          else it.afaze = 0;
          vv[R.pesos_delay]!--;
        }
        break;
    }
  }

  // ---- viking2: rowing groans (mirrors viking5's cinnost-2 idle) ----
  {
    const it = s.item(R.viking2);
    const vv = s.vars(R.viking2);
    switch (vv[R.viking2_cinnost]) {
      case 0:
        vv[R.viking2_faze] = 0;
        if (s.random(1000) < 3) vv[R.viking2_cinnost] = 2;
        break;
      case -1:
        it.afaze = 2;
        if (s.talking(220)) vv[R.viking2_cinnost] = 1;
        break;
      case 1:
        if (s.talking(220)) {
          it.afaze = 2 + s.random(2) * 2;
          if (it.afaze === 2) {
            if (s.random(100) < 7) it.afaze = it.afaze - 1 + 2 * s.random(2);
          }
        } else {
          vv[R.viking2_faze] = 0;
          vv[R.viking2_cinnost]!++;
        }
        break;
      case 2:
        switch (vv[R.viking2_faze]) {
          case 0:
            vv[R.viking2_delay] = s.random(5) + 10;
            vv[R.viking2_faze]!++;
            break;
          case 1:
            if (it.afaze === 3) {
              if (s.random(2) === 0) it.afaze = 2;
              // else keep 3
            } else {
              if (s.random(100) < 7) {
                if (s.random(2) === 0) it.afaze = 3;
                else it.afaze = 1;
              } else it.afaze = 2;
            }
            if (vv[R.viking2_delay] === 0) vv[R.viking2_faze] = 2;
            else vv[R.viking2_delay]!--;
            break;
          case 2:
            it.afaze = 0;
            vv[R.viking2_cinnost] = 0;
            break;
        }
        break;
    }
  }

  // ---- hlavadr (dragon figurehead): mouths while its line plays ----
  {
    const it = s.item(R.hlavadr);
    if (s.count % 3 === 1) {
      if (s.vars(R.hlavadr)[R.hlavadr_mluvi] !== 0) {
        const pom1 = it.afaze;
        do {
          it.afaze = s.random(3);
        } while (it.afaze === pom1);
      } else it.afaze = 0;
    }
  }
}

export const DRAKAR: RoomScript = { name: 'DRAKAR', init, prog };
