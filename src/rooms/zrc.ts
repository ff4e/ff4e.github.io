/**
 * ZRC ("Drowned Submarine") room script — a faithful port of ZRC_InitProgramky /
 * ZRC_Programky (URoom.pas:5146-5188, 9780-9953).
 *
 * The mirror room: the fish pull faces at the mirror (xicht), a bubble-curtain
 * "peri" plays a long idle animation, a cannon charge (naboj) announces itself
 * when seated, and the room comments on caution/leaving. Constants are the
 * generated r_ZRC_* values (URoom.pas:3469-3484); fish are items 7 (little) and
 * 8 (big).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  room: 0,
  room_odjel: 1,
  room_qopatrne: 2,
  room_hulakat: 3,
  room_oci: 4,
  room_reklopatrne: 5,
  peri: 1, // bubble curtain
  peri_delay: 1,
  peri_cinnost: 2,
  zrcadlo: 2, // mirror
  lahev: 4, // bottle
  naboj: 5, // cannon charge
  naboj_nabita: 1,
  malar: 7, // little fish
  malar_trpelivost: 1,
  velkar: 8, // big fish
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 5);
  v[R.room_odjel] = 0;
  v[R.room_qopatrne] = 0;
  v[R.room_hulakat] = s.random(30) + 10 * s.pokus;
  v[R.room_oci] = 0;
  v[R.room_reklopatrne] = 0;

  s.vars(R.peri, 2)[R.peri_cinnost] = 0;
  s.item(R.zrcadlo).spec = 1;
  s.vars(R.naboj, 1)[R.naboj_nabita] = 0;
  s.vars(R.malar, 1)[R.malar_trpelivost] = s.random(50) + 30;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const it = (i: number) => s.item(i);

  // ---- room dialogue ----
  if (s.talking('little') || s.talking('big')) v[R.room_hulakat] = -1;

  if (v[R.room_odjel] === 0 && s.venku('big') && s.alive('little')) {
    v[R.room_odjel] = 1;
    switch (s.random(3)) {
      case 0:
        s.addm(10, 'zr-m-takfajn');
        break;
      case 1:
        s.addm(10, 'zr-m-tojeon');
        break;
      case 2:
        s.addm(10, 'zr-m-pockej');
        break;
    }
  } else if (
    v[R.room_qopatrne]! < 2 &&
    v[R.room_reklopatrne] === 1 &&
    !s.alive('little') &&
    it(R.malar).x === 8 &&
    s.alive('big')
  ) {
    s.addv(3, 'zr-v-vzdyt');
    v[R.room_qopatrne] = 2;
  }

  if (v[R.room_qopatrne]! < 2) {
    if (
      s.alive('little') &&
      it(R.malar).x === 9 &&
      s.alive('big') &&
      it(R.lahev).x === 8 &&
      !s.facingRight('little') &&
      v[R.room_qopatrne] === 0
    ) {
      if (s.noDialog()) {
        s.addv(1, 'zr-v-opatrne');
        v[R.room_reklopatrne] = 1;
      } else {
        v[R.room_reklopatrne] = 0;
      }
      v[R.room_qopatrne] = 1;
    }
  }
  if (v[R.room_qopatrne] === 1 && s.facingRight('little')) v[R.room_qopatrne] = 0;

  if (
    s.alive('little') &&
    !s.venku('little') &&
    s.alive('big') &&
    !s.venku('big') &&
    s.noDialog()
  ) {
    if (v[R.room_hulakat]! > 0) v[R.room_hulakat]!--;
    else if (v[R.room_hulakat] === 0) {
      v[R.room_hulakat] = -1;
      switch (s.random(3)) {
        case 0:
          s.addv(3, 'zr-v-hej');
          break;
        case 1:
          s.addv(3, 'zr-v-halo');
          break;
        case 2:
          s.addv(3, 'zr-v-jetunekdo');
          break;
      }
      switch (s.random(3)) {
        case 0:
          s.addm(9, 'zr-m-nervi');
          break;
        case 1:
          s.addm(9, 'zr-m-nepovykuj');
          break;
        case 2:
          s.addm(9, 'zr-m-tadyjsem');
          break;
      }
    }
    if (s.noDialog() && s.vars(R.malar)[R.malar_trpelivost] === 0) {
      if (s.random(2) === 0) s.addm(0, 'zr-m-obliceje');
      else s.addm(0, 'zr-m-prestan');
      s.vars(R.malar)[R.malar_trpelivost] = s.random(600) + 100;
    }
    if (
      s.noDialog() &&
      s.vars(R.peri)[R.peri_cinnost] === 7 &&
      v[R.room_oci] === 0 &&
      s.random(100) < 50
    ) {
      s.addm(5, 'zr-m-komu');
      s.addv(10, 'zr-v-nevim');
      v[R.room_oci] = 1;
    }
  }

  // ---- peri (bubble curtain) idle animation ----
  {
    const p = it(R.peri);
    const pv = s.vars(R.peri);
    const c = pv[R.peri_cinnost]!;
    if (c === 0) {
      pv[R.peri_delay] = s.random(100) + 50;
      pv[R.peri_cinnost] = 1;
      p.afaze = 0;
    } else if (c === 1) {
      if (pv[R.peri_delay] === 0) pv[R.peri_cinnost]!++;
      else pv[R.peri_delay]!--;
    } else if (c >= 2 && c <= 7) {
      p.afaze = c - 1;
      pv[R.peri_cinnost]!++;
    } else if (c === 8) {
      pv[R.peri_delay] = s.random(30) + 15;
      pv[R.peri_cinnost]!++;
    } else if (c === 9) {
      if (s.count % 3 === 0) p.afaze = 6 + s.random(2);
      if (pv[R.peri_delay] === 0) pv[R.peri_cinnost]!++;
      else pv[R.peri_delay]!--;
    } else if (c === 10) {
      if (s.random(100) < 30) pv[R.peri_cinnost] = 20;
      else pv[R.peri_cinnost]!++;
    } else if (c === 11) {
      pv[R.peri_delay] = s.random(5) + 2;
      pv[R.peri_cinnost]!++;
    } else if (c === 12) {
      if (s.random(100) < 20) pv[R.peri_cinnost]!++;
    } else if (c >= 13 && c <= 15) {
      p.afaze = 18 - c;
      pv[R.peri_cinnost]!++;
    } else if (c >= 16 && c <= 18) {
      p.afaze = c - 12;
      pv[R.peri_cinnost]!++;
    } else if (c === 19) {
      if (pv[R.peri_delay] === 0) pv[R.peri_cinnost] = 8;
      else {
        pv[R.peri_delay]!--;
        pv[R.peri_cinnost] = 12;
      }
    } else if (c >= 20 && c <= 25) {
      p.afaze = 25 - c;
      pv[R.peri_cinnost]!++;
    } else if (c === 26) {
      pv[R.peri_cinnost] = 0;
    }
  }

  // ---- naboj (cannon charge): announces itself when seated at (12,8) ----
  {
    const n = it(R.naboj);
    const nv = s.vars(R.naboj);
    if (nv[R.naboj_nabita] === 0 && n.x === 12 && n.y === 8) {
      nv[R.naboj_nabita] = 1;
      s.talkNow('zr-x-nabito', 201); // Talk('zr-x-nabito',201): plays immediately, not queued
    }
  }

  // ---- little fish pulls faces at the mirror (xicht) ----
  {
    const facingMirror =
      s.facingRight('little') &&
      (s.xdist(R.malar, R.zrcadlo) === -1 || s.xdist(R.malar, R.zrcadlo) === -2) &&
      s.ydist(R.malar, R.zrcadlo) === 0;
    if (facingMirror) {
      if (s.random(100) < 30) s.setXicht('little', s.random(9));
    } else {
      s.setXicht('little', 0);
    }
  }

  // ---- big fish pulls faces at the mirror (and wears down the little fish's patience) ----
  {
    const big = it(R.velkar);
    const facingMirror =
      s.facingRight('big') &&
      (s.xdist(R.velkar, R.zrcadlo) === -1 || s.xdist(R.velkar, R.zrcadlo) === -2) &&
      (it(R.zrcadlo).y === big.y || it(R.zrcadlo).y === big.y - 1);
    if (facingMirror) {
      if (s.random(100) < 30) s.setXicht('big', s.random(8));
      if (s.vars(R.malar)[R.malar_trpelivost]! > 0) s.vars(R.malar)[R.malar_trpelivost]!--;
    } else {
      s.setXicht('big', 0);
    }
  }
}

export const ZRC: RoomScript = { name: 'ZRC', init, prog };
