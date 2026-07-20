/**
 * KNIHOVNA ("Library") room script — a faithful port of KNIHOVNA_InitProgramky /
 * KNIHOVNA_Programky (URoom.pas:7751-7826, 18916-19061).
 *
 * Exercises mechanics beyond the earlier rooms:
 *  - the per-room global array `roompole` (a rotating dialogue selector) and the
 *    persistent global array `globpole` (the ten crystals' animation phase),
 *  - `addset` scheduling busy[] flag writes inside a dialogue sequence,
 *  - a script "agent" (`universal`) that plays an afaze animation on a randomly
 *    chosen object each cycle,
 *  - `.dir`-driven frames (the two `db` doors) and random-timer PC animations.
 *
 * Constants are the generated r_KNIHOVNA_* values (URoom.pas:4477-4495).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_cas: 1,
  room_zakaz: 2,
  universal: 1,
  universal_kdo: 1,
  universal_co: 2,
  malar: 7, // little fish
  velkar: 8, // big fish
  pc2: 14,
  pc2_stav: 1,
  switcher: 15,
  pf2: 16,
  db1: 19,
  pf1: 20,
  db2: 22,
  pazur: 24,
  pc1: 25,
  pc1_stav: 1,
  krystal: 35, // first of ten crystals (35..44)
} as const;

function init(s: Script): void {
  const room = s.vars(R.room, 2);
  room[R.room_cas] = s.random(100) + 10;
  room[R.room_zakaz] = 0;

  const uni = s.vars(R.universal, 2);
  uni[R.universal_co] = 0;

  s.vars(R.pc2, 1)[R.pc2_stav] = 0;

  // switcher: randomly swap the switcher and the pazur to each other's start.
  if (s.random(3) === 1) {
    const sw = s.item(R.switcher);
    const pz = s.item(R.pazur);
    sw.x = pz.xStart;
    sw.y = pz.yStart;
    pz.x = sw.xStart;
    pz.y = sw.yStart;
  }

  s.item(R.pf2).afaze = s.random(2);
  s.item(R.pf1).afaze = s.random(2);

  s.vars(R.pc1, 1)[R.pc1_stav] = 0;

  // Ten crystals: pick a base frame (mask picks one of two look-up tables).
  const malarMask = s.item(R.malar).mask;
  const db1Mask = s.item(R.db1).mask;
  for (let pom1 = 0; pom1 < 10; pom1++) {
    const it = s.item(R.krystal + pom1);
    const pom2 = s.random(7) * 4;
    it.mask = pom2 === 24 ? malarMask : db1Mask;
    it.afaze = pom2;
    s.globpole[pom1] = 0;
    s.globpole[pom1 + 10] = pom2;
  }
}

function prog(s: Script): void {
  // --- room: rotating dialogue driven by roompole[1] ---
  {
    const v = s.vars(R.room);
    // pom2 is left uninitialised in the original; it only selects a dialogue when
    // `cas` expires, so we default it to a non-matching value.
    let pom2 = 99;
    if (s.noDialog() && s.alive('little') && s.alive('big')) {
      if (v[R.room_cas]! > 0) {
        v[R.room_cas]!--;
      } else {
        v[R.room_cas] = s.random(1000) + 600;
        let pom1 = s.roompole[1]!;
        if (pom1 % 4 === 2) {
          if (v[R.room_zakaz] === 1) pom1++;
        }
        pom2 = pom1 % 4;
        pom1++;
        pom1 = pom1 % 4;
        s.roompole[1] = pom1;
      }
    }
    switch (pom2) {
      case 0:
        s.addm(7, 'kni-m-svicny');
        if (s.pokus < 3 || s.random(3) > 0) s.addv(7, 'kni-v-ber');
        break;
      case 1:
        s.addv(7, 'kni-v-prolezt');
        s.addm(7, 'kni-m-tloustka');
        s.addv(7, 'kni-v-padavko');
        s.addm(7, 'kni-m-hromado');
        s.adddel(7);
        s.addset((val) => s.setBusy('big', val), 1);
        s.addv(1, 'kni-v-vypni');
        s.addset((val) => s.setBusy('big', val), 0);
        break;
      case 2:
        s.addm(7, 'kni-m-hrncirstvi');
        s.addv(7, 'kni-v-amforstvi');
        s.addm(7, 'kni-m-amfornictvi');
        break;
      case 3:
        s.addm(7, 'kni-m-mise');
        s.addv(7, 'kni-v-proc');
        s.addm(7, 'kni-m-cetky');
        s.adddel(14);
        s.addset((val) => s.setBusy('little', val), 1);
        s.addm(1, 'kni-m-kramy');
        s.addset((val) => s.setBusy('little', val), 0);
        break;
    }
  }

  // --- universal: an "agent" animating a random object through a sequence ---
  {
    const v = s.vars(R.universal);
    const co = v[R.universal_co]!;
    if (co === 0) {
      switch (s.random(10)) {
        case 1:
          v[R.universal_co] = 1;
          break;
        case 2:
          v[R.universal_co] = 8;
          break;
      }
      if (v[R.universal_co] !== 0) v[R.universal_kdo] = s.random(3) + R.universal;
    } else {
      const kdo = v[R.universal_kdo]!;
      if (co >= 1 && co <= 3) {
        s.item(kdo).afaze = co;
        v[R.universal_co]!++;
      } else if (co >= 4 && co <= 6) {
        s.item(kdo).afaze = 7 - co;
        v[R.universal_co]!++;
      } else if (co >= 8 && co <= 9) {
        s.item(kdo).afaze = co - 4;
        v[R.universal_co]!++;
      } else if (co >= 10 && co <= 11) {
        s.item(kdo).afaze = 15 - co;
        v[R.universal_co]!++;
      } else {
        s.item(kdo).afaze = 0;
        v[R.universal_co] = 0;
      }
    }
  }

  // --- velkar: the big fish rising past y=18 flips the room's "zakaz" flag ---
  if (s.item(R.velkar).y < 18) s.vars(R.room)[R.room_zakaz] = 1;

  // --- pc1 / pc2: random-timer flicker animations ---
  for (const [pc, stav] of [
    [R.pc2, R.pc2_stav],
    [R.pc1, R.pc1_stav],
  ] as const) {
    const it = s.item(pc);
    const v = s.vars(pc);
    if (v[stav]! > 0) v[stav]!--;
    else v[stav] = s.random(300) + 50;
    switch (v[stav]) {
      case 2:
      case 3:
        it.afaze--;
        break;
      case 6:
      case 7:
        it.afaze++;
        break;
      case 8:
        it.afaze = s.random(2) === 1 ? 0 : 3;
        break;
    }
  }

  // --- db1 / db2: doors whose frame follows their pending push direction ---
  for (const db of [R.db1, R.db2]) {
    const it = s.item(db);
    it.afaze = it.dir === Dir.no ? 0 : 1;
  }

  // --- krystal: ten crystals cycling through globpole phase state ---
  for (let pom1 = 0; pom1 < 10; pom1++) {
    const it = s.item(R.krystal + pom1);
    switch (s.globpole[pom1]) {
      case 0:
        if (s.random(25) === 1) s.globpole[pom1]!++;
        break;
      case 6:
        s.globpole[pom1] = 0;
        break;
      default:
        if (s.globpole[pom1]! >= 1 && s.globpole[pom1]! <= 5) s.globpole[pom1]!++;
    }
    const g = s.globpole[pom1]!;
    const pom2 = g <= 3 ? g : 7 - g;
    it.afaze = s.globpole[pom1 + 10]! + pom2;
  }
}

export const KNIHOVNA: RoomScript = { name: 'KNIHOVNA', init, prog };
