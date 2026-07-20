/**
 * POTOPENA ("Sunken Ship", room 12) — a faithful port of POTOPENA_InitProgramky /
 * POTOPENA_Programky (URoom.pas:5600-5622, 11537-11635).
 *
 * A dialogue room with position-gated remarks: a randomised intro (a hat exchange),
 * a comment when the big fish reaches the steel door, and remarks as each fish goes
 * "down below". A jellyfish (meduza) idly cycles three frames. Item indices are the
 * generated r_POTOPENA_* values (URoom.pas:3657-3664).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  potop: 0,
  potop_uvod: 1,
  potop_ooceli: 2,
  potop_maladole: 3,
  potop_velkadole: 4,
  malar: 5,
  velkar: 6,
  meduza: 8,
} as const;

function init(s: Script): void {
  const v = s.vars(R.potop, 4);
  v[R.potop_uvod] = 0;
  v[R.potop_ooceli] = 0;
  v[R.potop_maladole] = 0;
  v[R.potop_velkadole] = s.random(2);
}

function prog(s: Script): void {
  const v = s.vars(R.potop);
  const velkar = s.item(R.velkar);
  const malar = s.item(R.malar);

  if (s.alive('little') && s.alive('big') && s.noDialog()) {
    if (v[R.potop_uvod] === 0) {
      s.adddel(s.random(15) + 10);
      switch (s.random(5)) {
        case 0:
          s.addv(0, 'pot-v-slus');
          s.addm(s.random(8), 'pot-m-dik');
          break;
        case 1:
          s.addv(0, 'pot-v-cepic');
          s.addm(s.random(8), 'pot-m-klob');
          break;
        case 2:
          s.addv(0, 'pot-v-hlave');
          s.addm(s.random(8), 'pot-m-zima');
          break;
        case 3:
          s.addm(0, 'pot-m-pujc');
          s.addv(s.random(8), 'pot-v-leda');
          break;
        case 4:
          s.addm(0, 'pot-m-velik');
          s.addv(s.random(8), 'pot-v-kras');
          break;
      }
      if (s.pokus === 1 || s.random(100) < 15) v[R.potop_uvod] = 1;
      else v[R.potop_uvod] = 2;
    } else if (v[R.potop_uvod] === 1) {
      s.addv(20 + s.random(30), 'pot-v-lod');
      s.addm(9, 'pot-m-soud');
      s.addv(2, 'pot-v-jmeno');
      s.adddel(10);
      v[R.potop_uvod] = 2;
    } else if (
      v[R.potop_ooceli] === 0 &&
      ((velkar.x === 16 && velkar.y === 3 && !s.facingRight('big')) ||
        (velkar.x < 16 && velkar.y === 4))
    ) {
      if (s.random(2) === 0) s.addv(0, 'pot-v-pohnu');
      else s.addv(0, 'pot-v-trub');
      if (s.random(2) === 0) s.addm(15, 'pot-m-nezb');
      else s.addm(15, 'pot-m-dovn');
      v[R.potop_ooceli] = 1;
    } else if (v[R.potop_maladole] === 0 && malar.y >= 12 && s.random(100) < 5) {
      if (s.random(2) === 0) s.addm(5, 'pot-m-zatuch');
      else s.addm(5, 'pot-m-moc');
      if (s.random(100) < 50 || s.pokus === 1) s.addv(s.random(10), 'pot-v-plav');
      v[R.potop_maladole] = 1;
    } else if (v[R.potop_velkadole] === 0 && velkar.y > 11) {
      s.addv(s.random(10), 'pot-v-nikdo');
      v[R.potop_velkadole] = 1;
    } else if (
      v[R.potop_velkadole]! < 2 &&
      velkar.y >= 14 &&
      s.facingRight('big') &&
      s.random(100) < 8
    ) {
      if (malar.y < 14 || s.random(100) < 40) {
        s.addm(5, 'pot-m-vidis');
        s.addv(s.random(3), 'pot-v-vidim');
      } else {
        s.addv(5, 'pot-v-ponur');
        s.addm(s.random(5), 'pot-m-hnil');
      }
      v[R.potop_velkadole] = 2;
    }
  }

  s.item(R.meduza).afaze = s.random(3);
}

export const POTOPENA: RoomScript = { name: 'POTOPENA', init, prog };
