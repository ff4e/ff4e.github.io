/**
 * KORALY ("Sleeping Creatures", room 34) — a faithful port of KORALY_InitProgramky
 * / KORALY_Programky (URoom.pas:6654-6776, 15384-15828).
 *
 * A sleepy reef whose centrepiece is a balalaika-playing octopus (balalajka = 2):
 * left alone it hums a "tca/psi" beat, but shoved it launches into a tune
 * (`music('rybky08', 10)`), stepping through an afaze score. While the tune plays
 * (`playing(10)`) six crabs (krab1..6) dance and six sea-anemones (sas1..6) sway in
 * sync; otherwise the crabs doze and the anemones idle. A cuttlefish (sepie = 21)
 * shuffles its legs falling/standing. The fish comment on the coral and, once the
 * octopus has played, cheer or grumble; a two-line hint fires when they reach the
 * exit corridor. Uses existing primitives (music at priority 10, not the -999
 * room-music channel).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const ITEM_WATER = 255;
const ITEM_WALL = 0;

const R = {
  room: 0,
  room_quvod: 1,
  room_vydrz: 2,
  room_komentovaly: 3,
  room_qhlaska: 4,
  room_pouzito: 5,
  room_kreseni: 6,
  krab1: 1,
  krab1_krabfaze: 1,
  krab1_cekat: 2,
  balalajka: 2,
  balalajka_cinnost: 1,
  balalajka_tcatcat: 2,
  balalajka_hrala: 3,
  sas1: 3,
  sas1_sasfaze: 1,
  sas1_noha: 2,
  sas1_kvet: 3,
  sas2: 4,
  sas3: 5,
  sas4: 6,
  sas5: 7,
  sas6: 8,
  // sas2..6 share var slots: noha=1, kvet=2
  sas_noha: 1,
  sas_kvet: 2,
  elko: 11,
  krab2: 12,
  krab3: 13,
  krab4: 14,
  krab5: 15,
  krab6: 16,
  krab_cekat: 1, // crabs 2..6 share cekat=1
  velkar: 18, // big fish
  sepie: 21,
  sepie_mrk: 1,
  sepie_nohy: 2,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 6);
  v[R.room_quvod] = s.random(20) + 20;
  v[R.room_qhlaska] = s.random(100) + 100;
  v[R.room_pouzito] = 0;
  v[R.room_vydrz] = s.random(2) + 2;
  v[R.room_komentovaly] = 0;
  v[R.room_kreseni] = 0;

  const k1 = s.vars(R.krab1, 2);
  k1[R.krab1_krabfaze] = 1;
  k1[R.krab1_cekat] = 0;

  const bal = s.vars(R.balalajka, 3);
  bal[R.balalajka_cinnost] = 0;
  bal[R.balalajka_hrala] = 0;
  bal[R.balalajka_tcatcat] = s.random(15) + 10;

  const s1 = s.vars(R.sas1, 3);
  s1[R.sas1_sasfaze] = -1;
  s1[R.sas1_kvet] = s.random(2) * 2 + 1;
  s1[R.sas1_noha] = s.random(2);
  for (const sa of [R.sas2, R.sas3, R.sas4, R.sas5, R.sas6]) {
    const sv = s.vars(sa, 2);
    sv[R.sas_kvet] = s.random(2) * 2 + 1;
    sv[R.sas_noha] = s.random(2);
  }

  for (const c of [R.krab2, R.krab3, R.krab4, R.krab5, R.krab6]) s.vars(c, 1)[R.krab_cekat] = 0;

  const se = s.vars(R.sepie, 2);
  se[R.sepie_mrk] = 0;
  se[R.sepie_nohy] = 0;
}

/** A dancing crab keyed on crab 1's krabfaze (URoom.pas:15498+). While the tune is
 *  idle (krabfaze<=2) the crab waits out its `cekat` timer; while it plays it kicks
 *  to the leader's frame, or scuttles randomly if it has no floor beneath it. */
function crabDance(s: Script, idx: number, cekatSlot: number, krab1faze: number): void {
  const kv = s.vars(idx);
  const it = s.item(idx);
  if (krab1faze === 2) kv[cekatSlot] = s.random(70) + 30;
  if (krab1faze <= 2) {
    if (kv[cekatSlot] === 0) {
      it.afaze = 1;
    } else {
      it.afaze = 0;
      kv[cekatSlot]!--;
    }
  } else if (
    s.farray(it.x, it.y + 1) !== ITEM_WATER &&
    s.farray(it.x + 1, it.y + 1) !== ITEM_WATER
  ) {
    it.afaze = krab1faze;
  } else if (s.random(100) < 50) {
    it.afaze = s.random(4) + 2;
  }
}

/** A swaying anemone (URoom.pas:15619+). It mirrors crab-1-derived `sasfaze` while
 *  the tune plays; otherwise it drifts its own bloom/leg. Only sways with open water
 *  or wall diagonally above-right; else it folds shut (afaze 0). */
function sasSway(s: Script, idx: number, nohaSlot: number, kvetSlot: number, sasfaze: number): void {
  const it = s.item(idx);
  const above = s.farray(it.x + 1, it.y - 1);
  if (above === ITEM_WATER || above === ITEM_WALL) {
    if (sasfaze >= 0) {
      it.afaze = sasfaze;
    } else {
      const sv = s.vars(idx);
      if (s.count % 3 === 0 && s.random(100) < 50) sv[kvetSlot] = s.random(2) * 2 + 1;
      if (s.count % 4 === 0 && s.random(100) < 30) sv[nohaSlot] = s.random(2);
      it.afaze = sv[nohaSlot]! * 4 + sv[kvetSlot]!;
    }
  } else {
    it.afaze = 0;
  }
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const bal = s.vars(R.balalajka);

  // ---- room dialogue (only while the octopus is idle or winding down) ----
  if (
    s.alive('little') &&
    s.alive('big') &&
    s.noDialog() &&
    (bal[R.balalajka_cinnost] === 0 || bal[R.balalajka_cinnost]! > 70)
  ) {
    if (v[R.room_quvod]! > 0) v[R.room_quvod]!--;
    if (bal[R.balalajka_hrala]! > 0) v[R.room_quvod] = -1;
    if (v[R.room_qhlaska]! > 0) v[R.room_qhlaska]!--;

    if (v[R.room_komentovaly]! < bal[R.balalajka_hrala]!) {
      if (s.pokus < 1000) s.pokus += 1000;
      v[R.room_komentovaly] = bal[R.balalajka_hrala]!;
      if (v[R.room_komentovaly]! <= v[R.room_vydrz]!) {
        switch (s.random(4)) {
          case 0:
          case 1:
            if (s.random(2) === 1) s.addv(6, 'kor-v-juchacka');
            else s.addv(6, 'kor-v-vali');
            switch (s.random(3)) {
              case 0:
                s.addm(3, 'kor-m-hraje');
                break;
              case 1:
                s.addm(3, 'kor-m-nachob');
                break;
            }
            break;
          case 2:
            s.addv(0, 'kor-v-odvaz');
            break;
          case 3:
            s.addm(6, 'kor-m-vsimlsis');
            s.addv(2, 'kor-v-avidelas');
            s.addm(4, 'kor-m-tovis');
            break;
        }
      } else {
        const pom1 = s.random(6); // 0..1 little, 2..3 big, 4..5 both
        for (let pom2 = 1; pom2 <= 2; pom2++) {
          if (
            ((pom2 === 1 && [0, 1, 4].includes(pom1) && s.random(3) === 0) || (pom2 === 2 && pom1 === 5))
          ) {
            switch (s.random(2)) {
              case 0:
                s.addm(5, 'kor-m-jinou');
                break;
              case 1:
                s.addm(5, 'kor-m-neprehani');
                break;
            }
          } else if (pom2 === 1 && pom1 <= 1) {
            s.addm(5, 'kor-m-lezekrkem');
          }
          if ((pom2 === 1 && [2, 3, 5].includes(pom1)) || (pom2 === 2 && pom1 === 4)) {
            switch (s.random(2)) {
              case 0:
                s.addv(5, 'kor-v-lezekrkem');
                break;
              case 1:
                s.addv(5, 'kor-v-kostice');
                break;
            }
          }
        }
      }
    } else if (
      v[R.room_kreseni] === 0 &&
      s.item(R.velkar).x >= 30 &&
      s.item(R.velkar).y === 5 &&
      s.item(R.elko).x === 30
    ) {
      v[R.room_kreseni]!++;
      s.addv(5, 'kor-v-odsud');
      s.addm(8, 'kor-m-budesmuset');
    } else if (
      v[R.room_kreseni] === 1 &&
      s.farray(10, 6) === ITEM_WATER &&
      s.farray(23, 6) === ITEM_WATER
    ) {
      v[R.room_kreseni]!++;
    } else if (
      v[R.room_kreseni] === 2 &&
      ((s.farray(10, 6) >= R.sas1 && s.farray(10, 6) <= R.sas6) ||
        (s.farray(23, 6) >= R.sas1 && s.farray(23, 6) <= R.sas6))
    ) {
      v[R.room_kreseni]!++;
      s.addm(10, 'kor-m-neniono');
      s.addm(20, 'kor-m-tudiru');
    } else if (v[R.room_qhlaska] === 0) {
      v[R.room_qhlaska] = s.random(600) + 200;
      const pom1 = s.random(6);
      if ((v[R.room_pouzito]! & (1 << pom1)) === 0) {
        switch (pom1) {
          case 0:
            s.addm(10, 'kor-m-dusi');
            break;
          case 1:
            s.addm(10, 'kor-m-pocit');
            break;
          case 2:
            s.addm(10, 'kor-m-bizarni');
            break;
          case 3:
            s.addv(10, 'kor-v-bermudy');
            break;
          case 4:
            s.addv(10, 'kor-v-inteligentni');
            break;
          case 5:
            s.addv(10, 'kor-v-jedovate');
            break;
        }
      }
      v[R.room_pouzito] = v[R.room_pouzito]! | (1 << pom1);
    } else if (v[R.room_quvod] === 0) {
      switch (true) {
        case s.pokus >= 1 && s.pokus <= 1000:
          v[R.room_quvod] = s.random(2) + 1;
          break;
        case s.pokus >= 1001 && s.pokus <= 2000:
          v[R.room_quvod] = 3;
          s.pokus += 1000;
          break;
        default:
          v[R.room_quvod] = s.random(4);
          break;
      }
      switch (v[R.room_quvod]) {
        case 0:
        case 1:
          s.addv(10, 'kor-v-podivej');
          s.addm(2, 'kor-m-vzdyt');
          s.addv(6, 'kor-v-treba');
          break;
        case 2:
        case 3:
          s.addm(10, 'kor-m-podivej');
          s.addv(5, 'kor-v-spitu');
          if (s.random(100) < 40) s.addm(2, 'kor-m-avlada');
          s.addv(10, 'kor-v-nicje');
          if (v[R.room_quvod] === 3) s.addm(5, 'kor-m-pokud');
          break;
      }
      v[R.room_quvod] = -1;
    }
  }

  // ---- krab1 (the lead crab): derive krabfaze from the tune, then dance ----
  {
    const k1 = s.vars(R.krab1);
    if (s.playing(10)) {
      switch (s.count % 4) {
        case 0:
        case 1:
          k1[R.krab1_krabfaze] = 7;
          break;
        default: // 2,3
          k1[R.krab1_krabfaze] = 9;
          break;
      }
    } else if (k1[R.krab1_krabfaze]! <= 2) {
      k1[R.krab1_krabfaze] = 1;
    } else {
      k1[R.krab1_krabfaze] = 2;
    }
    crabDance(s, R.krab1, R.krab1_cekat, k1[R.krab1_krabfaze]!);
  }

  // ---- balalajka (the octopus): idle beat, or the pushed-into-playing score ----
  {
    const it = s.item(R.balalajka);
    if (it.dir !== Dir.no && bal[R.balalajka_cinnost] === 0) bal[R.balalajka_cinnost]!++;

    switch (bal[R.balalajka_cinnost]) {
      case 0:
        switch (s.count % 18) {
          case 0:
            if (bal[R.balalajka_tcatcat] === 0) {
              s.snd('kor-chob-tca', 501);
              bal[R.balalajka_tcatcat] = s.random(15) + 10;
            } else {
              s.snd('kor-chob-psi', 501);
              bal[R.balalajka_tcatcat]!--;
            }
            break;
          case 1:
          case 2:
          case 3:
          case 4:
          case 5:
          case 6:
          case 7:
          case 8:
          case 9:
          case 10:
            it.afaze = 0;
            break;
          case 11:
            s.snd('kor-chob-chro', 501);
            break;
          default:
            it.afaze = 1;
            break;
        }
        break;
      case 1:
        bal[R.balalajka_hrala]!++;
        s.clearDialog();
        it.afaze = 2;
        s.ksnd(501);
        break;
      case 6:
        it.afaze = 3;
        break;
      case 10:
        it.afaze = 4;
        break;
      case 13:
        it.afaze = 3;
        break;
      case 15:
        it.afaze = 4;
        break;
      case 17:
        it.afaze = 5;
        break;
      case 19:
        s.music('rybky08', 10);
        break;
      case 21:
      case 23:
      case 25:
      case 27:
        it.afaze = 6;
        break;
      case 22:
      case 24:
      case 26:
      case 28:
        if (s.random(100) < 10) it.afaze = 7;
        else it.afaze = 8;
        break;
      case 29:
      case 31:
      case 33:
      case 35:
        it.afaze = 9;
        break;
      case 30:
      case 32:
      case 34:
      case 36:
        it.afaze = 10;
        break;
      case 83:
        it.afaze = 5;
        break;
      case 90:
        bal[R.balalajka_cinnost] = 0;
        break;
    }

    if (bal[R.balalajka_cinnost]! > 20 && bal[R.balalajka_cinnost]! < 80 && !s.playing(10)) {
      bal[R.balalajka_cinnost] = 80;
    } else if (bal[R.balalajka_cinnost] === 36) {
      bal[R.balalajka_cinnost] = 21;
    } else if (bal[R.balalajka_cinnost]! > 0) {
      bal[R.balalajka_cinnost]!++;
    }
  }

  // ---- sas1 (lead anemone): derive sasfaze from the tune, then sway ----
  {
    const s1 = s.vars(R.sas1);
    if (s.playing(10)) {
      const pom1 = s.count % 8 <= 3 ? 0 : 1;
      const m8 = s.count % 8;
      const pom2 = m8 === 0 || m8 === 3 || m8 === 4 || m8 === 7 ? 2 : 1;
      s1[R.sas1_sasfaze] = pom1 * 4 + pom2;
    } else {
      s1[R.sas1_sasfaze] = -1;
    }
    sasSway(s, R.sas1, R.sas1_noha, R.sas1_kvet, s1[R.sas1_sasfaze]!);
  }

  // ---- sas2..6: sway mirroring the lead anemone ----
  const sasfaze = s.vars(R.sas1)[R.sas1_sasfaze]!;
  for (const sa of [R.sas2, R.sas3, R.sas4, R.sas5, R.sas6]) {
    sasSway(s, sa, R.sas_noha, R.sas_kvet, sasfaze);
  }

  // ---- krab2..6: dance mirroring the lead crab ----
  const krab1faze = s.vars(R.krab1)[R.krab1_krabfaze]!;
  for (const c of [R.krab2, R.krab3, R.krab4, R.krab5, R.krab6]) {
    crabDance(s, c, R.krab_cekat, krab1faze);
  }

  // ---- sepie (cuttlefish): shuffles its legs falling/standing, blinks ----
  {
    const se = s.vars(R.sepie);
    const it = s.item(R.sepie);
    const pada = it.dir === Dir.down;
    const stoji =
      s.farray(it.x, it.y + 1) === ITEM_WATER &&
      s.farray(it.x + 1, it.y + 1) === ITEM_WATER &&
      s.farray(it.x + 2, it.y + 3) !== ITEM_WATER;

    if (se[R.sepie_mrk]! > 0) se[R.sepie_mrk]!--;
    else if (s.random(100) < 15) se[R.sepie_mrk] = s.random(3) + 2;

    if (pada || !stoji) {
      if (s.count % 2 === 1) se[R.sepie_nohy] = (se[R.sepie_nohy]! + 2 + s.random(2) * 2) % 3;
      if (pada) it.afaze = se[R.sepie_nohy]! + 3;
      else if (se[R.sepie_mrk]! > 0) it.afaze = se[R.sepie_nohy]! + 6;
      else it.afaze = se[R.sepie_nohy]!;
    } else {
      if (it.dir === Dir.left || it.dir === Dir.right) se[R.sepie_nohy] = (se[R.sepie_nohy]! + 1) % 2;
      else se[R.sepie_nohy] = 0;
      if (se[R.sepie_mrk]! > 0) it.afaze = 2 * se[R.sepie_nohy]! + 10;
      else it.afaze = 2 * se[R.sepie_nohy]! + 9;
    }
  }
}

export const KORALY: RoomScript = { name: 'KORALY', init, prog };
