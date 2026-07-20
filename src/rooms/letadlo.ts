/**
 * LETADLO ("Sunken Aeroplane", room 14) — a faithful port of LETADLO_InitProgramky
 * / LETADLO_Programky (URoom.pas:6340-6367, 14130-14253).
 *
 * A dialogue room with: a randomised intro whose "vrak" line avoids repeating the
 * previous room's pick (roompole[0]), an eye-porthole (ocicko) comment, and a
 * remark when the active fish is the little one and a seat (sed1/2/3) is being
 * pushed. The eye (ocicko) runs a rich blink/look idle state machine. Item indices
 * are the generated r_LETADLO_* values (URoom.pas:3946-3956).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  letadlo: 0,
  letadlo_uvod: 1,
  letadlo_ooku: 2,
  letadlo_osedadle: 3,
  sed1: 6,
  sed2: 7,
  sed3: 8,
  ocicko: 11,
  ocicko_cinnost: 1,
  ocicko_faze: 2,
  ocicko_citac: 3,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.letadlo, 3);
  v[R.letadlo_uvod] = 0;
  v[R.letadlo_ooku] = 0;
  v[R.letadlo_osedadle] = 0;
  s.vars(R.ocicko, 3)[R.ocicko_cinnost] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.letadlo);

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.letadlo_uvod] === 0) {
      v[R.letadlo_uvod] = 1;
      if (s.pokus > 1) s.adddel(10 * s.pokus);
      if (s.random(100) < 110 - 10 * s.pokus) s.addm(20 + s.random(30), 'let-m-divna');
      let pom1: number;
      if (s.roompole[0] === 0) {
        pom1 = s.random(3);
      } else {
        pom1 = s.random(2);
        if (s.roompole[0] === pom1 + 10) pom1 = 2;
      }
      s.roompole[0] = pom1 + 10;
      s.addv(s.random(10) + 5, 'let-v-vrak' + digit(pom1));
    } else if (
      v[R.letadlo_ooku] === 0 &&
      s.item(R.ocicko).x >= 23 &&
      s.random(100) < 1
    ) {
      s.addv(s.random(30), 'let-v-oko');
      s.addm(5, 'let-m-oko');
      v[R.letadlo_ooku] = 1;
    } else if (
      (s.item(R.sed1).dir !== Dir.no ||
        s.item(R.sed2).dir !== Dir.no ||
        s.item(R.sed3).dir !== Dir.no) &&
      s.aktivni() === 'little' &&
      s.random(100) < 1
    ) {
      s.addm(0, 'let-m-sedadlo');
      if (v[R.letadlo_osedadle] === 0 || s.random(100) < 30)
        s.addv(5 + s.random(15), 'let-v-budrada');
      v[R.letadlo_osedadle]!++;
    }
  }

  // ---- ocicko (eye porthole): blink / look-around idle animation ----
  {
    const oc = s.item(R.ocicko);
    const ov = s.vars(R.ocicko);
    const c = ov[R.ocicko_cinnost]!;
    if (c === 0) {
      if (s.random(100) < 10) {
        const r = s.random(8);
        if (r >= 0 && r <= 2) {
          ov[R.ocicko_citac] = s.random(5) + 5;
          ov[R.ocicko_cinnost] = 1;
          ov[R.ocicko_faze] = s.random(2) * 2;
        } else if (r === 3) {
          ov[R.ocicko_citac] = s.random(3) + 2;
          ov[R.ocicko_cinnost] = 2;
          ov[R.ocicko_faze] = s.random(2) * 2;
        } else if (r >= 4 && r <= 6) {
          ov[R.ocicko_citac] = s.random(12) + 12;
          ov[R.ocicko_cinnost] = 3 + s.random(2);
        } else if (r === 7) {
          ov[R.ocicko_citac] = s.random(10) + 2;
          ov[R.ocicko_cinnost] = 5;
        }
      }
    } else if (c === 1 || c === 2) {
      switch (ov[R.ocicko_faze]) {
        case 0:
          oc.afaze = c === 1 ? 1 : 3;
          if (s.random(100) < 20) ov[R.ocicko_faze]!++;
          break;
        case 1:
          oc.afaze = 0;
          ov[R.ocicko_faze]!++;
          break;
        case 2:
          oc.afaze = c === 1 ? 2 : 4;
          if (s.random(100) < 20) ov[R.ocicko_faze]!++;
          break;
        case 3:
          oc.afaze = 0;
          ov[R.ocicko_citac]!--;
          if (ov[R.ocicko_citac] === 0) ov[R.ocicko_cinnost] = 0;
          else ov[R.ocicko_faze] = 0;
          break;
      }
    } else if (c === 3 || c === 4 || c === 5) {
      if (c === 3) {
        switch (oc.afaze) {
          case 0:
            oc.afaze = s.random(4) + 1;
            break;
          case 1:
            oc.afaze = 3;
            break;
          case 2:
            oc.afaze = 4;
            break;
          case 3:
            oc.afaze = 2;
            break;
          case 4:
            oc.afaze = 1;
            break;
        }
      } else if (c === 4) {
        switch (oc.afaze) {
          case 0:
            oc.afaze = s.random(4) + 1;
            break;
          case 1:
            oc.afaze = 4;
            break;
          case 2:
            oc.afaze = 3;
            break;
          case 3:
            oc.afaze = 1;
            break;
          case 4:
            oc.afaze = 2;
            break;
        }
      } else if (c === 5) {
        if (s.random(100) < 40) oc.afaze = s.random(5);
      }
      ov[R.ocicko_citac]!--;
      if (ov[R.ocicko_citac] === 0) {
        ov[R.ocicko_cinnost] = 0;
        oc.afaze = 0;
      }
    }
  }
}

export const LETADLO: RoomScript = { name: 'LETADLO', init, prog };
