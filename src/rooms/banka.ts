/**
 * BANKA ("The gene bank" / lab, room 57) — the largest room in the game. A faithful
 * port of BANKA_InitProgramky / BANKA_Programky (URoom.pas:6458-6628, 14578-15346).
 *
 * A mad-scientist laboratory teeming with life: two "dog" pairs (horni/dolni) that
 * track each other, 16 bubbling test tubes (zkum, via globpole), a skeleton (kostra),
 * a big rolling eye (oko), three little blobs (qldik1-3), a shape-shifting bottle
 * creature (lahvac), a fish-tracking eye (oka), a swinging critter (malej), a grabbing
 * hand (ruka), a mutant behind doors, and the centrepiece: a self-reproducing blob
 * colony (pldicek) driven by the PldiciState cellular automaton (src/core/pldici.ts).
 *
 * The room block fires dozens of one-shot fish comments as the fish explore, throttled
 * by a shared "nerus" (don't-disturb) counter and periodically re-armed (count mod 800).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { PldiciState } from '../core/pldici.js';

const R = {
  room: 0,
  room_hnerus: 1,
  room_kdy: 2,
  room_kdy2: 3,
  room_uvod: 4,
  room_pokusy: 5,
  room_nerus: 6,
  room_zij: 7,
  room_bojidole: 8,
  room_pldicim: 9,
  room_pldiciv: 10,
  room_kouk: 11,
  room_fuja: 12,
  room_ruk: 13,
  room_zku: 14,
  room_nep: 15,
  room_vic: 16,
  room_mrt: 17,
  room_nedobre: 18,
  room_jej: 19,
  room_kolem: 20,
  klicka: 1,
  malar: 2,
  velkar: 3,
  zataras: 7,
  horni1: 10,
  horni1_oci: 1,
  horni1_poloha: 2,
  dolni1: 11,
  dolni1_oci: 1,
  dolni1_zije: 2,
  zkum: 12,
  horni2: 32,
  horni2_oci: 1,
  horni2_poloha: 2,
  dolni2: 33,
  dolni2_oci: 1,
  dolni2_zije: 2,
  kostra: 35,
  kostra_citac: 1,
  oko: 38,
  oko_cinnost: 1,
  oko_faze: 2,
  oko_citac: 3,
  qldik1: 39,
  qldik1_zije: 1,
  qldik1_oci: 2,
  qldik2: 40,
  qldik2_zije: 1,
  qldik2_oci: 2,
  qldik3: 41,
  qldik3_oci: 1,
  qldik3_skace: 2,
  lahvac: 42,
  lahvac_rozbit: 1,
  lahvac_stav: 2,
  lahvac_vnitrek: 3,
  lahvac_smer: 4,
  lahvac_pada: 5,
  oka: 43,
  oka_kuk: 1,
  oka_smer: 2,
  oka_novysmer: 3,
  oka_impuls: 4,
  oka_faze: 5,
  malej: 45,
  malej_oci: 1,
  malej_houpe: 2,
  malej_faze: 3,
  ruka: 46,
  ruka_cinnost: 1,
  ruka_faze: 2,
  ruka_smer: 3,
  dvere1: 49,
  dvere2: 50,
  pldicek: 51,
  pldicek_pocet: 1,
  mutant: 78,
} as const;

// chr(49+n) -> '1','2',...
const d1 = (n: number): string => String.fromCharCode(49 + n);

let pldici: PldiciState | null = null;

function init(s: Script): void {
  const room = s.vars(R.room, 20);
  const pokus = s.pokus;
  room[R.room_uvod] = 0;
  if (pokus > 15) room[R.room_uvod] = s.random(2);
  room[R.room_pokusy] = 0;
  room[R.room_bojidole] = 0;
  room[R.room_nerus] = Math.floor(pokus / 2);
  room[R.room_hnerus] = 0;
  room[R.room_zij] = s.random(10) < pokus ? 1 : 0;
  room[R.room_kdy] = s.random(1000 * pokus);
  room[R.room_kdy2] = s.random(2000 * pokus);
  room[R.room_pldicim] = s.random(20) < pokus ? 1 : 0;
  room[R.room_pldiciv] = 0;
  room[R.room_kouk] = 0;
  room[R.room_fuja] = -42;
  room[R.room_ruk] = 0;
  room[R.room_zku] = 0;
  room[R.room_nep] = 0;
  room[R.room_vic] = 0;
  room[R.room_mrt] = 0;
  room[R.room_nedobre] = pokus % 3 > 0 ? 0 : 1;
  room[R.room_jej] = 0;
  room[R.room_kolem] = 0;

  s.vars(R.horni1, 2)[R.horni1_oci] = 0;
  let v = s.vars(R.dolni1, 2);
  v[R.dolni1_oci] = 0;
  v[R.dolni1_zije] = -99;

  for (let i = 0; i <= 15; i++) {
    s.globpole[i] = s.random(100) + 10;
    s.item(R.zkum + i).afaze = 0;
    if (s.random(2) === 0) s.globpole[i] = -s.globpole[i]!;
  }

  s.vars(R.horni2, 2)[R.horni2_oci] = 0;
  v = s.vars(R.dolni2, 2);
  v[R.dolni2_oci] = 0;
  v[R.dolni2_zije] = -99;

  s.vars(R.kostra, 1)[R.kostra_citac] = s.random(200) + 200;
  s.vars(R.oko, 3)[R.oko_cinnost] = 0;

  v = s.vars(R.qldik1, 2);
  s.item(R.qldik1).afaze = 5;
  v[R.qldik1_zije] = 0;
  v[R.qldik1_oci] = 0;
  v = s.vars(R.qldik2, 2);
  s.item(R.qldik2).afaze = 5;
  v[R.qldik2_zije] = 0;
  v[R.qldik2_oci] = 0;
  v = s.vars(R.qldik3, 2);
  v[R.qldik3_oci] = 0;
  v[R.qldik3_skace] = 0;

  v = s.vars(R.lahvac, 5);
  v[R.lahvac_rozbit] = 0;
  v[R.lahvac_vnitrek] = s.random(4);
  v[R.lahvac_stav] = 0;
  v[R.lahvac_smer] = s.random(2);
  v[R.lahvac_pada] = 0;

  v = s.vars(R.oka, 5);
  v[R.oka_impuls] = 0;
  v[R.oka_kuk] = 0;
  v[R.oka_smer] = 4;

  v = s.vars(R.malej, 3);
  v[R.malej_houpe] = 0;
  v[R.malej_oci] = 0;

  v = s.vars(R.ruka, 3);
  v[R.ruka_cinnost] = 0;
  v[R.ruka_smer] = 0;
  v[R.ruka_faze] = 0;

  s.vars(R.pldicek, 1)[R.pldicek_pocet] = 0;
  pldici = new PldiciState(s, R.pldicek);
}

function roomBlock(s: Script): void {
  const room = s.vars(R.room);
  const malar = s.item(R.malar);
  const velkar = s.item(R.velkar);

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (room[R.room_uvod] === 0) {
      room[R.room_uvod] = 1;
      s.addm(s.random(42) + 14, 'bank-m-labolator' + d1(s.random(3)));
      if (s.pokus > s.random(5) && s.random(4) === 1) {
        room[R.room_pokusy] = 1;
        // Verbatim original bug: the sound name literally contains the Pascal
        // expression source (URoom.pas:14594) — no such sample exists, so it is silent.
        s.addv(10, 'bank-v-Vars^[r_BANKA_room_pokusy]' + d1(s.random(2)));
      }
    }

    if (room[R.room_bojidole] === 0 && malar.y > 26 && malar.x < 20) {
      room[R.room_bojidole] = 1;
      s.addm(10, 'bank-m-bojim');
      if (s.random(3) !== 1) s.addm(10, 'bank-m-ocicka');
      if (s.random(3) !== 1) s.addv(15, 'bank-v-pomoc');
    }

    if (s.count === room[R.room_kdy2]) {
      if (s.random(5) < 3) {
        s.addm(20, 'bank-m-prohlednout');
        s.addv(22, 'bank-v-vypad' + d1(s.random(2)));
      } else s.addm(20, 'bank-m-tvorove');
    }

    if (room[R.room_pldicim] === 0 && malar.x > 27 && malar.y < 17) {
      s.addm(8, 'bank-m-nesetkala');
      room[R.room_pldicim] = 1;
    }
    if (room[R.room_pldiciv] === 0 && velkar.x > 27 && velkar.y < 17) {
      s.addv(25, 'bank-v-mnozeni');
      room[R.room_pldiciv] = 1;
    }

    if (room[R.room_kouk] === 0 && malar.y > 26 && malar.x + 1 <= s.item(R.oka).x) {
      room[R.room_kouk] = 1;
      s.addm(2, 'bank-m-kouka');
    }

    if (room[R.room_fuja]! + 50 < s.count) {
      if (
        (s.vars(R.lahvac)[R.lahvac_rozbit] === 10 && s.dist(R.malar, R.lahvac) < 4) ||
        (s.item(R.oka).dir !== Dir.no && s.dist(R.malar, R.oka) < 4)
      ) {
        s.addm(5, 'bank-m-fuj');
        room[R.room_fuja] = s.count;
      }
    }

    if (room[R.room_ruk] === 0 && s.vars(R.ruka)[R.ruka_cinnost] === 2) {
      room[R.room_ruk] = 1;
      s.addm(12, 'bank-m-nervozni');
    }

    if (room[R.room_zku] === 0) {
      let pom2 = 0;
      for (let pom1 = 0; pom1 <= 15; pom1++)
        if (s.dist(R.malar, R.zkum + pom1) < 2) pom2 = 1;
      if (pom2 === 1) {
        room[R.room_zku] = 1;
        s.addm(7, 'bank-m-zkumavka');
      }
    }

    if (
      room[R.room_kolem] === 0 &&
      s.noDialog() &&
      room[R.room_kouk]! +
        room[R.room_zku]! +
        room[R.room_ruk]! +
        room[R.room_pldicim]! +
        room[R.room_pldiciv]! +
        room[R.room_bojidole]! +
        room[R.room_jej]! +
        room[R.room_zij]! +
        room[R.room_uvod]! +
        room[R.room_pokusy]! +
        room[R.room_nep]! +
        room[R.room_mrt]! +
        room[R.room_nedobre]! >
        7
    ) {
      room[R.room_kolem] = 1;
      s.addm(42, 'bank-m-hlavakolem');
    }

    if (room[R.room_nep] === 0 && velkar.x === 40 && velkar.y > 13) {
      room[R.room_nep] = 1;
      s.addv(4, 'bank-v-neproplavu' + d1(s.random(2)));
    }

    if (room[R.room_vic]! < 2 && s.count % 8 === 1) {
      let pom2 = 0;
      for (let pom1 = 1; pom1 <= s.room.itemCount - 1; pom1++) {
        const it = s.item(pom1);
        if (it.y < 21 && it.y > 17 && it.x > 14 && it.x < 29) pom2++;
      }
      if (room[R.room_vic] === 0 && pom2 === 5) {
        s.addv(5, 'bank-v-nahazet');
        room[R.room_vic]!++;
      }
      if (room[R.room_vic] === 1 && pom2 === 7) {
        s.addv(5, 'bank-v-jeste');
        room[R.room_vic]!++;
      }
    }

    if (room[R.room_mrt] === 0 && s.dist(R.malar, R.kostra) < 3) {
      room[R.room_mrt] = 1;
      if (s.random(3) !== 1) s.addm(1, 'bank-m-mrtvolka');
      switch (s.random(5)) {
        case 1:
        case 2:
          s.addm(9, 'bank-m-prehnal1');
          break;
        case 3:
        case 4:
          s.addm(9, 'bank-m-prehnal2');
          break;
      }
    }

    if (room[R.room_nedobre] === 0 && s.item(R.lahvac).dir !== Dir.no) {
      room[R.room_nedobre] = 1;
      s.addv(10, 'bank-v-flaska');
    }

    if (s.item(R.lahvac).afaze === 25) {
      if (s.random(2) === 1) s.addm(5, 'bank-m-rozbila');
    }

    if (
      room[R.room_jej] === 0 &&
      ((s.vars(R.dolni1)[R.dolni1_zije] === -4 && s.dist(R.dolni1, R.malar) < 11) ||
        (s.vars(R.dolni2)[R.dolni2_zije] === -4 && s.dist(R.dolni2, R.malar) < 11))
    ) {
      room[R.room_jej] = 1;
      s.addm(5, 'bank-m-jejda');
    }

    if (room[R.room_pokusy] === 0 && (velkar.x > 32 || velkar.y > 17)) {
      room[R.room_pokusy] = 1;
      if (s.random(3) !== 1) {
        s.addv(10, 'bank-v-pokusy' + d1(s.random(2)));
        room[R.room_hnerus] = 1;
      }
    }

    if (
      room[R.room_zij] === 0 &&
      s.count > Math.floor((10000 - room[R.room_kdy]! - room[R.room_kdy2]!) / 16)
    ) {
      room[R.room_zij] = 1;
      s.addv(s.random(50), 'bank-v-zije');
      room[R.room_hnerus] = 1;
    }

    if (s.count === room[R.room_kdy]) {
      if (s.random(3) === 1) {
        s.addv(20, 'bank-v-potvory');
        if (s.random(3) === 1) room[R.room_hnerus] = 1;
      } else s.addm(20, 'bank-m-organismy');
    }
  }

  // These run every tick (outside the no_dialog guard):
  if (room[R.room_hnerus] === 1) {
    if (s.random(5) + room[R.room_nerus]! < 4) {
      room[R.room_nerus]!++;
      s.addm(10, 'bank-m-nerus');
    }
  }
  room[R.room_hnerus] = 0;

  if (s.count > room[R.room_kdy]!) room[R.room_kdy]! += 1000 + s.random(10000);
  if (s.count > room[R.room_kdy2]!) room[R.room_kdy2]! += 1000 + s.random(10000);

  if (s.count % 800 === 777) {
    switch (s.random(10)) {
      case 1: room[R.room_ruk] = 0; break;
      case 2: room[R.room_kouk] = 0; break;
      case 3: room[R.room_mrt] = 0; break;
      case 4: room[R.room_nedobre] = 0; break;
      case 5: room[R.room_jej] = 0; break;
      case 6: room[R.room_kolem] = 0; break;
      case 7: room[R.room_nerus] = 0; break;
      case 8: room[R.room_pokusy] = 0; break;
      case 9: room[R.room_zij] = 0; break;
      case 0: room[R.room_bojidole] = 0; break;
    }
  }
}

/** horni/dolni: a "dog" pair — the upper one tracks the lower one's position. */
function dogPair(
  s: Script,
  horni: number,
  horniOci: number,
  horniPoloha: number,
  dolni: number,
  dolniOci: number,
  dolniZije: number,
): void {
  const hv = s.vars(horni);
  const dv = s.vars(dolni);
  const hit = s.item(horni);
  const dit = s.item(dolni);

  // upper
  hv[horniPoloha] = 0;
  if (dv[dolniZije]! > 0) {
    const xd = s.xdist(horni, dolni);
    if (xd === 0) hv[horniPoloha] = 3;
    else if (hit.y === dit.y) {
      if (xd >= 1 && xd <= 3) hv[horniPoloha] = 1;
      else if (xd >= -3 && xd <= -1) hv[horniPoloha] = 2;
    }
  }
  if (s.count % 3 === 0 && s.random(100) < 40) hv[horniOci] = s.random(5);
  if (s.random(100) < 2) hit.afaze = 5;
  else if (hv[horniPoloha]! > 0) hit.afaze = hv[horniPoloha]!;
  else hit.afaze = hv[horniOci]!;

  // lower
  if (hit.x !== dit.x && dv[dolniZije] === -99) dv[dolniZije] = -7;
  if (dv[dolniZije] === -99) {
    // nothing
  } else if (dv[dolniZije]! <= 0) {
    dv[dolniZije]!++;
    dit.afaze = 1;
  } else {
    if (s.count % 3 === 0 && s.random(100) < 40) dv[dolniOci] = s.random(4) + 2;
    const pom1 = hv[horniPoloha]!;
    if (s.random(100) < 2) dit.afaze = 1;
    else if (pom1 > 0) {
      if (pom1 === 3) dit.afaze = 3;
      else dit.afaze = 3 + pom1;
    } else dit.afaze = dv[dolniOci]!;
  }
}

function prog(s: Script): void {
  roomBlock(s);

  // klicka: a blinking indicator
  s.item(R.klicka).afaze = s.count % 2;

  // zataras: barrier — once shoved, marks the "can't swim past" comment as used
  if (s.item(R.zataras).dir !== Dir.no) s.vars(R.room)[R.room_nep] = 1;

  dogPair(s, R.horni1, R.horni1_oci, R.horni1_poloha, R.dolni1, R.dolni1_oci, R.dolni1_zije);

  // zkum: 16 bubbling test tubes driven by globpole timers
  for (let i = 0; i <= 15; i++) {
    if (s.globpole[i]! > 0) {
      s.globpole[i]!--;
      if (s.globpole[i] === 0) s.globpole[i] = -s.random(100) - 10;
      if ((s.count + i) % 2 === 1) {
        const it = s.item(R.zkum + i);
        if (s.random(2) > 0) it.afaze = (it.afaze + 1) % 3;
        else it.afaze = (it.afaze + 2) % 3;
      }
    } else {
      s.globpole[i]!++;
      if (s.globpole[i] === 0) s.globpole[i] = s.random(100) + 10;
      s.item(R.zkum + i).afaze = 0;
    }
  }

  dogPair(s, R.horni2, R.horni2_oci, R.horni2_poloha, R.dolni2, R.dolni2_oci, R.dolni2_zije);

  // kostra: a skeleton slowly decaying frame by frame
  {
    const it = s.item(R.kostra);
    const v = s.vars(R.kostra);
    if (it.afaze < 8) {
      if (v[R.kostra_citac] === 0) {
        it.afaze++;
        v[R.kostra_citac] = s.random(200) + 200;
      } else v[R.kostra_citac]!--;
    }
  }

  // oko: a big eye that blinks, glances and rolls
  {
    const it = s.item(R.oko);
    const v = s.vars(R.oko);
    switch (v[R.oko_cinnost]) {
      case 0:
        if (s.random(100) < 10) {
          switch (s.random(8)) {
            case 0:
            case 1:
            case 2:
              v[R.oko_citac] = s.random(5) + 5;
              v[R.oko_cinnost] = 1;
              v[R.oko_faze] = s.random(2) * 2;
              break;
            case 3:
              v[R.oko_citac] = s.random(3) + 2;
              v[R.oko_cinnost] = 2;
              v[R.oko_faze] = s.random(2) * 2;
              break;
            case 4:
            case 5:
            case 6:
              v[R.oko_citac] = s.random(12) + 12;
              v[R.oko_cinnost] = 3 + s.random(2);
              break;
            case 7:
              v[R.oko_citac] = s.random(10) + 2;
              v[R.oko_cinnost] = 5;
              break;
          }
        }
        break;
      case 1:
      case 2:
        switch (v[R.oko_faze]) {
          case 0:
            it.afaze = v[R.oko_cinnost] === 1 ? 1 : 3;
            if (s.random(100) < 20) v[R.oko_faze]!++;
            break;
          case 1:
            it.afaze = 0;
            v[R.oko_faze]!++;
            break;
          case 2:
            it.afaze = v[R.oko_cinnost] === 1 ? 2 : 4;
            if (s.random(100) < 20) v[R.oko_faze]!++;
            break;
          case 3:
            it.afaze = 0;
            v[R.oko_citac]!--;
            if (v[R.oko_citac] === 0) v[R.oko_cinnost] = 0;
            else v[R.oko_faze] = 0;
            break;
        }
        break;
      case 3:
      case 4:
      case 5:
        switch (v[R.oko_cinnost]) {
          case 3:
            switch (it.afaze) {
              case 0: it.afaze = s.random(4) + 1; break;
              case 1: it.afaze = 3; break;
              case 2: it.afaze = 4; break;
              case 3: it.afaze = 2; break;
              case 4: it.afaze = 1; break;
            }
            break;
          case 4:
            switch (it.afaze) {
              case 0: it.afaze = s.random(4) + 1; break;
              case 1: it.afaze = 4; break;
              case 2: it.afaze = 3; break;
              case 3: it.afaze = 1; break;
              case 4: it.afaze = 2; break;
            }
            break;
          case 5:
            if (s.random(100) < 40) it.afaze = s.random(5);
            break;
        }
        v[R.oko_citac]!--;
        if (v[R.oko_citac] === 0) {
          v[R.oko_cinnost] = 0;
          it.afaze = 0;
        }
        break;
    }
  }

  // qldik1/qldik2: little blobs that wake when shoved
  for (const [idx, zijeI, ociI] of [
    [R.qldik1, R.qldik1_zije, R.qldik1_oci],
    [R.qldik2, R.qldik2_zije, R.qldik2_oci],
  ] as const) {
    const it = s.item(idx);
    const v = s.vars(idx);
    if (it.dir !== Dir.no) v[zijeI] = 1;
    if (s.count % 3 === 0) {
      if (v[zijeI]! > 0) {
        if (s.random(100) < 20) v[ociI] = s.random(5);
        if (s.random(100) < 4) it.afaze = 5;
        else it.afaze = v[ociI]!;
      }
    }
  }

  // qldik3: a hopping blob
  {
    const it = s.item(R.qldik3);
    const v = s.vars(R.qldik3);
    if (s.count % 2 === 0) {
      if (v[R.qldik3_skace] === 0) {
        if (s.random(100) < 1) v[R.qldik3_skace] = s.random(7) * 2 + 3;
        if (s.random(100) < 4) it.afaze = 5;
        else {
          if (s.random(100) < 30) v[R.qldik3_oci] = s.random(5);
          it.afaze = v[R.qldik3_oci]!;
        }
      } else {
        if (v[R.qldik3_skace]! % 2 === 1) it.afaze = 6;
        else it.afaze = 7;
        v[R.qldik3_skace]!--;
      }
    }
  }

  lahvacProg(s);

  // oka: a stalk-eye that tracks the active fish
  {
    const it = s.item(R.oka);
    const v = s.vars(R.oka);
    if (it.dir !== Dir.no) {
      if (v[R.oka_impuls] === 0) v[R.oka_faze] = 0;
      v[R.oka_impuls] = 4;
    }
    if (v[R.oka_impuls]! > 0) {
      if (v[R.oka_faze]! < v[R.oka_impuls]!) it.afaze = 7 + v[R.oka_faze]!;
      else it.afaze = 15 - 2 * v[R.oka_impuls]! + v[R.oka_faze]!;
      v[R.oka_faze]!++;
      if (v[R.oka_faze] === 2 * v[R.oka_impuls]!) {
        v[R.oka_faze] = 0;
        v[R.oka_impuls]!--;
      }
    } else if (v[R.oka_kuk]! > 0) {
      it.afaze = 1;
      v[R.oka_kuk]!--;
      v[R.oka_smer] = 4;
    } else {
      const fish = s.aktivni() === 'little' ? R.malar : R.velkar;
      const pom1 = s.xdist(fish, R.oka);
      const pom2 = s.ydist(fish, R.oka);
      if (pom1 < 0) {
        if (Math.abs(pom1) >= 2 * Math.abs(pom2)) v[R.oka_novysmer] = 6;
        else if (Math.abs(pom2) >= 2 * Math.abs(pom1)) v[R.oka_novysmer] = 4;
        else v[R.oka_novysmer] = 5;
      } else {
        if (Math.abs(pom1) >= 2 * Math.abs(pom2)) v[R.oka_novysmer] = 2;
        else if (Math.abs(pom2) >= 2 * Math.abs(pom1)) v[R.oka_novysmer] = 4;
        else v[R.oka_novysmer] = 3;
      }
      if (v[R.oka_smer] === -1) v[R.oka_smer] = v[R.oka_novysmer]!;
      else if (v[R.oka_smer]! < v[R.oka_novysmer]!) v[R.oka_smer]!++;
      else if (v[R.oka_smer]! > v[R.oka_novysmer]!) v[R.oka_smer]!--;
      it.afaze = v[R.oka_smer]!;
      if (s.random(200) < 1) v[R.oka_kuk] = s.random(4) + 4;
    }
  }

  // malej: a small critter that swings when shoved
  {
    const it = s.item(R.malej);
    const v = s.vars(R.malej);
    if (s.count % 3 === 0) {
      if (s.random(100) < 10) v[R.malej_oci] = s.random(5);
    }
    if (it.dir !== Dir.no && v[R.malej_houpe] === 0) {
      v[R.malej_faze] = 0;
      v[R.malej_houpe] = 1;
    }
    switch (v[R.malej_houpe]) {
      case 0:
        if (s.random(100) < 2) it.afaze = 4;
        else it.afaze = v[R.malej_oci]!;
        break;
      case 1:
        v[R.malej_faze]!++;
        switch (v[R.malej_faze]) {
          case 1: it.afaze = 5; break;
          case 4: it.afaze = 6; break;
          case 6:
            if (it.dir === Dir.no) {
              v[R.malej_houpe] = 0;
              v[R.malej_oci] = 0;
            } else v[R.malej_faze] = 0;
            break;
        }
        break;
    }
  }

  rukaProg(s);

  // pldicek: the self-reproducing blob colony
  pldici?.step();

  // mutant: a mutant that stirs when the doors are still
  {
    const it = s.item(R.mutant);
    if (s.count % 2 === 1) {
      if (s.item(R.dvere1).dir === Dir.no && s.item(R.dvere2).dir === Dir.no) {
        if (it.afaze >= 0 && it.afaze <= 4) {
          switch (s.random(20)) {
            case 0: it.afaze = 5; break;
            case 1:
            case 2:
            case 3: it.afaze = s.random(5); break;
          }
        } else if (it.afaze === 5 || it.afaze === 9) {
          if (s.random(4) === 2) it.afaze = 5 + s.random(5);
        } else {
          switch (s.random(20)) {
            case 0:
            case 1: it.afaze = s.random(5); break;
            case 2:
            case 3:
            case 4:
            case 5:
            case 6:
            case 7: it.afaze = 6 + s.random(3); break;
          }
        }
      } else it.afaze = 9;
    }
  }
}

/** lahvac: the shape-shifting bottle creature (URoom.pas:15033-15165). */
function lahvacProg(s: Script): void {
  const it = s.item(R.lahvac);
  const v = s.vars(R.lahvac);
  const rozbit = v[R.lahvac_rozbit]!;
  const vmod2 = (): number => v[R.lahvac_vnitrek]! % 2;

  if (rozbit === 0) {
    if (s.count % 4 === 0) {
      switch (s.random(4)) {
        case 0: v[R.lahvac_vnitrek] = (v[R.lahvac_vnitrek]! + 1) % 4; break;
        case 1: v[R.lahvac_vnitrek] = (v[R.lahvac_vnitrek]! + 3) % 4; break;
      }
    }
    switch (v[R.lahvac_stav]) {
      case 0:
        if (s.random(100) < 5) {
          v[R.lahvac_stav] = 10 + s.random(2) * 10;
          v[R.lahvac_smer] = 1 - v[R.lahvac_smer]!;
          it.afaze = 0;
        } else if (s.random(100) < 7) {
          v[R.lahvac_stav] = 1 + s.random(2);
          it.afaze = 7 + v[R.lahvac_stav]! * 4 + vmod2();
        } else it.afaze = v[R.lahvac_vnitrek]!;
        break;
      case 1:
      case 2:
        if (s.random(100) < 7) {
          it.afaze = 7 + v[R.lahvac_stav]! * 4 + vmod2();
          v[R.lahvac_stav] = 0;
        } else if (s.random(100) < 7 && v[R.lahvac_stav] === 2) {
          v[R.lahvac_stav] = 3;
          it.afaze = 19;
        } else {
          it.afaze = 9 + 4 * v[R.lahvac_stav]! + vmod2();
          if (s.random(100) < 5) it.afaze -= 2;
        }
        break;
      case 3:
        if (s.random(100) < 7) {
          v[R.lahvac_stav] = 2;
          it.afaze = 15 + vmod2();
        } else if (s.random(100) < 7) {
          v[R.lahvac_stav] = 4;
          it.afaze = 22 + vmod2();
        } else {
          if (vmod2() === 1 && s.random(100) < 10) it.afaze = 19;
          else it.afaze = 20 + vmod2();
        }
        break;
      case 4:
        if (s.random(100) < 7) {
          v[R.lahvac_stav] = 3;
          it.afaze = 20 + vmod2();
        }
        break;
      default:
        if (v[R.lahvac_stav]! >= 10 && v[R.lahvac_stav]! <= 15) {
          if (v[R.lahvac_smer] === 0) it.afaze = v[R.lahvac_stav]! - 5;
          else it.afaze = 25 - v[R.lahvac_stav]! - 5;
          if (v[R.lahvac_stav] === 15) v[R.lahvac_stav] = 0;
          else v[R.lahvac_stav]!++;
        } else if (v[R.lahvac_stav]! >= 20 && v[R.lahvac_stav]! <= 25) {
          if (s.count % 3 === 0) {
            if (v[R.lahvac_smer] === 0) it.afaze = v[R.lahvac_stav]! - 15;
            else it.afaze = 45 - v[R.lahvac_stav]! - 15;
            if (v[R.lahvac_stav] === 25) v[R.lahvac_stav] = 0;
            else v[R.lahvac_stav]!++;
          }
        }
        break;
    }
    if (it.dir === Dir.down) v[R.lahvac_pada] = 1;
    else if (v[R.lahvac_pada] === 1) v[R.lahvac_rozbit] = 1;
  } else if (rozbit >= 1 && rozbit <= 4) {
    it.afaze = 23 + rozbit;
    v[R.lahvac_rozbit]!++;
  } else if (rozbit === 5) {
    v[R.lahvac_stav] = s.random(30) + 30;
    v[R.lahvac_rozbit]!++;
  } else if (rozbit === 6) {
    if (v[R.lahvac_stav] === 0 || it.dir === Dir.left || it.dir === Dir.right) {
      v[R.lahvac_rozbit]!++;
      v[R.lahvac_stav] = 0;
    } else v[R.lahvac_stav]!--;
  } else if (rozbit === 7) {
    if (it.dir !== Dir.no) {
      v[R.lahvac_stav] = s.random(10) + 10;
      v[R.lahvac_rozbit] = 10;
      it.afaze = 31 + s.random(3);
    } else {
      switch (v[R.lahvac_stav]) {
        case 0:
          if (s.random(100) < 7) {
            v[R.lahvac_stav] = 1 + s.random(2);
            if (v[R.lahvac_stav] === 1) it.afaze = 28;
            else it.afaze = 30;
          } else it.afaze = 27;
          break;
        case 1:
          if (s.random(100) < 7) {
            v[R.lahvac_stav] = 0;
            it.afaze = 28;
          } else if (s.random(100) < 5) it.afaze = 28;
          else it.afaze = 29;
          break;
        case 2:
          if (s.random(100) < 7) v[R.lahvac_stav] = 0;
          break;
      }
    }
  } else if (rozbit === 10) {
    if (v[R.lahvac_stav] === 0) {
      v[R.lahvac_stav] = s.random(10) + 10;
      v[R.lahvac_rozbit] = 6;
      it.afaze = 27;
    } else {
      if (s.count % 2 === 1) {
        if (s.random(2) === 0) it.afaze = ((it.afaze - 30) % 3) + 31;
        else it.afaze = ((it.afaze - 29) % 3) + 31;
      }
      v[R.lahvac_stav]!--;
    }
  }
}

/** ruka: a hand that grabs a fish hovering directly below it (URoom.pas:15261-15322). */
function rukaProg(s: Script): void {
  if (s.count % 2 !== 1) return; // if odd(count)
  const it = s.item(R.ruka);
  const v = s.vars(R.ruka);

  let pomb1 =
    s.xdist(R.ruka, R.malar) === 0 && s.ydist(R.ruka, R.malar) > 0 && s.ydist(R.ruka, R.malar) < 10;
  let pomb2 =
    s.xdist(R.ruka, R.velkar) === 0 &&
    s.ydist(R.ruka, R.velkar) > 0 &&
    s.ydist(R.ruka, R.velkar) < 10;

  if (pomb1 && pomb2) if (s.item(R.malar).y > s.item(R.velkar).y) pomb2 = false;

  if (pomb1 || pomb2) {
    if (v[R.ruka_cinnost] !== 2) v[R.ruka_faze] = 0;
    v[R.ruka_cinnost] = 2;
    if (pomb1) v[R.ruka_smer] = !s.facingRight('little') ? 0 : 1;
    else v[R.ruka_smer] = !s.facingRight('big') ? 0 : 1;
  } else if (v[R.ruka_cinnost] === 2) {
    v[R.ruka_cinnost] = 0;
    v[R.ruka_faze] = 0;
  }

  switch (v[R.ruka_cinnost]) {
    case 0:
      if (s.random(100) < 2) {
        v[R.ruka_cinnost] = 1;
        it.afaze = 0;
        v[R.ruka_faze] = (s.random(3) + 2) * 2;
      } else {
        if (s.random(100) < 3) v[R.ruka_smer] = 1 - v[R.ruka_smer]!;
        if (v[R.ruka_smer] === 0) v[R.ruka_faze] = (v[R.ruka_faze]! + 1) % 7;
        else v[R.ruka_faze] = (v[R.ruka_faze]! + 6) % 7;
        it.afaze = v[R.ruka_faze]!;
      }
      break;
    case 1:
      v[R.ruka_faze]!--;
      if (v[R.ruka_faze]! % 2 === 1) it.afaze = 7;
      else it.afaze = 0;
      if (v[R.ruka_faze] === 0) v[R.ruka_cinnost] = 0;
      break;
    case 2:
      v[R.ruka_faze] = 1 - v[R.ruka_faze]!;
      it.afaze = 8 + v[R.ruka_faze]! + v[R.ruka_smer]! * 2;
      break;
  }
}

export const BANKA: RoomScript = { name: 'BANKA', init, prog };
