/**
 * WIN ("Favorites", room 68) — a faithful port of WIN_InitProgramky / WIN_Programky
 * (URoom.pas:7406-7460, 17936-18099) plus the bonus-level swap ZapniBonusLevel /
 * VypniBonusLevel (URoom.pas:7700-7730... actually 23700-23730).
 *
 * The desktop "Favorites" room. Its centrepiece is a hidden BONUS LEVEL: when the big
 * fish reaches the bonus tile, control swaps from the young fish (StartLittle/StartBig)
 * to the ELDERLY fish (staramala/staravelka) and gspec flips to 5; you walk the old fish
 * to the exit (x=1), which rescues them and swaps control back (VypniBonusLevel). The
 * room also chatters about the desktop (notepad, windows, the "steel" VGA hole, etc.).
 *
 * DEFERRED (cosmetic): the exact gspec=5 render (which draws the young fish via the
 * animated fish body and the old fish as static sprites, URoom.pas:26227-26260) is not
 * yet ported — the port currently renders whichever pair is `littleIdx/bigIdx` (the old
 * fish, in the bonus) with the normal fish body. Gameplay (control swap + rescue) is
 * faithful; the sprite inversion is a deferred render-pass task.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { Kind } from '../data/ffr.js';

const R = {
  room: 0,
  room_resit: 1,
  room_umrela: 2,
  room_navrhy: 3,
  room_poslnavrh: 4,
  room_odire: 5,
  room_onotepadu: 6,
  room_ooknech: 7,
  room_obonusu: 8,
  room_obordelu: 9,
  room_ooceli: 10,
  room_hlasky: 11,
  room_nhlasek: 12,
  bonuslevel: 4,
  malar: 10,
  velkar: 11,
  notepad: 12,
  notepad_napsano: 1,
  staravelka: 32,
  staramala: 33,
  budik: 38,
  spuntik: 39,
} as const;

/** ZapniBonuslevel (URoom.pas:23700): enter the bonus level — control the old fish. */
function zapniBonus(s: Script): void {
  s.room.facingRight.little = true;
  s.room.facingRight.big = true;
  s.room.gspec = 5;
  s.item(R.spuntik).x = 1;
  s.item(R.spuntik).y = 29;
  s.room.littleIdx = R.staramala;
  s.item(R.staramala).kind = Kind.little;
  s.room.bigIdx = R.staravelka;
  s.item(R.staravelka).kind = Kind.big;
  s.item(R.bonuslevel).kind = Kind.static;
}

/** VypniBonuslevel (URoom.pas:23716): leave the bonus level — restore the young fish. */
function vypniBonus(s: Script): void {
  s.room.gspec = 0;
  s.item(R.spuntik).x = s.item(R.bonuslevel).x;
  s.item(R.spuntik).y = s.item(R.bonuslevel).y + 9;
  s.item(R.staramala).kind = Kind.light;
  s.item(R.staravelka).kind = Kind.light;
  s.room.facingRight.little = true;
  s.room.facingRight.big = true;
  s.room.bigIdx = s.room.startBig;
  s.room.littleIdx = s.room.startLittle;
  s.item(R.bonuslevel).kind = Kind.heavy;
}

function init(s: Script): void {
  const v = s.vars(R.room, 12);
  s.room.gspec = 0;
  v[R.room_resit] = 0;
  v[R.room_umrela] = 0;
  vypniBonus(s); // VypniBonusLevel: normal-play item kinds + spuntik position
  v[R.room_navrhy] = s.random(500) + 200;
  v[R.room_poslnavrh] = 4;
  v[R.room_odire] = 0;
  v[R.room_onotepadu] = 0;
  v[R.room_ooknech] = 0;
  v[R.room_obonusu] = 0;
  v[R.room_obordelu] = 0;
  v[R.room_ooceli] = 0;
  v[R.room_hlasky] = s.random(100) + 20;
  v[R.room_nhlasek] = 0;

  s.vars(R.notepad, 1)[R.notepad_napsano] = 0;
  s.item(R.staravelka).spec = 0;
  s.item(R.staramala).spec = 0;
  s.item(R.spuntik).spec = 11;
}

function roomBlock(s: Script): void {
  const v = s.vars(R.room);

  // Enter the bonus level: big fish (facing right) reaches the bonus tile.
  if (v[R.room_resit] === 0 && s.alive('little') && s.alive('big')) {
    if (
      s.item(R.velkar).x + 4 === s.item(R.bonuslevel).x &&
      s.facingRight('big') &&
      s.item(R.velkar).y >= s.item(R.bonuslevel).y - 1
    ) {
      v[R.room_resit] = 1;
      s.roompole[1] = 1;
      v[R.room_obonusu] = 0;
      zapniBonus(s);
      s.setBusy('big', 1);
      s.setBusy('little', 1);
      if (s.pokus === 1) {
        s.addv(0, 'win-v-pockej');
        s.addm(2, 'win-m-zavrene');
      }
      s.addset((val) => s.setBusy('little', val), 0);
      s.addset((val) => s.setBusy('big', val), 0);
      if (s.pokus < 3 || s.random(100) < 40) {
        s.addv(5, 'win-v-osvobodit');
        s.addm(10, 'win-m-ven');
        s.addv(0, 'win-v-citim');
        s.addm(s.random(10) + 5, 'win-m-vzit');
      }
      s.addv(5, 'win-v-nehrajem');
    }
  }

  // Exit the bonus level: both old fish reached the rescue point (x=1).
  if (v[R.room_resit] === 1) {
    if (s.item(R.staramala).x === 1 && s.item(R.staravelka).x === 1) {
      v[R.room_resit] = 2;
      vypniBonus(s);
    }
  }

  // In the bonus level, a comment if one old fish is left behind (dead, not out).
  if (
    s.room.gspec === 5 &&
    v[R.room_umrela] === 0 &&
    s.alive('little') &&
    !s.alive('big') &&
    !s.venku('big')
  ) {
    v[R.room_umrela] = 1;
    s.addm(5, 'win-m-jejda');
  } else if (
    s.room.gspec === 5 &&
    v[R.room_umrela] === 0 &&
    s.alive('big') &&
    !s.alive('little') &&
    !s.venku('little')
  ) {
    v[R.room_umrela] = 1;
    s.addv(5, 'win-v-real');
  }

  // Desktop chatter — only in normal play (gspec=0).
  if (s.noDialog() && s.room.gspec === 0 && s.alive('little') && s.alive('big')) {
    if (v[R.room_navrhy]! > 0) v[R.room_navrhy]!--;
    if (v[R.room_hlasky]! > 0) v[R.room_hlasky]!--;

    if (v[R.room_navrhy] === 0) {
      v[R.room_navrhy] = s.random(1500) + 200;
      let pom1 = s.random(4);
      if (v[R.room_poslnavrh] === pom1) pom1 = 4;
      s.addm(30, 'win-m-costim' + String.fromCharCode(48 + pom1));
      s.adddel(30);
    } else if (v[R.room_ooceli] === 0 && s.dist(R.malar, R.bonuslevel) <= 1) {
      v[R.room_ooceli] = 1;
      s.addm(5, 'win-m-vga');
    } else if (v[R.room_hlasky] === 0) {
      let pom1 = s.random(5);
      v[R.room_nhlasek]!++;
      v[R.room_hlasky] = s.random(300) + 300;
      if (s.roompole[0] === 0 && v[R.room_nhlasek] === 2) pom1 = 0;
      switch (pom1) {
        case 0:
          if (v[R.room_obonusu] === 0) {
            v[R.room_obonusu] = 1;
            s.addm(10, 'win-m-okno');
            s.addv(8, 'win-v-hra');
            s.addm(s.random(10) + 10, 'win-m-chodila');
            s.addv(2, 'win-v-nic0');
            s.addm(2, 'win-m-nic1');
            s.addv(2, 'win-v-nic2');
            s.addm(5, 'win-m-nic3');
            s.addv(s.random(10) + 10, 'win-v-hav');
            if (s.roompole[1] === 0) s.addm(s.random(30) + 10, 'win-m-zahrat');
          }
          break;
        case 1:
          if (v[R.room_onotepadu] === 0) {
            v[R.room_onotepadu] = 1;
            s.addm(10, 'win-m-blok');
            s.adddel(s.random(15) + 5);
            s.addset((val) => (s.vars(R.notepad)[R.notepad_napsano] = val), 1);
            s.adddel(s.random(15) + 5);
            s.addset((val) => (s.vars(R.notepad)[R.notepad_napsano] = val), 2);
            s.adddel(s.random(15) + 5);
            s.addset((val) => (s.vars(R.notepad)[R.notepad_napsano] = val), 3);
            s.adddel(s.random(15) + 5);
            s.addset((val) => (s.vars(R.notepad)[R.notepad_napsano] = val), 4);
            s.addv(10, 'win-v-premyslej');
          }
          break;
        case 2:
          if (v[R.room_odire] === 0) {
            v[R.room_odire] = 1;
            s.addm(30, 'win-m-dira');
            s.addv(3, 'win-v-tamhle');
          }
          break;
        case 3:
          if (v[R.room_ooknech] === 0) {
            v[R.room_ooknech] = 1;
            s.addv(20, 'win-v-pocitala');
            s.addm(5, 'win-m-nemusim');
          }
          break;
        case 4:
          if (v[R.room_obordelu] === 0) {
            v[R.room_obordelu] = 1;
            s.addv(30, 'win-v-plocha');
          }
          break;
      }
    }
  }

  s.stdHlaskySmrti = s.room.gspec !== 5;
}

function prog(s: Script): void {
  roomBlock(s);

  s.item(R.bonuslevel).afaze = s.room.gspec === 5 ? 1 : 0;

  s.item(R.notepad).afaze =
    s.vars(R.notepad)[R.notepad_napsano]! * 2 + Math.floor((s.count % 10) / 5);

  // The rescued old fish: once one reaches the exit (x=bonuslevel.x or x=1), hide+park it.
  {
    const it = s.item(R.staravelka);
    if (it.x === s.item(R.bonuslevel).x || it.x === 1) {
      it.spec = 11;
      it.x = 1;
      it.y = 24;
    }
  }
  {
    const it = s.item(R.staramala);
    if (it.x === s.item(R.bonuslevel).x || it.x === 1) {
      it.spec = 11;
      it.x = 1;
      it.y = 27;
    }
  }
}

export const WIN: RoomScript = { name: 'WIN', init, prog };
