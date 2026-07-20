/**
 * VES ("A Bit of Music", room 26) — a faithful port of VES_InitProgramky /
 * VES_Programky (URoom.pas:5759-5807, 12166-12414).
 *
 * A stone jukebox: a singing head (hlava, item 4) strikes up ("ves-hs-hrajeme")
 * at count=zac1, then three amplifiers (amp1/2/3 = items 1/2/3) each kick off a
 * looping backing track ('ves-ampliony' at priorities 50/51/52, staggered by the
 * hlava's zac2 timer) and dance through an afaze pattern. The fish can silence the
 * gig by pushing an amp down and releasing it (Dir cycles no->down->no), which
 * kills that amp's loop, plays a smash, and bumps `rozbito`; once enough are
 * broken the head sings its farewell ("ves-hs-papa") and quits. A little crab
 * (krabik, 13) bops while any track plays. Introduces the `musiccyc` primitive
 * (looping music-channel track).
 *
 * The `music_volume` easter egg (fish thank you if you turn the music slider down)
 * is ported faithfully but stays inert: the port has no in-game volume slider, so
 * music_volume is the fixed default (27) and the branch never triggers.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_hlaskam: 1,
  room_hlaskav: 2,
  room_rozbito: 3,
  amp1: 1,
  amp2: 2,
  amp3: 3,
  hlava: 4,
  hlava_stav: 1,
  hlava_zac1: 2,
  hlava_zac2: 3,
  krabik: 13,
} as const;

// Per-amp Vars: stav (state) / faze (dance-pattern cursor).
const STAV = 1;
const FAZE = 2;
/** music_volume default (RSound.pas:36); the port has no volume slider so it is fixed. */
const MUSIC_VOLUME = 27;

/** odd(count div 2): a slow two-frame toggle used by the head's bobbing. */
const slowToggle = (count: number): boolean => Math.floor(count / 2) % 2 === 1;

/**
 * One amplifier's state machine (identical for the three amps aside from their
 * start offset, loop priority, and initial dance phase). stav: 0 wait -> start
 * loop; 1 dancing (until pushed down); 2 pushed down (until released -> smash).
 */
function amp(s: Script, idx: number, prior: number, offset: number, fazeInit: number): void {
  const av = s.vars(idx);
  const it = s.item(idx);
  const zac2 = s.vars(R.hlava)[R.hlava_zac2]!;

  // Defensive re-trigger if the loop somehow isn't sounding (never fires in
  // practice: stav becomes 1 only well after count passes 2+offset).
  if (av[STAV] === 1 && s.count === 2 + offset && !s.playing(prior)) {
    s.musiccyc('ves-ampliony', prior);
  }

  switch (av[STAV]) {
    case 0:
      if (s.count === zac2 + offset) {
        av[FAZE] = fazeInit;
        s.musiccyc('ves-ampliony', prior);
        av[STAV]!++;
      }
      break;
    case 1:
      if (it.dir === Dir.down) {
        av[STAV]!++;
        it.afaze = 7;
      } else if (s.count % 2 === 1) {
        switch (av[FAZE]) {
          case 0:
          case 3:
          case 4:
          case 7:
          case 12:
            it.afaze++;
            break;
          case 1:
          case 6:
          case 9:
          case 10:
            it.afaze--;
            break;
          case 2:
          case 5:
            it.afaze += 2;
            break;
          case 8:
          case 11:
            it.afaze -= 2;
            break;
          case 13:
            av[FAZE] = -1;
            it.afaze = 0;
            break;
        }
        av[FAZE]!++;
      }
      break;
    case 2:
      if (it.dir !== Dir.down) {
        s.ksnd(prior);
        s.snd('sp-smrt', 40);
        it.afaze = 9;
        av[STAV]!++;
        s.vars(R.room)[R.room_rozbito]!++;
      } else if (s.count % 2 === 1) {
        it.afaze = 15 - it.afaze;
      }
      break;
  }
}

function init(s: Script): void {
  const v = s.vars(R.room, 3);
  v[R.room_hlaskam] = 0;
  v[R.room_hlaskav] = 0;
  if (s.roompole[0] === 0) s.roompole[0] = MUSIC_VOLUME;
  v[R.room_rozbito] = 0;

  s.vars(R.amp1, 2)[STAV] = 0;
  const a2 = s.vars(R.amp2, 2);
  a2[STAV] = 0;
  s.item(R.amp2).afaze = 3;
  const a3 = s.vars(R.amp3, 2);
  a3[STAV] = 0;
  s.item(R.amp3).afaze = 6;

  const h = s.vars(R.hlava, 3);
  h[R.hlava_stav] = 0;
  h[R.hlava_zac1] = 30;
  h[R.hlava_zac2] = 65;

  s.item(R.krabik).afaze = 1;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room dialogue ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (s.playing(50) || s.playing(51) || s.playing(52)) {
      if (v[R.room_hlaskam] === 0 && s.random(1000) < 1) {
        v[R.room_hlaskam] = 1;
        s.addm(10, 'ves-m-krab');
      } else if (v[R.room_hlaskav] === 0 && s.random(1000) < 2) {
        v[R.room_hlaskav] = 1;
        switch (s.random(2)) {
          case 0:
            s.addv(10, 'ves-v-veci');
            break;
          case 1:
            s.addv(10, 'ves-v-vyp');
            break;
        }
      } else if (s.roompole[0]! > MUSIC_VOLUME && MUSIC_VOLUME < 16) {
        // inert in the port (no volume slider) — see file header.
        s.roompole[0] = 0;
        s.addm(15, 'ves-m-dik');
        s.addv(s.random(20) + 10, 'ves-v-stejne');
      }
    } else if (v[R.room_rozbito] === 3) {
      v[R.room_rozbito]!++;
      s.addv(10, 'ves-v-pokoj');
    } else if (v[R.room_rozbito] === 5) {
      s.addm(3, 'ves-m-uz');
      v[R.room_rozbito]!++;
    }
  }

  // ---- the three amplifiers ----
  amp(s, R.amp1, 50, 0, 0);
  amp(s, R.amp2, 51, 3, 4);
  amp(s, R.amp3, 52, 5, 6);

  // ---- hlava (singing jukebox head) ----
  {
    const h = s.vars(R.hlava);
    const hl = s.item(R.hlava);
    switch (h[R.hlava_stav]) {
      case 0:
        if (s.count === h[R.hlava_zac1]) {
          h[R.hlava_stav]!++;
          s.snd('ves-hs-hrajeme', 301);
        }
        break;
      case 1:
        if (s.playing(301)) {
          switch (s.random(3)) {
            case 0:
              hl.afaze = 0;
              break;
            case 1:
              hl.afaze = 17;
              break;
            case 2:
              hl.afaze = 14;
              break;
          }
        } else {
          h[R.hlava_stav]!++;
          hl.afaze = 5;
        }
        break;
      case 2:
        if (s.count >= h[R.hlava_zac2]! + 10) h[R.hlava_stav]!++;
        break;
      case 3:
        if (v[R.room_rozbito]! < 3) {
          hl.afaze = slowToggle(s.count) ? 10 : 11;
        } else {
          hl.afaze = 13;
          h[R.hlava_stav]!++;
        }
        break;
      case 51:
        s.talkNow('ves-hs-papa', 302);
        v[R.room_rozbito]!++;
        h[R.hlava_stav] = 100;
        break;
      case 100:
        if (s.playing(302)) {
          hl.afaze = slowToggle(s.count) ? 4 : 18;
        } else {
          v[R.room_rozbito]!++;
          hl.afaze = 5;
          h[R.hlava_stav]!++;
        }
        break;
      default:
        // stav 4..50: a delay counter ticking up toward the farewell (51).
        if (h[R.hlava_stav]! >= 4 && h[R.hlava_stav]! <= 50) h[R.hlava_stav]!++;
        break;
    }
  }

  // ---- krabik (crab): bops while any track plays, else occasionally raises a claw ----
  {
    const kr = s.item(R.krabik);
    if (s.playing(50) || s.playing(51) || s.playing(52) || s.playing(302)) {
      kr.afaze = s.random(5);
      if (kr.afaze === 1) kr.afaze = 5;
    } else if (s.random(20) === 0) {
      kr.afaze = 1;
    }
  }
}

export const VES: RoomScript = { name: 'VES', init, prog };
