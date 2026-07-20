/**
 * KUCHYNE ("Ship Kitchen", room 48) — a faithful port of KUCHYNE_InitProgramky /
 * KUCHYNE_Programky (URoom.pas:8792-8846, 23210-23419).
 *
 * A dialogue-heavy galley. A long else-if chain of timers (`zatrpocitadlo`,
 * `klauspocitadlo`, `prycpocitadlo`) and positional triggers sprinkles remarks about
 * the tables, the hanging weight (`zavazedlo`), the pot by the drain hole, the chair,
 * the cleaver (`mecik`), and a recipe scroll — many gated on whether the big fish has
 * swum off (`velkar_pryc`) or gone below (`velkar_dole`). A `stoji` "standing still"
 * counter (reset whenever either fish moves) triggers a periodic "tricky" line. Uses
 * existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_zatrpocitadlo: 2,
  room_zavazi: 3,
  room_klauspocitadlo: 4,
  room_stolecky: 5,
  room_prycpocitadlo: 6,
  room_hrncisko: 7,
  room_kresilko: 8,
  room_ss: 9,
  room_osam: 10,
  room_stoji: 11,
  room_uprava: 12,
  velkar: 1, // big fish
  velkar_pryc: 1,
  velkar_dole: 2,
  malar: 2, // little fish
  zavazedlo2: 4,
  zavazedlo1: 5,
  papir: 6,
  spindira: 7,
  stolek: 8,
  mecik: 11,
  kreslak: 12,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 12);
  v[R.room_uvod] = 0;
  v[R.room_zatrpocitadlo] = 1000 + s.random(4000);
  v[R.room_zavazi] = 0;
  v[R.room_klauspocitadlo] = 500 + s.random(1500);
  v[R.room_stolecky] = 0;
  v[R.room_prycpocitadlo] = 500 + s.random(1500);
  v[R.room_hrncisko] = 0;
  v[R.room_kresilko] = 0;
  v[R.room_ss] = 0;
  v[R.room_osam] = 0;
  if (s.roompole[3] === 2) s.roompole[3] = 1;
  v[R.room_stoji] = 0;
  v[R.room_uprava] = 0;

  const ve = s.vars(R.velkar, 2);
  ve[R.velkar_pryc] = 0;
  ve[R.velkar_dole] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const ve = s.vars(R.velkar);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_zatrpocitadlo]! > 0) v[R.room_zatrpocitadlo]!--;
    if (v[R.room_klauspocitadlo]! > 0) v[R.room_klauspocitadlo]!--;
    if (v[R.room_prycpocitadlo]! > 0) v[R.room_prycpocitadlo]!--;

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      let pom1 = s.random(20);
      if (s.pokus === 1) pom1 = 3;
      if (pom1 <= 5) {
        s.addm(9 + s.random(35), 'kuch-m-objev0');
      } else if (pom1 <= 9) {
        s.addm(9 + s.random(35), 'kuch-m-objev1');
      } else if (pom1 <= 17) {
        s.addm(9 + s.random(42), 'kuch-m-objev3');
        if (s.random(100) > s.pokus * 8 || s.random(100) < 30) {
          s.addv(12, 'kuch-v-varil');
          s.addv(7, 'kuch-v-problem');
          s.addm(14, 'kuch-m-noproblem');
          s.addv(5, 'kuch-v-podivej');
        }
      } else if (pom1 === 18) {
        s.addm(9 + s.random(35), 'kuch-m-objev2');
        v[R.room_zatrpocitadlo] = -1;
      }
    } else if (
      v[R.room_uvod] === 1 &&
      v[R.room_stolecky] === 0 &&
      ve[R.velkar_pryc] === 0 &&
      s.random(70) === 1
    ) {
      v[R.room_stolecky] = 1;
      if (s.random(40 * s.pokus) < 50) s.addv(9 + s.random(100), 'kuch-v-stolky0');
    } else if (v[R.room_zatrpocitadlo] === 0) {
      v[R.room_zatrpocitadlo] = -1;
      s.addm(9, 'kuch-m-objev2');
    } else if (
      v[R.room_zavazi] === 0 &&
      s.item(R.zavazedlo2).x === 39 &&
      s.item(R.zavazedlo2).y === 9 &&
      s.random(10 * s.pokus) === 1
    ) {
      v[R.room_zavazi] = 1;
      if (s.pokus < 5 || s.random(100) < 40) {
        s.addv(9, 'kuch-v-stolky1');
        if (s.random(100) < 40 && v[R.room_zatrpocitadlo]! > -1) {
          v[R.room_zatrpocitadlo] = -1;
          s.addm(9, 'kuch-m-objev2');
        }
      }
    } else if (v[R.room_klauspocitadlo] === 0 && ve[R.velkar_pryc] === 0) {
      v[R.room_klauspocitadlo] = 2000 + s.random(10000);
      if (s.pokus < 6 || s.random(100) < 50) s.addv(9, 'kuch-v-stolky2');
    } else if (v[R.room_prycpocitadlo] === 0 && ve[R.velkar_pryc] === 0) {
      v[R.room_prycpocitadlo] = -1;
      if (s.pokus < 10 || s.random(100) < 50) {
        if (s.random(100) < 70) {
          s.addv(9, 'kuch-v-odsud0');
          if (s.random(100) < 30) s.addv(9, 'kuch-v-odsud1');
          if (s.random(100) < 25) s.addm(9, 'kuch-m-premyslim0');
        } else {
          s.addv(9, 'kuch-v-odsud1');
        }
        if (s.random(100) < 90 || s.pokus === 1) {
          if (s.item(R.malar).dir !== Dir.no && s.random(100) < 50) {
            s.addm(6, 'kuch-m-premyslim2');
          } else if (s.random(100) < 45) {
            s.addm(9, 'kuch-m-premyslim0');
          } else {
            s.addm(16, 'kuch-m-premyslim1');
          }
        }
      }
    } else if (
      v[R.room_hrncisko] === 0 &&
      s.dist(R.spindira, R.malar) < 2 &&
      s.random(100) < 10
    ) {
      v[R.room_hrncisko] = 1;
      if (s.pokus < 6 || s.random(100) < 50) {
        switch (s.random(3)) {
          case 0:
            s.addm(9, 'kuch-m-hrnec0');
            if (s.random(100) < 35) s.addm(9, 'kuch-m-hrnec2');
            break;
          case 1:
            s.addm(9, 'kuch-m-hrnec1');
            break;
          case 2:
            s.addm(9, 'kuch-m-hrnec2');
            break;
        }
      }
    } else if (
      v[R.room_kresilko] === 0 &&
      s.dist(R.kreslak, R.velkar) < 4 &&
      (s.random(100) < 50 || s.roompole[1] === 0)
    ) {
      v[R.room_kresilko] = 1;
      s.addv(9, 'kuch-v-kreslo0');
      if (s.random(100) < 70) s.addv(16, 'kuch-v-ja');
      if (s.roompole[1] === 0 || s.random(100) < 70) {
        if (s.random(100) < 50) {
          s.addm(9, 'kuch-m-kreslo0');
        } else {
          s.addv(9, 'kuch-v-kreslo1');
          if (s.random(100) < 65) s.addm(7, 'kuch-m-kreslo2');
        }
      }
      s.roompole[1] = 1;
    } else if (v[R.room_ss] === 0 && s.dist(R.malar, R.stolek) < 2 && s.random(100) === 1) {
      s.addm(4, 'kuch-m-stolky');
      s.addv(8, 'kuch-v-serie');
      s.addm(8, 'kuch-m-pekne');
      v[R.room_ss] = 1;
    } else if (v[R.room_osam] === 0 && ve[R.velkar_dole] !== 0 && s.random(100) === 1) {
      v[R.room_osam] = 1;
      s.addv(5, 'kuch-v-obavam');
    } else if (s.roompole[3]! < 2 && s.dist(R.velkar, R.mecik) < 3 && s.random(50) === 1) {
      if (s.roompole[3] === 0 || s.random(2) === 1) {
        s.roompole[3] = 2;
        s.addv(5, 'kuch-v-mec');
        s.addm(8, 'kuch-m-porcovani');
        s.addv(7, 'kuch-v-nedela');
      }
    } else if (v[R.room_uprava] === 0 && s.item(R.papir).dir !== Dir.no && s.random(14) === 1) {
      v[R.room_uprava] = 1;
      s.addv(7, 'kuch-v-svitek' + digit(s.random(2)));
      if (s.random(2) === 1) s.addm(8, 'kuch-m-recept');
      else s.addm(8, 'kuch-m-kuchari');
    } else if (
      v[R.room_stoji]! > 1000 + 2000 * s.roompole[2]! &&
      ve[R.velkar_pryc] === 1
    ) {
      v[R.room_stoji] = 0;
      s.addv(16, 'kuch-m-zapeklite');
      s.roompole[2]!++;
    }
  }

  v[R.room_stoji]!++;

  // ---- velkar: track whether the big fish has swum off / gone below ----
  {
    const it = s.item(R.velkar);
    if (it.x < 32 || it.y > 13) {
      ve[R.velkar_pryc] = 1;
      v[R.room_zavazi] = 1;
    }
    if (it.x > 15 && it.y > 20) ve[R.velkar_dole] = 1;
    else ve[R.velkar_dole] = 0;
    if (it.dir !== Dir.no) v[R.room_stoji] = 0;
  }

  // ---- malar: any move resets the standing-still counter ----
  if (s.item(R.malar).dir !== Dir.no) v[R.room_stoji] = 0;
}

export const KUCHYNE: RoomScript = { name: 'KUCHYNE', init, prog };
