/**
 * JEDNICKY ("One More Pearl!", room 36) — a faithful port of JEDNICKY_InitProgramky
 * / JEDNICKY_Programky (URoom.pas:7525-7602, 18267-18474).
 *
 * A pearl-diver's cove. The little fish (malar = 1) hustles (`fofr` counter, bumped
 * once per move via gfaze); when it has worked hard enough the big fish (velkar = 2)
 * nags it to relax (`flakat`). A giant clam (zeva = 3) idly gapes (cinnost 1) or
 * yawns wide (cinnost 2), and when a fish begs it for a pearl it snaps "won't give!"
 * — the `jed-x-nedam` line drives its refuse animation by writing its own `cinnost`
 * through the dialogue `prom` (prior 101/102). A staircase of `jestejednu` timers
 * escalates the refusals. Twelve pearls (perla1..12) shimmer via globpole[0..11].
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_fofr: 2,
  room_flakat: 3,
  room_jestejednu: 4,
  room_otyci: 5,
  room_kleopatra: 6,
  room_opoteru: 7,
  malar: 1, // little fish
  malar_fofr: 1,
  velkar: 2, // big fish
  zeva: 3,
  zeva_cinnost: 1,
  zeva_faze: 2,
  zeva_pocet: 3,
  zeva_delay: 4,
  perla1: 11,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 7);
  v[R.room_uvod] = 0;
  v[R.room_fofr] = s.nah(300, 1500);
  v[R.room_jestejednu] = s.nah(500, 5000);
  v[R.room_flakat] = 0;
  v[R.room_otyci] = s.nah(500, 3000);
  v[R.room_kleopatra] = s.nah(300, 1000);
  v[R.room_opoteru] = s.nah(600, 1200);

  s.vars(R.malar, 1)[R.malar_fofr] = 0;

  const z = s.vars(R.zeva, 4);
  z[R.zeva_cinnost] = 0;
  z[R.zeva_pocet] = 0;

  for (let i = 0; i <= 11; i++) s.globpole[i] = -s.random(50) - 10;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const setCinnost = (val: number): void => {
    s.vars(R.zeva)[R.zeva_cinnost] = val;
  };

  // ---- room: timers + one dialogue branch per tick ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_jestejednu]! > 0) v[R.room_jestejednu]!--;
    if (v[R.room_jestejednu]! < -1 && v[R.room_jestejednu]! > -60) v[R.room_jestejednu]!++;
    if (v[R.room_jestejednu]! < -60 && v[R.room_jestejednu]! > -120) v[R.room_jestejednu]!++;
    if (v[R.room_otyci]! > 0) v[R.room_otyci]!--;
    if (v[R.room_kleopatra]! > 0) v[R.room_kleopatra]!--;
    if (v[R.room_opoteru]! > 0) v[R.room_opoteru]!--;

    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      s.addm(s.random(200) + 10, 'jed-m-libi');
      switch (s.random(2)) {
        case 0:
          s.addm(s.random(5), 'jed-m-perly0');
          break;
        case 1:
          s.addm(s.random(5), 'jed-m-perly1');
          break;
      }
      switch (s.random(7)) {
        case 0:
        case 1:
          s.addv(s.random(5), 'jed-v-poslani0');
          break;
        case 2:
        case 3:
          s.addv(s.random(5), 'jed-v-poslani1');
          break;
        case 4:
        case 5:
          s.addv(s.random(5), 'jed-v-poslani2');
          break;
        // case 6: nothing (faithful)
      }
    } else if (
      v[R.room_fofr]! <= s.vars(R.malar)[R.malar_fofr]! &&
      v[R.room_flakat] === 0
    ) {
      v[R.room_flakat] = 1;
      s.addm(1, 'jed-m-flakas');
      switch (s.random(2)) {
        case 0:
          s.addv(s.random(5), 'jed-v-uzivat0');
          break;
        case 1:
          s.addv(s.random(5), 'jed-v-uzivat1');
          break;
      }
    } else if (
      v[R.room_jestejednu] === 0 &&
      s.dist(R.malar, R.zeva) < 3 &&
      s.lookAt(R.malar, R.zeva) &&
      s.random(100) < 5
    ) {
      v[R.room_jestejednu] = -1 * (s.random(40) + 20);
      s.addm(1, 'jed-m-perlorodka0');
      s.addd(s.nah(1, 20), 'jed-x-nedam', 101, setCinnost);
    } else if (
      s.dist(R.malar, R.zeva) < 3 &&
      s.lookAt(R.malar, R.zeva) &&
      v[R.room_jestejednu] === -1
    ) {
      v[R.room_jestejednu] = -1 * (s.random(40) + 80);
      s.addm(1, 'jed-m-perlorodka1');
      s.addd(s.nah(1, 20), 'jed-x-nedam', 101, setCinnost);
    } else if (
      s.dist(R.malar, R.zeva) < 3 &&
      s.lookAt(R.malar, R.zeva) &&
      v[R.room_jestejednu] === -60
    ) {
      v[R.room_jestejednu] = s.random(10000) + 10000;
      s.addm(1, 'jed-m-perlorodka2');
      s.addd(s.nah(1, 20), 'jed-x-nedam', 102, setCinnost);
    } else if (v[R.room_otyci] === 0 && v[R.room_flakat] === 1) {
      s.addm(s.random(5), 'jed-m-trubka');
      v[R.room_otyci] = -1;
    } else if (v[R.room_kleopatra] === 0) {
      s.addv(s.random(10), 'jed-v-ocet');
      s.addm(s.random(4), 'jed-m-moc');
      s.addv(s.random(5), 'jed-v-vzdelat');
      v[R.room_kleopatra] = -1;
    } else if (v[R.room_opoteru] === 0) {
      s.addv(s.random(10), 'jed-v-poter');
      if (s.random(100) < 60) s.addm(s.random(5), 'jed-m-kulicka');
      v[R.room_opoteru] = -1;
    }
  }

  // ---- malar: the little fish's hustle counter (once per move, gfaze==0) ----
  if (s.item(R.malar).dir !== Dir.no && s.gfaze === 0) s.vars(R.malar)[R.malar_fofr]!++;

  // ---- zeva (clam): idle gape / wide yawn / refuse animations ----
  {
    const z = s.vars(R.zeva);
    const it = s.item(R.zeva);
    if (z[R.zeva_cinnost] === 0 && s.random(1000) < 10) {
      z[R.zeva_faze] = 1;
      if (s.random(100) < 25 && z[R.zeva_pocet]! > 3) z[R.zeva_cinnost] = 2;
      else z[R.zeva_cinnost] = 1;
      z[R.zeva_pocet]!++;
    }

    switch (z[R.zeva_cinnost]) {
      case 1:
        switch (z[R.zeva_faze]) {
          case 1:
            it.afaze = 1;
            z[R.zeva_faze]!++;
            break;
          case 2:
            it.afaze = 2;
            z[R.zeva_delay] = s.random(10);
            z[R.zeva_faze]!++;
            break;
          case 3:
            if (z[R.zeva_delay]! > 0) z[R.zeva_delay]!--;
            else {
              it.afaze = 1;
              z[R.zeva_faze]!++;
            }
            break;
          case 4:
            z[R.zeva_cinnost] = 0;
            it.afaze = 0;
            break;
        }
        break;
      case 2:
        switch (z[R.zeva_faze]) {
          case 1:
            it.afaze = 3;
            z[R.zeva_faze]!++;
            break;
          case 2:
            it.afaze = 4;
            z[R.zeva_delay] = 20 + s.random(100);
            z[R.zeva_faze]!++;
            break;
          case 3:
            if (z[R.zeva_delay]! > 0) {
              if (s.random(100) < 3) z[R.zeva_faze] = 10;
              else z[R.zeva_delay]!--;
            } else {
              it.afaze = 1;
              z[R.zeva_faze]!++;
            }
            break;
          case 4:
            z[R.zeva_cinnost] = 0;
            it.afaze = 0;
            break;
          case 10:
          case 15:
            it.afaze = 5;
            z[R.zeva_faze]!++;
            break;
          case 11:
          case 14:
            it.afaze = 6;
            z[R.zeva_faze]!++;
            break;
          case 12:
          case 13:
            it.afaze = 7;
            z[R.zeva_faze]!++;
            break;
          case 16:
            it.afaze = 4;
            z[R.zeva_faze] = 3;
            break;
        }
        break;
      case 101:
        z[R.zeva_faze] = 1;
        z[R.zeva_cinnost] = 1;
        break;
      case 102:
        z[R.zeva_faze] = 1;
        z[R.zeva_cinnost] = 2;
        break;
    }
  }

  // ---- perla1..12: shimmer, each on its own globpole cursor ----
  for (let i = 0; i <= 11; i++) {
    s.globpole[i]!++;
    let pom2 = 0;
    switch (s.globpole[i]) {
      case 0:
      case 5:
        pom2 = 1;
        break;
      case 1:
      case 4:
        pom2 = 2;
        break;
      case 2:
      case 3:
        pom2 = 3;
        break;
      case 6:
        pom2 = 0;
        s.globpole[i] = -s.random(50) - 10;
        break;
      default:
        pom2 = 0;
        break;
    }
    s.item(R.perla1 + i).afaze = pom2;
  }
}

export const JEDNICKY: RoomScript = { name: 'JEDNICKY', init, prog };
