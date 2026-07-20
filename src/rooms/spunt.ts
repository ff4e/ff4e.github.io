/**
 * SPUNT ("And How It Was", room 29) — a faithful port of SPUNT_InitProgramky /
 * SPUNT_Programky (URoom.pas:7603-7673, 18475-18731).
 *
 * The City branch's closer, and a `gspec=9` "push it out" room: instead of getting
 * the fish out, you win by shoving the CORK (spunt, item 1) off the edge (Spec9
 * marks it, the host slides it off and wins once `vytlacit` hits 0). The two fish
 * (velkar=3=big, malar=4=little — note the swapped order) grumble about being sent
 * to plug the leak on a long timed dialogue schedule. Decor: two sleepy crabs
 * (krab1=7, krab2=16) with idle eye animation, two peeking snails (snecik1=12,
 * snecik2=17), and three chattering wall heads (hlava1=19, hlava2=18, hlava3=11)
 * whose mouth (huba) opens on a ksicht timer. StdKrajniHlaska gives the "push it
 * out!" edge hint. Uses only existing primitives + the gspec=9 host support.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const R = {
  room: 0,
  room_uvod: 1,
  room_vratit: 2,
  room_nechat: 3,
  room_zatraceny: 4,
  spunt: 1,
  velkar: 3, // big fish
  malar: 4, // little fish
  krab1: 7,
  krab1_oci: 1,
  krab1_spi: 2,
  hlava3: 11,
  hlava3_ksicht: 1,
  hlava3_huba: 2,
  snecik1: 12,
  snecik1_kouka: 1,
  krab2: 16,
  krab2_oci: 1,
  krab2_spi: 2,
  snecik2: 17,
  snecik2_kouka: 1,
  hlava2: 18,
  hlava2_ksicht: 1,
  hlava2_huba: 2,
  hlava1: 19,
  hlava1_ksicht: 1,
  hlava1_huba: 2,
} as const;

/** One sleepy crab (krab1/krab2 are identical): dozes on a `spi` timer, else
 *  occasionally shifts its eyes (oci) or blinks (afaze 1). */
function crab(s: Script, idx: number, ociSlot: number, spiSlot: number): void {
  const it = s.item(idx);
  const v = s.vars(idx);
  if (it.afaze === 1 && v[spiSlot]! > 0) {
    v[spiSlot]!--;
    it.afaze = 1;
  } else if (v[spiSlot] === 0) {
    v[spiSlot] = s.nah(2, 70);
    it.afaze = v[ociSlot]!;
  } else if (s.random(100) < 5) {
    v[ociSlot] = s.random(5);
    if (v[ociSlot]! > 0) v[ociSlot] = v[ociSlot]! + 1;
  } else if (s.random(100) > 97) {
    it.afaze = 1;
  } else {
    it.afaze = v[ociSlot]!;
  }
}

/** One peeking snail (snecik1/snecik2): pops out (afaze up to 2) for a while after
 *  being nudged, then retracts. */
function snail(s: Script, idx: number, koukaSlot: number): void {
  const it = s.item(idx);
  const v = s.vars(idx);
  if (it.dir !== Dir.no) v[koukaSlot] = s.random(100) + 10;
  else if (v[koukaSlot]! > 0) v[koukaSlot]!--;
  if (v[koukaSlot]! > 0) {
    if (it.afaze < 2) it.afaze++;
  } else if (it.afaze > 0) {
    it.afaze--;
  }
}

/** One chattering wall head (hlava1/2/3): its mouth (huba) opens for a spell on a
 *  ksicht countdown, otherwise closed (afaze 0). */
function head(s: Script, idx: number, ksichtSlot: number, hubaSlot: number): void {
  const it = s.item(idx);
  const v = s.vars(idx);
  if (v[hubaSlot] !== 0 && v[ksichtSlot]! > 0) {
    v[ksichtSlot]!--;
    it.afaze = v[hubaSlot]!;
  } else if (v[ksichtSlot] === 0) {
    v[ksichtSlot] = s.nah(10, 100);
    v[hubaSlot] = 0;
  } else if (s.random(1000) < 3) {
    v[hubaSlot] = s.random(2) + 1;
  } else {
    it.afaze = 0;
  }
}

function init(s: Script): void {
  s.room.gspec = 9; // "push the cork out" room
  const v = s.vars(R.room, 4);
  v[R.room_uvod] = 0;
  v[R.room_vratit] = 0;
  v[R.room_nechat] = s.nah(1000, 2500);
  v[R.room_zatraceny] = s.nah(2000, 4000);

  const k1 = s.vars(R.krab1, 2);
  k1[R.krab1_oci] = 0;
  k1[R.krab1_spi] = s.nah(2, 70);
  const h3 = s.vars(R.hlava3, 2);
  h3[R.hlava3_huba] = 0;
  h3[R.hlava3_ksicht] = s.nah(10, 100);
  s.vars(R.snecik1, 1)[R.snecik1_kouka] = 0;
  const k2 = s.vars(R.krab2, 2);
  k2[R.krab2_oci] = 0;
  k2[R.krab2_spi] = s.nah(2, 70);
  s.vars(R.snecik2, 1)[R.snecik2_kouka] = 0;
  const h2 = s.vars(R.hlava2, 2);
  h2[R.hlava2_huba] = 0;
  h2[R.hlava2_ksicht] = s.nah(10, 100);
  const h1 = s.vars(R.hlava1, 2);
  h1[R.hlava1_huba] = 0;
  h1[R.hlava1_ksicht] = s.nah(10, 100);
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room: edge hint + the fish's grumbling dialogue schedule ----
  if (s.stdKrajniHlaska()) {
    s.addv(s.random(10) + 5, 'sp-v-ven');
    s.stdKonecKrajniHlasky();
  }

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.room_nechat]! > 0) v[R.room_nechat]!--;
    if (v[R.room_zatraceny]! > 0) v[R.room_zatraceny]!--;

    if (v[R.room_uvod] === 0) {
      if (s.pokus === 1 || s.random(100) < 70) {
        switch (s.random(4)) {
          case 0:
            s.addv(s.nah(20, 30), 'sp-v-no0');
            break;
          case 1:
            s.addm(s.nah(20, 30), 'sp-m-no1');
            break;
          case 2:
            s.addv(s.nah(20, 30), 'sp-v-kdoby');
            break;
          case 3:
            s.addm(s.nah(20, 30), 'sp-m-neopatrnost');
            break;
        }
        s.addv(s.random(10), 'sp-v-zahynuli');
        s.addm(s.random(8), 'sp-m-vytazeny');
        s.addv(s.random(8), 'sp-v-trapne');
      }
      v[R.room_uvod] = 1;
    } else if (v[R.room_vratit] === 0 && s.random(100) < 1) {
      v[R.room_vratit] = 1;
      s.addm(s.random(5), 'sp-m-costim');
      switch (s.random(2)) {
        case 0:
          s.addv(s.random(5), 'sp-v-vratit0');
          s.addm(s.random(5), 'sp-m-vratit0');
          break;
        case 1:
          s.addv(s.random(5), 'sp-v-vratit1');
          s.addm(s.random(5), 'sp-m-vratit1');
          break;
      }
      switch (s.random(4)) {
        case 0:
          s.addm(s.random(5), 'sp-m-kalet');
          s.addv(s.random(5), 'sp-v-pocit');
          s.addm(s.random(5), 'sp-m-potize');
          s.addv(s.random(5), 'sp-v-vzit');
          break;
        case 1:
          s.addm(s.random(5), 'sp-m-potize');
          s.addv(s.random(5), 'sp-v-vzit');
          break;
        case 2:
          s.addm(s.random(5), 'sp-m-kalet');
          s.addv(s.random(5), 'sp-v-vzit');
          break;
        case 3:
          s.addm(s.random(5), 'sp-m-potize');
          s.addv(s.random(5), 'sp-v-pocit');
          break;
      }
      if (s.random(2) === 0) {
        s.addm(s.random(5), 'sp-m-taky');
        s.addv(s.random(5), 'sp-v-dotoho');
      }
    } else if (v[R.room_nechat] === 0) {
      v[R.room_nechat] = s.nah(500, 2000);
      switch (s.random(2)) {
        case 0:
          s.addm(s.random(5), 'sp-m-nechat');
          s.addv(s.random(5), 'sp-v-centrala');
          break;
        case 1:
          s.addv(s.random(5), 'sp-v-jedno');
          s.addm(s.random(5), 'sp-m-vydrz');
          break;
      }
    } else if (v[R.room_zatraceny] === 0) {
      v[R.room_zatraceny] = s.nah(1000, 4000);
      s.addm(s.random(5), 'sp-m-spunt');
      s.addv(s.random(7), 'sp-v-co');
      switch (s.random(5)) {
        case 0:
          s.addm(s.random(7), 'sp-m-vymluva0');
          break;
        case 1:
          s.addm(s.random(7), 'sp-m-vymluva1');
          break;
        case 2:
          s.addm(s.random(7), 'sp-m-vymluva2');
          break;
        case 3:
          s.addm(s.random(7), 'sp-m-vymluva3');
          break;
        case 4:
          s.addm(s.random(7), 'sp-m-vymluva4');
          break;
      }
      if (s.random(2) < 1) s.addv(s.random(7), 'sp-v-nesmysl');
    }
  }

  // ---- the cork: push-it-out win marker (Spec9) ----
  s.spec9(R.spunt, 6, 5);

  // ---- decor ----
  crab(s, R.krab1, R.krab1_oci, R.krab1_spi);
  head(s, R.hlava3, R.hlava3_ksicht, R.hlava3_huba);
  snail(s, R.snecik1, R.snecik1_kouka);
  crab(s, R.krab2, R.krab2_oci, R.krab2_spi);
  snail(s, R.snecik2, R.snecik2_kouka);
  head(s, R.hlava2, R.hlava2_ksicht, R.hlava2_huba);
  head(s, R.hlava1, R.hlava1_ksicht, R.hlava1_huba);
}

export const SPUNT: RoomScript = { name: 'SPUNT', init, prog };
