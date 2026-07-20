/**
 * BLUDISTE ("Labyrinth", room 31) — a faithful port of BLUDISTE_InitProgramky /
 * BLUDISTE_Programky (URoom.pas:8240-8270, 20859-20956).
 *
 * A maze of coral. Ambient banter fires on timers: an intro (varied by which
 * attempt, chosen once via roompole[0]), remarks about the hanging fly-trap plant
 * (muchoblud = 1) as it is dragged around, and — after a `rikanka` countdown that
 * only ticks while the little fish (malar = 4) watches the snail — a call-and-
 * response with a snail (snecek = 2). The snail answers by playing setanim message
 * sequences, cued through the dialogue `prom` (snecek_zprava 1/2/3). Uses existing
 * primitives only.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_osundavani: 2,
  room_otvaru: 3,
  room_rikanka: 4,
  muchoblud: 1,
  snecek: 2,
  snecek_zprava: 1,
  malar: 4, // little fish
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  if (s.roompole[0] === 0) s.roompole[0] = s.random(2) + 1;
  v[R.room_uvod] = 0;
  v[R.room_osundavani] = 0;
  v[R.room_otvaru] = 0;
  v[R.room_rikanka] = s.random(600) + 200 * s.pokus;

  const sn = s.vars(R.snecek, 1);
  s.item(R.snecek).anim = '';
  sn[R.snecek_zprava] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const setZprava = (val: number): void => {
    s.vars(R.snecek)[R.snecek_zprava] = val;
  };

  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    // rikanka only counts down while the little fish is watching the snail (and,
    // in the final stretch, is on the same row).
    if (v[R.room_rikanka]! > 30) {
      v[R.room_rikanka]!--;
    } else if (v[R.room_rikanka]! > 10 && s.lookAt(R.malar, R.snecek)) {
      v[R.room_rikanka]!--;
    } else if (
      v[R.room_rikanka]! > 0 &&
      s.lookAt(R.malar, R.snecek) &&
      s.item(R.malar).y === s.item(R.snecek).y
    ) {
      v[R.room_rikanka]!--;
    }

    if (v[R.room_uvod] === 0) {
      s.adddel(s.random(20) + 10);
      switch (s.random(2)) {
        case 0:
          s.addm(0, 'bl-m-zvlastni0');
          break;
        case 1:
          s.addv(0, 'bl-v-zvlastni1');
          break;
      }
      if (s.pokus === s.roompole[0]) {
        s.addm(10, 'bl-m-funkce');
        s.addv(3, 'bl-v-pozadi');
      }
      v[R.room_uvod] = 1;
    } else if (
      v[R.room_osundavani] === 0 &&
      s.item(R.muchoblud).dir !== Dir.no &&
      s.random(100) < 8
    ) {
      v[R.room_osundavani] = 1;
      const pom1 = s.pokus === 1 ? 3 : s.random(4);
      s.adddel(20);
      if (pom1 >= 1) {
        switch (s.random(2)) {
          case 0:
            s.addm(0, 'bl-m-koral0');
            break;
          case 1:
            s.addv(0, 'bl-v-koral1');
            break;
        }
      }
      if (pom1 >= 2) s.addm(s.random(10) + 3, 'bl-m-visi');
      if (pom1 >= 3) s.addv(s.random(10) + 3, 'bl-v-nevim' + digit(s.random(2)));
    } else if (
      v[R.room_osundavani]! < 2 &&
      s.item(R.muchoblud).x <= 14 &&
      s.random(100) < 5
    ) {
      v[R.room_osundavani] = 2;
      s.addv(30, 'bl-v-proc');
      s.addm(7, 'bl-m-zeptej');
    } else if (
      v[R.room_otvaru] === 0 &&
      s.item(R.muchoblud).x <= 14 &&
      s.item(R.muchoblud).y <= 6 &&
      s.random(100) < 1
    ) {
      v[R.room_otvaru] = 1;
      s.addm(s.random(100), 'bl-m-tvar');
      s.addv(5, 'bl-v-pestovany');
    } else if (v[R.room_rikanka] === 0 && s.lookAt(R.malar, R.snecek)) {
      v[R.room_rikanka] = -1;
      s.adddel(10);
      s.addset(setZprava, 1);
      s.addm(0, 'bl-m-snecku0');
      s.addset(setZprava, 3);
      s.addv(0, 'bl-v-dost0');
      s.adddel(10);
      s.addset(setZprava, 2);
      s.addm(0, 'bl-m-snecku1');
      s.addset(setZprava, 3);
      s.addv(0, 'bl-v-dost1');
      s.adddel(10);
      s.addset(setZprava, 2);
      s.addm(10, 'bl-m-snecku2');
      s.addset(setZprava, 3);
      s.addv(0, 'bl-v-dost2');
    }
  }

  // ---- snecek (snail): answers by launching a setanim message, then plays it ----
  {
    const sn = s.vars(R.snecek);
    switch (sn[R.snecek_zprava]) {
      case 1:
        sn[R.snecek_zprava] = 0;
        s.setanim(R.snecek, 'd4a1d1a2');
        break;
      case 2:
        sn[R.snecek_zprava] = 0;
        s.setanim(R.snecek, 'd11a1d1a2');
        break;
      case 3:
        sn[R.snecek_zprava] = 0;
        s.setanim(R.snecek, 'd3a1d2a0');
        break;
    }
    if (s.item(R.snecek).anim !== '') s.goanim(R.snecek);
  }
}

export const BLUDISTE: RoomScript = { name: 'BLUDISTE', init, prog };
