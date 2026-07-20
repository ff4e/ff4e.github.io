/**
 * PYRAMIDA ("Mr. Cheops' House", room 25) — a faithful port of
 * PYRAMIDA_InitProgramky / PYRAMIDA_Programky (URoom.pas:5869-5915, 12639-12822).
 *
 * A tomb: the little fish (malar, item 1) explores past an animated pharaoh statue
 * (faraon, 3), a ticking obelisk/stela (11) that runs a long scripted afaze
 * timeline, three loose slabs (deska1/2/3 = 6/5/7) and a worm (cerv, 18) that
 * crawls in and out of its hole by writing its own X/Y. Dialogue triggers off the
 * fish looking at these props; one line fires when the BIG fish shoves the pharaoh
 * (guarded by `gfaze===0` so it fires once as the push begins).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_hodinky: 2,
  room_cervik: 3,
  room_desticky: 4,
  malar: 1, // little fish
  faraon: 3,
  faraon_delay: 1,
  deska2: 5,
  deska1: 6,
  deska3: 7,
  stela: 11,
  stela_konstanta: 1,
  stela_faze: 2,
  stela_delay: 3,
  cerv: 18,
  cerv_stav: 1,
  cerv_mez: 2,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  if (s.random(100) < 70 || s.pokus === 1) v[R.room_uvod] = 0;
  v[R.room_hodinky] = 0;
  v[R.room_cervik] = 0;
  v[R.room_desticky] = 0;

  s.vars(R.faraon, 1)[R.faraon_delay] = s.random(200) + 100;

  const st = s.vars(R.stela, 3);
  st[R.stela_konstanta] = 10;
  st[R.stela_faze] = 0;
  st[R.stela_delay] = 0;

  const cv = s.vars(R.cerv, 2);
  cv[R.cerv_stav] = -5;
  cv[R.cerv_mez] = s.random(15);
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const malarY = () => s.item(R.malar).y;

  // ---- room dialogue (single else-if chain) ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    const stelaAfaze = s.item(R.stela).afaze;
    const cerv = s.item(R.cerv);
    const deskaTrig = (d: number): boolean =>
      s.lookAt(R.malar, d) &&
      s.item(R.malar).y === s.item(d).y &&
      s.dist(R.malar, d) < 2 &&
      s.item(d).dir === Dir.no;

    if (v[R.room_uvod] === 0) {
      if (s.random(100) < 33) s.addm(10 + s.random(20), 'pyr-m-kam');
      else if (s.random(100) < 50) s.addv(30 + s.random(30), 'pyr-v-vsim');
      else {
        s.addm(10 + s.random(20), 'pyr-m-kam');
        s.addv(s.random(40), 'pyr-v-vsim');
      }
      v[R.room_uvod] = 1;
    } else if (
      v[R.room_hodinky] === 0 &&
      s.lookAt(R.malar, R.stela) &&
      malarY() > 14 &&
      malarY() < 21 &&
      (stelaAfaze === 2 || stelaAfaze === 4 || stelaAfaze === 5)
    ) {
      s.addm(0, 'pyr-m-nudi');
      s.addv(2 + s.random(3), 'pyr-v-sark');
      if (s.random(100) < 50) s.addm(s.random(5), 'pyr-m-comy');
      if (s.random(100) < 50) s.addm(s.random(5), 'pyr-m-zkus');
      if (s.random(100) < 50) s.addm(s.random(5), 'pyr-m-nic');
      v[R.room_hodinky] = 1;
    } else if (
      s.lookAt(R.malar, R.cerv) &&
      v[R.room_cervik] === 0 &&
      malarY() < cerv.y + 2 &&
      malarY() > cerv.y - 2 &&
      s.random(100) < 4
    ) {
      s.addm(0, 'pyr-m-plaz');
      if (s.random(100) < 50) {
        s.addv(s.random(5), 'pyr-v-druha');
        v[R.room_cervik] = 1;
      }
    } else if (
      s.item(R.faraon).afaze === 2 &&
      s.aktivni() === 'big' &&
      s.item(R.faraon).dir !== Dir.no &&
      s.gfaze === 0 &&
      s.random(100) < 20
    ) {
      s.addv(0, 'pyr-v-sfing');
      s.adddel(10);
    } else if (
      v[R.room_desticky] === 0 &&
      s.random(100) < 3 &&
      (deskaTrig(R.deska1) || deskaTrig(R.deska2) || deskaTrig(R.deska3))
    ) {
      s.addm(0, 'pyr-m-dest');
      s.addv(s.random(15), 'pyr-v-sbohem');
      v[R.room_desticky] = 1;
    }
  }

  // ---- faraon (pharaoh statue): idle blink, shoved -> frame 2 ----
  {
    const it = s.item(R.faraon);
    const fv = s.vars(R.faraon);
    if (it.dir !== Dir.no) {
      fv[R.faraon_delay] = s.random(20) + 15;
      it.afaze = 2;
    }
    if (fv[R.faraon_delay]! > 0) fv[R.faraon_delay]!--;
    else {
      switch (it.afaze) {
        case 0:
          fv[R.faraon_delay] = s.random(20) + 20;
          it.afaze = 1;
          break;
        case 1:
        case 2:
          fv[R.faraon_delay] = s.random(200) + 100;
          it.afaze = 0;
          break;
      }
    }
  }

  // ---- stela (ticking obelisk): a long scripted afaze/delay timeline ----
  {
    const it = s.item(R.stela);
    const sv = s.vars(R.stela);
    if (it.dir !== Dir.no) {
      it.afaze = 0;
      sv[R.stela_delay] = 0;
      sv[R.stela_faze] = 0;
    }
    if (sv[R.stela_delay]! > 0) sv[R.stela_delay]!--;
    else {
      const k = sv[R.stela_konstanta]!;
      switch (sv[R.stela_faze]) {
        case 0:
          sv[R.stela_delay] = k * (s.random(30) + 50);
          break;
        case 1:
        case 5:
        case 9:
          it.afaze = 1;
          sv[R.stela_delay] = 0;
          break;
        case 2:
        case 6:
        case 10:
          sv[R.stela_delay] = s.random(30) + 20;
          it.afaze = 2;
          break;
        case 3:
        case 7:
        case 11:
          it.afaze = 1;
          sv[R.stela_delay] = 0;
          break;
        case 4:
          it.afaze = 0;
          sv[R.stela_delay] = k * (s.random(20) + 30);
          break;
        case 8:
          it.afaze = 0;
          sv[R.stela_delay] = k * (s.random(10) + 20);
          break;
        case 12:
          it.afaze = 0;
          sv[R.stela_delay] = k * (s.random(5) + 5);
          break;
        case 13:
          it.afaze = 3;
          sv[R.stela_delay] = k * (s.random(20) + 30);
          break;
        case 14:
        case 16:
          it.afaze = 4;
          sv[R.stela_delay] = s.random(30) + 20;
          break;
        case 15:
          it.afaze = 3;
          sv[R.stela_delay] = k * (s.random(10) + 20);
          break;
        case 17:
          it.afaze = 3;
          sv[R.stela_delay] = k * (s.random(5) + 5);
          break;
        default:
          it.afaze = 5;
          sv[R.stela_delay] = 30000;
          break;
      }
      sv[R.stela_faze]!++;
    }
  }

  // ---- cerv (worm): crawls in and out of its hole, moving its own X/Y ----
  {
    const it = s.item(R.cerv);
    const cv = s.vars(R.cerv);
    if (cv[R.cerv_stav]! < 32) cv[R.cerv_stav]!++;
    if (cv[R.cerv_stav] === 30) {
      if (it.y > cv[R.cerv_mez]!) cv[R.cerv_stav] = 0;
      else cv[R.cerv_mez] = cv[R.cerv_mez]! + 2 + s.random(21 - cv[R.cerv_mez]! - 2);
    }
    const st = cv[R.cerv_stav]!;
    if (st >= 0 && st <= 4) it.afaze = 0;
    else if (st >= 5 && st <= 6) it.afaze = 1;
    else if (st >= 7 && st <= 10) it.afaze = 2;
    else if (st >= 11 && st <= 12) it.afaze = 3;
    else if (st >= 13 && st <= 19) it.afaze = 4;
    else if (st >= 20 && st <= 21) it.afaze = 5;
    else if (st >= 22 && st <= 25) it.afaze = 6;
    else if (st >= 26 && st <= 27) it.afaze = 7;
    else if (st === 28) {
      it.afaze = 0;
      it.x--;
      it.y--;
    } else if (st === 32) {
      if (it.y < cv[R.cerv_mez]!) {
        it.x++;
        it.y++;
      } else {
        cv[R.cerv_stav] = 0;
        cv[R.cerv_mez] = s.random(cv[R.cerv_mez]! - 2);
      }
    }
  }
}

export const PYRAMIDA: RoomScript = { name: 'PYRAMIDA', init, prog };
