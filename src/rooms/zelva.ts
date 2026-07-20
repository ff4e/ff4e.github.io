/**
 * ZELVA ("Telepathic Devil", room 37) — a faithful port of ZELVA_InitProgramky /
 * ZELVA_Programky (URoom.pas:8271-8318, 20957-21281).
 *
 * A gspec=9 "push it out" room (shove the turtle off the edge, `Spec9(zelva,7,3)`).
 * The turtle is a telepathic devil: at intervals (`blbnout`) — once both fish have
 * idled a while — it SEIZES one fish (`natvrdo`) and walks it to a random reachable
 * cell, ignoring the player, while taunting ("what are you doing?!"). The host drives
 * that walk via the swim/najdi_smer machinery; this script only decides when to
 * possess, tracks the aftermath (`cosedelo`), and runs ambient chatter (`hlouposti`).
 * The turtle's face is a big napad/pozadavek/stav state machine animated through
 * setanim `S4,<frame>` commands (slot 4 = xicht). A pearl, a shy fish (rybka) and
 * the little fish's delayed "it's a turtle!" line round it out.
 *
 * NEW engine feature: the `natvrdo` possession (Script.natvrdo/tvrdaryba/tvrd{x,y}
 * + host force-swim). Everything else uses existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const ITEM_WATER = 255;
const ITEM_WALL = 0;

const R = {
  main: 0,
  main_blbnout: 1,
  main_kolikrat: 2,
  main_hlouposti: 3,
  main_kolikhlouposti: 4,
  main_poslhloupost: 5,
  main_cosedelo: 6,
  main_uvod: 7,
  zelva: 1,
  zelva_stav: 1,
  zelva_pozadavek: 2,
  zelva_napad: 3,
  zelva_xicht: 4,
  perla: 7,
  malar: 13, // little fish
  malar_hlasit: 1,
  rybka: 17,
  rybka_cinnost: 1,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);
const MALA = 1;

function init(s: Script): void {
  const v = s.vars(R.main, 7);
  s.room.gspec = 9;
  s.natvrdo = 0;
  v[R.main_blbnout] = 300 + s.random(300);
  v[R.main_kolikrat] = 0;
  v[R.main_hlouposti] = s.random(1000) + 500;
  v[R.main_kolikhlouposti] = 0;
  v[R.main_poslhloupost] = s.random(3);
  v[R.main_cosedelo] = 0;
  v[R.main_uvod] = 0;

  const z = s.vars(R.zelva, 4);
  z[R.zelva_stav] = 4;
  z[R.zelva_xicht] = 0;
  z[R.zelva_napad] = 0;
  z[R.zelva_pozadavek] = 0;

  s.item(R.perla).anim = 'a0d?0-90La1a2a3a2a1a0d?10-100G';

  s.vars(R.malar, 1)[R.malar_hlasit] = 0;
  s.vars(R.rybka, 1)[R.rybka_cinnost] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.main);

  // ---- main: possession scheduler + aftermath dialogue ----
  if (s.stdKrajniHlaska()) {
    s.addv(5, 'zel-v-ukol');
    s.stdKonecKrajniHlasky();
  }

  if (s.alive('little') && s.alive('big') && s.noDialog() && s.natvrdo === 0) {
    for (let i = 1; i <= 5; i++) if (v[R.main_blbnout]! > 0) v[R.main_blbnout]!--;
    if (v[R.main_hlouposti]! > 0) v[R.main_hlouposti]!--;

    if (v[R.main_blbnout] === 0 && s.natvrdo === 0 && s.delay('little') > 40 && s.delay('big') > 40) {
      let pomb1 = true;
      s.tvrdaryba = s.random(2) + 1;
      const which = s.tvrdaryba === MALA ? 'little' : 'big';
      const fishIdx = s.tvrdaryba === MALA ? s.littleIdx : s.bigIdx;
      const pom2 = s.tvrdaryba === MALA ? 2 : 3;
      const fish = s.item(fishIdx);
      for (let pom1 = 0; pom1 <= pom2; pom1++) {
        const cell = s.farray(fish.x + pom1, fish.y - 1);
        if (cell !== ITEM_WATER && cell !== ITEM_WALL) pomb1 = false;
      }
      if (pomb1) {
        s.tvrdex = s.random(s.rwidth - 2) + 1;
        s.tvrdey = s.random(s.rheight - 2) + 1;
        if (
          Math.abs(fish.x - s.tvrdex) + Math.abs(fish.y - s.tvrdey) > 8 &&
          s.najdiSmer(which, s.tvrdex, s.tvrdey) !== Dir.no
        ) {
          s.natvrdo = 1;
        }
        if (s.natvrdo === 1) v[R.main_blbnout] = (v[R.main_kolikrat]! + 3) * (s.random(100) + 50);
      }
    }

    if (v[R.main_hlouposti]! > 0) v[R.main_hlouposti]!--;

    if (s.natvrdo === 1) {
      v[R.main_kolikrat]!++;
      if (s.roompole[0]! <= 1) {
        const pom1 = s.random(3);
        switch (pom1) {
          case 0:
          case 2:
            if (s.tvrdaryba === MALA) s.addv(s.random(10), 'zel-v-coto' + digit(pom1));
            else s.addm(s.random(10), 'zel-m-coto' + digit(pom1));
            v[R.main_cosedelo] = s.tvrdaryba + 2;
            break;
          case 1:
            v[R.main_cosedelo] = s.tvrdaryba;
            break;
        }
      } else if (s.random(100) < 60) {
        if (s.tvrdaryba === MALA) s.addm(s.random(60), 'zel-m-potvora' + digit(s.random(2)));
        else s.addv(s.random(60), 'zel-v-stacit' + digit(s.random(2)));
      }

      if (s.roompole[0] === 0) s.roompole[0]!++;

      if (s.random(100) < v[R.main_kolikrat]! * 10 - 50) {
        if (s.roompole[0] === 1) {
          s.roompole[0]!++;
          v[R.main_cosedelo] = s.tvrdaryba + 4;
        }
      }
    } else if (v[R.main_cosedelo]! > 0) {
      if (v[R.main_cosedelo]! <= 2) {
        if (v[R.main_cosedelo] === 1) s.addv(s.random(10), 'zel-v-coto1');
        else s.addm(s.random(10), 'zel-m-coto1');
        v[R.main_cosedelo]! += 2;
      }
      if (v[R.main_cosedelo]! > 4 || s.random(100) < 50 || v[R.main_kolikrat]! <= 2) {
        if (v[R.main_cosedelo]! % 2 === 1) s.addm(s.random(3) + 3, 'zel-m-nevim' + digit(s.random(2)));
        else s.addv(s.random(3) + 3, 'zel-v-nevim' + digit(s.random(2)));
      }
      if (v[R.main_cosedelo]! > 4 || (s.random(100) < 40 && v[R.main_kolikrat]! >= 3)) {
        if (v[R.main_cosedelo]! % 2 === 1) s.addv(s.random(30) + 10, 'zel-v-cosedeje');
        else s.addm(s.random(30) + 10, 'zel-m-cimtoje');
      }
      if (v[R.main_cosedelo]! > 4) {
        s.adddel(s.random(30) + 10);
        s.addset((val) => (s.vars(R.malar)[R.malar_hlasit] = val), 1);
        s.addv(0, 'zel-v-tazelva');
        switch (s.random(2)) {
          case 0:
            s.addm(s.random(20) + 4, 'zel-m-jasne');
            break;
          case 1:
            s.addv(s.random(20) + 4, 'zel-v-pochyby');
            break;
        }
      }
      v[R.main_cosedelo] = 0;
    } else if (v[R.main_uvod] === 0) {
      v[R.main_uvod] = 1;
      if (s.roompole[0]! < 2) {
        s.addv(10 + s.random(25), 'zel-v-zelva' + digit(s.random(2)));
        s.addm(s.nah(5, 20), 'zel-m-fotky' + digit(s.random(2)));
        s.addv(5, 'zel-v-zmistnosti0');
      } else if (s.random(100) < 120 - s.pokus * 10) {
        s.addv(s.random(60) + 10, 'zel-v-zmistnosti1');
      }
    } else if (v[R.main_hlouposti] === 0) {
      v[R.main_kolikhlouposti]!++;
      v[R.main_hlouposti] = v[R.main_kolikhlouposti]! * (1500 + s.random(1500));
      let pom1 = s.random(2);
      if (pom1 === v[R.main_poslhloupost]) pom1 = 2;
      v[R.main_poslhloupost] = pom1;
      switch (pom1) {
        case 0:
          s.addv(50, 'zel-v-bizarni');
          break;
        case 1:
          s.addm(50, 'zel-m-priroda');
          break;
        case 2:
          s.addv(50, 'zel-v-tvary');
          if (s.random(100) < 60) s.addm(50, 'zel-m-jednoduse');
          break;
      }
    }
  }

  // ---- zelva (the turtle): push-out + the napad/pozadavek/stav face machine ----
  {
    const z = s.vars(R.zelva);
    const it = s.item(R.zelva);
    s.spec9(R.zelva, 7, 3);

    if (s.natvrdo === 1) z[R.zelva_pozadavek] = 7;

    switch (z[R.zelva_pozadavek]) {
      case 8:
        if (z[R.zelva_stav] === 8) z[R.zelva_pozadavek] = 0;
        break;
      case 0:
        if (it.dir !== Dir.no) z[R.zelva_pozadavek] = 8;
        break;
      case 7:
        if (s.natvrdo === 0) z[R.zelva_pozadavek] = 0;
        break;
    }

    if (it.anim !== '') {
      s.goanim(R.zelva);
    } else {
      if (z[R.zelva_pozadavek] === 0 && z[R.zelva_napad] === 0) {
        switch (z[R.zelva_stav]) {
          case 8:
            if (s.random(100) < 2) z[R.zelva_napad] = 1;
            break;
          case 1:
            switch (s.random(400)) {
              case 0:
                z[R.zelva_napad] = 8;
                break;
              case 1:
              case 2:
                z[R.zelva_napad] = 2;
                break;
              case 3:
              case 4:
                z[R.zelva_napad] = 3;
                break;
              case 5:
              case 6:
              case 7:
                z[R.zelva_napad] = 4;
                break;
            }
            break;
          case 2:
          case 3:
            if (s.random(100) < 6) z[R.zelva_napad] = 1;
            break;
          case 4:
            switch (s.random(100)) {
              case 0:
                z[R.zelva_napad] = 1;
                break;
              case 1:
                z[R.zelva_napad] = 5;
                break;
              case 2:
                z[R.zelva_napad] = 6;
                break;
            }
            break;
          case 5:
          case 6:
            if (s.random(100) < 2) z[R.zelva_napad] = 4;
            break;
        }
      } else if (
        z[R.zelva_pozadavek] !== 0 &&
        z[R.zelva_pozadavek] !== z[R.zelva_stav] &&
        z[R.zelva_napad] === 0
      ) {
        switch (z[R.zelva_pozadavek]) {
          case 7:
            switch (z[R.zelva_stav]) {
              case 2:
              case 3:
              case 8:
                z[R.zelva_napad] = 1;
                break;
              case 1:
              case 5:
              case 6:
                z[R.zelva_napad] = 4;
                break;
              case 4:
                z[R.zelva_napad] = 7;
                break;
            }
            break;
          case 8:
            switch (z[R.zelva_stav]) {
              case 5:
              case 6:
                z[R.zelva_napad] = 4;
                break;
              case 4:
              case 2:
              case 3:
                z[R.zelva_napad] = 1;
                break;
              case 1:
                z[R.zelva_napad] = 8;
                break;
            }
            break;
        }
      }

      switch (z[R.zelva_stav]) {
        case 8:
          z[R.zelva_xicht] = 27;
          if (z[R.zelva_napad] === 1) s.setanim(R.zelva, 'S4,29S3,0S1,1');
          break;
        case 1:
          if (s.random(100) < 5) {
            if (s.random(2) === 0) z[R.zelva_xicht] = 29;
            else z[R.zelva_xicht] = s.nah(31, 33);
          }
          switch (z[R.zelva_napad]) {
            case 8:
              s.setanim(R.zelva, 'S4,27S3,0S1,8');
              break;
            case 2:
              s.setanim(R.zelva, 's4,36S4,38S3,0S1,2');
              break;
            case 3:
              s.setanim(R.zelva, 's4,37S4,42S3,0S1,3');
              break;
            case 4:
              s.setanim(R.zelva, 's4,34s4,35S4,0S3,0S1,4');
              break;
          }
          break;
        case 2:
          if (s.random(100) < 5) {
            if (s.random(2) === 0) z[R.zelva_xicht] = 38;
            else z[R.zelva_xicht] = 40 + s.random(2);
          }
          if (z[R.zelva_napad] === 1) s.setanim(R.zelva, 's4,36S4,29S3,0S1,1');
          break;
        case 3:
          if (s.random(100) < 5) {
            if (s.random(2) === 0) z[R.zelva_xicht] = 42;
            else z[R.zelva_xicht] = 44 + s.random(2);
          }
          if (z[R.zelva_napad] === 1) s.setanim(R.zelva, 's4,37S4,29S3,0S1,1');
          break;
        case 4:
          if (s.random(100) < 5) {
            if (s.random(2) === 0) z[R.zelva_xicht] = 0;
            else z[R.zelva_xicht] = s.random(3) * 2 + 2;
          }
          switch (z[R.zelva_napad]) {
            case 1:
              s.setanim(R.zelva, 's4,35s4,34S4,29S3,0S1,1');
              break;
            case 5:
              s.setanim(R.zelva, 's4,13S4,16S3,0S1,5');
              break;
            case 6:
              s.setanim(R.zelva, 's4,18S4,19S3,0S1,6');
              break;
            case 7:
              s.setanim(R.zelva, 'S4,8S3,0S1,7');
              break;
          }
          break;
        case 5:
          if (s.random(100) < 5) {
            if (s.random(2) === 0) z[R.zelva_xicht] = 14;
            else z[R.zelva_xicht] = 16 + 7 * s.random(2);
          }
          if (z[R.zelva_napad] === 4) s.setanim(R.zelva, 's4,13S4,0S3,0S1,4');
          break;
        case 6:
          if (s.random(100) < 5) {
            if (s.random(2) === 0) z[R.zelva_xicht] = 19;
            else z[R.zelva_xicht] = 21 + 4 * s.random(2);
          }
          if (z[R.zelva_napad] === 4) s.setanim(R.zelva, 's4,18S4,0S3,0S1,4');
          break;
        case 7:
          if (z[R.zelva_xicht]! >= 8 && z[R.zelva_xicht]! <= 10) z[R.zelva_xicht]!++;
          else z[R.zelva_xicht] = 8;
          if (z[R.zelva_pozadavek] !== 7) s.setanim(R.zelva, 's4,12d4S3,0S1,4');
          break;
      }
      s.goanim(R.zelva);
    }

    it.afaze = z[R.zelva_xicht]!;
    if ([0, 2, 4, 6, 14, 16, 19, 21, 23, 25, 27, 29, 38, 42].includes(it.afaze)) {
      if (s.random(100) < 5) it.afaze++;
    }
  }

  // ---- perla: a self-looping shimmer ----
  s.goanim(R.perla);

  // ---- malar: the little fish's delayed "it's a turtle!" line ----
  {
    const mv = s.vars(R.malar);
    if (mv[R.malar_hlasit] === 1) {
      mv[R.malar_hlasit] = 0;
      s.talkNow('zel-m-tazelva', MALA);
    }
  }

  // ---- rybka (shy fish): darts a fresh random anim when nudged, else idles ----
  {
    const rv = s.vars(R.rybka);
    const it = s.item(R.rybka);
    if (it.dir !== Dir.no) {
      rv[R.rybka_cinnost] = 1;
      let anim = '';
      for (let i = 1; i <= s.random(5) + 5; i++) anim += 'a' + (s.random(3) + 1);
      for (let i = 1; i <= s.random(5) + 5; i++) anim += 'a' + (s.random(3) + 1) + 'd1';
      for (let i = 1; i <= s.random(5) + 5; i++) anim += 'a' + (s.random(3) + 1) + 'd2';
      for (let i = 1; i <= s.random(5) + 5; i++) anim += 'a' + (s.random(3) + 1) + 'd3';
      anim += 'S1,0';
      it.anim = anim;
      s.resetanim(R.rybka);
    }
    switch (rv[R.rybka_cinnost]) {
      case 0:
        s.setanim(R.rybka, 'a0d?30-200S1,2d?10-40s1,1r');
        rv[R.rybka_cinnost] = 1;
        break;
      case 1:
        s.goanim(R.rybka);
        break;
      case 2:
        s.goanim(R.rybka);
        if (s.count % 3 === 0) it.afaze = s.random(3) + 1;
        break;
    }
  }
}

export const ZELVA: RoomScript = { name: 'ZELVA', init, prog };
