/**
 * RECYCLED ("First Bizarre Things", room 30) — a faithful port of
 * RECYCLED_InitProgramky / RECYCLED_Programky (URoom.pas:8368-8402, 21469-21593).
 *
 * The first weird room of the branch. The two fish (malar = item 6 = little,
 * velkar = item 7 = big) comment on the coral and a steel roller (valec = item 3)
 * that the big fish can hoist. The star is a grumpy sleeping crab (krab = item 5):
 * it dozes (`spi` counter), wakes when the fish loiter nearby (`pobliz`), grumbles
 * a third-speaker line (prior 110), and shuffles its legs / falls (`dopad`). A long
 * timed schedule (`uvod`) sprinkles ambient banter. Uses only existing primitives.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_zvednout: 1,
  room_uvod: 2,
  room_ahojkrabe: 3,
  room_pobliz: 4,
  room_nesahat: 5,
  room_bud: 6,
  room_rozhovor: 7,
  room_veselit: 8,
  valec: 3,
  krab: 5,
  krab_spi: 1,
  krab_dopad: 2,
  malar: 6, // little fish
  velkar: 7, // big fish
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);

function init(s: Script): void {
  const v = s.vars(R.room, 8);
  v[R.room_zvednout] = 0;
  v[R.room_uvod] = s.random(42) + 14;
  v[R.room_ahojkrabe] = 0;
  v[R.room_pobliz] = 0;
  v[R.room_nesahat] = 0;
  v[R.room_bud] = 0;
  v[R.room_rozhovor] = 0;
  v[R.room_veselit] = 0;

  const kr = s.vars(R.krab, 2);
  kr[R.krab_spi] = 0;
  kr[R.krab_dopad] = 10000;
}

function prog(s: Script): void {
  const v = s.vars(R.room);
  const kr = s.vars(R.krab);

  // ---- room: the ambient dialogue chain (one branch per tick) ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (
      v[R.room_zvednout] === 0 &&
      s.dist(R.velkar, R.valec) <= 1 &&
      s.item(R.velkar).dir === Dir.no &&
      s.random(6) === 1 &&
      s.item(R.valec).y > 14
    ) {
      v[R.room_zvednout] = 1;
      s.addv(4, 're-v-ocel');
    } else if (v[R.room_uvod]! <= 0) {
      let pom1 = 0;
      if (kr[R.krab_spi] === 0) {
        switch (s.random(10)) {
          case 1:
          case 2:
            pom1 = 1 + 4;
            break;
          case 3:
          case 4:
            pom1 = 2 + 8;
            break;
          case 5:
            pom1 = 16 + 32;
            break;
          case 6:
            pom1 = 1 + 4 + 32;
            break;
          case 7:
            pom1 = 2 + 8 + 32;
            break;
          case 8:
            pom1 = 1 + 16;
            break;
          case 9:
            pom1 = 2 + 4;
            break;
          case 0:
            pom1 = 16;
            break;
        }
      }
      if ((pom1 & 1) > 0) s.addv(3 + s.random(9), 're-v-koraly0');
      if ((pom1 & 2) > 0) s.addv(3 + s.random(9), 're-v-koraly1');
      if ((pom1 & 4) > 0) s.addm(3 + s.random(9), 're-m-libi0');
      if ((pom1 & 8) > 0) s.addm(3 + s.random(9), 're-m-libi1');
      if ((pom1 & 16) > 0) s.addm(3 + s.random(9), 're-m-libi2');
      if ((pom1 & 32) > 0) s.addv(3 + s.random(9), 're-v-pokoj');
      v[R.room_uvod] = 800 + s.random(300) + s.random(400);
    } else if (v[R.room_ahojkrabe] === 0 && s.dist(R.malar, R.krab) <= 1 && s.random(20) === 1) {
      v[R.room_ahojkrabe] = 1;
      s.addm(1, 're-m-ahoj');
    } else if (kr[R.krab_spi] === 0 && v[R.room_pobliz]! > 20) {
      kr[R.krab_spi] = 1;
    } else if (v[R.room_bud] === 0 && v[R.room_pobliz]! > s.random(800)) {
      v[R.room_bud] = 1;
      s.addd(2, 're-k-budi', 110);
      if (v[R.room_ahojkrabe] === 0 && s.random(2) === 1) {
        v[R.room_ahojkrabe] = 1;
        s.addm(5, 're-m-ahoj');
      }
    } else if (kr[R.krab_dopad]! >= 1 && kr[R.krab_dopad]! <= 10) {
      kr[R.krab_dopad] = 1000;
      s.addd(0, 're-k-au', 110);
    } else if (
      v[R.room_nesahat] === 0 &&
      (s.item(R.krab).dir === Dir.left || s.item(R.krab).dir === Dir.right)
    ) {
      v[R.room_nesahat] = 1;
      if (s.count % 2 === 1) v[R.room_bud] = 1;
      s.addd(0, 're-k-nesahej', 110);
    } else if (v[R.room_pobliz] === s.random(500) + 30) {
      if (v[R.room_pobliz]! % 2 === 1) s.addd(5, 're-k-spim', 110);
      else s.addd(5, 're-k-otravujete', 110);
    } else if (v[R.room_rozhovor] === 0 && v[R.room_pobliz]! > 1 && s.random(333) === 1) {
      v[R.room_rozhovor] = 1;
      s.addm(7, 're-m-uzitecny' + digit(s.random(2)));
      if (s.count % 2 === 1) {
        s.addv(7, 're-v-obejit');
      } else {
        s.addv(6, 're-v-nech');
        s.addv(3, 're-v-nervozni');
      }
    } else if (
      v[R.room_veselit] === 0 &&
      kr[R.krab_spi]! > 0 &&
      s.random(2000 + 100 * s.pokus) <=
        v[R.room_bud]! * 2 + v[R.room_nesahat]! * 2 + v[R.room_ahojkrabe]! + v[R.room_rozhovor]!
    ) {
      v[R.room_veselit] = 1;
      s.addm(10, 're-m-rozveselit');
      s.addv(7, 're-v-nevsimej');
    }
  }

  // These run every tick, regardless of the dialogue gate.
  v[R.room_uvod]!--;
  if (s.dist(R.velkar, R.krab) <= 1 || s.dist(R.malar, R.krab) <= 1) v[R.room_pobliz]!++;
  else v[R.room_pobliz] = 0;
  if (s.count % 3000 === 0) v[R.room_rozhovor] = 0;

  // ---- valec (steel roller): pushing it up counts as the hoist ----
  if (s.item(R.valec).dir === Dir.up) v[R.room_zvednout] = 1;

  // ---- krab (grumpy sleeping crab): doze/wake + leg-shuffle + fall counter ----
  const krab = s.item(R.krab);
  if (s.talking(110)) kr[R.krab_spi] = 1;

  if (kr[R.krab_spi] === 0) {
    if (krab.dir === Dir.no) krab.afaze = 0;
    else kr[R.krab_spi] = 1;
  } else if (s.talking(110)) {
    krab.afaze = (s.count % 4) + 2;
  } else if (krab.dir === Dir.down) {
    krab.afaze = s.random(9) + 1;
  } else {
    switch (s.random(kr[R.krab_spi]!) % 100) {
      case 99:
        kr[R.krab_spi] = 0;
        v[R.room_pobliz] = -14 - s.random(50);
        if (s.random(2) === 1) v[R.room_ahojkrabe] = 0;
        if (s.random(2) === 1) v[R.room_nesahat] = 0;
        if (s.random(2) === 1) v[R.room_bud] = 0;
        break;
      case 20:
      case 21:
      case 22:
      case 23:
      case 24:
      case 25:
        krab.afaze = 0;
        break;
      case 26:
      case 27:
      case 28:
        krab.afaze = s.random(4) + 2;
        break;
      default:
        krab.afaze = 1;
        break;
    }
  }

  if (kr[R.krab_spi]! > 0) kr[R.krab_spi]!++;

  if (krab.dir === Dir.down) kr[R.krab_dopad] = 0;
  else kr[R.krab_dopad]!++;
}

export const RECYCLED: RoomScript = { name: 'RECYCLED', init, prog };
