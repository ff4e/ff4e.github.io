/**
 * SMETAK ("Real Chaos", room 43) — a faithful port of SMETAK_InitProgramky /
 * SMETAK_Programky (URoom.pas:5918-5978, 12823-12968).
 *
 * A junk-strewn cavern of idle creatures: a jellyfish (meduza = 1) that bobs a ball
 * (mic = 2) when parked 3 cells above it, two more jellyfish (8/9), a centipede
 * (stonozka = 12), a pufferfish (ostnatec = 23) that peeks on a `kukuc` timer, an eel
 * (uhor = 28), and an alarm clock (budik = 31) that ticks (`sm-x-tiktak`, prior 940).
 * The fish comment on the junk, the ferryman boat (lod = 17), and a painting collection.
 *
 * NOTE: one dialogue name in the original is a copy-paste bug — `addv(...,'sm-v-Items
 * [r_SMETAK_lod]^')` — a leftover code fragment that names no real sound (it silently
 * fails). Reproduced verbatim for fidelity (cf. the DIRY octopus typo).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_obudikovi: 2,
  room_okramech: 3,
  room_olodi: 4,
  room_sbirka: 5,
  meduza: 1,
  meduza_keca: 1,
  mic: 2,
  mic_beha: 1,
  meduza2: 8,
  meduza1: 9,
  stonozka: 12,
  lod: 17,
  ostnatec: 23,
  ostnatec_kukuc: 1,
  uhor: 28,
  budik: 31,
  malar: 35, // little fish
  velkar: 36, // big fish
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 5);
  v[R.room_uvod] = 0;
  v[R.room_obudikovi] = 0;
  v[R.room_okramech] = s.nah(1000, 3000);
  v[R.room_olodi] = 0;
  v[R.room_sbirka] = s.nah(300, 1200);

  const me = s.vars(R.meduza, 1);
  s.item(R.meduza).afaze = 0;
  me[R.meduza_keca] = 0;

  const mi = s.vars(R.mic, 1);
  mi[R.mic_beha] = 1;
  s.item(R.mic).afaze = 0;

  const os = s.vars(R.ostnatec, 1);
  s.item(R.ostnatec).afaze = 0;
  os[R.ostnatec_kukuc] = s.nah(10, 30);
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room dialogue chain ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_okramech]! > 0) v[R.room_okramech]!--;
    if (v[R.room_sbirka]! > 0) v[R.room_sbirka]!--;
    if (v[R.room_uvod] === 0) {
      v[R.room_uvod] = 1;
      s.addm(s.nah(15, 30), 'sm-m-prolezame');
      switch (s.random(3)) {
        case 0:
          s.addv(s.random(5), 'sm-v-jine0');
          break;
        case 1:
          s.addv(s.random(5), 'sm-v-jine1');
          break;
        case 2:
          s.addv(s.random(5), 'sm-v-jine2');
          break;
      }
    } else if (
      v[R.room_obudikovi] === 0 &&
      s.lookAt(R.malar, R.budik) &&
      s.dist(R.malar, R.budik) < 3 &&
      s.random(100) < 1
    ) {
      v[R.room_obudikovi] = 1;
      s.addv(0, 'sm-v-budik');
      if (s.random(2) < 1) s.addm(s.random(5), 'sm-m-normalni');
    } else if (v[R.room_okramech] === 0) {
      v[R.room_okramech] = s.nah(1000, 3000);
      switch (s.random(4)) {
        case 0:
          s.addm(s.random(10), 'sm-m-kramy0');
          break;
        case 1:
          s.addm(s.random(10), 'sm-m-kramy1');
          break;
        case 2:
          s.addv(s.random(10), 'sm-v-kramy2');
          break;
        case 3:
          s.addv(s.random(10), 'sm-v-kramy3');
          break;
      }
    } else if (v[R.room_olodi] === 0 && s.item(R.lod).dir !== Dir.no) {
      v[R.room_olodi] = 1;
      switch (s.random(2)) {
        case 0:
          // Faithful reproduction of the original's copy-paste bug (broken sound name).
          s.addv(s.random(7), 'sm-v-Items[r_SMETAK_lod]^');
          s.addm(s.random(7), 'sm-m-dedek');
          s.addv(s.random(7), 'sm-v-charon');
          s.addm(s.random(7), 'sm-m-codela');
          break;
        case 1:
          s.addv(s.random(7), 'sm-v-charon');
          s.addm(s.random(7), 'sm-m-codela');
          break;
      }
      switch (s.random(2)) {
        case 0:
          s.addv(s.random(7), 'sm-v-duchodce0');
          break;
        case 1:
          s.addv(s.random(7), 'sm-v-duchodce1');
          break;
      }
    } else if (v[R.room_sbirka] === 0) {
      v[R.room_sbirka] = -1;
      s.addv(s.random(10), 'sm-v-sbirka');
      s.addm(s.random(7), 'sm-m-namaloval');
      if (s.vars(R.mic)[R.mic_beha] === 1) {
        s.addv(s.random(7), 'sm-v-marnost');
        s.addm(s.random(7), 'sm-m-proc');
        s.addv(s.random(7), 'sm-v-podivej');
        s.addd(s.random(7), 'sm-x-meduza', 101, (val) => (s.vars(R.meduza)[R.meduza_keca] = val));
      }
    }
  }

  // ---- meduza (jellyfish): bobs the ball while parked 3 cells above it ----
  {
    const me = s.vars(R.meduza);
    const it = s.item(R.meduza);
    const mic = s.item(R.mic);
    if (me[R.meduza_keca] !== 101) {
      if (it.x === mic.x && it.y === mic.y - 3) {
        s.vars(R.mic)[R.mic_beha] = 1;
        it.afaze = (it.afaze + 1) % 3;
      } else {
        s.vars(R.mic)[R.mic_beha] = 0;
      }
    } else {
      s.vars(R.mic)[R.mic_beha] = 0;
    }
  }

  // ---- mic (ball): spins while bobbed ----
  {
    const it = s.item(R.mic);
    if (s.vars(R.mic)[R.mic_beha] === 1) it.afaze = (it.afaze + 1) % 4;
  }

  // ---- meduza1/2, stonozka, uhor: occasional idle flicker ----
  if (s.random(100) < 20) s.item(R.meduza2).afaze = s.random(2);
  if (s.random(100) < 20) s.item(R.meduza1).afaze = s.random(2);
  if (s.random(100) < 5) s.item(R.stonozka).afaze = s.random(2);

  // ---- ostnatec (pufferfish): peeks out on a kukuc timer ----
  {
    const os = s.vars(R.ostnatec);
    const it = s.item(R.ostnatec);
    if (os[R.ostnatec_kukuc]! > 0 && it.afaze !== 0) {
      os[R.ostnatec_kukuc]!--;
    } else if (os[R.ostnatec_kukuc] === 0) {
      os[R.ostnatec_kukuc] = s.nah(10, 30);
      it.afaze = 0;
    } else if (s.random(100) < 1) {
      it.afaze = s.random(2) + 1;
    } else {
      it.afaze = 0;
    }
  }

  if (s.random(100) < 5) s.item(R.uhor).afaze = s.random(2);

  // ---- budik (alarm clock): tick face + looping tiktak sound ----
  {
    const it = s.item(R.budik);
    switch (s.count % 9) {
      case 0:
        it.afaze = 0;
        break;
      case 5:
        it.afaze = 1;
        break;
    }
    if (!s.playing(940)) s.sndcyc('sm-x-tiktak', 940);
  }
}

export const SMETAK: RoomScript = { name: 'SMETAK', init, prog };
