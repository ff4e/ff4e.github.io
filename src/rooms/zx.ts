/**
 * ZX ("Emulator", room 66) — a faithful port of ZX_InitProgramky / ZX_Programky
 * (URoom.pas:7861-7920, 19145-19313). A homage to the ZX-Spectrum: the fish reminisce
 * about 8-bit games (Jetpac robots, Manic Miner, a marching knightik) while a loading
 * screen flickers.
 *
 * DEFERRED (cosmetic): gspec=42 selects the KresliZX "emulator" render — an oscillating
 * scanline-roll/loading-stripe effect over the wall (Priprav, URoom.pas:26214-26222).
 * The port sets gspec=42 but currently renders the wall normally; the scanline effect is
 * a deferred render-pass task. Everything gameplay-relevant here is faithful.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  spectrum: 0,
  s_uvod: 1,
  s_nekdy: 2,
  s_pixely: 3,
  s_hra: 4,
  s_lore: 5,
  s_pocitadlo: 6,
  s_premyslis: 7,
  s_load: 8,
  s_opakovani: 9,
  s_tlaci: 10,
  s_skladat: 11,
  s_miner: 12,
  jet: 9,
  jet2: 11,
  jet1: 12,
  knightik: 13,
  knightik_poc: 1,
  knightik_stav: 2,
  manic: 14,
  trubys: 18,
  velkar: 19,
  velkar_nehybe_se: 1,
  malar: 20,
  malar_tlacit_jeste: 1,
  jet3: 21,
} as const;

function init(s: Script): void {
  const v = s.vars(R.spectrum, 12);
  s.room.gspec = 42;
  v[R.s_pocitadlo] = 0;
  v[R.s_uvod] = 0;
  v[R.s_nekdy] = 100 + s.random(5000);
  v[R.s_pixely] = 0;
  v[R.s_hra] = 0;
  v[R.s_lore] = 0;
  v[R.s_premyslis] = 0;
  v[R.s_load] = 0;
  v[R.s_opakovani] = 0;
  v[R.s_tlaci] = 0;
  v[R.s_skladat] = 0;
  v[R.s_miner] = 0;

  const kv = s.vars(R.knightik, 2);
  kv[R.knightik_stav] = 0;
  kv[R.knightik_poc] = s.random(200) + 100;

  s.vars(R.velkar, 1)[R.velkar_nehybe_se] = 0;
  s.vars(R.malar, 1)[R.malar_tlacit_jeste] = 20 + s.random(80);
}

function roomBlock(s: Script): void {
  const v = s.vars(R.spectrum);
  if (!(s.noDialog() && s.alive('little') && s.alive('big'))) {
    v[R.s_pocitadlo] = 0;
    return;
  }
  if (v[R.s_nekdy]! > 0) v[R.s_nekdy]!--;
  v[R.s_pocitadlo]!++;

  if (v[R.s_uvod] === 0) {
    v[R.s_uvod] = 1;
    let pom1: number;
    switch (s.pokus) {
      case 1: pom1 = 1; break;
      case 2: pom1 = 2; break;
      default: pom1 = s.random(2) + 1; break;
    }
    if (pom1 === 1) {
      s.addm(s.random(42) + 9, 'zx-m-pametnici');
      if (s.pokus < 5 + s.random(5) || s.random(100) < 50) s.addv(15, 'zx-v-osmibit');
    } else {
      s.addv(s.random(42) + 9, 'zx-v-roboti');
      s.addm(9, 'zx-m-highway');
    }
  } else if (v[R.s_pixely] === 0 && v[R.s_nekdy] === 0) {
    v[R.s_pixely] = 1;
    s.addm(9, 'zx-m-pixel');
    if (s.random(100) < 40 && v[R.s_hra] === 0) {
      v[R.s_hra] = 1;
      s.addv(5, 'zx-v-hry');
    }
  } else if (v[R.s_hra] === 0 && s.item(R.velkar).dir !== Dir.no && s.item(R.jet).dir !== Dir.no) {
    v[R.s_hra] = 1;
    s.addv(20 + s.random(50), 'zx-v-hry');
  } else if (
    v[R.s_premyslis] === 0 &&
    s.vars(R.velkar)[R.velkar_nehybe_se]! > 90 &&
    v[R.s_pocitadlo]! > 500 + s.random(200)
  ) {
    v[R.s_premyslis] = 1;
    s.addm(0, 'zx-m-premyslis');
    if (v[R.s_hra] === 0 && s.random(100) < 25) {
      s.addv(4, 'zx-v-hry');
      v[R.s_hra] = 1;
    } else {
      const pom1 = s.random(6);
      if (pom1 < 5) s.addv(12, 'zx-v-pamet');
      if (pom1 > 1) s.addv(5 + s.random(4), 'zx-v-otazka');
      if (s.random(5) > 0) s.addm(10 + s.random(4), 'zx-m-necodosebe');
    }
  } else if (
    v[R.s_lore] === 0 &&
    s.dist(R.knightik, R.malar) < 5 &&
    s.item(R.malar).y >= 2 &&
    s.item(R.malar).y <= 4 &&
    s.facingRight('little') &&
    s.random(100) < 20
  ) {
    v[R.s_lore] = 1;
    s.addm(0 + 9 * s.random(2), 'zx-m-knight');
  } else if (
    v[R.s_load]! < 4 &&
    v[R.s_pocitadlo]! > 400 + 200 * v[R.s_load]! + s.random(200)
  ) {
    v[R.s_load]!++;
    if (v[R.s_load] === 1) s.addv(0, 'zx-v-nahravani');
    else if (s.random(2) === 0) s.addv(0, 'zx-v-nahravani');
  } else if (
    v[R.s_tlaci] === 0 &&
    s.item(R.malar).dir !== Dir.no &&
    s.tlaceno &&
    s.vars(R.malar)[R.malar_tlacit_jeste] === 0
  ) {
    v[R.s_tlaci] = 1;
    s.addm(5, 'zx-m-ocel');
  } else if (
    v[R.s_skladat] === 0 &&
    s.roompole[2]! < 2 &&
    (s.item(R.jet1).dir !== Dir.no || s.item(R.jet2).dir !== Dir.no || s.item(R.jet3).dir !== Dir.no) &&
    s.item(R.malar).dir !== Dir.no &&
    s.random(8) === 0
  ) {
    if (s.pokus > 2 && s.random(100) < 60) {
      v[R.s_skladat] = 1;
    } else {
      v[R.s_skladat] = 1;
      s.roompole[2]!++;
      s.addm(9, 'zx-m-jetpack');
    }
  } else if (
    v[R.s_miner] === 0 &&
    s.item(R.velkar).dir === Dir.no &&
    s.dist(R.manic, R.velkar) < 6 &&
    s.random(100) < 8
  ) {
    if (s.pokus > 3 && s.random(100) < 10 + 50 * s.roompole[1]!) {
      v[R.s_miner] = 1;
    } else {
      s.roompole[1] = 1;
      v[R.s_miner] = 1;
      s.addv(5, 'zx-v-manicminer');
    }
  }
}

function prog(s: Script): void {
  roomBlock(s);

  // knightik: the marching little knight (Manic-Miner homage).
  {
    const it = s.item(R.knightik);
    const kv = s.vars(R.knightik);
    switch (kv[R.knightik_stav]) {
      case 0:
      case 2:
        if (kv[R.knightik_poc]! > 0) kv[R.knightik_poc]!--;
        else {
          kv[R.knightik_stav]!++;
          kv[R.knightik_poc] = 42;
        }
        break;
      case 1:
      case 3:
        if (kv[R.knightik_poc] === 0) {
          if (kv[R.knightik_stav] === 3) kv[R.knightik_stav] = 0;
          else kv[R.knightik_stav] = 2;
          it.afaze = kv[R.knightik_stav]! * 3;
          kv[R.knightik_poc] = 300 - kv[R.knightik_stav]! * 50;
        } else {
          kv[R.knightik_poc]!--;
          if (kv[R.knightik_poc]! % 3 === 2) it.afaze = s.random(4) + 2;
        }
        break;
      case 5:
      case 6:
      case 7:
      case 8:
        kv[R.knightik_stav]!++;
        break;
      case 9:
        kv[R.knightik_stav] = 0;
        it.afaze = 0;
        break;
    }
    if (kv[R.knightik_stav] === 0 && s.random(100) === 14) {
      kv[R.knightik_stav] = 5;
      it.afaze = 1;
    }
  }

  // trubys: a looping ticker.
  {
    const it = s.item(R.trubys);
    it.afaze = it.afaze === 3 ? 0 : it.afaze + 1;
  }

  // velkar / malar: idle + push counters feeding the room banter.
  {
    const it = s.item(R.velkar);
    if (it.dir !== Dir.no) s.vars(R.velkar)[R.velkar_nehybe_se] = 0;
    else s.vars(R.velkar)[R.velkar_nehybe_se]!++;
  }
  {
    const it = s.item(R.malar);
    const mv = s.vars(R.malar);
    if (it.dir !== Dir.no && mv[R.malar_tlacit_jeste]! > 0 && s.tlaceno)
      mv[R.malar_tlacit_jeste]!--;
  }
}

export const ZX: RoomScript = { name: 'ZX', init, prog };
