/**
 * JESKYNE ("The Deepest Cave", room 63) — a faithful port of JESKYNE_InitProgramky /
 * JESKYNE_Programky (URoom.pas:5979-6033, 12969-13202). The largest Cave room.
 *
 * A deep cavern with a hanging bat (netopyr) that, once a pole (tycka) and vase (vaza)
 * pin it in place, strains its wings (the lift puzzle); a gawking troglodyte (blbec)
 * that gapes when shoved; a darting cave-fish (rybka); a chomping skull (das); and a
 * long chain of one-shot fish observations about the creatures and the grail.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_vzperac: 1,
  room_blbecek: 2,
  room_neprojedu: 3,
  room_orybe: 4,
  room_kecy: 5,
  room_potvurka: 6,
  room_onetopyrovi: 7,
  netopyr: 1,
  netopyr_kridla: 1,
  netopyr_oci: 2,
  netopyr_vzpira: 3,
  malar: 2,
  velkar: 3,
  tycka: 4,
  das: 5,
  blbec: 8,
  blbec_faze: 1,
  blbec_udivenej: 2,
  rybka: 9,
  rybka_faze: 1,
  vaza: 11,
} as const;

function init(s: Script): void {
  s.vars(R.room, 7); // all seven room flags default 0

  const nv = s.vars(R.netopyr, 3);
  nv[R.netopyr_kridla] = -1 * (s.random(200) + 20);
  nv[R.netopyr_oci] = 0;
  nv[R.netopyr_vzpira] = 0;

  const bv = s.vars(R.blbec, 2);
  bv[R.blbec_faze] = 0;
  bv[R.blbec_udivenej] = 0;

  s.vars(R.rybka, 1)[R.rybka_faze] = -s.random(200) - 100;
}

/** True when the bat is pinned between the pole and vase (the lift puzzle position). */
function batPinned(s: Script): boolean {
  return (
    s.item(R.tycka).x === 10 &&
    s.item(R.tycka).y === 15 &&
    s.item(R.vaza).x === 18 &&
    s.item(R.vaza).y === 16 &&
    s.item(R.netopyr).x === 18 &&
    s.item(R.netopyr).y === 19
  );
}

function roomBlock(s: Script): void {
  const v = s.vars(R.room);
  if (!(s.alive('little') && s.alive('big') && s.noDialog())) return;
  const malar = s.item(R.malar);
  const velkar = s.item(R.velkar);
  const netAfaze = s.item(R.netopyr).afaze;

  if (
    s.lookAt(R.malar, R.netopyr) &&
    malar.y > 17 &&
    malar.y < 22 &&
    v[R.room_vzperac] === 0 &&
    (netAfaze === 2 || netAfaze === 3) &&
    s.random(100) < 4
  ) {
    s.addm(s.random(20), 'jes-m-netopyr');
    s.addv(s.random(5), 'jes-v-tojo');
    v[R.room_vzperac] = 1;
  } else if (
    s.lookAt(R.malar, R.blbec) &&
    s.dist(R.malar, R.blbec) < 3 &&
    v[R.room_blbecek] === 0 &&
    s.random(100) < 2
  ) {
    s.addm(s.random(5), 'jes-m-tvor');
    v[R.room_blbecek] = 1;
  } else if (
    velkar.x === 3 &&
    velkar.y === 15 &&
    s.item(R.tycka).x === 10 &&
    s.item(R.tycka).y === 15 &&
    v[R.room_neprojedu] === 0 &&
    s.random(100) < 3
  ) {
    s.addv(0, 'jes-v-uzke');
    v[R.room_neprojedu] = 1;
  } else if (
    s.lookAt(R.malar, R.rybka) &&
    s.item(R.tycka).x === 10 &&
    s.item(R.tycka).y === 17 &&
    s.random(100) < 30 &&
    v[R.room_orybe] === 0
  ) {
    v[R.room_orybe] = 1;
    s.addm(s.random(5), 'jes-m-ryba');
    s.addv(s.random(5), 'jes-v-kamen');
  } else if (s.random(1000) < 3 && v[R.room_kecy] === 0) {
    switch (s.random(3)) {
      case 0:
        s.addv(s.random(5), 'jes-v-gral');
        break;
      case 1:
        s.addv(s.random(5), 'jes-v-gral');
        s.addm(s.random(5), 'jes-m-deprese');
        break;
      case 2:
        s.addv(s.random(5), 'jes-v-gral');
        s.addm(s.random(5), 'jes-m-deprese');
        s.addv(s.random(5), 'jes-v-nevim');
        break;
    }
    v[R.room_kecy] = 1;
  } else if (v[R.room_kecy] === 1 && velkar.y > 19 && s.random(100) < 30) {
    s.addm(s.random(5), 'jes-m-takvidis');
    v[R.room_kecy] = 2;
  } else if (
    v[R.room_potvurka] === 0 &&
    s.random(100) < 5 &&
    s.lookAt(R.malar, R.das) &&
    s.dist(R.malar, R.das) < 4
  ) {
    switch (s.random(3)) {
      case 0: s.addm(1, 'jes-m-potvora0'); break;
      case 1: s.addm(1, 'jes-m-potvora1'); break;
      case 2: s.addm(1, 'jes-m-potvora2'); break;
    }
    switch (s.random(3)) {
      case 0: s.addv(s.random(5), 'jes-v-potvora0'); break;
      case 1: s.addv(s.random(5), 'jes-v-potvora1'); break;
      case 2: s.addv(s.random(5), 'jes-v-potvora2'); break;
    }
    v[R.room_potvurka] = 1;
  } else if (
    v[R.room_onetopyrovi] === 0 &&
    s.lookAt(R.malar, R.netopyr) &&
    s.dist(R.malar, R.netopyr) < 4 &&
    s.random(1000) < 2
  ) {
    v[R.room_onetopyrovi] = 1;
    s.addm(1, 'jes-m-netopyr0');
    switch (s.random(3)) {
      case 0: s.addv(s.random(5), 'jes-v-netopyr0'); break;
      case 1: s.addv(s.random(5), 'jes-v-netopyr1'); break;
      case 2: s.addv(s.random(5), 'jes-v-netopyr2'); break;
    }
    switch (s.random(3)) {
      case 0: s.addm(s.random(5), 'jes-m-netopyr1'); break;
      case 1: s.addm(s.random(5), 'jes-m-netopyr2'); break;
      case 2: s.addm(s.random(5), 'jes-m-netopyr3'); break;
    }
  } else if (
    v[R.room_potvurka] === 1 &&
    s.item(R.das).x === 17 &&
    s.item(R.das).y === 7 &&
    s.random(1000) < 4
  ) {
    switch (s.random(2)) {
      case 0: s.addv(s.random(5), 'jes-v-nechut0'); break;
      case 1: s.addv(s.random(5), 'jes-v-nechut1'); break;
    }
    v[R.room_potvurka] = 2;
  }
}

function prog(s: Script): void {
  roomBlock(s);

  // netopyr: the bat — eyes blink; when pinned it strains its wings (vzpira/kridla).
  {
    const it = s.item(R.netopyr);
    const nv = s.vars(R.netopyr);
    if (nv[R.netopyr_oci] === 0 && s.random(100) < 30) nv[R.netopyr_oci] = 1;
    else if (s.random(100) < 60) nv[R.netopyr_oci] = 0;

    if (batPinned(s)) {
      if (nv[R.netopyr_kridla]! < 0) {
        nv[R.netopyr_kridla]!++;
      } else if (nv[R.netopyr_kridla] === 0 && nv[R.netopyr_vzpira]! < 7 && batPinned(s)) {
        it.afaze = nv[R.netopyr_oci]! + 2;
        nv[R.netopyr_vzpira]!++;
      } else if (nv[R.netopyr_vzpira]! >= 7 && nv[R.netopyr_kridla] === 0) {
        nv[R.netopyr_vzpira] = 0;
        nv[R.netopyr_kridla] = -1 * (s.random(300) + 5);
        it.afaze = nv[R.netopyr_oci]!;
      }
    } else {
      it.afaze = nv[R.netopyr_oci]!;
    }
  }

  // tycka (pole) + vaza (vase): both react to the straining bat.
  const straining = s.item(R.netopyr).afaze === 2 || s.item(R.netopyr).afaze === 3;
  s.item(R.tycka).afaze = straining ? 1 : 0;
  s.item(R.vaza).afaze = straining ? 1 : 0;

  // das: the chomping skull's animation cycle.
  {
    const it = s.item(R.das);
    switch (it.afaze) {
      case 0:
      case 2:
      case 3:
      case 4:
      case 6:
      case 7:
        it.afaze++;
        break;
      case 1:
        if (s.random(100) < 10) it.afaze = 6;
        else it.afaze++;
        break;
      case 5:
        it.afaze = 0;
        break;
      case 8:
        it.afaze = 5;
        break;
    }
  }

  // blbec: the troglodyte — sways, and gapes (udivenej) when shoved.
  {
    const it = s.item(R.blbec);
    const bv = s.vars(R.blbec);
    if (s.count % 2 === 0) {
      switch (bv[R.blbec_faze]) {
        case 0:
        case 1:
          bv[R.blbec_faze]!++;
          break;
        case 2:
          bv[R.blbec_faze] = 0;
          break;
      }
    }
    if (it.dir !== Dir.no) bv[R.blbec_udivenej] = s.random(100) + 30;
    if (bv[R.blbec_udivenej]! > 0) {
      bv[R.blbec_udivenej]!--;
      if (s.random(100) < 20) it.afaze = 3 * bv[R.blbec_faze]! + 1;
      else it.afaze = 3 * bv[R.blbec_faze]! + 2;
    } else {
      it.afaze = 3 * bv[R.blbec_faze]!;
    }
  }

  // rybka: the darting cave-fish.
  {
    const it = s.item(R.rybka);
    const rv = s.vars(R.rybka);
    const faze = rv[R.rybka_faze]!;
    if (faze >= -10 && faze <= 0) {
      it.afaze = 1;
      rv[R.rybka_faze]!++;
    } else if (faze === 1) {
      it.afaze = 2;
      if (s.random(100) < 25) rv[R.rybka_faze]!++;
    } else if (faze === 2) {
      it.afaze = 1;
      rv[R.rybka_faze]!++;
    } else if (faze === 3) {
      it.afaze = 3;
      if (s.random(100) < 25) rv[R.rybka_faze]!++;
    } else if (faze === 4) {
      it.afaze = 1;
      if (s.random(100) < 15) rv[R.rybka_faze] = 1;
      else rv[R.rybka_faze] = -s.random(200) - 100;
    } else {
      it.afaze = 0;
      rv[R.rybka_faze]!++;
    }
  }
}

export const JESKYNE: RoomScript = { name: 'JESKYNE', init, prog };
