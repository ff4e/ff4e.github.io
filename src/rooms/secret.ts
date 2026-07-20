/**
 * SECRET ("Crab Freak Show", room 27) — a faithful port of SECRET_InitProgramky /
 * SECRET_Programky (URoom.pas:6899-6995, 16286-16548).
 *
 * A hidden circus of crustaceans. The fish (scully = item 6 = little, mulder =
 * item 7 = big — an X-Files gag) draw commentary from a long timed dialogue
 * schedule. A row of balloons (lbalon/rbalon/balon1/2/3) spins when pushed and
 * bobs on its own; nudging the two end balloons onto the CRAB (item 17) makes it
 * scuttle. The crab's eyes track whichever fish stands over it, it frowns at
 * random and shuffles its legs; a shrimp (18) and a sleepy little crab (krabik,
 * 19) react to the crab's state. A stone mouth (drzka, 2) chatters via a setanim
 * sequence. Uses only existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_poslvykrik: 2,
  room_pocetvykriku: 3,
  room_venku: 4,
  room_obaloncich: 5,
  room_omeste: 6,
  room_okrabech: 7,
  room_osose: 8,
  room_opocitech: 9,
  cihla: 1,
  drzka: 2,
  drzka_cinnost: 1,
  scully: 6, // little fish
  mulder: 7, // big fish
  lbalon: 8,
  rbalon: 9,
  balon1: 10,
  balon1_pauza: 1,
  balon2: 11,
  balon3: 12,
  hlava1: 14,
  hlava2: 15,
  hlava3: 16,
  krab: 17,
  krab_beh: 1,
  krab_oci: 2,
  krab_voci: 3,
  krab_mrac: 4,
  krab_nohy: 5,
  shrimp: 18,
  krabik: 19,
  krabik_spi: 1,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

/** A balloon's push-spin: rolls the afaze 0..3 with the shove direction. Returns
 *  true when the balloon was being pushed (so the caller skips its idle branch). */
function balloonDirSpin(s: Script, idx: number): boolean {
  const it = s.item(idx);
  if (it.dir === Dir.left) {
    it.afaze = it.afaze === 0 ? 3 : it.afaze - 1;
    return true;
  }
  if (it.dir === Dir.right) {
    it.afaze = it.afaze === 3 ? 0 : it.afaze + 1;
    return true;
  }
  return false;
}

function init(s: Script): void {
  const v = s.vars(R.room, 9);
  v[R.room_uvod] = 10 + s.random(10);
  v[R.room_poslvykrik] = -1;
  v[R.room_pocetvykriku] = 0;
  v[R.room_venku] = 1;
  v[R.room_obaloncich] = s.random(20) + 40;
  v[R.room_omeste] = s.random(2);
  v[R.room_okrabech] = 0;
  v[R.room_osose] = s.random(4000) + 3000;
  if (s.pokus > 1 && s.random(100) < 50) v[R.room_opocitech] = s.random(1500) + 1000;
  else v[R.room_opocitech] = -1;

  const dr = s.vars(R.drzka, 1);
  dr[R.drzka_cinnost] = 0;
  s.item(R.drzka).afaze = 0;

  s.vars(R.balon1, 1)[R.balon1_pauza] = s.random(200);

  const kr = s.vars(R.krab, 5);
  kr[R.krab_beh] = 0;
  kr[R.krab_oci] = 1;
  kr[R.krab_voci] = 1;
  kr[R.krab_mrac] = 1;
  kr[R.krab_nohy] = 1;
  s.item(R.krab).afaze = 10;

  s.item(R.shrimp).afaze = 4;

  s.vars(R.krabik, 1)[R.krabik_spi] = 0;
  s.item(R.krabik).afaze = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room dialogue (a long timed schedule) ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_uvod]! > 0) {
      const cihla = s.item(R.cihla);
      if (cihla.x === cihla.xStart && cihla.y === cihla.yStart) v[R.room_uvod]!--;
      else {
        v[R.room_uvod] = -1;
        v[R.room_venku] = 0;
      }
    }
    if (v[R.room_osose]! > 0) v[R.room_osose]!--;
    if (v[R.room_opocitech]! > 0) v[R.room_opocitech]!--;

    if (v[R.room_obaloncich]! > 0) {
      if (
        s.item(R.balon1).dir !== Dir.no ||
        s.item(R.balon2).dir !== Dir.no ||
        s.item(R.balon3).dir !== Dir.no ||
        s.item(R.lbalon).dir !== Dir.no ||
        s.item(R.rbalon).dir !== Dir.no
      ) {
        v[R.room_obaloncich]!--;
      }
    }

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 100 + s.random(200);
      v[R.room_pocetvykriku]!++;
      let pom1 = s.random(2);
      if (pom1 === v[R.room_poslvykrik]) pom1 = 2;
      if (v[R.room_pocetvykriku] === 5 || v[R.room_pocetvykriku] === 11 || v[R.room_pocetvykriku] === 16) {
        pom1 = 3;
      }
      v[R.room_poslvykrik] = pom1;
      if (pom1 >= 0 && pom1 <= 2) {
        s.addv(3, 'sec-v-ven' + digit(pom1));
      } else if (pom1 === 3) {
        s.addv(3, 'sec-v-zavreny');
        s.addm(10, 'sec-m-kamen');
      }
    } else if (v[R.room_venku] === 0) {
      v[R.room_venku] = 1;
      s.addm(s.random(10) + 10, 'sec-m-ven' + digit(s.random(2)));
    } else if (v[R.room_obaloncich] === 0) {
      v[R.room_obaloncich] = -1;
      s.addm(5, 'sec-m-balonky');
    } else if (v[R.room_omeste] === 0 && s.random(3000) === 0) {
      v[R.room_omeste] = 1;
      s.addv(10, 'sec-v-mesto');
    } else if (v[R.room_okrabech] === 0 && s.random(2000) === 0) {
      v[R.room_okrabech] = 1;
      // NOTE: faithful to the original — this sound name is a developer placeholder
      // that was never filled in (URoom.pas:16347), so it resolves to nothing (a
      // silent ~20-tick beat in the exchange). Kept verbatim.
      s.addm(20, 'sec-m-Items[r_SECRET_krab]^');
      s.addv(10, 'sec-v-ktery');
      s.addm(5, 'sec-m-dole' + digit(s.random(2)));
      s.addv(5 + s.random(20), 'sec-v-normalni' + digit(s.random(2)));
    } else if (v[R.room_osose] === 0) {
      v[R.room_osose] = -1;
      s.addv(40, 'sec-v-socha');
      s.addm(s.random(10) + 4, 'sec-m-situace');
      s.adddel(s.random(15) + 5);
      s.addset((val) => (s.vars(R.drzka)[R.drzka_cinnost] = val), 1);
    } else if (v[R.room_opocitech] === 0) {
      v[R.room_opocitech] = -1;
      s.addv(20, 'sec-v-pocit');
      s.addm(5, 'sec-m-pocity');
      s.addv(0, 'sec-v-pockej');
      s.addv(s.random(30) + 40, 'sec-v-oci');
      s.addm(4, 'sec-m-program');
    }
  }

  // ---- drzka (stone mouth): chatters via a setanim sequence ----
  {
    const dv = s.vars(R.drzka);
    switch (dv[R.drzka_cinnost]) {
      case 1:
        s.setanim(R.drzka, 'a5d2a10d11a11d4a10d4a11d4a10d4a11d4a10d?20-40a9');
        dv[R.drzka_cinnost]!++;
        break;
      case 2:
        s.goanim(R.drzka);
        break;
    }
  }

  // ---- lbalon: spins when pushed; else scuttles the crab if it sits on it ----
  if (!balloonDirSpin(s, R.lbalon)) {
    const it = s.item(R.lbalon);
    const krab = s.item(R.krab);
    if (it.x === krab.x && it.y - 3 === krab.y) {
      it.afaze = it.afaze === 3 ? 0 : it.afaze + 1;
      s.vars(R.krab)[R.krab_beh] = 1;
    }
  }

  // ---- rbalon: mirror of lbalon, offset by 5 ----
  if (!balloonDirSpin(s, R.rbalon)) {
    const it = s.item(R.rbalon);
    const krab = s.item(R.krab);
    if (it.x - 5 === krab.x && it.y - 3 === krab.y) {
      it.afaze = it.afaze === 0 ? 3 : it.afaze - 1;
      s.vars(R.krab)[R.krab_beh] = 1;
    }
  }

  // ---- balon1: the push-spin + the pauza=0 reset are gated on dir; but the pauza<0
  // float (spin+inc, else dec) is a SEPARATE UNCONDITIONAL statement in the original
  // (URoom.pas:16416) that runs every tick, even while the balloon is being pushed. ----
  {
    const it = s.item(R.balon1);
    const bv = s.vars(R.balon1);
    if (!balloonDirSpin(s, R.balon1)) {
      if (bv[R.balon1_pauza] === 0) bv[R.balon1_pauza] = s.random(320) - 60;
    }
    if (bv[R.balon1_pauza]! < 0) {
      it.afaze = it.afaze === 3 ? 0 : it.afaze + 1;
      bv[R.balon1_pauza]!++;
    } else {
      bv[R.balon1_pauza]!--;
    }
  }

  // ---- balon2 / balon3: push-spin only ----
  balloonDirSpin(s, R.balon2);
  balloonDirSpin(s, R.balon3);

  // hlava1/2/3 (items 14/15/16): their per-tick face cycles are commented out in
  // the original (URoom.pas:16436-16465) — intentionally no-ops here.

  // ---- krab (the show crab): eyes track a fish above it, frowns, shuffles legs ----
  {
    const it = s.item(R.krab);
    const kv = s.vars(R.krab);

    if (kv[R.krab_beh] === 1) {
      if (kv[R.krab_nohy] === 2) kv[R.krab_nohy] = 0;
      else kv[R.krab_nohy]!++;
      kv[R.krab_beh] = 0;
    } else {
      kv[R.krab_nohy] = 1;
    }

    if (s.random(20) === 1) kv[R.krab_mrac] = 1 - kv[R.krab_mrac]!;

    if (s.xdist(R.scully, R.krab) === 0 && s.ydist(R.scully, R.krab) <= 0) {
      if (s.item(R.scully).x < it.x) kv[R.krab_oci] = 0;
      else if (s.item(R.scully).x > it.x + 3) kv[R.krab_oci] = 2;
      else kv[R.krab_oci] = 1;
    } else if (s.xdist(R.mulder, R.krab) === 0 && s.ydist(R.mulder, R.krab) <= 0) {
      if (s.item(R.mulder).x < it.x - 1) kv[R.krab_oci] = 0;
      else if (s.item(R.mulder).x > it.x + 3) kv[R.krab_oci] = 2;
      else kv[R.krab_oci] = 1;
    } else if (s.count % 2 === 1) {
      switch (s.random(11)) {
        case 0:
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          kv[R.krab_voci] = kv[R.krab_voci] === 3 ? 0 : kv[R.krab_voci]! + 1;
          break;
        case 6:
          kv[R.krab_voci] = kv[R.krab_voci] === 0 ? 3 : kv[R.krab_voci]! - 1;
          break;
        case 9:
          kv[R.krab_voci] = s.random(4);
          break;
      }
      kv[R.krab_oci] = kv[R.krab_voci] === 3 ? 1 : kv[R.krab_voci]!;
    }

    it.afaze = kv[R.krab_oci]! + kv[R.krab_mrac]! * 3 + kv[R.krab_nohy]! * 6;
  }

  // ---- shrimp: eye animation keyed off the crab's gaze ----
  {
    const it = s.item(R.shrimp);
    const kv = s.vars(R.krab);
    if (s.count % 2 === 1) {
      switch (kv[R.krab_oci]) {
        case 0:
          it.afaze = 2;
          break;
        case 2:
          it.afaze = 0;
          break;
        case 1:
          switch (kv[R.krab_voci]) {
            case 1:
              switch (s.random(10)) {
                case 0:
                  it.afaze = 3;
                  break;
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                  it.afaze = 4;
                  break;
                default:
                  it.afaze = 1;
                  break;
              }
              break;
            case 3:
              switch (s.random(10)) {
                case 0:
                case 1:
                case 2:
                case 3:
                  it.afaze = 3;
                  break;
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                  it.afaze = 4;
                  break;
                default:
                  it.afaze = 1;
                  break;
              }
              break;
            default:
              switch (s.count % 8) {
                case 0:
                case 1:
                  it.afaze = 1;
                  break;
                case 4:
                case 5:
                  it.afaze = 3;
                  break;
                default:
                  it.afaze = 4;
                  break;
              }
              break;
          }
          break;
      }
    }
  }

  // ---- krabik (sleepy little crab): dozes, else mirrors the shrimp ----
  {
    const it = s.item(R.krabik);
    const kv = s.vars(R.krabik);
    if (s.count % 2 === 1) {
      if (kv[R.krabik_spi]! > 0) {
        it.afaze = 1;
        kv[R.krabik_spi]!--;
      } else {
        switch (s.item(R.shrimp).afaze) {
          case 0:
            it.afaze = 5;
            break;
          case 1:
            it.afaze = 2;
            break;
          case 2:
            it.afaze = 4;
            break;
          case 3:
            it.afaze = 3;
            break;
          case 4:
            it.afaze = 0;
            break;
        }
        if (s.random(100) === 14) kv[R.krabik_spi] = s.random(30);
      }
    }
  }
}

export const SECRET: RoomScript = { name: 'SECRET', init, prog };
