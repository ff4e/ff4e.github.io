/**
 * PRVNI ("How It All Started") room script — a faithful port of
 * PRVNI_InitProgramky / PRVNI_Programky (URoom.pas:6369-6414, 14255-14455).
 *
 * This is the tutorial room: after the player idles, the fish deliver the
 * scripted rules explanation (navod1..8), and the wall pipe (trubka) plays its
 * steel-clanging animation. Constants are the generated r_PRVNI_* values.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_qnavod1: 1,
  room_qnavod2: 2,
  room_qnavod3: 3,
  room_kecyoceli: 4,
  room_malanemuze: 5,
  room_malanepohne: 6,
  room_tlustoch: 7,
  room_restrt: 8,
  room_uzreklnavod: 9,
  room_qcount: 10,
  zidlev: 2, // chair
  trubka: 4, // wall pipe
  trubka_cinnost: 1,
  trubka_delay: 2,
  trubka_pohnul: 3,
  malar: 5, // small fish
  velkar: 6, // big fish
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 10);
  v[R.room_uzreklnavod] = 0;
  v[R.room_qcount] = 0;
  if (s.pokus === 1) {
    v[R.room_qnavod1] = 110;
    v[R.room_qnavod2] = 500;
  } else {
    v[R.room_qnavod1] = 400;
    v[R.room_qnavod2] = 2000;
  }
  v[R.room_kecyoceli] = s.random(100) + 80;
  v[R.room_malanepohne] = 0;
  v[R.room_malanemuze] = 0;
  v[R.room_tlustoch] = 0;
  v[R.room_restrt] = 0;

  const t = s.vars(R.trubka, 3);
  t[R.trubka_cinnost] = 0;
  t[R.trubka_pohnul] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const item = (i: number) => s.item(i);
  const busyM = (val: number) => (s.room.busy.little = val);
  const busyV = (val: number) => (s.room.busy.big = val);
  const delayM = (val: number) => (s.room.idle.little = val);
  const trubka = () => s.vars(R.trubka);

  // ---- room object ----
  v[R.room_qcount] = v[R.room_qcount]! + 1;
  if (v[R.room_qcount] === 3) {
    s.addm(15 + s.random(5), '1st-m-cotobylo');
    s.addv(6, '1st-v-netusim');
    s.addv(s.random(10) + 10, '1st-v-ven');
    s.addm(3, '1st-m-pockej');
  }

  if (s.noDialog() && trubka()[R.trubka_cinnost] === 0 && s.alive('little') && s.alive('big')) {
    if (v[R.room_qnavod1]! > 0 && s.delay('little') >= v[R.room_qnavod1]! && s.delay('big') >= v[R.room_qnavod1]!) {
      v[R.room_qnavod1] = -1;
      s.addm(5, '1st-m-proc');
      s.addd(3, 'set', 1, busyM);
      s.addm(5, '1st-m-hej');
    } else if (s.count >= v[R.room_qnavod2]! && v[R.room_qnavod2] !== -1) {
      v[R.room_qnavod1] = -1;
      s.addd(3, 'set', 1, busyM);
      s.addm(5, '1st-m-hej');
    }
    if (v[R.room_qnavod1] === -1) {
      v[R.room_qnavod1] = 600;
      v[R.room_qnavod2] = -1;
      s.addd(4, 'set', 1, busyV);
      s.addv(5, '1st-v-navod1');
      s.addd(3, 'set', 0, busyM);
      s.addd(1, 'set', 0, busyV);
      s.addm(20, '1st-m-navod2');
      s.addv(5, '1st-v-navod3');
      s.addd(100, 'set', 1, busyM);
      s.addd(2, 'set', 1, busyV);
      s.addm(3, '1st-m-navod4');
      s.addv(0, '1st-v-navod5');
      s.addm(2, '1st-m-navod6');
      s.addd(3, 'set', 0, busyV);
      s.addd(2, 'set', 0, busyM);
      s.addv(20, '1st-v-navod7');
      s.addm(20, '1st-m-navod8');
      if (v[R.room_uzreklnavod] === 0) {
        v[R.room_uzreklnavod] = 1;
        s.addv(35, '1st-v-davej');
        s.addm(0, '1st-m-nechtoho');
        s.addv(5, '1st-v-takdobre');
      }
      s.addset(delayM, 0);
    }
    if (v[R.room_kecyoceli] === 0) {
      v[R.room_kecyoceli] = s.random(600) + 300;
      trubka()[R.trubka_cinnost] = 1;
    } else {
      v[R.room_kecyoceli] = v[R.room_kecyoceli]! - 1;
    }

    if (v[R.room_malanemuze] === 0 && trubka()[R.trubka_pohnul] === 0 && item(R.malar).x === 13) {
      v[R.room_malanemuze] = 1;
      s.addm(s.random(5) + 2, '1st-m-neprojedu');
    }
    if (
      v[R.room_malanepohne] === 0 &&
      trubka()[R.trubka_pohnul] === 0 &&
      item(R.malar).x === 12 &&
      item(R.malar).y >= 10
    ) {
      v[R.room_malanepohne] = 1;
      s.addm(0, '1st-m-nepohnu');
    }
    if (v[R.room_malanepohne]! > 0) {
      v[R.room_malanepohne] = v[R.room_malanepohne]! + 1;
      if (item(R.trubka).dir === Dir.left) {
        if (v[R.room_malanepohne]! < 50) s.addv(0, '1st-v-takukaz');
        v[R.room_malanepohne] = -1;
      }
    }
    if (v[R.room_malanepohne] !== -2 && item(R.trubka).dir === Dir.left) {
      s.addm(4, '1st-m-hmmm');
      v[R.room_malanepohne] = -2;
    }
    if (item(R.zidlev).x >= 20 && item(R.velkar).x >= 21 && item(R.velkar).y === 15) {
      switch (v[R.room_tlustoch]) {
        case 0:
          s.addv(10, '1st-v-nemuzu');
          if (s.random(100) < 50) s.addv(4, '1st-v-pribral');
          v[R.room_tlustoch] = v[R.room_tlustoch]! + 1;
          break;
        case 2:
          s.addv(10, '1st-v-posunout');
          v[R.room_tlustoch] = v[R.room_tlustoch]! + 1;
          break;
      }
    }
    if (item(R.velkar).x < 20 && v[R.room_tlustoch] === 1) v[R.room_tlustoch] = v[R.room_tlustoch]! + 1;

    if (v[R.room_restrt] === 0 && item(R.trubka).x <= 9 && item(R.malar).x <= item(R.trubka).x - 3) {
      s.addset(busyM, 0);
      s.addm(10, '1st-m-pokud');
      s.addd(3, 'set', 1, busyV);
      s.addv(3, '1st-v-znovu');
      if (s.random(100) < 50) {
        s.addm(0, '1st-m-backspace');
        s.addv(0, '1st-v-jedno');
      }
      s.addd(3, 'set', 0, busyM);
      s.addv(5, '1st-v-najit');
      s.addset(busyV, 0);
      v[R.room_restrt] = 1;
    }
  }

  if (
    s.noDialog() &&
    v[R.room_restrt] === 0 &&
    s.venku('little') &&
    s.alive('big') &&
    item(R.velkar).x <= 23 &&
    item(R.zidlev).x >= 20
  ) {
    s.addv(30, '1st-v-chyba');
    s.addset(busyV, 1);
    s.addv(10, '1st-v-nedostanu');
    s.addset(busyV, 0);
    s.addd(50, 'set', 1, busyV);
    s.addv(3, '1st-v-stiskni');
    if (s.random(100) < 50) {
      s.addm(0, '1st-m-backspace');
      s.addv(0, '1st-v-jedno');
    }
    s.addv(5, '1st-v-najit');
    s.addset(busyV, 0);
    v[R.room_restrt] = 1;
  }

  // ---- trubka (wall pipe) animation ----
  {
    const it = item(R.trubka);
    const t = trubka();
    if (it.dir === Dir.left || it.dir === Dir.right) t[R.trubka_pohnul] = 1;

    switch (t[R.trubka_cinnost]) {
      case 1:
      case 2:
      case 3:
      case 4:
        t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        it.afaze++;
        t[R.trubka_delay] = 7;
        break;
      case 5:
        if (t[R.trubka_delay]! > 0) t[R.trubka_delay] = t[R.trubka_delay]! - 1;
        else t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        break;
      case 6:
        it.afaze = 5;
        t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        t[R.trubka_delay] = 8;
        break;
      case 7:
        if (t[R.trubka_delay]! > 0) {
          it.afaze = s.random(100) < 10 ? 4 : 5;
          t[R.trubka_delay] = t[R.trubka_delay]! - 1;
        } else t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        break;
      case 8:
        s.addd(0, '1st-x-ocel', 202);
        t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        break;
      case 9:
        if (s.playing(202)) {
          if (it.afaze === 4) it.afaze = 5;
          if (s.count % 3 === 1) {
            if (s.random(2) === 0) it.afaze++;
            else it.afaze--;
            if (it.afaze === 4) it.afaze = 8;
            else if (it.afaze === 9) it.afaze = 5;
          }
          if (it.afaze === 5 && s.random(100) < 40) it.afaze = 4;
        } else t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        break;
      case 10:
        it.afaze = 5;
        t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        break;
      case 11:
      case 12:
      case 13:
      case 14:
      case 15:
        it.afaze--;
        t[R.trubka_cinnost] = t[R.trubka_cinnost]! + 1;
        break;
      case 16:
        t[R.trubka_cinnost] = 0;
        break;
    }
  }
}

export const PRVNI: RoomScript = { name: 'PRVNI', init, prog };
