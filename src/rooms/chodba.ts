/**
 * CHODBA ("In the darkness", room 56) — a faithful port of CHODBA_InitProgramky /
 * CHODBA_Programky (URoom.pas:5271-5354, 10209-10484).
 *
 * A pitch-black corridor. A light switch (vypinac) toggles the room between lit
 * (gspec=0) and dark (gspec=2). In the dark only the fish plus every "glowing"
 * machine part (two robot dogs, four flickering doors, two hatches) stay visible:
 * each such item raises its own `spec:=2` and advances to a glow-eye frame. The
 * room narrates the fish stumbling around in the dark (bliknul/oci/tma/last FSMs)
 * and, if the big fish wanders near a dog, a "robo-dog" banter chain plays.
 *
 * Uses the gspec=2 darkness renderer (already built) — the only new plumbing this
 * room needs is `gspec` in the save snapshot (script.ts), so the original's
 * ToRecord('x2')/('x0') replay machinery is skipped.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_bliknul: 1,
  room_tma: 2,
  room_oci: 3,
  room_last: 4,
  room_rpesmala: 5,
  room_rpesvelka: 6,
  room_nerusit: 7,
  room_cpsa: 8,
  room_pesmluvi: 9,
  rightpes: 1,
  rightpes_faze: 1,
  leftpes: 2,
  leftpes_faze: 1,
  vypinac: 3,
  vypinac_stav: 1,
  malar: 4,
  velkar: 5,
  dvere1: 12,
  dvere1_faze: 1,
  dvere1_pocit: 2,
  dvere2: 13,
  dvere2_faze: 1,
  dvere2_pocit: 2,
  dvere3: 14,
  dvere3_faze: 1,
  dvere3_pocit: 2,
  dvere4: 15,
  dvere4_faze: 1,
  dvere4_pocit: 2,
  poklop2: 18,
  poklop2_faze: 1,
  poklop2_pocit: 2,
  poklop1: 19,
  poklop1_faze: 1,
  poklop1_pocit: 2,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const room = s.vars(R.room, 9);
  room[R.room_bliknul] = 0;
  room[R.room_last] = s.random(2);
  room[R.room_rpesmala] = 0;
  room[R.room_rpesvelka] = 0;
  room[R.room_nerusit] = 0;
  room[R.room_pesmluvi] = 0;

  s.vars(R.rightpes, 1)[R.rightpes_faze] = 0;
  s.vars(R.leftpes, 1)[R.leftpes_faze] = 0;

  s.vars(R.vypinac, 1)[R.vypinac_stav] = 0;
  s.room.gspec = 0; // room starts LIT
  s.item(R.vypinac).spec = 2; // switch stays visible even in the dark

  let v = s.vars(R.dvere1, 2);
  v[R.dvere1_faze] = 0;
  v[R.dvere1_pocit] = 2;
  v = s.vars(R.dvere2, 2);
  v[R.dvere2_faze] = 0;
  v[R.dvere2_pocit] = 1;
  v = s.vars(R.dvere3, 2);
  v[R.dvere3_faze] = 0;
  v[R.dvere3_pocit] = 2;
  v = s.vars(R.dvere4, 2);
  v[R.dvere4_faze] = 0;
  v[R.dvere4_pocit] = 1;
  v = s.vars(R.poklop2, 2);
  v[R.poklop2_faze] = 1;
  v[R.poklop2_pocit] = 1;
  v = s.vars(R.poklop1, 2);
  v[R.poklop1_faze] = 0;
  v[R.poklop1_pocit] = 1;
}

/** Common glow behaviour for the doors/hatches: cycle faze on a countdown, then
 *  in the dark show a glow frame (faze+2) with spec=2, else the plain frame. */
function flapItem(s: Script, idx: number, fazeI: number, pocitI: number, reset: number): void {
  const v = s.vars(idx);
  if (v[pocitI]! > 0) v[pocitI]!--;
  else {
    v[pocitI] = reset;
    v[fazeI] = 1 - v[fazeI]!;
  }
  const it = s.item(idx);
  if (s.room.gspec === 2) {
    it.afaze = v[fazeI]! + 2;
    it.spec = 2;
  } else {
    it.afaze = v[fazeI]!;
    it.spec = 0;
  }
}

function prog(s: Script): void {
  const room = s.vars(R.room);

  // ----- room block: darkness narration + robo-dog banter -----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (s.room.gspec === 2 && room[R.room_tma]! > 0) room[R.room_tma]!--;
    if (s.room.gspec !== 2) room[R.room_tma] = s.random(100) + 50;

    if (room[R.room_bliknul] === 1) {
      room[R.room_bliknul]!++;
      s.addm(s.random(10) + 10, 'ch-m-rozsvit' + digit(s.random(3)));
      s.addv(s.random(15) + 2, 'ch-v-pockej' + digit(s.random(3)));
    } else if (room[R.room_bliknul] === 3) {
      room[R.room_bliknul]!++;
      s.addm(s.random(10), 'ch-m-blik' + String.fromCharCode(s.random(2) + 49));
      room[R.room_oci] = room[R.room_bliknul]! + 2;
    } else if (room[R.room_oci]! < room[R.room_bliknul]! && room[R.room_oci]! > 0) {
      if (s.random(100) < 40) {
        room[R.room_oci] = 0;
        s.addm(3, 'ch-m-blik0');
      } else {
        room[R.room_oci] = room[R.room_bliknul]!;
      }
    } else if (room[R.room_tma] === 0) {
      room[R.room_tma] = s.random(300) + 100;
      if (s.random(100) < 80) room[R.room_last] = 1 - room[R.room_last]!;
      switch (room[R.room_last]) {
        case 0:
          s.addv(0, 'ch-v-halo' + digit(s.random(3)));
          s.addm(s.random(20), 'ch-m-tady' + digit(s.random(3)));
          break;
        case 1:
          s.addm(0, 'ch-m-bojim' + digit(s.random(3)));
          s.addv(s.random(20), 'ch-v-neboj' + digit(s.random(3)));
          break;
      }
    } else if (
      room[R.room_rpesvelka] === 0 &&
      s.gstav !== 2 &&
      s.item(R.velkar).y >= 20 &&
      s.random(100) < 2
    ) {
      room[R.room_rpesvelka] = 1;
      room[R.room_nerusit] = 1;
      const pom1 = s.random(4) + 48;
      s.addv(10, 'ch-v-robopes');
      s.addm(s.random(5), 'ch-m-ten');
      s.addv(s.random(10), 'ch-v-zapada');
      s.addm(5 + s.random(10), 'ch-m-odpoved' + String.fromCharCode(pom1));
      if (s.random(100) < 70) {
        s.addv(s.random(20) + 10, 'ch-v-smysl');
        if (s.random(100) < 80) s.addm(s.random(10) + 5, 'ch-m-vubec');
      }
      room[R.room_cpsa] = s.random(2);
      const setP = (val: number): void => {
        room[R.room_pesmluvi] = val;
      };
      s.addd(s.random(20), 'ch-r-nevsimej' + digit(s.random(3)), 10, setP);
      s.addd(s.random(20), 'ch-r-hracka', 10, setP);
      s.addd(10 + s.random(20), 'ch-r-ikdyz' + digit(s.random(4)), 10, setP);
      s.addd(10 + s.random(20), 'ch-r-anavic' + String.fromCharCode(pom1), 10, setP);
      s.addset((val) => {
        room[R.room_nerusit] = val;
      }, 0);
    } else if (
      room[R.room_rpesmala] === 0 &&
      s.item(R.malar).y >= 28 &&
      (s.item(R.malar).x <= 11 || s.item(R.malar).x >= 20) &&
      s.random(100) < 3
    ) {
      if (room[R.room_rpesvelka] === 1 && s.random(3) < 2) s.addv(2, 'ch-v-pozor');
      else s.addm(2, 'ch-m-doufam');
      room[R.room_rpesmala] = 1;
    }
  }

  // ----- right dog -----
  {
    const v = s.vars(R.rightpes);
    if (v[R.rightpes_faze] === 2) v[R.rightpes_faze] = 0;
    else v[R.rightpes_faze]!++;
    const it = s.item(R.rightpes);
    if (s.room.gspec === 2) {
      it.afaze = v[R.rightpes_faze]! + 3;
      it.spec = 2;
    } else {
      it.afaze = v[R.rightpes_faze]!;
      it.spec = 0;
      if (room[R.room_pesmluvi] !== 0 && room[R.room_cpsa] === 1 && s.random(2) === 0)
        it.afaze += 6;
    }
  }

  // ----- left dog -----
  {
    const v = s.vars(R.leftpes);
    if (v[R.leftpes_faze] === 2) v[R.leftpes_faze] = 0;
    else v[R.leftpes_faze]!++;
    const it = s.item(R.leftpes);
    if (s.room.gspec === 2) {
      it.afaze = v[R.leftpes_faze]! + 3;
      it.spec = 2;
    } else {
      it.afaze = v[R.leftpes_faze]!;
      it.spec = 0;
      if (room[R.room_pesmluvi] !== 0 && room[R.room_cpsa] === 0 && s.random(2) === 0)
        it.afaze += 6;
    }
  }

  // ----- light switch -----
  {
    const v = s.vars(R.vypinac);
    const it = s.item(R.vypinac);
    const pushed = (it.dir === Dir.left || it.dir === Dir.right) && s.gfaze === 0;
    switch (v[R.vypinac_stav]) {
      case 0:
        if (pushed) {
          v[R.vypinac_stav]!++;
          it.afaze = 1;
          s.talkNow('ch-x-click1', 200);
        }
        break;
      case 1:
        v[R.vypinac_stav]!++;
        it.afaze = 2;
        s.room.gspec = 2;
        room[R.room_bliknul]!++;
        if (room[R.room_nerusit] === 0) s.clearDialog();
        break;
      case 2:
        if (pushed) {
          v[R.vypinac_stav] = 0;
          it.afaze = 0;
          s.room.gspec = 0;
          s.talkNow('ch-x-click2', 200);
          room[R.room_bliknul]!++;
          if (room[R.room_nerusit] === 0) s.clearDialog();
        }
        break;
    }
  }

  // ----- flickering doors + hatches -----
  flapItem(s, R.dvere1, R.dvere1_faze, R.dvere1_pocit, 5);
  flapItem(s, R.dvere2, R.dvere2_faze, R.dvere2_pocit, 1);
  flapItem(s, R.dvere3, R.dvere3_faze, R.dvere3_pocit, 4);
  flapItem(s, R.dvere4, R.dvere4_faze, R.dvere4_pocit, 2);
  flapItem(s, R.poklop2, R.poklop2_faze, R.poklop2_pocit, 3);
  flapItem(s, R.poklop1, R.poklop1_faze, R.poklop1_pocit, 3);
}

export const CHODBA: RoomScript = { name: 'CHODBA', init, prog };
