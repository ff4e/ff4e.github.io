/**
 * KUFRIK ("Briefcase Message") room script — a faithful port of
 * KUFRIK_InitProgramky / KUFRIK_Programky (URoom.pas:8045-8075, 19914-20065).
 *
 * The briefcase (kufr) falls, opens, and at phase 8 launches the story cutscene
 * (InitKufrDemo -> the demo.pck animation + KD-* narration). The fish then
 * comment through the room dialogue (uvod/do_prace/znovu/dilna/zvedni).
 *
 * NOTE: showmode is the automatic demonstration (help.cap capture replay). When
 * both fish reach the demo spot the host starts it (main.ts startShowmode); the
 * fish then auto-move from the recording and tutorial subtitles play.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_do_prace: 2,
  room_znovu: 3,
  room_dilna: 4,
  room_zvedni: 5,
  kufr: 1, // briefcase
  kufr_faze: 1,
  kufr_delay: 2,
  kufr_hotovo: 3,
  malar: 2, // small fish
  velkar: 3, // big fish
  ocel: 4, // steel block
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 5);
  v[R.room_uvod] = 0;
  v[R.room_do_prace] = 0;
  v[R.room_znovu] = 0;
  v[R.room_dilna] = 0;
  v[R.room_zvedni] = 0;
  const k = s.vars(R.kufr, 3);
  k[R.kufr_faze] = 0;
  k[R.kufr_hotovo] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const item = (i: number) => s.item(i);

  // ---- room dialogue ----
  if (s.alive('little') && s.alive('big')) {
    // Reaching the demonstration spot starts showmode: the help.cap tutorial
    // recording auto-plays (fish move themselves + subtitles). URoom.pas:19923.
    if (
      !s.showmode &&
      item(R.malar).x === 25 &&
      item(R.malar).y === 23 &&
      item(R.velkar).x === 27 &&
      item(R.velkar).y === 21
    ) {
      s.startShowmode();
    }
    if (!s.showmode && s.noDialog()) {
      if (v[R.room_uvod] === 0) {
        switch (s.pokus) {
          case 1:
            s.addm(6, 'kuf-m-je');
            s.addv(4, 'kuf-v-noco');
            s.addv(9, 'kuf-v-hod');
            break;
          case 2:
            s.addv(9, 'kuf-v-hod');
            break;
          default:
            switch (s.random(3)) {
              case 1:
                s.addv(9, 'kuf-v-hod');
                break;
              case 2:
                s.addm(6, 'kuf-m-je');
                break;
            }
        }
        v[R.room_uvod] = 1;
      } else if (v[R.room_do_prace] === 0 && s.vars(R.kufr)[R.kufr_hotovo] === 1) {
        switch (s.pokus) {
          case 1:
            s.addv(10, 'kuf-v-doprace');
            break;
          case 2:
            s.addv(10, 'kuf-v-dotoho');
            break;
          default:
            if (s.random(2) === 0) s.addv(10, 'kuf-v-doprace');
            else s.addv(10, 'kuf-v-dotoho');
        }
        s.addm(5, 'kuf-m-ven');
        s.addv(0, 'kuf-v-ukol');
        v[R.room_do_prace] = 1;
      } else if (
        v[R.room_znovu] === 0 &&
        v[R.room_do_prace] === 1 &&
        v[R.room_dilna] === 0 &&
        s.random(100) < 5
      ) {
        if (s.pokus === 1) {
          s.addv(20, 'kuf-v-jeste');
          s.addm(2, 'kuf-m-disk');
          s.addv(6, 'kuf-v-restart');
          s.addm(3, 'kuf-m-pravda');
        }
        v[R.room_znovu] = 1;
      } else if (
        v[R.room_dilna] === 0 &&
        v[R.room_znovu] === 1 &&
        (item(R.malar).y >= 22 || item(R.velkar).y >= 22)
      ) {
        s.addm(30, 'kuf-m-dodilny');
        s.addv(5, 'kuf-v-napad');
        v[R.room_dilna] = 1;
      } else if (
        v[R.room_zvedni] === 0 &&
        item(R.ocel).y === 18 &&
        item(R.malar).y >= 22 &&
        item(R.malar).y <= 24 &&
        item(R.malar).x >= 29 &&
        item(R.malar).x <= 30
      ) {
        v[R.room_zvedni] = 1;
        s.addm(0, 'kuf-m-nezvednu');
      } else if (v[R.room_zvedni]! <= 1 && item(R.ocel).y === 16 && s.random(100) < 7) {
        v[R.room_zvedni] = 2;
        s.addm(0, 'kuf-m-kousek');
      }
    }
  }

  // ---- briefcase (kufr) animation + cutscene trigger ----
  {
    const it = item(R.kufr);
    const k = s.vars(R.kufr);
    const faze = k[R.kufr_faze]!;
    if (faze === 0) {
      if (it.dir === Dir.down) k[R.kufr_faze] = faze + 1;
    } else if (faze === 1) {
      it.afaze = 0;
      if (it.dir === Dir.no) k[R.kufr_faze] = faze + 1;
    } else if (faze >= 2 && faze <= 6) {
      it.afaze = faze - 2;
      k[R.kufr_faze] = faze + 1;
    } else if (faze === 7) {
      k[R.kufr_delay] = 3;
      k[R.kufr_faze] = faze + 1;
    } else if (faze === 8) {
      if (k[R.kufr_delay]! > 0) k[R.kufr_delay] = k[R.kufr_delay]! - 1;
      else {
        s.startKufrDemo(); // InitKufrDemo — the story cutscene
        k[R.kufr_faze] = faze + 1;
      }
    } else if (faze === 9) {
      k[R.kufr_delay] = 4;
      k[R.kufr_faze] = faze + 1;
    } else if (faze >= 10 && faze <= 13) {
      if (k[R.kufr_delay]! > 0) k[R.kufr_delay] = k[R.kufr_delay]! - 1;
      else {
        it.afaze = 13 - faze;
        k[R.kufr_faze] = faze + 1;
      }
    } else if (faze === 14) {
      k[R.kufr_delay] = 37;
      k[R.kufr_faze] = faze + 1;
    } else if (faze === 15) {
      if (k[R.kufr_delay]! > 0) k[R.kufr_delay] = k[R.kufr_delay]! - 1;
      else k[R.kufr_faze] = faze + 1;
    } else if (faze >= 16 && faze <= 21) {
      it.afaze = faze - 11;
      k[R.kufr_faze] = faze + 1;
    } else if (faze === 22) {
      it.afaze = 0;
      k[R.kufr_faze] = faze + 1;
      k[R.kufr_hotovo] = 1;
    }
  }

  // ---- steel block (ocel): moving it reveals the workshop path ----
  {
    const it = item(R.ocel);
    if (it.dir !== Dir.no) {
      v[R.room_dilna] = 1;
      v[R.room_do_prace] = 1;
      v[R.room_znovu] = 1;
    }
  }
}

export const KUFRIK: RoomScript = { name: 'KUFRIK', init, prog };
