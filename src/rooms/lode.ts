/**
 * LODE ("The Gods Must Be Mad", room 19) — a faithful port of LODE_InitProgramky /
 * LODE_Programky (URoom.pas:7922-8004, 19315-19788).
 *
 * Two gods (buh1, buh2) play Battleship on hidden 10×10 grids (the `LodeGame`
 * engine in lode-game.ts) while the fish escape below. The room narrates the match:
 * each god calls out a coordinate (globtit "A5"), the opponent answers water/hit/
 * sunk, buh2 sometimes cheats (podvod), a sunk ship makes a ship fall from the sky
 * (ShodLod), and the fish comment on the spectacle and their surroundings. The gods'
 * faces/eyes/mouths/hands run rich per-tick animation state machines. Item indices
 * are the generated r_LODE_* values (URoom.pas:4537-4576).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { LodeGame, LODE } from './lode-game.js';

const NLODI = 7; // matches lode-game NKOSTEK (7 ships)

const R = {
  room: 0,
  room_uvod: 1,
  room_costim: 2,
  room_oholi: 3,
  room_opalce: 4,
  room_omicich: 5,
  room_hraje: 6,
  room_cekani: 7,
  room_stavhry: 8,
  room_posl: 9,
  room_shodit: 10,
  buh2: 1,
  buh2_cinnost: 1,
  buh2_cekat: 2,
  buh2_mluveni: 3,
  buh2_lodi: 4,
  buh2_x: 5,
  buh2_y: 6,
  buh2_cinruky: 7,
  buh2_ruka: 8,
  buh2_xicht: 9,
  buh1: 2,
  buh1_cinnost: 1,
  buh1_cekat: 2,
  buh1_mluveni: 3,
  buh1_lodi: 4,
  buh1_x: 5,
  buh1_y: 6,
  buh1_pusa: 7,
  buh1_oci: 8,
  buh1_ruka: 9,
  buh1_cinruky: 10,
  palka: 7,
  hul: 11,
  kriketak: 12,
  malar: 13,
  velkar: 14,
  velkar_hlaska: 1,
  objekty: 15,
  maska: 16,
} as const;

const istr = (n: number): string => String(n);
/** chr(n-1+'A') / chr(n-1+'a') — the grid row letter. */
const rowUpper = (y: number): string => String.fromCharCode(y - 1 + 65);
const rowLower = (y: number): string => String.fromCharCode(y - 1 + 97);

/** The battleship game state (planek + posltrefena). Reset per room enter in init(). */
let game = new LodeGame();

function init(s: Script): void {
  game = new LodeGame((n) => s.random(n));

  const v = s.vars(R.room, 10);
  v[R.room_stavhry] = 0;
  v[R.room_posl] = 0;
  v[R.room_uvod] = 0;
  v[R.room_costim] = s.nah(25, 100);
  v[R.room_oholi] = 0;
  v[R.room_opalce] = 0;
  v[R.room_omicich] = s.nah(1200, 4000);
  v[R.room_shodit] = -1;

  const b2 = s.vars(R.buh2, 9);
  b2[R.buh2_cinnost] = 0;
  b2[R.buh2_mluveni] = 0;
  b2[R.buh2_cinruky] = 0;
  b2[R.buh2_ruka] = 0;

  const b1 = s.vars(R.buh1, 10);
  b1[R.buh1_cinnost] = 0;
  b1[R.buh1_ruka] = 0;
  b1[R.buh1_oci] = 0;
  b1[R.buh1_pusa] = 0;
  b1[R.buh1_mluveni] = 0;
  b1[R.buh1_cinruky] = 0;

  s.vars(R.velkar, 1)[R.velkar_hlaska] = 0;
  s.item(R.objekty).spec = 11;
  s.item(R.maska).spec = 11;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const b1v = s.vars(R.buh1);
  const b2v = s.vars(R.buh2);
  const setB1cinruky = (x: number) => (b1v[R.buh1_cinruky] = x);
  const setB2cinruky = (x: number) => (b2v[R.buh2_cinruky] = x);
  const setB1mluveni = (x: number) => (b1v[R.buh1_mluveni] = x);
  const setB2mluveni = (x: number) => (b2v[R.buh2_mluveni] = x);
  const setShodit = (x: number) => (v[R.room_shodit] = x);
  const setVelkarHlaska = (x: number) => (s.vars(R.velkar)[R.velkar_hlaska] = x);

  // ---- room: fish dialogue + the game clock ----
  {
    if (s.stdKrajniHlaska()) {
      s.addm(s.random(10) + 5, 'lod-m-bohove');
      s.stdKonecKrajniHlasky();
    }

    if (s.alive('little') && s.alive('big') && s.noDialog()) {
      if (v[R.room_costim]! > 0) v[R.room_costim]!--;
      if (v[R.room_omicich]! > 0) v[R.room_omicich]!--;

      if (v[R.room_uvod] === 0) {
        v[R.room_uvod] = 1;
        switch (s.random(3)) {
          case 0:
            s.addv(s.nah(10, 20), 'lod-v-silenost0');
            break;
          case 1:
            s.addv(s.nah(10, 20), 'lod-v-silenost1');
            break;
          case 2:
            s.addv(s.nah(10, 20), 'lod-v-silenost2');
            break;
        }
        switch (s.random(3)) {
          case 0:
            s.addm(s.random(5), 'lod-m-pravda0');
            break;
          case 1:
            s.addm(s.random(5), 'lod-m-pravda1');
            break;
          case 2:
            s.addm(s.random(5), 'lod-m-pravda2');
            break;
        }
      } else if (v[R.room_costim] === 0) {
        v[R.room_costim] = -1;
        if (s.random(2) === 0) {
          s.addm(s.random(5), 'lod-m-cos' + 'tim');
          s.addv(s.random(5), 'lod-v-internovat');
          s.addm(s.random(5), 'lod-m-co');
          s.addv(s.random(5), 'lod-v-cvok');
          s.addm(s.random(5), 'lod-m-oba');
          s.addv(s.random(5), 'lod-v-golf');
          s.addm(s.random(5), 'lod-m-jednoho');
        } else {
          s.addm(s.random(5), 'lod-m-cos' + 'tim');
          s.addv(s.random(5), 'lod-v-internovat');
          s.addm(s.random(5), 'lod-m-oba');
          s.addv(s.random(5), 'lod-v-golf');
          s.addm(s.random(5), 'lod-m-jednoho');
        }
        s.addv(s.random(7), 'lod-v-koho');
        if (s.random(2) === 0) {
          s.addset(setVelkarHlaska, 1);
          s.addm(s.random(3), 'lod-m-zluty');
        } else {
          s.addset(setVelkarHlaska, 2);
          s.addm(s.random(3), 'lod-m-modry');
        }
        if (s.random(2) === 0) s.addm(s.random(5), 'lod-m-hrac');
        else s.addv(s.random(5), 'lod-v-hrac');
      } else if (
        v[R.room_oholi] === 0 &&
        s.item(R.hul).dir !== Dir.no &&
        s.aktivni() === 'big' &&
        s.random(100) < 1
      ) {
        v[R.room_oholi] = 1;
        s.addv(0, 'lod-v-Items[r_LODE_hul]^'); // (verbatim placeholder from the original → silent)
        s.addm(s.random(7), 'lod-m-ozizlana');
      } else if (v[R.room_opalce] === 0 && s.random(1000) < 1) {
        v[R.room_opalce] = 1;
        s.addv(s.random(10), 'lod-v-hravost');
        if (s.item(R.palka).x === 23 && s.item(R.palka).y === 2)
          s.addm(s.random(7), 'lod-m-pal' + 'ka');
      } else if (v[R.room_omicich] === 0) {
        if (s.item(R.kriketak).x > 24 && s.item(R.kriketak).y > 19) {
          s.addv(s.random(5), 'lod-v-micky');
          s.addm(s.random(5), 'lod-m-vyznam');
          s.addv(s.random(5), 'lod-v-kdovi');
        }
        s.addm(s.random(5), 'lod-m-micek');
        s.addv(s.random(5), 'lod-v-rozliseni');
      }
    }

    // The match state machine: init → cue a god → resolve who won → restart.
    switch (v[R.room_stavhry]) {
      case 0:
        game.initLode();
        b1v[R.buh1_lodi] = NLODI;
        b2v[R.buh2_lodi] = NLODI;
        v[R.room_hraje] = 1;
        v[R.room_stavhry]!++;
        v[R.room_cekani] = s.random(10) + 5;
        break;
      case 1:
        if (s.noDialog()) {
          if (v[R.room_cekani]! > 0) v[R.room_cekani]!--;
          else {
            if (v[R.room_hraje] === 1) b1v[R.buh1_cinnost] = 1;
            else if (v[R.room_hraje] === 2) b2v[R.buh2_cinnost] = 1;
            v[R.room_stavhry] = 2;
          }
        }
        break;
      case 2:
        v[R.room_stavhry] = 1;
        if (b2v[R.buh2_lodi] === 0) {
          s.addd(3, 'b2-vyhral', 201, setB2mluveni);
          v[R.room_stavhry] = 3;
        }
        if (b1v[R.buh1_lodi] === 0) {
          s.addd(8, 'b1-vyhral', 101, setB1mluveni);
          v[R.room_stavhry] = 3;
        }
        if (v[R.room_stavhry] === 1) v[R.room_cekani] = s.random(10) + 5;
        else {
          v[R.room_cekani] = s.random(100) + 100;
          if (s.random(2) === 0) {
            s.addd(s.random(30) + 10, 'b2-znovu', 201, setB2mluveni);
            s.addd(s.random(10) + 5, 'b1-dobre', 101, setB1mluveni);
          } else {
            s.addd(s.random(30) + 10, 'b1-znovu', 101, setB1mluveni);
            s.addd(s.random(10) + 5, 'b2-dobre', 201, setB2mluveni);
          }
        }
        break;
      case 3:
        if (s.noDialog()) {
          if (v[R.room_cekani]! > 0) v[R.room_cekani]!--;
          else {
            s.addd(0, 'b1-zacinam', 101, setB1mluveni);
            v[R.room_stavhry] = 0;
          }
        }
        break;
    }

    if (v[R.room_shodit]! >= 0) {
      s.shodLod(v[R.room_shodit]!);
      v[R.room_shodit] = -1;
    }
  }

  // ---- buh2 (the cheating god): shoots, narrates, animates ----
  {
    const it = s.item(R.buh2);
    s.spec9(R.buh2, 6, 6);

    if (b2v[R.buh2_cinnost] === 1) {
      const move = game.hrajlode(2);
      b2v[R.buh2_x] = move.sx;
      b2v[R.buh2_y] = move.sy;
      const pom1 = move.result;
      b2v[R.buh2_cekat] = s.random(10) + 5;
      s.globtit = rowUpper(move.sy) + istr(move.sx);
      s.addd(b2v[R.buh2_cekat]!, 'b2-' + rowLower(move.sy), 201, setB2mluveni);
      b2v[R.buh2_cinnost] = 2;
      b2v[R.buh2_cekat] = b2v[R.buh2_cekat]! + s.random(4) + 9;
      switch (pom1) {
        case LODE.VODA:
          s.adddel(s.random(20) + 20);
          s.addset(setB1cinruky, s.random(3) + 1);
          s.addd(0, 'b1-voda' + istr(s.random(5) + 1), 102, setB1mluveni);
          s.addset(setB2cinruky, s.random(3) + 1);
          v[R.room_hraje] = 1;
          break;
        case LODE.ZASAH:
          s.adddel(s.random(20) + 20);
          s.addset(setB1cinruky, s.random(3) + 3);
          s.addd(0, 'b1-zasah' + istr(s.random(4) + 1), 103, setB1mluveni);
          s.addset(setB2cinruky, s.random(3) + 3);
          break;
        case LODE.POTOPENA:
          s.adddel(s.random(20) + 20);
          s.addset(setB1cinruky, s.random(3) + 1);
          s.addd(0, 'b1-potop' + istr(s.random(3) + 1), 104, setB1mluveni);
          s.addset(setB1cinruky, -s.random(10) - 5);
          s.addset(setB2cinruky, -s.random(10) - 5);
          b2v[R.buh2_lodi]!--;
          s.addset(setShodit, game.posltrefena);
          break;
        case LODE.PODVOD_POTOPENA:
          s.addd(s.random(20) + 20, 'b1-voda' + istr(s.random(5) + 1), 102, setB1mluveni);
          s.adddel(5);
          s.addset(setB2mluveni, 3);
          s.addd(10 + s.random(10), 'b2-podvadis', 220, setB2mluveni);
          s.addd(8, 'b2-' + rowLower(move.sy), 220, setB2mluveni);
          s.addd(0, 'b2-' + istr(move.sx), 220, setB2mluveni);
          s.addd(0, 'b2-nemuze', 220, setB2mluveni);
          s.addd(s.random(30) + 10, 'b1-spletl', 105, setB1mluveni);
          s.addd(s.random(5) + 5, 'b1-potop' + istr(s.random(3) + 1), 104, setB1mluveni);
          b2v[R.buh2_lodi]!--;
          s.addset(setShodit, game.posltrefena);
          break;
        case LODE.ZASAH_PODVOD:
          s.addd(s.random(20) + 20, 'b1-zasah' + istr(s.random(4) + 1), 103, setB1mluveni);
          s.addd(s.random(10), 'b2-podvadis', 220, setB2mluveni);
          s.addd(s.random(10), 'b2-spatne', 220, setB2mluveni);
          if (s.random(2) === 0) s.addd(s.random(30) + 10, 'b1-spletl', 105, setB1mluveni);
          else s.addd(s.random(5) + 2, 'b1-nepodvadim', 106, setB1mluveni);
          break;
        case LODE.POTOPENA_PODVOD:
          s.addd(s.random(20) + 20, 'b1-potop' + istr(s.random(3) + 1), 104, setB1mluveni);
          s.addd(s.random(10), 'b2-podvadis', 220, setB2mluveni);
          s.addd(s.random(10), 'b2-spatne', 220, setB2mluveni);
          if (s.random(2) === 0) s.addd(s.random(30) + 10, 'b1-spletl', 105, setB1mluveni);
          else s.addd(s.random(5) + 2, 'b1-nepodvadim', 106, setB1mluveni);
          b2v[R.buh2_lodi]!--;
          s.addset(setShodit, game.posltrefena);
          break;
      }
    } else if (b2v[R.buh2_cinnost] === 2) {
      if (b2v[R.buh2_cekat]! > 0) b2v[R.buh2_cekat]!--;
      else {
        s.talkNow('b2-' + istr(b2v[R.buh2_x]!), 201);
        b2v[R.buh2_cinnost] = 0;
      }
    }

    // buh2 face (xicht) by speaking state.
    switch (b2v[R.buh2_mluveni]) {
      case 0: {
        const x = b2v[R.buh2_xicht]!;
        if (!(x === 3 || x === 4 || x === 6 || x === 7) || s.random(100) < 4) {
          b2v[R.buh2_xicht] = s.random(6) + 3;
          if (b2v[R.buh2_xicht] === 5 || b2v[R.buh2_xicht] === 8) b2v[R.buh2_xicht] = 3;
        }
        break;
      }
      case 1: {
        const x = b2v[R.buh2_xicht]!;
        if (!(x === 8 || x === 9) || s.random(100) < 3) {
          b2v[R.buh2_xicht] = 8 + s.random(2);
          it.afaze = b2v[R.buh2_xicht]! + b2v[R.buh2_ruka]! * 10;
        }
        break;
      }
      case 2: {
        const x = b2v[R.buh2_xicht]!;
        if (!(x === 0 || x === 1) || s.random(100) < 5) b2v[R.buh2_xicht] = s.random(2);
        break;
      }
      case 3: {
        const x = b2v[R.buh2_xicht]!;
        if (!(x === 1 || x === 2) || s.random(100) < 5) b2v[R.buh2_xicht] = s.random(2) + 1;
        break;
      }
      default:
        if (b2v[R.buh2_mluveni]! >= 200 && b2v[R.buh2_mluveni]! <= 219) {
          if (s.count % 2 === 1) b2v[R.buh2_xicht] = s.random(3);
        } else if (b2v[R.buh2_mluveni] === 220) {
          b2v[R.buh2_xicht] = b2v[R.buh2_xicht] === 5 ? 6 : 5;
        }
        break;
    }

    // buh2 hand (ruka) + resulting afaze.
    const ml = b2v[R.buh2_mluveni]!;
    if (ml === 0 || ml === 1 || (ml >= 200 && ml <= 220)) {
      if (b2v[R.buh2_ruka]! > 3) b2v[R.buh2_ruka] = s.random(4);
      if (b2v[R.buh2_cinruky] === 0) {
        if (s.random(100) < 2) b2v[R.buh2_ruka] = s.random(4);
      } else if (b2v[R.buh2_cinruky]! > 0) {
        if (s.count % 3 === 0) {
          b2v[R.buh2_ruka] =
            s.random(100) < 30 ? b2v[R.buh2_ruka]! ^ 1 : b2v[R.buh2_ruka]! ^ 2;
          b2v[R.buh2_cinruky]!--;
        }
      } else {
        b2v[R.buh2_ruka] = s.random(100) < 30 ? b2v[R.buh2_ruka]! ^ 1 : b2v[R.buh2_ruka]! ^ 2;
        b2v[R.buh2_cinruky]!++;
      }
      it.afaze = b2v[R.buh2_ruka]! * 10 + b2v[R.buh2_xicht]!;
    } else if (ml === 2 || ml === 3) {
      const r = b2v[R.buh2_ruka]!;
      if (!(r >= 4 && r <= 6) || (s.count % 2 === 1 && s.random(100) < 30))
        b2v[R.buh2_ruka] = s.random(3) + 4;
      if (b2v[R.buh2_ruka] === 4) {
        switch (b2v[R.buh2_xicht]) {
          case 0:
            it.afaze = 0;
            break;
          case 1:
            it.afaze = 6;
            break;
          case 2:
            it.afaze = 9;
            break;
        }
      } else {
        it.afaze = b2v[R.buh2_ruka]! * 3 + 25 + b2v[R.buh2_xicht]!;
      }
    }
  }

  // ---- buh1 (the honest god): shoots, narrates, animates ----
  {
    const it = s.item(R.buh1);
    s.spec9(R.buh1, 5, 6);

    if (b1v[R.buh1_cinnost] === 1) {
      const move = game.hrajlode(1);
      b1v[R.buh1_x] = move.sx;
      b1v[R.buh1_y] = move.sy;
      const pom1 = move.result;
      b1v[R.buh1_cekat] = s.random(10) + 5;
      s.globtit = rowUpper(move.sy) + istr(move.sx);
      s.addd(b1v[R.buh1_cekat]!, 'b1-' + rowLower(move.sy), 101, setB1mluveni);
      b1v[R.buh1_cinnost] = 2;
      b1v[R.buh1_cekat] = b1v[R.buh1_cekat]! + s.random(4) + 9;
      switch (pom1) {
        case LODE.VODA:
          s.adddel(s.random(20) + 20);
          s.addset(setB2cinruky, s.random(2) + 1);
          s.addd(0, 'b2-voda' + istr(s.random(5) + 1), 202, setB2mluveni);
          s.addset(setB1cinruky, s.random(2) + 1);
          v[R.room_hraje] = 2;
          break;
        case LODE.ZASAH:
          s.adddel(s.random(20) + 20);
          s.addset(setB2cinruky, s.random(3) + 2);
          s.addd(0, 'b2-zasah' + istr(s.random(4) + 1), 203, setB2mluveni);
          if (s.random(3) === 0) s.addset(setB2mluveni, 1);
          s.addset(setB1cinruky, s.random(3) + 2);
          break;
        case LODE.POTOPENA:
          s.adddel(s.random(20) + 20);
          s.addset(setB2cinruky, s.random(3) + 1);
          s.addd(0, 'b2-potop' + istr(s.random(3) + 1), 204, setB2mluveni);
          if (s.random(3) !== 0) s.addset(setB2mluveni, 1);
          s.addset(setB1cinruky, -s.random(7) - 5);
          s.addset(setB2cinruky, -s.random(7) - 5);
          b1v[R.buh1_lodi]!--;
          s.addset(setShodit, game.posltrefena);
          break;
        case LODE.UZ_VODA:
          s.adddel(10 + s.random(10));
          s.addset(setB2mluveni, 2);
          s.addd(s.random(15) + 10, 'b2-rikal' + istr(s.random(2) + 1), 205, setB2mluveni);
          s.addd(1, 'b2-voda1', 201, setB2mluveni);
          v[R.room_hraje] = 2;
          break;
        case LODE.UZ_ZASAH:
          s.adddel(10 + s.random(10));
          s.addset(setB2mluveni, 2);
          s.addd(s.random(15) + 10, 'b2-rikal' + istr(s.random(2) + 1), 201, setB2mluveni);
          break;
      }
    } else if (b1v[R.buh1_cinnost] === 2) {
      if (b1v[R.buh1_cekat]! > 0) b1v[R.buh1_cekat]!--;
      else {
        s.talkNow('b1-' + istr(b1v[R.buh1_x]!), 101);
        b1v[R.buh1_cinnost] = 0;
      }
    }

    // buh1 mouth (pusa) while speaking.
    if (b1v[R.buh1_mluveni]! > 100) {
      if (
        (s.count % 2 === 1 && b1v[R.buh1_mluveni]! > 101) ||
        s.count % 4 === 1
      ) {
        if (s.random(2) === 1) b1v[R.buh1_pusa] = (b1v[R.buh1_pusa]! + 1) % 3;
        else b1v[R.buh1_pusa] = (b1v[R.buh1_pusa]! + 2) % 3;
      }
    }

    // buh1 eyes (oci) by speaking state.
    switch (b1v[R.buh1_mluveni]) {
      case 0:
        b1v[R.buh1_pusa] = 0;
        if (s.random(100) < 3) b1v[R.buh1_oci] = s.random(2);
        break;
      case 101:
      case 102:
        if (v[R.room_posl] !== b1v[R.buh1_mluveni])
          b1v[R.buh1_oci] = Math.floor(s.random(3) / 2);
        else if (s.random(100) < 3) b1v[R.buh1_oci] = 1 - b1v[R.buh1_oci]!;
        v[R.room_posl] = b1v[R.buh1_mluveni]!;
        break;
      case 103:
      case 104:
        if (v[R.room_posl] !== b1v[R.buh1_mluveni])
          b1v[R.buh1_oci] = 2 - Math.floor(s.random(3) / 2);
        else if (s.random(100) < 3) b1v[R.buh1_oci] = 3 - b1v[R.buh1_oci]!;
        v[R.room_posl] = b1v[R.buh1_mluveni]!;
        break;
      case 105:
        if (v[R.room_posl] !== b1v[R.buh1_mluveni]) b1v[R.buh1_oci] = 0;
        v[R.room_posl] = b1v[R.buh1_mluveni]!;
        break;
      case 106:
        if (v[R.room_posl] !== b1v[R.buh1_mluveni]) b1v[R.buh1_oci] = 2;
        v[R.room_posl] = b1v[R.buh1_mluveni]!;
        break;
    }

    // buh1 hand (ruka).
    if (b1v[R.buh1_cinruky] === 0) {
      if (s.random(100) < 4) b1v[R.buh1_ruka] = s.random(4);
    } else if (b1v[R.buh1_cinruky]! > 0) {
      if (s.count % 2 === 0) {
        let pom1 = s.random(3);
        if (pom1 === b1v[R.buh1_ruka]) pom1 = 3;
        b1v[R.buh1_ruka] = pom1;
        b1v[R.buh1_cinruky]!--;
      }
    } else {
      let pom1 = s.random(3);
      if (pom1 === b1v[R.buh1_ruka]) pom1 = 3;
      b1v[R.buh1_ruka] = pom1;
      b1v[R.buh1_cinruky]!++;
    }

    it.afaze = b1v[R.buh1_ruka]! * 12 + b1v[R.buh1_oci]! * 4 + b1v[R.buh1_pusa]!;
  }

  // ---- velkar: one-shot "it's the blue/yellow one" remark ----
  {
    switch (s.vars(R.velkar)[R.velkar_hlaska]) {
      case 1:
        s.talkNow('lod-v-modry', 2);
        break;
      case 2:
        s.talkNow('lod-v-zluty', 2);
        break;
    }
    s.vars(R.velkar)[R.velkar_hlaska] = 0;
  }
}

export const LODE_ROOM: RoomScript = { name: 'LODE', init, prog };
