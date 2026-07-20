/**
 * BARELY ("Outraged Greenpeace", room 44) — a faithful port of BARELY_InitProgramky
 * / BARELY_Programky (URoom.pas:8478-8605, 21882-22464). The largest room: a gspec=9
 * "push it out" puzzle (shove the barrel `barel`=1 off the edge, Spec9(barel,9,13))
 * set in a polluted dump teeming with ~15 idle creatures, each its own afaze state
 * machine: a quacking duck (kachnicka), a snake (had), a wandering eye (ocicko), a
 * finned fish (kukajda), a grinning shark-"killer" (a decorative anim, NOT a hazard),
 * a deep-sea fish (hlubinna, snores "zzz"), a crab (krabik), a baguette (baget), a
 * stomping leg (nozka), two sucking blobs (pldik / pldotec), a shark, and a pair of
 * heads that catch each other's eye (levahlava / pravahlava). Four staggered `hl1..4`
 * timers drip environmental one-liners (chosen without repeats via an `ozviratkach`
 * bitmask). Uses existing primitives (incl. the by-ref `prom` in addd).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_celakrajni: 2,
  room_ozviratkach: 3,
  room_hl1: 4,
  room_hl2: 5,
  room_hl3: 6,
  room_hl4: 7,
  room_onoze: 8,
  room_opldech: 9,
  room_okukajde: 10,
  room_okrabovi: 11,
  room_okachne: 12,
  barel: 1,
  kachnicka: 4,
  kachnicka_cinnost: 1,
  had: 5,
  had_streva: 1,
  had_huba: 2,
  ocicko: 6,
  ocicko_cinnost: 1,
  ocicko_faze: 2,
  ocicko_citac: 3,
  kukajda: 7,
  kukajda_ploutvicka: 1,
  kukajda_oci: 2,
  kukajda_mrknuti: 3,
  killer: 8,
  killer_ocas: 1,
  killer_usmev: 2,
  hlubinna: 9,
  hlubinna_ploutvicka: 1,
  hlubinna_zzzeni: 2,
  krabik: 10,
  krabik_oci: 1,
  baget: 12,
  nozka: 13,
  nozka_cinnost: 1,
  nozka_oci: 2,
  nozka_dup: 3,
  pldik: 14,
  pldik_cinnost: 1,
  pldik_oci: 2,
  pldik_suckani: 3,
  pldik_suckfaze: 4,
  shark: 15,
  shark_oci: 1,
  shark_pusa: 2,
  pldotec: 16,
  pldotec_del: 1,
  pldotec_vlnit: 2,
  pldotec_ocko: 3,
  pldotec_faze: 4,
  pldotec_smer: 5,
  pldotec_smutny: 6,
  levahlava: 18,
  levahlava_cinnost: 1,
  levahlava_kouka: 2,
  levahlava_makoukat: 3,
  pravahlava: 19,
  pravahlava_cinnost: 1,
  pravahlava_kouka: 2,
  pravahlava_makoukat: 3,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 12);
  s.room.gspec = 9;
  v[R.room_uvod] = 0;
  v[R.room_celakrajni] = 0;
  v[R.room_ozviratkach] = 0;
  v[R.room_hl1] = s.random(400) + 400;
  v[R.room_hl2] = v[R.room_hl1]! + s.random(800) + 800;
  v[R.room_hl3] = v[R.room_hl2]! + s.random(1600) + 1600;
  v[R.room_hl4] = v[R.room_hl3]! + s.random(3200) + 3200;
  v[R.room_onoze] = 0;
  v[R.room_opldech] = 0;
  v[R.room_okukajde] = 0;
  v[R.room_okrabovi] = 0;
  v[R.room_okachne] = 0;

  s.setanim(R.barel, 'a0d8a1a2a3a4d3a3a2a1R');

  s.vars(R.kachnicka, 1)[R.kachnicka_cinnost] = s.random(100) + 10;

  const ha = s.vars(R.had, 2);
  ha[R.had_streva] = s.random(4);
  ha[R.had_huba] = s.random(3);

  s.vars(R.ocicko, 3)[R.ocicko_cinnost] = 0;

  const ku = s.vars(R.kukajda, 3);
  ku[R.kukajda_ploutvicka] = 0;
  ku[R.kukajda_oci] = 0;
  ku[R.kukajda_mrknuti] = 0;

  const ki = s.vars(R.killer, 2);
  ki[R.killer_ocas] = 0;
  ki[R.killer_usmev] = 0;

  const hl = s.vars(R.hlubinna, 2);
  hl[R.hlubinna_ploutvicka] = 0;
  hl[R.hlubinna_zzzeni] = 0;

  s.vars(R.krabik, 1)[R.krabik_oci] = 0;

  const no = s.vars(R.nozka, 3);
  no[R.nozka_cinnost] = s.random(100) + 20;
  no[R.nozka_dup] = 0;
  no[R.nozka_oci] = 0;

  const pl = s.vars(R.pldik, 4);
  pl[R.pldik_cinnost] = 0;
  pl[R.pldik_oci] = 0;
  pl[R.pldik_suckani] = 0;

  const sh = s.vars(R.shark, 2);
  sh[R.shark_oci] = s.random(2);
  sh[R.shark_pusa] = s.random(2);

  const pt = s.vars(R.pldotec, 6);
  pt[R.pldotec_vlnit] = 0;
  pt[R.pldotec_del] = 0;
  pt[R.pldotec_ocko] = 0;
  pt[R.pldotec_smer] = 0;
  pt[R.pldotec_faze] = 0;
  pt[R.pldotec_smutny] = 0;

  const lh = s.vars(R.levahlava, 3);
  lh[R.levahlava_kouka] = s.random(3);
  lh[R.levahlava_makoukat] = lh[R.levahlava_kouka]!;
  lh[R.levahlava_cinnost] = 0;

  const rh = s.vars(R.pravahlava, 3);
  rh[R.pravahlava_kouka] = s.random(3);
  rh[R.pravahlava_makoukat] = rh[R.pravahlava_kouka]!;
  rh[R.pravahlava_cinnost] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room: edge hint + intro + four staggered environmental one-liners ----
  if (s.stdKrajniHlaska()) {
    s.addm(6, 'bar-m-barel');
    if (s.random(100) < 30 || v[R.room_celakrajni] === 0) s.addv(s.random(10) + 5, 'bar-v-genofond');
    v[R.room_celakrajni] = 1;
    s.stdKonecKrajniHlasky();
  }

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_hl1]! > 0) v[R.room_hl1]!--;
    if (v[R.room_hl2]! > 0) v[R.room_hl2]!--;
    if (v[R.room_hl3]! > 0) v[R.room_hl3]!--;
    if (v[R.room_hl4]! > 0) v[R.room_hl4]!--;

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      let pom1: number;
      switch (s.pokus) {
        case 1:
          pom1 = 5;
          break;
        case 2:
          pom1 = s.nah(2, 4);
          break;
        default:
          pom1 = s.random(6);
          break;
      }
      s.adddel(10 + s.random(20));
      if (pom1 >= 4) {
        switch (s.random(2)) {
          case 0:
            s.addv(0, 'bar-v-videt0');
            break;
          case 1:
            s.addm(0, 'bar-m-videt1');
            break;
        }
      }
      if (pom1 >= 5) s.addv(5, 'bar-v-co');
      if (pom1 >= 2) {
        s.addm(10, 'bar-m-pobit');
        s.addd(2, 'bar-x-suckne', 201, (val) => (s.vars(R.pldik)[R.pldik_cinnost] = val));
        s.addv(10, 'bar-v-priciny');
        s.addd(2, 'bar-x-suckano', 202, (val) => (s.vars(R.pldik)[R.pldik_cinnost] = val));
      }
      if (pom1 >= 4) s.addm(s.random(30) + 10, 'bar-m-no');
      if (pom1 >= 2) s.addv(5, 'bar-v-sud');
      if (pom1 >= 3) s.addm(5, 'bar-m-panb');
    } else if (v[R.room_hl1] === 0 || v[R.room_hl2] === 0 || v[R.room_hl3] === 0 || v[R.room_hl4] === 0) {
      if (v[R.room_hl1] === 0) v[R.room_hl1] = -1;
      if (v[R.room_hl2] === 0) v[R.room_hl2] = -1;
      if (v[R.room_hl3] === 0) v[R.room_hl3] = -1;
      if (v[R.room_hl4] === 0) v[R.room_hl4] = -1;
      let pom1: number;
      if (v[R.room_ozviratkach] === 0) {
        pom1 = s.random(2);
      } else if (v[R.room_ozviratkach] === 15) {
        v[R.room_ozviratkach] = 0;
        pom1 = s.random(4);
      } else {
        do {
          pom1 = s.random(4);
        } while ((v[R.room_ozviratkach]! & (1 << pom1)) !== 0);
      }
      v[R.room_ozviratkach] = v[R.room_ozviratkach]! | (1 << pom1);
      s.adddel(50 + s.random(100));
      switch (pom1) {
        case 0:
          s.addm(0, 'bar-m-rada');
          s.addv(7, 'bar-v-kdyby' + digit(s.random(2)));
          break;
        case 1:
          s.addm(0, 'bar-m-mutanti');
          if (s.random(100) < 50) s.addv(10, 'bar-v-ufouni');
          s.addm(s.random(50) + 10, 'bar-m-zmeni');
          break;
        case 2:
          s.addv(0, 'bar-v-lih');
          s.addm(8, 'bar-m-fdto');
          s.addd(3, 'bar-x-vypr', 5);
          s.addm(10, 'bar-m-promin');
          break;
        case 3:
          s.addv(0, 'bar-v-sbirka');
          s.addm(10, 'bar-m-dost' + digit(s.random(2)));
          break;
      }
    } else if (
      v[R.room_onoze] === 0 &&
      s.vars(R.nozka)[R.nozka_cinnost]! < 20 &&
      s.dist(s.littleIdx, R.nozka) < 5 &&
      s.random(1000) < 2
    ) {
      v[R.room_onoze] = 1;
      s.addm(3, 'bar-m-noha');
    } else if (v[R.room_opldech] === 0 && s.dist(s.bigIdx, R.pldotec) <= 5 && s.random(100) < 1) {
      v[R.room_opldech] = 1;
      s.addv(10, 'bar-v-pld');
      s.addm(6, 'bar-m-pudy');
      s.addv(2, 'bar-v-traverza');
      s.addd(2, 'bar-x-suckne', 201, (val) => (s.vars(R.pldik)[R.pldik_cinnost] = val));
    } else if (
      v[R.room_okukajde] === 0 &&
      s.item(R.kukajda).dir !== Dir.no &&
      s.random(100) < 2 &&
      s.aktivni() === 'little'
    ) {
      v[R.room_okukajde] = 1;
      s.addm(10, 'bar-m-rybka');
      if (s.random(100) < 70) s.addv(s.random(30) + 5, 'bar-v-fotka');
    } else if (
      v[R.room_okrabovi] === 0 &&
      s.lookAt(s.bigIdx, R.krabik) &&
      s.dist(s.bigIdx, R.krabik) <= 3 &&
      s.random(100) < 1
    ) {
      v[R.room_okrabovi] = 1;
      s.addv(10, 'bar-v-krab');
    } else if (
      v[R.room_okachne] === 0 &&
      s.item(R.kachnicka).dir !== Dir.no &&
      s.aktivni() === 'little' &&
      s.random(100) < 10
    ) {
      v[R.room_okachne] = 1;
      s.addm(5, 'bar-m-kachna');
    }
  }

  // ---- barel (the barrel): gspec=9 push-out target + its wobble anim ----
  s.spec9(R.barel, 9, 13);
  s.goanim(R.barel);

  // ---- kachnicka (duck): quacks (bar-x-kchkch, prior 701) on a cinnost cycle ----
  {
    const kv = s.vars(R.kachnicka);
    const it = s.item(R.kachnicka);
    if (kv[R.kachnicka_cinnost]! > 0) {
      if (s.playing(701)) s.ksnd(701);
      if (s.count % 2 === 1 && s.random(100) < 10) it.afaze = s.random(5);
      kv[R.kachnicka_cinnost]!--;
      if (kv[R.kachnicka_cinnost] === 0) {
        it.afaze = 5;
        kv[R.kachnicka_cinnost] = -30 - s.random(60);
      }
    } else {
      if (!s.playing(701)) s.sndcyc('bar-x-kchkch', 701);
      it.afaze = ((it.afaze - 5 + 1) % 4) + 5;
      kv[R.kachnicka_cinnost]!++;
      if (kv[R.kachnicka_cinnost] === 0) {
        it.afaze = 0;
        kv[R.kachnicka_cinnost] = 30 + s.random(100);
      }
    }
  }

  // ---- had (snake): mouth (huba) + gut wave (streva) → afaze ----
  {
    const ha = s.vars(R.had);
    const it = s.item(R.had);
    if (s.count % 3 === 0) {
      switch (ha[R.had_huba]) {
        case 0:
          if (s.random(1000) < 15) ha[R.had_huba] = s.random(2) + 1;
          break;
        case 1:
        case 2:
          if (s.random(1000) < 15) ha[R.had_huba] = 0;
          else if (s.random(100) < 50) ha[R.had_huba] = 3 - ha[R.had_huba]!;
          break;
      }
    }
    ha[R.had_streva] = (ha[R.had_streva]! + 1) % 4;
    it.afaze = 4 * ha[R.had_huba]! + ha[R.had_streva]!;
  }

  // ---- ocicko (wandering eye): open/roll/blink FSM ----
  {
    const oc = s.vars(R.ocicko);
    const it = s.item(R.ocicko);
    switch (oc[R.ocicko_cinnost]) {
      case 0:
        if (s.random(100) < 10) {
          switch (s.random(8)) {
            case 0:
            case 1:
            case 2:
              oc[R.ocicko_citac] = s.random(5) + 5;
              oc[R.ocicko_cinnost] = 1;
              oc[R.ocicko_faze] = s.random(2) * 2;
              break;
            case 3:
              oc[R.ocicko_citac] = s.random(3) + 2;
              oc[R.ocicko_cinnost] = 2;
              oc[R.ocicko_faze] = s.random(2) * 2;
              break;
            case 4:
            case 5:
            case 6:
              oc[R.ocicko_citac] = s.random(12) + 12;
              oc[R.ocicko_cinnost] = 3 + s.random(2);
              break;
            case 7:
              oc[R.ocicko_citac] = s.random(10) + 2;
              oc[R.ocicko_cinnost] = 5;
              break;
          }
        }
        break;
      case 1:
      case 2:
        switch (oc[R.ocicko_faze]) {
          case 0:
            if (oc[R.ocicko_cinnost] === 1) it.afaze = 1;
            else it.afaze = 3;
            if (s.random(100) < 20) oc[R.ocicko_faze]!++;
            break;
          case 1:
            it.afaze = 0;
            oc[R.ocicko_faze]!++;
            break;
          case 2:
            if (oc[R.ocicko_cinnost] === 1) it.afaze = 2;
            else it.afaze = 4;
            if (s.random(100) < 20) oc[R.ocicko_faze]!++;
            break;
          case 3:
            it.afaze = 0;
            oc[R.ocicko_citac]!--;
            if (oc[R.ocicko_citac] === 0) oc[R.ocicko_cinnost] = 0;
            else oc[R.ocicko_faze] = 0;
            break;
        }
        break;
      case 3:
      case 4:
      case 5:
        switch (oc[R.ocicko_cinnost]) {
          case 3:
            switch (it.afaze) {
              case 0:
                it.afaze = s.random(4) + 1;
                break;
              case 1:
                it.afaze = 3;
                break;
              case 2:
                it.afaze = 4;
                break;
              case 3:
                it.afaze = 2;
                break;
              case 4:
                it.afaze = 1;
                break;
            }
            break;
          case 4:
            switch (it.afaze) {
              case 0:
                it.afaze = s.random(4) + 1;
                break;
              case 1:
                it.afaze = 4;
                break;
              case 2:
                it.afaze = 3;
                break;
              case 3:
                it.afaze = 1;
                break;
              case 4:
                it.afaze = 2;
                break;
            }
            break;
          case 5:
            if (s.random(100) < 40) it.afaze = s.random(5);
            break;
        }
        oc[R.ocicko_citac]!--;
        if (oc[R.ocicko_citac] === 0) {
          oc[R.ocicko_cinnost] = 0;
          it.afaze = 0;
        }
        break;
    }
  }

  // ---- kukajda (finned fish): fin cycle + eyes + blink ----
  {
    const ku = s.vars(R.kukajda);
    const it = s.item(R.kukajda);
    ku[R.kukajda_ploutvicka] = (ku[R.kukajda_ploutvicka]! + 1) % 6;
    switch (ku[R.kukajda_ploutvicka]) {
      case 0:
      case 1:
        it.afaze = 0;
        break;
      case 2:
      case 5:
        it.afaze = 1;
        break;
      case 3:
      case 4:
        it.afaze = 2;
        break;
    }
    if (s.random(100) < 3) ku[R.kukajda_oci] = s.random(5);
    if (ku[R.kukajda_mrknuti]! > 0) {
      ku[R.kukajda_mrknuti]!--;
      it.afaze = it.afaze + 15;
    } else {
      it.afaze = it.afaze + ku[R.kukajda_oci]! * 3;
      if (s.random(100) < 4) ku[R.kukajda_mrknuti] = s.random(3) + 2;
    }
  }

  // ---- killer (grinning shark — decorative anim, not a hazard) ----
  {
    const ki = s.vars(R.killer);
    const it = s.item(R.killer);
    if (s.count % 2 === 1) ki[R.killer_ocas] = 1 - ki[R.killer_ocas]!;
    if (ki[R.killer_usmev]! > 0) {
      ki[R.killer_usmev]!--;
      it.afaze = ki[R.killer_ocas]!;
    } else {
      if (s.random(100) < 2) {
        ki[R.killer_usmev] = s.random(30) + 10;
        s.snd('bar-x-gr' + digit(s.random(3)), 801);
      }
      it.afaze = 2 * ki[R.killer_ocas]! + 2;
      if (s.random(100) < 7) it.afaze++;
    }
  }

  // ---- hlubinna (deep-sea fish): fin cycle + occasional snore (zzz, prior 901) ----
  {
    const hl = s.vars(R.hlubinna);
    const it = s.item(R.hlubinna);
    hl[R.hlubinna_ploutvicka] = (hl[R.hlubinna_ploutvicka]! + 1) % 5;
    switch (hl[R.hlubinna_ploutvicka]) {
      case 0:
      case 1:
      case 2:
        it.afaze = hl[R.hlubinna_ploutvicka]!;
        break;
      case 3:
        it.afaze = 1;
        break;
      case 4:
        it.afaze = 0;
        break;
    }
    if (hl[R.hlubinna_zzzeni]! > 0) {
      it.afaze += 6;
      hl[R.hlubinna_zzzeni]!--;
    } else if (s.random(100) < 5) {
      it.afaze += 3;
    } else if (s.random(1000) < 15) {
      it.afaze += 6;
      hl[R.hlubinna_zzzeni] = 5;
      s.snd('bar-x-zzz', 901);
    }
  }

  // ---- krabik (crab): eyes ----
  {
    const kr = s.vars(R.krabik);
    const it = s.item(R.krabik);
    if (s.count % 2 === 1 && s.random(100) < 10) kr[R.krabik_oci] = s.random(5);
    if (s.random(100) < 10) it.afaze = 5;
    else it.afaze = kr[R.krabik_oci]!;
  }

  // ---- baget (baguette): rare twitch ----
  {
    const it = s.item(R.baget);
    if (s.random(100) < 6) it.afaze = 1;
    else it.afaze = 0;
  }

  // ---- nozka (stomping leg): stomps (bar-x-tup, prior 951) + eyes ----
  {
    const no = s.vars(R.nozka);
    const it = s.item(R.nozka);
    if (s.count % 2 === 1 && s.random(100) < 10) no[R.nozka_oci] = s.random(5);
    if (no[R.nozka_cinnost]! > 0) {
      no[R.nozka_cinnost]!--;
      no[R.nozka_dup] = 0;
      if (no[R.nozka_cinnost] === 0) no[R.nozka_cinnost] = -20 - s.random(60);
    } else {
      if (s.count % 3 === 0) {
        no[R.nozka_dup] = 1 - no[R.nozka_dup]!;
        if (no[R.nozka_dup] === 0) s.snd('bar-x-tup', 951);
      }
      if (no[R.nozka_cinnost]! < -1 || no[R.nozka_dup] === 0) no[R.nozka_cinnost]!++;
      if (no[R.nozka_cinnost] === 0) no[R.nozka_cinnost] = 10 + s.random(150);
    }
    if (s.random(100) < 4) it.afaze = 5;
    else it.afaze = no[R.nozka_oci]!;
    it.afaze = it.afaze + no[R.nozka_dup]! * 6;
  }

  // ---- pldik (sucking blob): cinnost 0/1/201/202 + suck sounds (prior 251) ----
  {
    const pl = s.vars(R.pldik);
    const it = s.item(R.pldik);
    switch (pl[R.pldik_cinnost]) {
      case 0:
        if (s.random(1000) < 5) pl[R.pldik_cinnost] = 1;
        if (s.random(100) < 5) {
          pl[R.pldik_oci] = s.random(5);
          if (pl[R.pldik_oci]! > 0) pl[R.pldik_oci]!++;
        }
        if (pl[R.pldik_suckani] === 0 && s.random(100) < 4) {
          pl[R.pldik_suckani] = s.random(5) + 1;
          pl[R.pldik_suckfaze] = 0;
        }
        break;
      case 1:
        if (s.random(1000) < 10) pl[R.pldik_cinnost] = 0;
        pl[R.pldik_oci] = 6;
        if (pl[R.pldik_suckani] === 0 && s.random(100) < 4) {
          pl[R.pldik_suckani] = s.random(4) + 1;
          pl[R.pldik_suckfaze] = 0;
        }
        break;
      case 201:
        if (!s.playing(201)) pl[R.pldik_cinnost] = 0;
        pl[R.pldik_oci] = 1;
        if (pl[R.pldik_suckani] === 0) {
          pl[R.pldik_suckani] = 1000;
          pl[R.pldik_suckfaze] = 0;
        }
        break;
      case 202:
        if (!s.playing(202)) pl[R.pldik_cinnost] = 0;
        pl[R.pldik_oci] = 0;
        if (pl[R.pldik_suckani] === 0) {
          pl[R.pldik_suckani] = 1000;
          pl[R.pldik_suckfaze] = 0;
        }
        break;
    }

    it.afaze = pl[R.pldik_oci]! * 2;
    if (s.random(100) < 5) it.afaze = 12;

    if (pl[R.pldik_suckani]! > 0) {
      switch (pl[R.pldik_suckfaze]) {
        case 0:
          if (pl[R.pldik_cinnost]! < 200) s.snd('bar-x-suck' + digit(s.random(4)), 251);
          break;
        case 1:
        case 2:
        case 3:
          it.afaze++;
          break;
        case 5:
          pl[R.pldik_suckani]!--;
          break;
      }
      pl[R.pldik_suckfaze] = (pl[R.pldik_suckfaze]! + 1) % 6;
    }
  }

  // ---- shark: eyes + mouth ----
  {
    const sh = s.vars(R.shark);
    const it = s.item(R.shark);
    if (s.random(1000) < 5) sh[R.shark_oci] = 1 - sh[R.shark_oci]!;
    if (s.random(1000) < 5) sh[R.shark_pusa] = 1 - sh[R.shark_pusa]!;
    it.afaze = sh[R.shark_oci]! + sh[R.shark_pusa]! * 2;
    if (sh[R.shark_oci] === 0 && s.random(100) < 3) it.afaze++;
  }

  // ---- pldotec (blob): ripple / sulk / idle-blink FSM (same shape as PUCLIK pld) ----
  {
    const pt = s.vars(R.pldotec);
    const it = s.item(R.pldotec);
    switch (it.dir) {
      case Dir.no:
        if (pt[R.pldotec_vlnit] === -1) pt[R.pldotec_vlnit] = 8;
        break;
      case Dir.down:
        pt[R.pldotec_vlnit] = -1;
        break;
      default:
        pt[R.pldotec_vlnit] = 8;
        break;
    }

    if (pt[R.pldotec_vlnit]! > 0) pt[R.pldotec_smutny] = 0;

    if (pt[R.pldotec_vlnit]! > 0) {
      if (pt[R.pldotec_del] === 0) {
        switch (pt[R.pldotec_vlnit]) {
          case 8:
          case 7:
          case 6:
            pt[R.pldotec_del] = 1;
            break;
          case 5:
          case 4:
          case 3:
            pt[R.pldotec_del] = 2;
            break;
          default:
            pt[R.pldotec_del] = 3;
            break;
        }
        if (s.random(2) === 0) it.afaze = (it.afaze + 1) % 4;
        else it.afaze = (it.afaze + 3) % 4;
        pt[R.pldotec_vlnit]!--;
        if (pt[R.pldotec_vlnit] === 0) pt[R.pldotec_del] = 0;
        if (pt[R.pldotec_vlnit] === 0) it.afaze = 0;
        else if (pt[R.pldotec_vlnit] === 1) it.afaze = 3;
      } else {
        pt[R.pldotec_del]!--;
      }
    } else if (pt[R.pldotec_smutny]! > 0) {
      if (pt[R.pldotec_ocko] === 0) {
        if (s.random(100) < 10) pt[R.pldotec_ocko] = 3;
      }
      if (pt[R.pldotec_ocko]! > 0) pt[R.pldotec_ocko]!--;
      if (pt[R.pldotec_ocko]! > 0) it.afaze = 15;
      else it.afaze = 14;
      pt[R.pldotec_smutny]!--;
    } else {
      if (s.random(100) < 10) pt[R.pldotec_smer] = 1 - pt[R.pldotec_smer]!;
      switch (pt[R.pldotec_faze]) {
        case 0:
          it.afaze = 0;
          if (s.random(100) < 10) pt[R.pldotec_faze] = 1;
          break;
        case 1:
        case 4:
          pt[R.pldotec_faze]!++;
          it.afaze = 4;
          break;
        case 2:
        case 3:
          pt[R.pldotec_faze]!++;
          it.afaze = 5;
          break;
        case 5:
          it.afaze = 0;
          pt[R.pldotec_faze] = 0;
          break;
      }
      switch (it.afaze) {
        case 0:
          if (pt[R.pldotec_smer] === 1) it.afaze = 6;
          break;
        case 4:
          if (pt[R.pldotec_smer] === 1) it.afaze = 7;
          break;
      }
      if (pt[R.pldotec_ocko] === 0) {
        if (s.random(100) < 10) pt[R.pldotec_ocko] = 3;
      }
      if (pt[R.pldotec_ocko]! > 0) pt[R.pldotec_ocko]!--;
      if (pt[R.pldotec_ocko]! > 0) {
        if (it.afaze === 0) it.afaze = 9;
        else it.afaze = it.afaze + 6;
      }
    }
  }

  // ---- levahlava (left head): catches the right head's eye; both look away together ----
  {
    const lh = s.vars(R.levahlava);
    const rh = s.vars(R.pravahlava);
    const it = s.item(R.levahlava);
    if (
      lh[R.levahlava_kouka] === 0 &&
      rh[R.pravahlava_kouka] === 0 &&
      lh[R.levahlava_cinnost] === 0 &&
      lh[R.levahlava_cinnost] === 0 &&
      lh[R.levahlava_makoukat] === 0 &&
      rh[R.pravahlava_makoukat] === 0 &&
      s.random(100) < 5
    ) {
      lh[R.levahlava_cinnost] = 2;
      rh[R.pravahlava_cinnost] = 2;
    }

    if (lh[R.levahlava_kouka] !== lh[R.levahlava_makoukat]) {
      if (lh[R.levahlava_kouka] === 1 || lh[R.levahlava_makoukat] === 1) {
        lh[R.levahlava_kouka] = lh[R.levahlava_makoukat]!;
      } else {
        lh[R.levahlava_kouka] = 1;
      }
    }

    switch (lh[R.levahlava_cinnost]) {
      case 0:
        if (s.random(1000) < 5) lh[R.levahlava_cinnost] = 1;
        else if (s.random(100) < 5) lh[R.levahlava_makoukat] = s.random(3);
        it.afaze = lh[R.levahlava_kouka]! * 2;
        if (it.afaze > 0) it.afaze++;
        if (s.random(100) < 95) it.afaze++;
        break;
      case 1:
        it.afaze = lh[R.levahlava_kouka]! * 2;
        if (it.afaze > 0) it.afaze++;
        if (s.random(1000) < 5) lh[R.levahlava_cinnost] = 0;
        break;
      case 2:
        it.afaze = 2;
        if (s.random(100) < 3) {
          lh[R.levahlava_cinnost] = 0;
          rh[R.pravahlava_cinnost] = 0;
        }
        break;
    }
  }

  // ---- pravahlava (right head): follows makoukat; its stare is released by leva ----
  {
    const rh = s.vars(R.pravahlava);
    const it = s.item(R.pravahlava);
    if (rh[R.pravahlava_kouka] !== rh[R.pravahlava_makoukat]) {
      if (rh[R.pravahlava_kouka] === 1 || rh[R.pravahlava_makoukat] === 1) {
        rh[R.pravahlava_kouka] = rh[R.pravahlava_makoukat]!;
      } else {
        rh[R.pravahlava_kouka] = 1;
      }
    }

    switch (rh[R.pravahlava_cinnost]) {
      case 0:
        if (s.random(1000) < 5) rh[R.pravahlava_cinnost] = 1;
        else if (s.random(100) < 5) rh[R.pravahlava_makoukat] = s.random(3);
        it.afaze = rh[R.pravahlava_kouka]! * 2;
        if (it.afaze > 0) it.afaze++;
        if (s.random(100) < 95) it.afaze++;
        break;
      case 1:
        it.afaze = rh[R.pravahlava_kouka]! * 2;
        if (it.afaze > 0) it.afaze++;
        if (s.random(1000) < 5) rh[R.pravahlava_cinnost] = 0;
        break;
      case 2:
        it.afaze = 2;
        break;
    }
  }
}

export const BARELY: RoomScript = { name: 'BARELY', init, prog };
