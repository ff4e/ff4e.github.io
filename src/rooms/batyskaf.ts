/**
 * BATYSKAF ("Bathyscaphe", room 15) — a faithful port of BATYSKAF_InitProgramky /
 * BATYSKAF_Programky (URoom.pas:5810-5867, 12415-12637).
 *
 * A gadget room driven by one big "main" state machine (Vars[aktivni] selects which
 * gizmo is currently active: the two telephones zluty/modry ringing on their cradles
 * ztel/mtel, or the alarm clock ibudik). When a phone is picked up a snail-operator
 * (snek) recites a random "phone number", the fish comment on the microscope, the
 * headset, and being told to calm down. Peripheral gadgets (periscope dhled, snail,
 * clock, microscope) run small idle animations. Environmental sounds use Snd/SndCyc/
 * KSnd by priority (50 clock, 51/52 phones). Item indices are the generated
 * r_BATYSKAF_* values (URoom.pas:3739-3762).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  main: 0,
  main_aktivni: 1,
  main_poc: 2,
  main_zvon: 3,
  main_halo: 4,
  main_mikros: 5,
  main_nemam: 6,
  main_odsud: 7,
  main_pronej: 8,
  main_uhnu: 9,
  main_teduz: 10,
  malar: 1,
  velkar: 2,
  dhled: 5,
  dhled_padal: 1,
  snek: 6,
  snek_mluvi: 1,
  ibudik: 7,
  mikroskop: 8,
  mikroskop_poc: 1,
  zluty: 9,
  mtel: 10,
  modry: 11,
  ztel: 12,
} as const;

const odd = (n: number): boolean => (n & 1) !== 0;
const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.main, 10);
  v[R.main_aktivni] = R.main;
  v[R.main_poc] = s.random(50 + s.pokus) + 100;
  v[R.main_halo] = 0;
  v[R.main_mikros] = 0;
  v[R.main_nemam] = 200;
  v[R.main_odsud] = 0;
  v[R.main_pronej] = 10 + s.random(50);
  v[R.main_uhnu] = 500 + s.random(500);
  v[R.main_teduz] = 0;
  s.vars(R.dhled, 1)[R.dhled_padal] = 0;
  s.vars(R.snek, 1)[R.snek_mluvi] = 0;
  s.vars(R.mikroskop, 1)[R.mikroskop_poc] = 0;
}

/** A phone (zluty/modry) sitting on its cradle (ztel/mtel): same x, 3 rows above. */
function onCradle(s: Script, phone: number, cradle: number): boolean {
  const p = s.item(phone);
  const c = s.item(cradle);
  return p.x === c.x && p.y + 3 === c.y;
}

function prog(s: Script): void {
  const v = s.vars(R.main);
  const setSnek = (x: number) => (s.vars(R.snek)[R.snek_mluvi] = x);
  const setHalo = (x: number) => (v[R.main_halo] = x);

  // ---- main gadget state machine ----
  switch (v[R.main_aktivni]) {
    case R.main:
      if (v[R.main_poc]! > 0) v[R.main_poc]!--;
      else {
        const pomb1 = onCradle(s, R.zluty, R.ztel);
        const pomb2 = onCradle(s, R.modry, R.mtel);
        v[R.main_poc] = s.random(80) + 50;
        v[R.main_zvon] = 0;
        if (pomb1) {
          if (pomb2) {
            if (odd(s.random(10))) v[R.main_aktivni] = R.zluty;
            else v[R.main_aktivni] = R.modry;
          } else v[R.main_aktivni] = R.zluty;
        } else if (pomb2) v[R.main_aktivni] = R.modry;
        else v[R.main_aktivni] = R.ibudik;
      }
      break;
    case R.zluty:
      ringPhone(s, v, R.zluty, R.ztel, 51, 'bat-t-phone0');
      break;
    case R.modry:
      ringPhone(s, v, R.modry, R.mtel, 52, 'bat-t-phone1');
      break;
    case R.ztel:
    case R.mtel:
      if (v[R.main_halo] !== 2) {
        v[R.main_aktivni] = R.main;
        v[R.main_poc] = s.random(100) + 30;
      }
      break;
    case R.ibudik:
      if (v[R.main_poc]! > 0) v[R.main_poc]!--;
      else if (!s.playing(50)) s.sndcyc('bat-t-budik', 50);
      else if (s.item(R.ibudik).dir !== Dir.no) {
        s.ksnd(50);
        v[R.main_aktivni] = -1;
      }
      break;
  }

  // ---- a picked-up phone: the operator reads back a random combination ----
  if (v[R.main_halo] === 1) {
    v[R.main_halo] = 2;
    let pom1: number;
    if (s.pokus > 5) pom1 = s.random(11);
    else pom1 = s.random(8);
    let pom2: number;
    switch (pom1) {
      case 0:
        pom2 = 1 + 2;
        break;
      case 1:
        pom2 = 1 + 4 + 16;
        break;
      case 2:
        pom2 = 1 + 8;
        break;
      case 3:
        pom2 = 32;
        break;
      case 4:
        pom2 = 32 + 16;
        break;
      case 5:
        pom2 = 1 + 4;
        break;
      case 6:
        pom2 = 1 + 8 + 16;
        break;
      case 7:
        pom2 = 2;
        break;
      default:
        pom2 = 0;
    }
    if ((pom2 & 1) > 0) s.addd(5, 'bat-p-0', 49);
    if ((pom2 & 2) > 0) s.addd(5, 'bat-p-1', 49);
    if ((pom2 & 4) > 0) s.addd(5, 'bat-p-2', 49);
    if ((pom2 & 8) > 0) s.addd(5, 'bat-p-3', 49);
    if ((pom2 & 32) > 0) s.addd(5, 'bat-p-5', 49);
    if ((pom2 & 16) > 0) s.addd(5, 'bat-p-4', 49);
    if (pom2 === 0) s.addd(5, 'bat-p-zhov' + digit(s.random(2)), 49);
    s.addset(setHalo, 0);
  }

  // ---- fish comments (microscope / headset / calm-down / phone pick-up nudges) ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (s.count === 20 && s.random(s.pokus) < 3) {
      s.addm(5, 'bat-m-tohle');
    } else if (
      v[R.main_mikros] === 0 &&
      s.dist(R.malar, R.mikroskop) < 3 &&
      s.item(R.mikroskop).dir !== Dir.no &&
      s.random(10) === 1
    ) {
      v[R.main_mikros] = 1;
      s.addm(6, 'bat-m-mikro');
    } else if (
      v[R.main_odsud] === 0 &&
      s.item(R.zluty).x > 32 &&
      s.dist(R.malar, R.zluty) < 4 &&
      s.random(30) === 1
    ) {
      v[R.main_odsud] = 1;
      s.addm(7, 'bat-m-sluch');
    } else if (v[R.main_teduz] === 0 && v[R.main_aktivni] === -1 && s.random(70) === 1) {
      v[R.main_teduz] = 1;
      s.addv(8, 'bat-v-klid');
    } else if (v[R.main_nemam]! > 0) {
      v[R.main_nemam]!--;
    } else {
      switch (v[R.main_aktivni]) {
        case R.ibudik:
          if (s.random(100) === 1) {
            v[R.main_nemam] = 200 + s.random(200);
            s.addv(1, 'bat-v-vyp');
          }
          break;
        case R.zluty:
        case R.modry:
          if (s.random(100) === 1) {
            v[R.main_nemam] = 200 + s.random(200);
            if (s.dist(R.malar, v[R.main_aktivni]!) < s.dist(R.velkar, v[R.main_aktivni]!))
              s.addv(1, 'bat-v-zved1');
            else s.addv(1, 'bat-v-zved0');
          }
          break;
      }
    }
  }

  // ---- snail-operator background phrases ----
  if (s.noDialog()) {
    if (
      v[R.main_pronej] === 0 &&
      (v[R.main_aktivni] === R.zluty || v[R.main_aktivni] === R.modry) &&
      s.random(30) === 1
    ) {
      v[R.main_pronej] = s.random(100);
      s.addd(3, 'bat-s-prome' + digit(s.random(3)), 111, setSnek);
    } else if (
      v[R.main_uhnu] === 0 &&
      (v[R.main_aktivni] === -1 ||
        (v[R.main_poc]! > 30 && v[R.main_aktivni] === R.main))
    ) {
      v[R.main_uhnu] = 300 + s.random(300);
      const pom2 = s.random(4);
      if (pom2 !== 1 || s.roompole[1]! > 0)
        s.addd(12, 'bat-s-sn' + 'ek' + digit(pom2), 111, setSnek);
      s.roompole[1]!++;
    }
  }
  if (v[R.main_uhnu]! > 0) v[R.main_uhnu]!--;

  // ---- dhled (periscope): a short drop animation when pushed down ----
  {
    const dh = s.item(R.dhled);
    const dv = s.vars(R.dhled);
    if (dv[R.dhled_padal] === 4) {
      dh.afaze = 0;
      dv[R.dhled_padal] = 0;
    } else if (dv[R.dhled_padal] === 3) dv[R.dhled_padal] = 4;
    else if (dv[R.dhled_padal] === 2) dv[R.dhled_padal] = 3;
    else if (dh.dir === Dir.down) dv[R.dhled_padal] = 1;
    else if (dv[R.dhled_padal] === 1) {
      dh.afaze = 1;
      dv[R.dhled_padal] = 2;
    }
  }

  // ---- snek (snail): mouth flaps while speaking ----
  {
    const sn = s.item(R.snek);
    if (odd(s.count) && s.vars(R.snek)[R.snek_mluvi] !== 0) sn.afaze = s.random(2);
    else sn.afaze = 0;
  }

  // ---- ibudik (alarm clock): jitters while ringing ----
  {
    const ib = s.item(R.ibudik);
    if (odd(s.count) && s.playing(50)) ib.afaze = 1;
    else ib.afaze = 0;
  }

  // ---- mikroskop: idle flicker; resets when nudged ----
  {
    const mk = s.item(R.mikroskop);
    const mv = s.vars(R.mikroskop);
    if (mv[R.mikroskop_poc]! > 0) mv[R.mikroskop_poc]!--;
    else {
      mk.afaze = s.random(3);
      mv[R.mikroskop_poc] = s.random(6);
    }
    if (mk.dir !== Dir.no) mv[R.mikroskop_poc] = 0;
  }
}

/**
 * A ringing phone (zluty/modry) on its cradle (ztel/mtel): rings with sound `prior`,
 * animates the handset while ringing, and hands control to the cradle (halo=1) once
 * the phone is lifted off. Mirrors the two near-identical cases in the original.
 */
function ringPhone(
  s: Script,
  v: number[],
  phone: number,
  cradle: number,
  prior: number,
  ringSound: string,
): void {
  if (v[R.main_poc] === 0) {
    s.ksnd(prior);
    v[R.main_poc] = s.random(30) + 30;
    v[R.main_aktivni] = R.main;
    s.item(phone).afaze = 0;
  } else {
    v[R.main_poc]!--;
    if (v[R.main_pronej]! > 0) v[R.main_pronej]!--;
    if (onCradle(s, phone, cradle)) {
      if (s.playing(prior)) {
        v[R.main_zvon]!++;
        if (odd(v[R.main_zvon]!)) s.item(phone).afaze = 1;
        else s.item(phone).afaze = 2;
      } else if (v[R.main_zvon]! > 0) {
        v[R.main_zvon]!--;
        s.item(phone).afaze = 0;
      } else s.snd(ringSound, prior);
    } else {
      s.ksnd(prior);
      s.item(phone).afaze = 0;
      v[R.main_aktivni] = cradle;
      v[R.main_halo] = 1;
    }
  }
}

export const BATYSKAF: RoomScript = { name: 'BATYSKAF', init, prog };
