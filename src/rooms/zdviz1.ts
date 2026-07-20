/**
 * ZDVIZ1 ("House with an Elevator", room 20) — a faithful port of
 * ZDVIZ1_InitProgramky / ZDVIZ1_Programky (URoom.pas:6069-6128, 13286-13408).
 *
 * The first room of the "City In the Deep" branch. The two fish are house
 * painters riding a large freight elevator (vytah); a rotating gear (stroj)
 * next to the shaft spins with the lift, a little head (hlavicka) bobs in a
 * window, and an old man (dedek) grumbles ("huhu" lines) — his "mluvi" var
 * doubles as the speaking flag driving his mouth (the addd prom-reference sets
 * it to the voice priority while the line plays, 0 when done).
 *
 * NOTE ON THE FISH: the original's look_at(fish,obj) returns false unless `fish`
 * is the little or big fish (URoom.pas:2138), so ZDVIZ1's malar (item 6) and
 * velkar (item 7) ARE the little and big fish respectively — the painters.
 *
 * The gear (stroj, item spec=3) and elevator (vytah, item spec=4) carry cosmetic
 * effect specs (specs[] registration, URoom.pas:25800) that the port does not
 * implement; both still render as ordinary sprites and the gear animates via its
 * script-driven `afaze`, so the room plays correctly. spec is set faithfully.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_lastura: 2,
  room_lebzna: 3,
  room_jizdam: 4,
  room_jizdav: 5,
  room_huhuh: 6,
  vytah: 1,
  stroj: 2,
  shelka: 3,
  hlavicka: 4,
  dedek: 5,
  dedek_mluvi: 1,
  malar: 6, // the little fish
  malar_jede: 1,
  velkar: 7, // the big fish
  velkar_jede: 1,
  llebka: 8,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 6);
  v[R.room_uvod] = 0;
  v[R.room_lebzna] = 0;
  v[R.room_lastura] = 0;
  v[R.room_jizdam] = s.random(15) + 3;
  v[R.room_jizdav] = s.random(50) + 10;
  if (s.pokus > 1) {
    if (s.random(100) < 30) v[R.room_uvod] = 1;
    if (s.random(100) < 50) v[R.room_lastura] = 1;
    if (s.random(100) < 60) v[R.room_lebzna] = 1;
    if (s.random(100) < 20) v[R.room_jizdam] = -1;
    if (s.random(100) < 30) v[R.room_jizdav] = -1;
  }
  v[R.room_huhuh] = 0;

  s.vars(R.vytah, 1);
  s.item(R.vytah).spec = 4;
  s.item(R.stroj).spec = 3;
  s.vars(R.dedek, 1)[R.dedek_mluvi] = 0;
  s.vars(R.malar, 1)[R.malar_jede] = 0;
  s.vars(R.velkar, 1)[R.velkar_jede] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const setDedekMluvi = (x: number) => (s.vars(R.dedek)[R.dedek_mluvi] = x);

  // ---- room dialogue (both painters alive, no active dialogue) ----
  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    // The intro (uvod) is a STANDALONE `if` in the original (URoom.pas:13295-13310,
    // closed with `end;`), so on the tick it fires the lastura..huhu chain below is
    // ALSO evaluated — it is a separate statement, not chained to the intro.
    if (v[R.room_uvod] === 0) {
      s.addv(s.random(20) + 50, 'zd1-v-civil');
      switch (s.roompole[0]) {
        case 0:
          s.addm(s.random(10), 'zd1-m-dolu');
          break;
        case 1:
          s.addm(s.random(10), 'zd1-m-tlac');
          s.roompole[0]!++;
          break;
        case 2:
          if (s.random(2) === 0) s.addm(s.random(10), 'zd1-m-tlac');
          else s.addm(s.random(10), 'zd1-m-dolu');
          break;
      }
      v[R.room_uvod] = 1;
    }

    if (
      v[R.room_lastura] === 0 &&
      s.lookAt(R.malar, R.shelka) &&
      Math.abs(s.ydist(R.malar, R.shelka)) < 3 &&
      s.random(100) < 1
    ) {
      if (s.random(2) === 0) s.addm(0, 'zd1-m-last');
      else s.addm(0, 'zd1-m-poved');
      if (s.random(2) === 0) s.addv(s.random(10), 'zd1-v-talis');
      else s.addv(s.random(3), 'zd1-v-styd');
      v[R.room_lastura] = 1;
    } else if (
      v[R.room_lebzna] === 0 &&
      s.lookAt(R.velkar, R.llebka) &&
      Math.abs(s.ydist(R.velkar, R.llebka)) < 3 &&
      s.random(100) < 1
    ) {
      s.addv(20, 'zd1-v-lebka');
      s.addm(s.random(8), 'zd1-m-stejne');
      v[R.room_lebzna] = 1;
    } else if (s.vars(R.malar)[R.malar_jede] === v[R.room_jizdam]) {
      s.addm(0, 'zd1-m-cesta');
      v[R.room_jizdam] = -1;
    } else if (s.vars(R.velkar)[R.velkar_jede] === v[R.room_jizdav]) {
      s.addv(0, 'zd1-v-krecek');
      s.addm(3, 'zd1-m-slap');
      v[R.room_jizdav] = -1;
    } else if (s.random(1000) < 8) {
      const pom1 = v[R.room_huhuh]!;
      if (v[R.room_huhuh] === 0) v[R.room_huhuh] = s.random(3) + 1;
      else v[R.room_huhuh] = s.random(4) + 1;
      if (pom1 === v[R.room_huhuh]) v[R.room_huhuh] = 5;
      s.addd(5, 'zd1-x-huhu' + digit(v[R.room_huhuh]!), 101, setDedekMluvi);
    }
  }

  // ---- vytah (elevator): latch the intro state the first time it rises ----
  if (s.item(R.vytah).dir === Dir.up) {
    if (s.roompole[0] === 0) s.roompole[0] = 1;
  }

  // ---- stroj (gear): rotate (afaze 0..5) in step with the lift's direction ----
  {
    const stroj = s.item(R.stroj);
    const vytah = s.item(R.vytah);
    if (stroj.x === vytah.x - 1) {
      let pom1: number;
      if (stroj.dir === Dir.no && vytah.dir === Dir.down) pom1 = 2;
      else if (stroj.dir === Dir.up && vytah.dir === Dir.no) pom1 = 1;
      else if (stroj.dir === Dir.no && vytah.dir === Dir.up) pom1 = -1;
      else if (stroj.dir === Dir.down && vytah.dir === Dir.no) pom1 = -2;
      else pom1 = 0;
      stroj.afaze += pom1;
      if (stroj.afaze > 5) stroj.afaze -= 6;
      else if (stroj.afaze < 0) stroj.afaze += 6;
    }
  }

  // ---- hlavicka (little head): occasionally bobs to a new frame ----
  {
    const h = s.item(R.hlavicka);
    if (
      (h.afaze === 0 && s.random(100) < 2) ||
      (h.afaze !== 0 && s.random(100) < 5)
    ) {
      h.afaze = s.random(3);
    }
  }

  // ---- dedek (old man): mouth flaps while his mluvi flag is set ----
  {
    const d = s.item(R.dedek);
    if (s.vars(R.dedek)[R.dedek_mluvi] !== 0) d.afaze = s.random(2) + 1;
    else d.afaze = 0;
  }

  // ---- malar (little painter): count ticks spent riding the lift upward ----
  {
    const m = s.item(R.malar);
    const vytah = s.item(R.vytah);
    if (
      vytah.dir === Dir.up &&
      m.x >= vytah.x &&
      m.x < vytah.x + 4 &&
      m.y > vytah.y &&
      m.y < vytah.y + 6
    ) {
      s.vars(R.malar)[R.malar_jede]!++;
    }
  }

  // ---- velkar (big painter): same, with the big fish's footprint ----
  {
    const b = s.item(R.velkar);
    const vytah = s.item(R.vytah);
    if (
      vytah.dir === Dir.up &&
      b.x >= vytah.x &&
      b.x < vytah.x + 3 &&
      b.y > vytah.y &&
      b.y < vytah.y + 5
    ) {
      s.vars(R.velkar)[R.velkar_jede]!++;
    }
  }
}

export const ZDVIZ1: RoomScript = { name: 'ZDVIZ1', init, prog };
