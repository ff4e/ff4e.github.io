/**
 * TRUP ("The Winter Mess Hall", room 46) — a faithful port of TRUP_InitProgramky /
 * TRUP_Programky (URoom.pas:5624-5649, 11637-11719).
 *
 * A freezing hold. The fish shiver on a `rozh` timer. A snowman (snehulak = 2) can be
 * bopped: when the little fish stands just below-left of it, facing right, and shoves,
 * the snowman recoils (a hit → `tr-x-koste` thwack + an "ouch" + `uder` count); after
 * enough hits the big fish grumbles about the aggression. Lone-survivor asides fire
 * depending on which fish is left and where the snowman ended up. This room disables
 * the standard death commentary (`StdHlaskySmrti := false`).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_rozh: 1,
  ocel: 1,
  snehulak: 2,
  snehulak_prastil: 1,
  snehulak_uder: 2,
  malar: 5, // little fish
} as const;

const istr = (n: number): string => String(n);

function init(s: Script): void {
  s.vars(R.room, 1)[R.room_rozh] = s.random(50) + 10;
  s.stdHlaskySmrti = false;
  const sn = s.vars(R.snehulak, 2);
  sn[R.snehulak_prastil] = 0;
  sn[R.snehulak_uder] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const sn = s.vars(R.snehulak);

  // ---- room: shiver timer + lone-survivor asides + aggression grumble ----
  if (s.count === v[R.room_rozh]) {
    v[R.room_rozh]! += 500 + s.random(1000);
    if (s.noDialog()) {
      if (s.random(5) === 1) {
        s.addm(2, 'tr-m-ztuhl');
      } else {
        s.addm(3, 'tr-m-chlad' + istr(s.random(2) + 1));
        if (s.count < 2000 || s.random(3) === 1) s.addv(5, 'tr-v-jid' + istr(s.random(2) + 1));
      }
    }
  }

  if (s.alive('little') && !s.alive('big') && !s.venku('big')) {
    if (s.item(R.snehulak).y <= 5) {
      if (s.roompole[1] === 0 || s.pokus - s.roompole[1]! > s.random(20)) {
        s.roompole[1] = s.pokus;
        s.addm(11, 'tr-m-cvicit');
      }
    }
  }

  if (s.alive('big') && !s.alive('little') && !s.venku('little')) {
    if (s.item(R.snehulak).y >= 5) {
      if (s.roompole[2] === 0 || s.pokus - s.roompole[2]! > s.random(20)) {
        s.roompole[2] = s.pokus;
        s.addv(14, 'tr-v-prezil');
      }
    }
  }

  if (sn[R.snehulak_uder]! > 4 && s.noDialog() && s.alive('big') && s.alive('little')) {
    if (s.pokus % 2 === 1) {
      s.addv(4, 'tr-v-agres');
      sn[R.snehulak_uder] = -10;
    }
  }

  // ---- snehulak (snowman): recoil-when-bopped state machine ----
  {
    const it = s.item(R.snehulak);
    if (it.dir === Dir.down && s.item(R.ocel).dir !== Dir.down) {
      it.afaze = 2;
    } else {
      if (it.afaze === 2) it.afaze = 1;
      const pom1 = it.afaze;
      const malar = s.item(R.malar);
      const pomb1 =
        s.alive('little') &&
        malar.x + 2 === it.x &&
        malar.y - 2 === it.y &&
        s.facingRight('little');
      if (!pomb1) {
        it.afaze = 0;
        sn[R.snehulak_prastil] = 0;
      } else if (it.dir === Dir.right) {
        if (s.count % 2 === 1) it.afaze = 1 - it.afaze;
      } else {
        if (sn[R.snehulak_prastil] === 0) {
          sn[R.snehulak_prastil] = -3;
          it.afaze = 1;
        } else {
          if (sn[R.snehulak_prastil]! < -1) sn[R.snehulak_prastil]!++;
          if (sn[R.snehulak_prastil] === -1) it.afaze = 0;
        }
      }
      if (pom1 === 0 && it.afaze === 1) {
        s.snd('tr-x-koste', 301);
        if (s.noDialog()) s.addm(2, 'tr-m-au' + istr(s.random(2) + 1));
        sn[R.snehulak_uder]!++;
      }
    }
  }
}

export const TRUP: RoomScript = { name: 'TRUP', init, prog };
