/**
 * PARTY1 ("Sunken Party Boat", room 10) — a faithful port of PARTY1_InitProgramky
 * / PARTY1_Programky (URoom.pas:7204-7281, 17058-17434).
 *
 * A ballroom seen through two portholes: four party NPCs (frkavec/dama/kapitan/
 * lodnik) bob in and out of the two windows on independent state machines, guarded
 * by a shared `globpole[1/2]` window-occupancy lock, while eight glasses + a tray
 * (sklenka..+8) animate via globpole[1000+n]. The room comments on the party, the
 * skeleton, the rolling cylinder, and not spilling the drinks. Item indices are the
 * generated r_PARTY1_* values (URoom.pas:4260-4298).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod1: 1,
  room_uvod2: 2,
  room_bojise: 3,
  room_nevylit: 4,
  room_ovalci: 5,
  ocel: 2,
  frkavec: 5,
  frkavec_okno: 1,
  frkavec_faze: 2,
  frkavec_cinnost: 3,
  frkavec_delay: 4,
  frkavec_strana: 5,
  dama: 6,
  dama_kdeje: 1,
  dama_okno: 2,
  dama_strana: 3,
  dama_cinnost: 4,
  dama_faze: 5,
  dama_delay: 6,
  dama_kdebude: 7,
  kapitan: 7,
  kapitan_kdeje: 1,
  kapitan_okno: 2,
  kapitan_strana: 3,
  kapitan_cinnost: 4,
  kapitan_faze: 5,
  kapitan_delay: 6,
  kapitan_kdebude: 7,
  lodnik: 8,
  lodnik_kdeje: 1,
  lodnik_okno: 2,
  lodnik_strana: 3,
  lodnik_cinnost: 4,
  lodnik_faze: 5,
  lodnik_delay: 6,
  lodnik_kdebude: 7,
  kabina: 9,
  sklenka: 10,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 5);
  v[R.room_uvod1] = 0;
  v[R.room_uvod2] = 0;
  v[R.room_nevylit] = 0;
  v[R.room_ovalci] = 0;
  if (s.random(100) >= 130 - s.pokus * 30) v[R.room_uvod1] = 2;
  if (s.random(100) >= 130 - s.pokus * 30) v[R.room_uvod2] = 2;
  if (s.random(100) >= 120 - s.pokus * 20) v[R.room_nevylit] = 2;
  if (s.random(100) >= 120 - s.pokus * 20) v[R.room_ovalci] = 2;
  if (v[R.room_uvod2] === 0) {
    s.globpole[1] = 1;
    s.globpole[2] = 1;
  } else {
    s.globpole[1] = 0;
    s.globpole[2] = 0;
  }
  v[R.room_bojise] = 0;

  s.vars(R.frkavec, 5)[R.frkavec_cinnost] = 0;
  s.item(R.frkavec).spec = 11;

  const d = s.vars(R.dama, 7);
  s.item(R.dama).spec = 11;
  d[R.dama_kdeje] = s.random(3);
  d[R.dama_cinnost] = 0;

  const k = s.vars(R.kapitan, 7);
  s.item(R.kapitan).spec = 11;
  k[R.kapitan_kdeje] = s.random(3);
  k[R.kapitan_cinnost] = 0;

  const l = s.vars(R.lodnik, 7);
  s.item(R.lodnik).spec = 11;
  l[R.lodnik_kdeje] = s.random(3);
  l[R.lodnik_cinnost] = 0;

  for (let i = 0; i <= 8; i++) s.globpole[1000 + i] = 0;
}

/** chr(48+n): the ASCII digit for a random sound-name suffix. */
const digit = (n: number): string => String.fromCharCode(48 + n);

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room dialogue ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    let pomb1 = false;
    for (let i = R.sklenka; i <= R.sklenka + 8; i++) {
      const d = s.item(i).dir;
      if (d === Dir.left || d === Dir.right) pomb1 = true;
    }
    let pomb2 = false;
    for (let i = R.sklenka; i <= R.sklenka + 7; i++) {
      const g = s.item(i);
      if (g.y === 27 && g.x === 36 && s.item(R.ocel).x === 37) pomb2 = true;
    }

    if (v[R.room_uvod1] === 0) {
      s.addm(s.random(20) + 20, 'pt1-m-parnicek');
      v[R.room_uvod1] = 1;
    } else if (v[R.room_uvod2] === 0) {
      s.addv(s.random(20) + 20, 'pt1-v-predtucha');
      s.addm(0, 'pt1-m-predtucha');
      s.addset((x) => (s.globpole[1] = x), 0);
      s.addset((x) => (s.globpole[2] = x), 0);
      v[R.room_uvod2] = 1;
    } else if (v[R.room_uvod2] === 1 && (s.globpole[1] !== 0 || s.globpole[2] !== 0)) {
      v[R.room_uvod2] = 2;
      s.addm(10 + s.random(10), 'pt1-m-kostlivec');
    } else if (
      v[R.room_bojise] === 0 &&
      v[R.room_uvod2] === 2 &&
      (s.globpole[1] !== 0 || s.globpole[2] !== 0) &&
      s.random(1000) < 3
    ) {
      v[R.room_bojise] = 1;
      s.addm(20, 'pt1-m-vylezt' + digit(s.random(3)));
      s.addv(s.random(10) + 5, 'pt1-v-pryc' + digit(s.random(2)));
    } else if (v[R.room_ovalci] === 0 && pomb2) {
      v[R.room_ovalci] = 1;
      s.addv(3, 'pt1-v-valec');
      s.addm(s.random(5), 'pt1-m-nemuzu');
    } else if (v[R.room_nevylit] === 0 && pomb1 && s.random(100) < 1) {
      v[R.room_nevylit] = 1;
      s.addv(0, 'pt1-v-pozor');
    }
  }

  // ---- frkavec (window figure that blows a party horn) ----
  {
    const fr = s.item(R.frkavec);
    const fv = s.vars(R.frkavec);
    const kab = s.item(R.kabina);
    if (fv[R.frkavec_okno] === 1) fr.x = kab.x + 2;
    else if (fv[R.frkavec_okno] === 2) fr.x = kab.x + 8;
    fr.spec = fv[R.frkavec_cinnost]! > 0 ? fv[R.frkavec_strana]! * 10 : 11;

    if (fv[R.frkavec_cinnost] === 0) {
      if (s.random(1000) < 8) {
        fv[R.frkavec_okno] = s.random(2) + 1;
        if (s.globpole[fv[R.frkavec_okno]!] === 0) {
          fv[R.frkavec_cinnost] = 1;
          fv[R.frkavec_faze] = 0;
          fv[R.frkavec_strana] = s.random(2);
          s.globpole[fv[R.frkavec_okno]!] = 1;
        }
      }
    } else if (fv[R.frkavec_cinnost] === 1) {
      const f = fv[R.frkavec_faze]!;
      if (f >= 0 && f <= 4) {
        fr.afaze = f;
        fv[R.frkavec_faze]!++;
      } else if (f === 5) {
        fr.afaze = 5;
        fv[R.frkavec_delay] = s.random(10) + 5;
        fv[R.frkavec_faze]!++;
      } else if (f === 6) {
        if (fv[R.frkavec_delay]! > 0) fv[R.frkavec_delay]!--;
        else {
          fr.afaze = 6;
          fv[R.frkavec_delay] = 10;
          fv[R.frkavec_faze]!++;
        }
      } else if (f === 7) {
        if (fv[R.frkavec_delay]! > 0) fv[R.frkavec_delay]!--;
        else {
          fr.afaze = 5;
          if (s.random(100) < 75) {
            fv[R.frkavec_delay] = 2 + s.random(10);
            fv[R.frkavec_faze] = 6;
          } else fv[R.frkavec_faze]!++;
        }
      } else if (f === 8) {
        fv[R.frkavec_faze]!++;
      } else if (f === 9) {
        s.globpole[fv[R.frkavec_okno]!] = 0;
        fv[R.frkavec_faze]!++;
      } else if (f >= 10 && f <= 14) {
        fr.afaze = 14 - f;
        fv[R.frkavec_faze]!++;
        if (fv[R.frkavec_faze] === 15) fv[R.frkavec_cinnost] = 0;
      }
    }
  }

  // ---- dama (lady): moves between windows, two greeting animations ----
  {
    const da = s.item(R.dama);
    const dv = s.vars(R.dama);
    const kab = s.item(R.kabina);
    if (dv[R.dama_okno] === 1) da.x = kab.x + 2;
    else if (dv[R.dama_okno] === 2) da.x = kab.x + 8;
    da.spec = dv[R.dama_cinnost]! > 0 ? dv[R.dama_strana]! * 10 : 11;

    if (dv[R.dama_cinnost] === 0) {
      if (s.random(1000) < 8) {
        switch (dv[R.dama_kdeje]) {
          case 0:
            dv[R.dama_okno] = 1;
            dv[R.dama_strana] = 1;
            dv[R.dama_kdebude] = 1;
            break;
          case 1:
            dv[R.dama_strana] = s.random(2);
            dv[R.dama_okno] = dv[R.dama_strana]! + 1;
            dv[R.dama_kdebude] = dv[R.dama_strana]! * 2;
            break;
          case 2:
            dv[R.dama_okno] = 2;
            dv[R.dama_strana] = 0;
            dv[R.dama_kdebude] = 1;
            break;
        }
        if (s.globpole[dv[R.dama_okno]!] === 0) {
          s.globpole[dv[R.dama_okno]!] = 1;
          dv[R.dama_cinnost] = s.random(2) + 1;
          dv[R.dama_faze] = 0;
          dv[R.dama_delay] = 3;
        }
      }
    } else if (dv[R.dama_cinnost]! >= 1 && dv[R.dama_cinnost]! <= 2) {
      const f = dv[R.dama_faze]!;
      if (f >= 0 && f <= 14) {
        da.afaze = f;
        if (dv[R.dama_delay]! > 0) dv[R.dama_delay]!--;
        else {
          dv[R.dama_delay] = 3;
          dv[R.dama_faze]!++;
          if (dv[R.dama_faze] === 7 && dv[R.dama_cinnost] === 2) dv[R.dama_faze] = 20;
        }
        if (dv[R.dama_faze] === 15) {
          dv[R.dama_cinnost] = 0;
          s.globpole[dv[R.dama_okno]!] = 0;
          dv[R.dama_kdeje] = dv[R.dama_kdebude]!;
        }
      } else if (f >= 20 && f <= 23) {
        dv[R.dama_faze]!++;
      } else if (f >= 24 && f <= 27) {
        da.afaze = 15;
        dv[R.dama_faze]!++;
      } else if (f >= 28 && f <= 29) {
        da.afaze = 6;
        dv[R.dama_faze]!++;
      } else if (f === 30) {
        dv[R.dama_faze] = 7;
      }
    }
  }

  // ---- kapitan (captain): like the lady but mirrored strana and offset frames ----
  {
    const ka = s.item(R.kapitan);
    const kv = s.vars(R.kapitan);
    const kab = s.item(R.kabina);
    if (kv[R.kapitan_okno] === 1) ka.x = kab.x + 2;
    else if (kv[R.kapitan_okno] === 2) ka.x = kab.x + 8;
    ka.spec = kv[R.kapitan_cinnost]! > 0 ? (1 - kv[R.kapitan_strana]!) * 10 : 11;

    if (kv[R.kapitan_cinnost] === 0) {
      if (s.random(1000) < 8) {
        switch (kv[R.kapitan_kdeje]) {
          case 0:
            kv[R.kapitan_okno] = 1;
            kv[R.kapitan_strana] = 1;
            kv[R.kapitan_kdebude] = 1;
            break;
          case 1:
            kv[R.kapitan_strana] = s.random(2);
            kv[R.kapitan_okno] = kv[R.kapitan_strana]! + 1;
            kv[R.kapitan_kdebude] = kv[R.kapitan_strana]! * 2;
            break;
          case 2:
            kv[R.kapitan_okno] = 2;
            kv[R.kapitan_strana] = 0;
            kv[R.kapitan_kdebude] = 1;
            break;
        }
        if (s.globpole[kv[R.kapitan_okno]!] === 0) {
          s.globpole[kv[R.kapitan_okno]!] = 1;
          kv[R.kapitan_cinnost] = s.random(2) + 1;
          kv[R.kapitan_faze] = 0;
          kv[R.kapitan_delay] = 2;
        }
      }
    } else if (kv[R.kapitan_cinnost]! >= 1 && kv[R.kapitan_cinnost]! <= 2) {
      const f = kv[R.kapitan_faze]!;
      if (f >= 0 && f <= 14) {
        ka.afaze = f;
        if (kv[R.kapitan_delay]! > 0) kv[R.kapitan_delay]!--;
        else {
          kv[R.kapitan_delay] = 2;
          kv[R.kapitan_faze]!++;
          if (kv[R.kapitan_faze] === 8 && kv[R.kapitan_cinnost] === 2) kv[R.kapitan_faze] = 20;
        }
        if (kv[R.kapitan_faze] === 15) {
          kv[R.kapitan_cinnost] = 0;
          s.globpole[kv[R.kapitan_okno]!] = 0;
          kv[R.kapitan_kdeje] = kv[R.kapitan_kdebude]!;
        }
      } else if (f >= 20 && f <= 23) {
        ka.afaze = f - 20 + 15;
        kv[R.kapitan_faze]!++;
      } else if (f >= 24 && f <= 27) {
        ka.afaze = 27 - f + 15;
        kv[R.kapitan_faze]!++;
      } else if (f === 28) {
        kv[R.kapitan_faze] = 8;
      }
    }
  }

  // ---- lodnik (sailor): two distinct one-shot animations (cinnost 1 vs 2) ----
  {
    const lo = s.item(R.lodnik);
    const lv = s.vars(R.lodnik);
    const kab = s.item(R.kabina);
    if (lv[R.lodnik_okno] === 1) lo.x = kab.x + 2;
    else if (lv[R.lodnik_okno] === 2) lo.x = kab.x + 8;
    lo.spec = lv[R.lodnik_cinnost]! > 0 ? lv[R.lodnik_strana]! * 10 : 11;

    if (lv[R.lodnik_cinnost] === 0) {
      if (s.random(1000) < 8) {
        switch (lv[R.lodnik_kdeje]) {
          case 0:
            lv[R.lodnik_okno] = 1;
            lv[R.lodnik_strana] = 1;
            lv[R.lodnik_kdebude] = 1;
            break;
          case 1:
            lv[R.lodnik_strana] = s.random(2);
            lv[R.lodnik_okno] = lv[R.lodnik_strana]! + 1;
            lv[R.lodnik_kdebude] = lv[R.lodnik_strana]! * 2;
            break;
          case 2:
            lv[R.lodnik_okno] = 2;
            lv[R.lodnik_strana] = 0;
            lv[R.lodnik_kdebude] = 1;
            break;
        }
        if (s.globpole[lv[R.lodnik_okno]!] === 0) {
          s.globpole[lv[R.lodnik_okno]!] = 1;
          lv[R.lodnik_cinnost] = s.random(2) + 1;
          lv[R.lodnik_faze] = 0;
          lv[R.lodnik_delay] = (lv[R.lodnik_cinnost]! - 1) * 2;
        }
      }
    } else if (lv[R.lodnik_cinnost] === 1) {
      const f = lv[R.lodnik_faze]!;
      if (f >= 0 && f <= 9) {
        lo.afaze = f;
        if (lv[R.lodnik_delay]! > 0) lv[R.lodnik_delay]!--;
        else {
          lv[R.lodnik_delay] = 1 + (lv[R.lodnik_cinnost]! - 1) * 2;
          lv[R.lodnik_faze]!++;
        }
        if (lv[R.lodnik_faze] === 10) {
          lv[R.lodnik_cinnost] = 0;
          s.globpole[lv[R.lodnik_okno]!] = 0;
          lv[R.lodnik_kdeje] = lv[R.lodnik_kdebude]!;
        }
      }
    } else if (lv[R.lodnik_cinnost] === 2) {
      const f = lv[R.lodnik_faze]!;
      if (f >= 0 && f <= 12) {
        lo.afaze = f + 10;
        if (lv[R.lodnik_delay]! > 0) lv[R.lodnik_delay]!--;
        else {
          lv[R.lodnik_delay] = 1 + (lv[R.lodnik_cinnost]! - 1) * 2;
          lv[R.lodnik_faze]!++;
        }
        if (lv[R.lodnik_faze] === 13) {
          lv[R.lodnik_cinnost] = 0;
          s.globpole[lv[R.lodnik_okno]!] = 0;
          lv[R.lodnik_kdeje] = lv[R.lodnik_kdebude]!;
        }
      }
    }
  }

  // ---- sklenka (8 glasses + a tray): ripple animation via globpole[1000+n] ----
  for (let i = 0; i <= 8; i++) {
    const g = s.item(R.sklenka + i);
    let pom2 = s.globpole[1000 + i]!;
    if (g.dir !== Dir.no) {
      if (pom2 === 0) pom2 = 9;
      else if (pom2 <= 6) pom2 += 6;
    }
    if (pom2 === 0) g.afaze = 0;
    else {
      pom2--;
      g.afaze = 2 - (Math.floor(pom2 / 3) % 2);
    }
    s.globpole[1000 + i] = pom2;
  }
}

export const PARTY1: RoomScript = { name: 'PARTY1', init, prog };
