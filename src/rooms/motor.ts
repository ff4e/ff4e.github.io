/**
 * MOTOR ("Brm... Brm...", room 54) — a faithful port of MOTOR_InitProgramky /
 * MOTOR_Programky (URoom.pas:7084-7140, 16789-16941).
 *
 * Turning the key (klicek = 1) into the motor (motorek = 2) starts the engine: it
 * drones (`mot-x-motor`) and the WHOLE VIEW judders in a circle (the original moves the
 * OS window Left/Top; the port traces the same circle on the canvas via
 * `s.screenOffset`, radius `polomer`, angle roompole[0]/20·π advanced every 3rd tick
 * while running). The fish comment on the engine, the key, and being unable to move
 * while it runs; edge-detected on/off (`zapnula`/`vypnula`) tags which fish did it.
 *
 * NEW engine feature: the circular screen wobble (Script.screenOffset, applied by the
 * host draw transform, reset per room).
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';

const POLOMER = 20; // wobble radius in display px (the original derives it from window size)
const MALA = 1;
const VELKA = 2;

const R = {
  wall: 0,
  wall_startleft: 1,
  wall_starttop: 2,
  wall_polomer: 3,
  wall_uvod: 4,
  wall_omotoru: 5,
  wall_oklici: 6,
  wall_vypnula: 7,
  wall_zapnula: 8,
  wall_jeli: 9,
  klicek: 1,
  motorek: 2,
  malar: 3, // little fish
  malar_vylezla: 1,
  velkar: 4, // big fish
  velkar_vylezla: 1,
  klicisko: 11,
} as const;

const digit = (n: number): string => String.fromCharCode(48 + n);
const aktRole = (s: Script): number => (s.aktivni() === 'little' ? MALA : VELKA);

function init(s: Script): void {
  const v = s.vars(R.wall, 9);
  v[R.wall_startleft] = 0;
  v[R.wall_starttop] = 0;
  v[R.wall_polomer] = POLOMER;

  switch (s.pokus) {
    case 1:
      v[R.wall_uvod] = 2;
      break;
    case 2:
      v[R.wall_uvod] = 1;
      break;
    default:
      v[R.wall_uvod] = 3 + s.random(2);
      break;
  }

  if (s.roompole[1] === 0) v[R.wall_omotoru] = s.random(50) + 30;
  else v[R.wall_omotoru] = s.random(200) + 50 * s.pokus;

  v[R.wall_oklici] = 0;
  v[R.wall_vypnula] = -1;
  v[R.wall_zapnula] = -1;
  v[R.wall_jeli] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.wall);
  const running =
    s.item(R.klicek).x + 2 === s.item(R.motorek).x && s.item(R.klicek).y - 2 === s.item(R.motorek).y;

  if (running) {
    v[R.wall_vypnula] = 0;
    if (v[R.wall_zapnula] === 0) {
      s.clearDialog();
      v[R.wall_zapnula] = aktRole(s);
    }
    s.roompole[1] = 1;
    if (!s.playing(10)) s.sndcyc('mot-x-motor', 10);
    if (s.count % 3 === 0) s.roompole[0]!++;
  } else {
    v[R.wall_zapnula] = 0;
    if (v[R.wall_vypnula] === 0) {
      v[R.wall_vypnula] = aktRole(s);
      s.clearDialog();
    }
    if (s.playing(10)) s.ksnd(10);
  }

  // The circular screen judder (URoom.pas: Left/Top on a circle of radius polomer).
  if (s.count % 3 === 0) {
    const a = (s.roompole[0]! / 20) * Math.PI;
    const r = v[R.wall_polomer]!;
    s.screenOffset.x = -Math.round(r * Math.sin(a));
    s.screenOffset.y = Math.round(r * Math.cos(a)) - r;
  }

  // ---- room dialogue ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.wall_omotoru]! > 0) v[R.wall_omotoru]!--;
    if (
      v[R.wall_omotoru]! >= 0 &&
      (s.vars(R.malar)[R.malar_vylezla] === 1 || s.vars(R.velkar)[R.velkar_vylezla] === 1)
    ) {
      v[R.wall_omotoru] = -1;
    }

    if (v[R.wall_uvod]! > 0) {
      s.adddel(s.random(50) + 10);
      switch (v[R.wall_uvod]) {
        case 1:
          s.addm(0, 'mot-m-info');
          s.addv(s.random(10), 'mot-v-konvencni');
          break;
        case 2:
          s.addm(0, 'mot-m-tak');
          s.addv(s.random(10), 'mot-v-zavery');
          break;
        case 3:
          if (s.random(2) === 0) s.addm(0, 'mot-m-info');
          else s.addm(0, 'mot-m-tak');
          if (s.random(2) === 0) s.addv(s.random(10), 'mot-v-konvencni');
          else s.addv(s.random(10), 'mot-v-zavery');
          break;
      }
      v[R.wall_uvod] = 0;
    } else if (v[R.wall_omotoru] === 0) {
      v[R.wall_omotoru] = -1;
      switch (s.roompole[1]) {
        case 0:
          s.addm(30, 'mot-m-akce' + digit(s.random(3)));
          s.addv(s.random(10), 'mot-v-funkce' + digit(s.random(3)));
          break;
        case 1:
          s.addv(30, 'mot-v-znovu' + digit(s.random(2)));
          break;
      }
    }

    if (
      v[R.wall_oklici] === 0 &&
      s.aktivni() === 'little' &&
      s.item(R.klicisko).dir !== Dir.no &&
      s.random(100) < 7
    ) {
      v[R.wall_oklici] = 1;
      if (s.random(100) < 35) {
        s.addv(5, 'mot-v-klic');
        s.addm(7, 'mot-m-ublizit');
      }
    } else if (v[R.wall_zapnula]! > 0) {
      let pom1: number;
      if (v[R.wall_jeli] === 0) pom1 = 1;
      else pom1 = s.random(4);
      v[R.wall_jeli] = 1;

      switch (pom1) {
        case 1:
        case 2:
          switch (v[R.wall_zapnula]) {
            case MALA:
              s.addv(s.random(20) + 10, 'mot-v-zvuky' + digit(s.random(2)));
              if (pom1 === 1) s.addm(s.random(10) + 10, 'mot-m-nemuzu' + digit(s.random(2)));
              break;
            case VELKA:
              s.addm(s.random(20) + 10, 'mot-m-zvuky' + digit(s.random(2)));
              s.addv(s.random(10) + 10, 'mot-v-nemuzu' + digit(s.random(2)));
              break;
          }
          break;
        case 3:
          s.addm(s.random(30) + 20, 'mot-m-mayday');
          break;
      }
      v[R.wall_zapnula] = -1;
    } else if (v[R.wall_vypnula]! > 0) {
      if (v[R.wall_jeli] === 1 || s.random(100) < 60) {
        switch (v[R.wall_vypnula]) {
          case MALA:
            s.addv(s.random(10) + 5, 'mot-v-konecne' + digit(s.random(2)));
            break;
          case VELKA:
            s.addm(s.random(10) + 5, 'mot-m-konecne' + digit(s.random(2)));
            break;
        }
      }
      if (v[R.wall_jeli] === 1) v[R.wall_jeli] = 2;
      v[R.wall_vypnula] = -1;
    }
  }

  // ---- klicek (the key): wiggles while the engine runs ----
  {
    const it = s.item(R.klicek);
    if (s.playing(10)) {
      if (it.afaze === 2) it.afaze = 0;
      else it.afaze++;
    } else if (it.afaze === 1) {
      it.afaze = 2;
    }
  }

  // ---- malar/velkar: note when a fish has climbed out ----
  if (s.item(R.malar).x === 35) s.vars(R.malar)[R.malar_vylezla] = 1;
  if (s.item(R.velkar).x === 8) s.vars(R.velkar)[R.velkar_vylezla] = 1;
}

export const MOTOR: RoomScript = { name: 'MOTOR', init, prog };
