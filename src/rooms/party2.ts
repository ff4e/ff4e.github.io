/**
 * PARTY2 ("Party Boat, Deck 2", room 18) — a faithful port of PARTY2_InitProgramky
 * / PARTY2_Programky (URoom.pas:7283-7378, 17435-17881).
 *
 * Two portholes (okno1/okno2) into a cabin. The room randomly assigns a party guest
 * — a peeker (kuk), a waving hand (ruka), a party-horn blower (frkavec) whose horn
 * puff is a separate sprite (frk), a taunting limb (hnat), or a bottle (lahev) — to
 * an empty window; the guest plays a built-up animation then retreats, freeing the
 * window. The fish comment on the picnic, tiredness, the guests, and the last
 * attempt. Item indices are the generated r_PARTY2_* values (URoom.pas:4300-4334).
 *
 * The animation strings are built with reused Pascal loop variables whose clobbering
 * semantics are preserved here (shared JS variables, limits captured once).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_okno1: 1,
  room_okno2: 2,
  room_okna: 3,
  room_uvod: 4,
  room_opikniku: 5,
  room_ounave: 6,
  room_oublizeni: 7,
  room_otezkosti: 8,
  ocel: 2,
  kuk: 17,
  kuk_zprava: 1,
  kuk_strana: 2,
  kuk_okno: 3,
  ruka: 18,
  ruka_zprava: 1,
  ruka_strana: 2,
  ruka_okno: 3,
  frkavec: 19,
  frkavec_frkacka: 1,
  frkavec_zprava: 2,
  frkavec_strana: 3,
  frkavec_okno: 4,
  hnat: 20,
  hnat_drazdit: 1,
  hnat_zprava: 2,
  hnat_strana: 3,
  hnat_okno: 4,
  lahev: 21,
  lahev_zprava: 1,
  lahev_strana: 2,
  lahev_okno: 3,
  frk: 22,
  frk_okno: 1,
  kabina: 23,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 8);
  v[R.room_okno1] = 0;
  v[R.room_okno2] = 0;
  v[R.room_okna] = 0;
  v[R.room_uvod] = 0;
  v[R.room_opikniku] = s.random(8) + 1;
  do {
    v[R.room_ounave] = s.random(16) + 5;
  } while (!(Math.abs(v[R.room_ounave]! - v[R.room_opikniku]!) > 3));
  do {
    v[R.room_oublizeni] = s.random(24) + 9;
  } while (
    !(
      Math.abs(v[R.room_oublizeni]! - v[R.room_opikniku]!) > 3 &&
      Math.abs(v[R.room_oublizeni]! - v[R.room_ounave]!) > 3
    )
  );
  v[R.room_otezkosti] = s.random(500);

  const kuk = s.vars(R.kuk, 3);
  s.item(R.kuk).spec = 11;
  kuk[R.kuk_zprava] = 0;
  kuk[R.kuk_strana] = 0;
  kuk[R.kuk_okno] = 0;

  const ruka = s.vars(R.ruka, 3);
  s.item(R.ruka).spec = 11;
  ruka[R.ruka_zprava] = 0;
  ruka[R.ruka_strana] = 0;
  ruka[R.ruka_okno] = 0;

  const fr = s.vars(R.frkavec, 4);
  s.item(R.frkavec).spec = 11;
  fr[R.frkavec_zprava] = 0;
  fr[R.frkavec_strana] = 0;
  fr[R.frkavec_okno] = 0;
  fr[R.frkavec_frkacka] = 0;

  const hn = s.vars(R.hnat, 4);
  hn[R.hnat_drazdit] = s.random(5) + 1;
  s.item(R.hnat).spec = 11;
  hn[R.hnat_zprava] = 0;
  hn[R.hnat_strana] = 0;
  hn[R.hnat_okno] = 0;

  const la = s.vars(R.lahev, 3);
  s.item(R.lahev).spec = 11;
  la[R.lahev_zprava] = 0;
  la[R.lahev_strana] = 0;
  la[R.lahev_okno] = 0;

  s.vars(R.frk, 1);
  s.item(R.frk).spec = 11;
}

/**
 * Common window-guest tail: when its animation ends, free the window (clear the
 * room okno flag), then reposition to the assigned porthole (kabina + offset) and
 * pick the facing sprite. Shared by kuk/ruka/frkavec/hnat/lahev — the per-figure
 * `spec:=11` on clear in the original is subsumed by the final okno=0 spec.
 */
function figureTail(
  s: Script,
  idx: number,
  zSlot: number,
  oSlot: number,
  stSlot: number,
): void {
  const it = s.item(idx);
  const v = s.vars(idx);
  const rv = s.vars(R.room);
  if (it.anim === '' || s.endanim(idx)) {
    if (v[zSlot] === 3) {
      if (v[oSlot] === 1) rv[R.room_okno1] = 0;
      else rv[R.room_okno2] = 0;
      v[zSlot] = 0;
      v[oSlot] = 0;
    }
  } else {
    s.goanim(idx);
  }
  const kab = s.item(R.kabina);
  if (v[oSlot] === 2) {
    it.x = kab.x + 9;
    it.y = kab.y + 1;
  } else {
    it.x = kab.x + 3;
    it.y = kab.y + 1;
  }
  it.spec = v[oSlot] === 0 ? 11 : v[stSlot]! * 10;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room: assign a guest to a free window; timed fish remarks ----
  if ((v[R.room_okno1] === 0 || v[R.room_okno2] === 0) && s.random(1000) < 25) {
    let pom1: number;
    if (v[R.room_okno1] === 0 && v[R.room_okno2] === 0 && s.random(2) === 0) pom1 = 1;
    else if (v[R.room_okno1] === 0 && v[R.room_okno2] === 0) pom1 = 2;
    else if (v[R.room_okno1] === 0) pom1 = 1;
    else pom1 = 2;

    const assign = (idx: number, zSlot: number) => {
      const gv = s.vars(idx);
      if (gv[zSlot] === 0) {
        gv[zSlot] = pom1;
        if (pom1 === 1) v[R.room_okno1] = 1;
        else if (pom1 === 2) v[R.room_okno2] = 1;
      }
    };
    switch (s.random(5)) {
      case 0:
        assign(R.frkavec, R.frkavec_zprava);
        break;
      case 1:
        assign(R.hnat, R.hnat_zprava);
        break;
      case 2:
        assign(R.lahev, R.lahev_zprava);
        break;
      case 3:
        assign(R.kuk, R.kuk_zprava);
        break;
      case 4:
        assign(R.ruka, R.ruka_zprava);
        break;
    }
  }

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_okno1]! + v[R.room_okno2]! === 2 && v[R.room_okna]! < 2) {
      if (v[R.room_opikniku]! > 0) v[R.room_opikniku]!--;
      if (v[R.room_ounave]! > 0) v[R.room_ounave]!--;
      if (v[R.room_oublizeni]! > 0) v[R.room_oublizeni]!--;
    }
    if (s.item(R.ocel).x >= 23 && v[R.room_otezkosti]! > 0) v[R.room_otezkosti]!--;

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      let pom1: number;
      if (s.pokus === 1) pom1 = 1;
      else if (s.pokus === 2) pom1 = s.random(3) + 1;
      else pom1 = s.random(5);
      if (pom1 > 3) pom1 = 0;
      s.adddel(10 + s.random(10));
      if (pom1 >= 1) s.addm(0, 'pt2-m-parnik');
      if (pom1 >= 2) s.addv(s.random(30) + 10, 'pt2-v-zmena');
      if (pom1 >= 3) {
        s.addset((x) => (s.room.busy.little = x), 1);
        s.addm(5, 'pt2-m-hrac');
        s.adddel(10);
        s.addset((x) => (s.room.busy.little = x), 0);
      }
    } else if (v[R.room_opikniku] === 0) {
      v[R.room_opikniku] = s.random(50) + 50;
      s.addm(20, 'pt2-m-piknik' + digit(s.random(4)));
    } else if (v[R.room_ounave] === 0) {
      v[R.room_ounave] = s.random(50) + 50;
      s.addv(20, 'pt2-v-unaveni' + digit(s.random(2)));
    } else if (v[R.room_oublizeni] === 0) {
      v[R.room_oublizeni] = s.random(50) + 50;
      s.addv(20, 'pt2-v-nemohou' + digit(s.random(2)));
    } else if (v[R.room_otezkosti] === 0) {
      v[R.room_otezkosti] = -1;
      s.addv(20, 'pt2-v-minule' + digit(s.random(2)));
    }
  }

  v[R.room_okna] = v[R.room_okno1]! + v[R.room_okno2]!;

  // ---- kuk (peeking head) ----
  {
    const it = s.item(R.kuk);
    const kv = s.vars(R.kuk);
    if (kv[R.kuk_zprava]! >= 1 && kv[R.kuk_zprava]! <= 2) {
      kv[R.kuk_okno] = kv[R.kuk_zprava]!;
      kv[R.kuk_zprava] = 3;
      kv[R.kuk_strana] = s.random(2);
      switch (s.random(3)) {
        case 0:
          it.anim = 'a0a1a2a3a4a5d?1-10a4a3a2a1a0';
          break;
        case 1: {
          let a = 'a6a7a8a9a10';
          switch (s.random(3)) {
            case 0:
              a += 'd?1-10';
              break;
            case 1:
              a += 'd?1-4a11a12a13a14a15a16d4a15a14d?5-10a13a12a11';
              break;
            case 2:
              a += 'd?1-4a11a12a13a14a15a16d?3-10a15a14a13a12a11';
              break;
          }
          a += 'a10a9a8a7a6';
          it.anim = a;
          break;
        }
        case 2:
          it.anim = 'a17a18a19a20a21a22a23d?1-10a22a21a20a19a18a17';
          break;
      }
      s.resetanim(R.kuk);
    }
    figureTail(s, R.kuk, R.kuk_zprava, R.kuk_okno, R.kuk_strana);
  }

  // ---- ruka (waving hand) ----
  {
    const rv = s.vars(R.ruka);
    if (rv[R.ruka_zprava]! >= 1 && rv[R.ruka_zprava]! <= 2) {
      rv[R.ruka_okno] = rv[R.ruka_zprava]!;
      rv[R.ruka_zprava] = 3;
      rv[R.ruka_strana] = s.random(2);
      let anim = '';
      let pom2 = 0;
      const lim = s.random(14) + 2;
      let pom1: number;
      for (pom1 = 1; pom1 <= lim; pom1++) {
        anim += 'a' + digit(pom2);
        if (pom2 >= 5) anim += 'd1';
        if (pom2 === 6) pom2 = 5;
        else pom2++;
      }
      for (pom1 = pom2 - 1; pom1 >= 0; pom1--) {
        anim += 'a' + digit(pom1);
      }
      s.item(R.ruka).anim = anim;
      s.resetanim(R.ruka);
    }
    figureTail(s, R.ruka, R.ruka_zprava, R.ruka_okno, R.ruka_strana);
  }

  // ---- frkavec (party-horn blower) ----
  {
    const fv = s.vars(R.frkavec);
    if (fv[R.frkavec_zprava]! >= 1 && fv[R.frkavec_zprava]! <= 2) {
      fv[R.frkavec_okno] = fv[R.frkavec_zprava]!;
      fv[R.frkavec_zprava] = 3;
      fv[R.frkavec_strana] = s.random(2);
      let anim = 'a0a1a2a3a4a5';
      const lim = s.random(5) + 1;
      for (let pom1 = 1; pom1 <= lim; pom1++) {
        if (s.random(2) === 0) anim += 'd?5-20a6d6a5';
        else anim += 'd?5-20a6s1,1s1,2d6s1,1s1,0,a5';
      }
      anim += 'a4a3a2a1a0';
      s.item(R.frkavec).anim = anim;
      s.resetanim(R.frkavec);
    }
    figureTail(s, R.frkavec, R.frkavec_zprava, R.frkavec_okno, R.frkavec_strana);
  }

  // ---- hnat (taunting limb): "drazdit" teasing cadence ----
  {
    const hv = s.vars(R.hnat);
    if (hv[R.hnat_zprava]! >= 1 && hv[R.hnat_zprava]! <= 2) {
      hv[R.hnat_okno] = hv[R.hnat_zprava]!;
      hv[R.hnat_zprava] = 3;
      hv[R.hnat_strana] = s.random(2);
      let anim = '';
      if (hv[R.hnat_drazdit]! > 0) {
        hv[R.hnat_drazdit]!--;
        switch (s.random(4)) {
          case 0:
            anim = 'a0a1a2a3a4a5a6a7d1a6a4';
            break;
          case 1:
            anim = 'a0a1a2a3a4a5a6a7a8d1a6a4';
            break;
          case 2:
            anim = 'a0a1a2a3a4a5a6a7a8a9d1a8a6a4';
            break;
          case 3:
            anim = 'a0a1a2a3a4a5a6a7a8a9a10d1a8a6a4';
            break;
        }
        const lim = s.random(5);
        for (let pom1 = 1; pom1 <= lim; pom1++) anim += 'd1a3d1a4';
        anim += 'a3a2a1a0';
      } else if (hv[R.hnat_drazdit] === 0) {
        anim = 'a0a1a2a3a4a5a6a7a8a9a10a11a12a13';
        switch (s.random(3)) {
          case 0:
            anim += 'a14a15a16a17a18a19a20a21';
            break;
          case 1:
            anim += 'd3a15a17a19a21';
            break;
          case 2:
            anim += 'd7a15a18a21';
            break;
        }
        hv[R.hnat_drazdit] = -s.random(5) - 2;
      } else if (hv[R.hnat_drazdit]! < 0) {
        hv[R.hnat_drazdit]!++;
        if (hv[R.hnat_drazdit] === 0) hv[R.hnat_drazdit] = s.random(5) + 1;
      }
      s.item(R.hnat).anim = anim;
      s.resetanim(R.hnat);
    }
    figureTail(s, R.hnat, R.hnat_zprava, R.hnat_okno, R.hnat_strana);
  }

  // ---- lahev (bottle) ----
  {
    const lv = s.vars(R.lahev);
    if (lv[R.lahev_zprava]! >= 1 && lv[R.lahev_zprava]! <= 2) {
      lv[R.lahev_okno] = lv[R.lahev_zprava]!;
      lv[R.lahev_zprava] = 3;
      lv[R.lahev_strana] = s.random(2);
      let anim = 'a0a1a2a3a4a5a6a7a8';
      let pom1: number;
      const lim = s.random(4);
      for (pom1 = 1; pom1 <= lim; pom1++) {
        const inner = s.random(3) + 1;
        for (pom1 = 1; pom1 <= inner; pom1++) anim += 'a9a10';
        anim += 'a11a12a13a14a9d?1-6';
      }
      anim += 'a8a7a6a5a4a3a2a1a0';
      s.item(R.lahev).anim = anim;
      s.resetanim(R.lahev);
    }
    figureTail(s, R.lahev, R.lahev_zprava, R.lahev_okno, R.lahev_strana);
  }

  // ---- frk (the party-horn puff sprite, driven by frkavec's frkacka) ----
  {
    const it = s.item(R.frk);
    const fv = s.vars(R.frkavec);
    const fk = s.vars(R.frk);
    fk[R.frk_okno] = 0;
    if (fv[R.frkavec_frkacka]! > 0) {
      if (
        (fv[R.frkavec_strana] === 0 && fv[R.frkavec_okno] === 2) ||
        (fv[R.frkavec_strana] === 1 && fv[R.frkavec_okno] === 1)
      ) {
        fk[R.frk_okno] = 3 - fv[R.frkavec_okno]!;
        it.afaze = fv[R.frkavec_frkacka]! - 1;
      }
    }
    const kab = s.item(R.kabina);
    if (fk[R.frk_okno] === 2) {
      it.x = kab.x + 9;
      it.y = kab.y + 1;
    } else {
      it.x = kab.x + 3;
      it.y = kab.y + 1;
    }
    it.spec = fk[R.frk_okno] === 0 ? 11 : fv[R.frkavec_strana]! * 10;
  }
}

export const PARTY2: RoomScript = { name: 'PARTY2', init, prog };
