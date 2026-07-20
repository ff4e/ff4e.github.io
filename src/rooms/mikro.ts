/**
 * MIKRO ("Closed Society", room 33) — a faithful port of MIKRO_InitProgramky /
 * MIKRO_Programky (URoom.pas:6176-6255, 13562-13844).
 *
 * A gossipy micro-community. Four crabs (krab1 = 12, krab2 = 10, krab3 = 9,
 * krab4 = 8) twitter over each other (`talk mik-x-stebet` at priorities 101..104),
 * each getting bolder (`drzej`) the more it chatters. Once all four are chattering
 * at once (`vsichni`) the big fish shushes them (`okrikla` → KSnd(101..104), a
 * telling-off, and a cooldown before they resume). A horse (kun = 5), a little
 * fish (rybusa = 6), a cuttlefish (sepie = 7) and a snail (snek = 11) idle through
 * their own afaze cycles; the fish also remark on the roller obstacle, the swimming
 * fish and the horse. Uses existing primitives only.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_okrikla: 1,
  room_maxdrzost: 2,
  room_kuk: 3,
  room_kobyla: 4,
  room_prekazka: 5,
  room_okriknuti: 6,
  room_vsichni: 7,
  malar: 1, // little fish
  velkar: 2, // big fish
  valec: 3,
  kun: 5,
  kun_pauza: 1,
  rybusa: 6,
  rybusa_pauza: 1,
  sepie: 7,
  sepie_pozice: 1,
  sepie_mrk: 2,
  krab4: 8,
  krab3: 9,
  krab2: 10,
  snek: 11,
  snek_pauza: 1,
  krab1: 12,
  // crab var slots are the same in every crab: drzej=1, keca=2
  drzej: 1,
  keca: 2,
} as const;

function init(s: Script): void {
  const v = s.vars(R.room, 7);
  v[R.room_okrikla] = 0;
  v[R.room_maxdrzost] = 20;
  v[R.room_kuk] = 0;
  v[R.room_kobyla] = 0;
  v[R.room_prekazka] = 0;
  v[R.room_okriknuti] = 2;
  v[R.room_vsichni] = 0;

  s.vars(R.kun, 1)[R.kun_pauza] = s.random(10);
  s.vars(R.rybusa, 1)[R.rybusa_pauza] = s.random(50);
  const se = s.vars(R.sepie, 2);
  se[R.sepie_mrk] = 0;
  se[R.sepie_pozice] = 0;
  for (const c of [R.krab4, R.krab3, R.krab2, R.krab1]) {
    const cv = s.vars(c, 2);
    cv[R.drzej] = 1;
    cv[R.keca] = 0;
  }
  s.vars(R.snek, 1)[R.snek_pauza] = 3;
}

/** One chattering crab (URoom.pas:13699+). `threshold` is the random ceiling (crab 1
 *  is shyer at 300, the rest 200); `others` are the three peers whose simultaneous
 *  chatter triggers the room-wide `vsichni` shush flag. */
function crabTwitter(s: Script, idx: number, prior: number, threshold: number, others: readonly number[]): void {
  const cv = s.vars(idx);
  const it = s.item(idx);
  cv[R.keca] = s.talking(prior) ? 1 : 0;

  if (cv[R.keca] === 0 && s.random(threshold) < cv[R.drzej]!) {
    if (others.every((o) => s.vars(o)[R.keca] === 1)) s.vars(R.room)[R.room_vsichni] = 1;
    s.talkNow('mik-x-stebet' + s.random(4), prior);
    cv[R.drzej]!++;
    cv[R.keca] = 1;
  }

  if (cv[R.keca] === 1) it.afaze = s.random(2) * 2;
  else it.afaze = 0;
  if (s.random(100) < 5) it.afaze++;

  if (s.vars(R.room)[R.room_okrikla] === 1) cv[R.drzej] = 1;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room: the roller remark + the shushing state machine + creature banter ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    const valec = s.item(R.valec);
    if (valec.x === 7 && valec.y === 9 && valec.dir === Dir.no && v[R.room_prekazka] === 0) {
      switch (s.random(2)) {
        case 0:
          s.addv(0, 'mik-v-sakra');
          break;
        case 1:
          s.addv(s.random(4), 'mik-v-projet');
          break;
      }
      v[R.room_prekazka] = 1;
    } else if (v[R.room_okrikla] !== 1 && v[R.room_vsichni] === 1) {
      switch (s.random(v[R.room_okriknuti]!)) {
        case 0:
          s.addv(s.random(5), 'mik-v-ticho0');
          break;
        case 1:
          s.addv(s.random(5), 'mik-v-ticho1');
          break;
        case 2:
          s.addv(s.random(5), 'mik-v-ticho2');
          break;
      }
      s.addset((val) => (s.vars(R.room)[R.room_okrikla] = val), 1);
    } else if (v[R.room_okrikla] === 1) {
      s.ksnd(101);
      s.ksnd(102);
      s.ksnd(103);
      s.ksnd(104);
      v[R.room_vsichni] = 0;
      switch (s.random(7)) {
        case 0:
          s.addm(20 + s.random(15), 'mik-m-krab');
          if (s.random(100) < 50) s.addm(s.random(6), 'mik-m-poust');
          break;
        case 1:
          s.addm(10 + s.random(25), 'mik-m-tusit');
          break;
        case 2:
        case 3:
        case 4:
          switch (s.random(2)) {
            case 0:
              s.addv(10 + s.random(15), 'mik-v-proto');
              break;
            case 1:
              s.addv(10 + s.random(15), 'mik-v-tak');
              break;
          }
          if (v[R.room_okriknuti] === 3) {
            switch (s.random(6)) {
              case 0:
                s.addm(6 + s.random(5), 'mik-m-nezlob');
                break;
              case 1:
                s.addm(10 + s.random(25), 'mik-m-myslit');
                break;
              case 2:
                s.addm(s.random(5), 'mik-m-nezlob');
                s.addm(5 + s.random(15), 'mik-m-myslit');
                break;
            }
          }
          v[R.room_okriknuti] = 3;
          break;
      }
      v[R.room_okrikla] = 0;
      for (const c of [R.krab1, R.krab2, R.krab3, R.krab4]) s.vars(c)[R.drzej] = 0;
      s.adddel(s.random(20) + 30);
      for (const c of [R.krab1, R.krab2, R.krab3, R.krab4]) {
        s.addset((val) => (s.vars(c)[R.drzej] = val), 1);
      }
    } else if (
      s.lookAt(R.malar, R.rybusa) &&
      s.item(R.rybusa).afaze > 0 &&
      s.random(100) < 10 &&
      v[R.room_kuk] === 0
    ) {
      s.addm(s.random(5), 'mik-m-proc');
      s.addv(s.random(5), 'mik-v-videt');
      v[R.room_kuk] = 1;
    } else if (
      s.lookAt(R.malar, R.kun) &&
      v[R.room_kobyla] === 0 &&
      (s.item(R.malar).y === s.item(R.kun).y || s.item(R.malar).y === s.item(R.kun).y + 1) &&
      s.xdist(R.malar, R.kun) < 2 &&
      s.item(R.kun).dir === Dir.no &&
      s.random(200) < 1
    ) {
      s.addm(0, 'mik-m-konik');
      v[R.room_kobyla] = 1;
    }
  }

  // ---- kun (horse): idle head-toss afaze cycle on a pause timer ----
  {
    const kv = s.vars(R.kun);
    const it = s.item(R.kun);
    if (kv[R.kun_pauza]! > 0) {
      kv[R.kun_pauza]!--;
    } else {
      switch (it.afaze) {
        case 0:
          it.afaze = s.random(2) + 2;
          kv[R.kun_pauza] = 10 - it.afaze + s.random((5 - it.afaze) * 20);
          break;
        case 1:
          it.afaze = s.random(4);
          kv[R.kun_pauza] = 10 + s.random(10);
          break;
        case 2:
          kv[R.kun_pauza] = s.random(150);
          if (kv[R.kun_pauza]! < 20) it.afaze = 3;
          else it.afaze = 1;
          break;
        case 3:
          it.afaze = 0;
          kv[R.kun_pauza] = s.random(20);
          break;
      }
    }
  }

  // ---- rybusa (little fish): idle afaze cycle ----
  {
    const rv = s.vars(R.rybusa);
    const it = s.item(R.rybusa);
    if (rv[R.rybusa_pauza]! > 0) {
      rv[R.rybusa_pauza]!--;
    } else {
      switch (it.afaze) {
        case 0:
          it.afaze = 1;
          rv[R.rybusa_pauza] = 10 + s.random(20);
          break;
        case 1:
          it.afaze = s.random(4);
          if (it.afaze === 0) rv[R.rybusa_pauza] = 20 + s.random(100);
          else rv[R.rybusa_pauza] = 10 + s.random(5);
          break;
        case 2:
          it.afaze = 1 + s.random(2) * 2;
          rv[R.rybusa_pauza] = 10 + s.random(5);
          break;
        case 3:
          it.afaze = 1 + s.random(2);
          rv[R.rybusa_pauza] = 10 + s.random(5);
          break;
      }
    }
  }

  // ---- sepie (cuttlefish): random pose + blink composited into afaze ----
  {
    const se = s.vars(R.sepie);
    if (s.random(7) < 4) se[R.sepie_pozice] = s.random(3);
    if (s.random(10) < 4) se[R.sepie_mrk] = s.random(2);
    s.item(R.sepie).afaze = se[R.sepie_mrk]! * 3 + se[R.sepie_pozice]!;
  }

  // ---- the four chattering crabs ----
  crabTwitter(s, R.krab4, 104, 200, [R.krab1, R.krab2, R.krab3]);
  crabTwitter(s, R.krab3, 103, 200, [R.krab1, R.krab2, R.krab4]);
  crabTwitter(s, R.krab2, 102, 200, [R.krab1, R.krab3, R.krab4]);

  // ---- snek (snail): idle afaze cycle on a pause timer ----
  {
    const sv = s.vars(R.snek);
    const it = s.item(R.snek);
    if (sv[R.snek_pauza]! > 0) {
      sv[R.snek_pauza]!--;
    } else {
      switch (it.afaze) {
        case 0:
          it.afaze = s.random(2) * 2;
          break;
        case 1:
          it.afaze = s.random(4);
          break;
        case 2:
          it.afaze = 1 + 2 * s.random(2);
          break;
        case 3:
          it.afaze = s.random(3);
          break;
      }
      sv[R.snek_pauza] = s.random(20) + 5;
    }
  }

  crabTwitter(s, R.krab1, 101, 300, [R.krab2, R.krab3, R.krab4]);
}

export const MIKRO: RoomScript = { name: 'MIKRO', init, prog };
