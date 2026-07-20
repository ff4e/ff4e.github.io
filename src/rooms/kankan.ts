/**
 * KANKAN ("Cancan Crabs", room 35) — a faithful port of KANKAN_InitProgramky /
 * KANKAN_Programky (URoom.pas:5395-5469, 10653-10947).
 *
 * A decorative music-hall: four crabs (1..4) dance the cancan in sync with the
 * room music (`playing(-999)`) — but only while neighbours line up (`muze`, same
 * row & adjacent) and their per-crab `ceka` cooldown has elapsed. Crab 1 is the
 * leader whose `krok` drives every crab's kick frame. A piano-playing octopus
 * (klavir = 6) waves its hands, blinks and — when shoved — slams the keys
 * (`KSnd(-999)`), covers its ears during `vyruseni`, then re-cues the music
 * (`MusicCycle(MusName,-999)`). A falling/standing cuttlefish (sepie = 10), a
 * napping ray (rejnok = 13) and a swaying anemone (sasanka = 18) fill the stage,
 * and the big fish (velkar = 19) occasionally asks "why?" between numbers.
 *
 * Relies on the room-music channel: `playing(-999)` reflects the host's looping
 * room music, `ksnd(-999)` stops it, and `musiccyc(MusName, -999)` re-cues it.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const MUSIC_PRIOR = -999;
const ITEM_WATER = 255;

const R = {
  room: 0,
  room_druh: 1,
  krab1: 1,
  krab1_muze: 1,
  krab1_krok: 2,
  krab1_ceka: 3,
  krab2: 2,
  krab2_muze: 1,
  krab2_ceka: 2,
  krab3: 3,
  krab3_muze: 1,
  krab3_ceka: 2,
  krab4: 4,
  krab4_muze: 1,
  krab4_ceka: 2,
  klavir: 6,
  klavir_ruce: 1,
  klavir_otocka: 2,
  klavir_mrknuti: 3,
  klavir_vyruseni: 4,
  sepie: 10,
  sepie_mrk: 1,
  sepie_nohy: 2,
  rejnok: 13,
  rejnok_pozice: 1,
  rejnok_nespi: 2,
  trubka: 17,
  sasanka: 18,
  sasanka_noha: 1,
  sasanka_kvet: 2,
  velkar: 19, // big fish
  velkar_ptalnyni: 1,
} as const;

function init(s: Script): void {
  s.vars(R.room, 1)[R.room_druh] = 1;

  const k1 = s.vars(R.krab1, 3);
  k1[R.krab1_ceka] = 10;
  k1[R.krab1_krok] = 0;
  s.vars(R.krab2, 2)[R.krab2_ceka] = 20;
  s.vars(R.krab3, 2)[R.krab3_ceka] = 30;
  s.vars(R.krab4, 2)[R.krab4_ceka] = 40;

  const kl = s.vars(R.klavir, 4);
  kl[R.klavir_ruce] = 0;
  kl[R.klavir_otocka] = -s.random(100) - 100;
  kl[R.klavir_vyruseni] = 0;

  const se = s.vars(R.sepie, 2);
  se[R.sepie_mrk] = 0;
  se[R.sepie_nohy] = 0;

  const re = s.vars(R.rejnok, 2);
  re[R.rejnok_pozice] = 0;
  re[R.rejnok_nespi] = 0;

  const sa = s.vars(R.sasanka, 2);
  sa[R.sasanka_noha] = 0;
  sa[R.sasanka_kvet] = 0;

  s.vars(R.velkar, 1)[R.velkar_ptalnyni] = 0;
}

/** The kick-frame each crab shows, driven by leader crab 1's `krok`. Runs when the
 *  crab has a dance partner, its cooldown is up, and the music is sounding; else it
 *  idles (a random resting frame). Mirrors the identical block in all four crabs. */
function crabAnimate(s: Script, idx: number, muze: number, ceka: number, krok: number, druh: number): void {
  const it = s.item(idx);
  if (muze === 1 && ceka === 0 && s.playing(MUSIC_PRIOR)) {
    if (druh === 0) {
      switch (krok) {
        case 1:
        case 3:
        case 5:
        case 7:
          it.afaze = 7;
          break;
        default: // 2,4,6,0
          it.afaze = 9;
          break;
      }
    } else {
      switch (krok) {
        case 1:
        case 3:
        case 5:
        case 7:
          it.afaze = 0;
          break;
        case 0:
          it.afaze = 6;
          break;
        case 2:
          it.afaze = 7;
          break;
        case 4:
          it.afaze = 8;
          break;
        case 6:
          it.afaze = 9;
          break;
      }
    }
  } else if (it.afaze > 5 || (s.count % 3 === 0 && s.random(100) < 40)) {
    it.afaze = s.random(6);
  }
}

function prog(s: Script): void {
  const druh = s.vars(R.room)[R.room_druh]!;
  const k1 = s.vars(R.krab1);
  const k2 = s.vars(R.krab2);
  const k3 = s.vars(R.krab3);
  const k4 = s.vars(R.krab4);

  // ---- crab 1 (leader): compute every crab's dance-partner flag + advance krok ----
  {
    k1[R.krab1_muze] = 0;
    k2[R.krab2_muze] = 0;
    k3[R.krab3_muze] = 0;
    k4[R.krab4_muze] = 0;

    const y1 = s.item(R.krab1).y;
    const y2 = s.item(R.krab2).y;
    const y3 = s.item(R.krab3).y;
    const y4 = s.item(R.krab4).y;
    if (y2 === y1 && s.dist(R.krab1, R.krab2) === 1) {
      k1[R.krab1_muze] = 1;
      k2[R.krab2_muze] = 1;
    }
    if (y3 === y1 && s.dist(R.krab1, R.krab3) === 1) {
      k1[R.krab1_muze] = 1;
      k3[R.krab3_muze] = 1;
    }
    if (y4 === y1 && s.dist(R.krab1, R.krab4) === 1) {
      k1[R.krab1_muze] = 1;
      k4[R.krab4_muze] = 1;
    }
    if (y3 === y2 && s.dist(R.krab2, R.krab3) === 1) {
      k2[R.krab2_muze] = 1;
      k3[R.krab3_muze] = 1;
    }
    if (y4 === y2 && s.dist(R.krab2, R.krab4) === 1) {
      k2[R.krab2_muze] = 1;
      k4[R.krab4_muze] = 1;
    }
    if (y4 === y3 && s.dist(R.krab3, R.krab4) === 1) {
      k3[R.krab3_muze] = 1;
      k4[R.krab4_muze] = 1;
    }

    if (s.count % 2 === 0) {
      if (k1[R.krab1_krok] === 7) k1[R.krab1_krok] = 0;
      else k1[R.krab1_krok]!++;
    }

    if (k1[R.krab1_ceka]! > 0) k1[R.krab1_ceka]!--;
    if (s.item(R.krab1).dir !== Dir.no || !s.playing(MUSIC_PRIOR)) k1[R.krab1_ceka] = 20;

    crabAnimate(s, R.krab1, k1[R.krab1_muze]!, k1[R.krab1_ceka]!, k1[R.krab1_krok]!, druh);
  }

  // ---- crabs 2..4: cooldown + dance, reading leader crab 1's krok ----
  for (const [idx, kv, cekaSlot] of [
    [R.krab2, k2, R.krab2_ceka],
    [R.krab3, k3, R.krab3_ceka],
    [R.krab4, k4, R.krab4_ceka],
  ] as const) {
    if (kv[cekaSlot]! > 0) kv[cekaSlot]!--;
    if (s.item(idx).dir !== Dir.no || !s.playing(MUSIC_PRIOR)) kv[cekaSlot] = 20;
    crabAnimate(s, idx, kv[1]!, kv[cekaSlot]!, k1[R.krab1_krok]!, druh);
  }

  // ---- klavir (piano octopus): wave/blink; slam keys + re-cue music when shoved ----
  {
    const kl = s.vars(R.klavir);
    const it = s.item(R.klavir);
    if (it.dir !== Dir.no) {
      s.ksnd(MUSIC_PRIOR);
      kl[R.klavir_vyruseni] = 20 + s.random(25);
    }

    if (kl[R.klavir_vyruseni]! > 0) {
      if (s.noDialog()) {
        kl[R.klavir_vyruseni]!--;
        if (kl[R.klavir_vyruseni] === 0) s.musiccyc(s.musName, MUSIC_PRIOR);
      }
      if (s.random(100) < 3) it.afaze = 8;
      else it.afaze = 6;
    } else {
      if (!s.playing(MUSIC_PRIOR)) s.musiccyc(s.musName, MUSIC_PRIOR);
      if (kl[R.klavir_otocka]! > 0 && kl[R.klavir_mrknuti]! > 0) {
        if (kl[R.klavir_ruce] === 0) kl[R.klavir_ruce] = 2;
        else if (kl[R.klavir_ruce] === 2) kl[R.klavir_ruce] = 0;
        else kl[R.klavir_ruce] = s.random(2) * 2;
        it.afaze = 8 + Math.floor(kl[R.klavir_ruce]! / 2);
        kl[R.klavir_mrknuti]!--;
        kl[R.klavir_otocka]!--;
      } else {
        kl[R.klavir_ruce] = (kl[R.klavir_ruce]! + s.random(3) + 1) % 4;
        if (kl[R.klavir_otocka]! > 0) {
          it.afaze = 4 + kl[R.klavir_ruce]!;
          if (s.random(100) < 7) kl[R.klavir_mrknuti] = 1 + s.random(4);
          kl[R.klavir_otocka]!--;
        } else {
          it.afaze = kl[R.klavir_ruce]!;
          kl[R.klavir_otocka]!++;
          if (kl[R.klavir_otocka] === 0) {
            kl[R.klavir_otocka] = s.random(10) + 50;
            kl[R.klavir_mrknuti] = 0;
          }
        }
      }
      if (kl[R.klavir_otocka] === 0) kl[R.klavir_otocka] = -s.random(300) - 150;
    }
  }

  // ---- sepie (cuttlefish): shuffles its legs falling/standing, blinks (mrk) ----
  {
    const se = s.vars(R.sepie);
    const it = s.item(R.sepie);
    const pada = it.dir === Dir.down;
    const stoji =
      s.farray(it.x, it.y + 1) === ITEM_WATER &&
      s.farray(it.x + 1, it.y + 1) === ITEM_WATER &&
      s.farray(it.x + 2, it.y + 3) !== ITEM_WATER;

    if (se[R.sepie_mrk]! > 0) se[R.sepie_mrk]!--;
    else if (s.random(100) < 15) se[R.sepie_mrk] = s.random(3) + 2;

    if (pada || !stoji) {
      if (s.count % 2 === 1) se[R.sepie_nohy] = (se[R.sepie_nohy]! + 2 + s.random(2) * 2) % 3;
      if (pada) it.afaze = se[R.sepie_nohy]! + 3;
      else if (se[R.sepie_mrk]! > 0) it.afaze = se[R.sepie_nohy]! + 6;
      else it.afaze = se[R.sepie_nohy]!;
    } else {
      if (it.dir === Dir.left || it.dir === Dir.down) se[R.sepie_nohy] = (se[R.sepie_nohy]! + 1) % 2;
      else se[R.sepie_nohy] = 0;
      if (se[R.sepie_mrk]! > 0) it.afaze = 2 * se[R.sepie_nohy]! + 10;
      else it.afaze = 2 * se[R.sepie_nohy]! + 9;
    }
  }

  // ---- rejnok (ray): dozes, wakes (nespi) when nudged, cycles its pose ----
  {
    const re = s.vars(R.rejnok);
    const it = s.item(R.rejnok);
    if (s.count % 2 === 0 || re[R.rejnok_nespi]! > 20) {
      if (re[R.rejnok_pozice] === 5) re[R.rejnok_pozice] = 0;
      else re[R.rejnok_pozice]!++;
      if (it.dir !== Dir.no) re[R.rejnok_nespi] = s.random(60) + 20;
      if (re[R.rejnok_nespi]! > 0) {
        if (s.random(100) < 13) it.afaze = re[R.rejnok_pozice]!;
        else it.afaze = re[R.rejnok_pozice]! + 6;
        re[R.rejnok_nespi]!--;
      } else {
        it.afaze = re[R.rejnok_pozice]!;
      }
    }
  }

  // ---- sasanka (anemone): sways only while the cell above it is open water ----
  {
    const sa = s.vars(R.sasanka);
    const it = s.item(R.sasanka);
    if (s.farray(it.x, it.y - 1) === ITEM_WATER) {
      switch (s.count % 8) {
        case 0:
        case 1:
        case 2:
        case 3:
          sa[R.sasanka_noha] = 0;
          break;
        default: // 4,5,6,7
          sa[R.sasanka_noha] = 1;
          break;
      }
      switch (s.count % 8) {
        case 0:
        case 3:
        case 4:
        case 7:
          sa[R.sasanka_kvet] = 1;
          break;
        default: // 1,2,5,6
          sa[R.sasanka_kvet] = 0;
          break;
      }
      it.afaze = sa[R.sasanka_noha]! * 4 + sa[R.sasanka_kvet]! + 1;
    } else {
      it.afaze = 1;
    }
  }

  // ---- velkar (big fish): asks "why?" in the gaps between numbers ----
  {
    const ve = s.vars(R.velkar);
    if (ve[R.velkar_ptalnyni] === 1 && s.playing(MUSIC_PRIOR)) {
      ve[R.velkar_ptalnyni] = 0;
    } else if (ve[R.velkar_ptalnyni] === 0 && !s.playing(MUSIC_PRIOR) && s.random(1000) < 15) {
      ve[R.velkar_ptalnyni] = 1;
      s.addv(3, 'kan-v-proc');
    }
  }
}

export const KANKAN: RoomScript = { name: 'KANKAN', init, prog };
