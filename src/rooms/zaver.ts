/**
 * ZAVER ("At Home", room 71) — the endgame finale. A faithful port of
 * ZAVER_InitProgramky / ZAVER_Programky (URoom.pas:8847-8875, 23420-23619).
 *
 * A scripted cutscene, not interactive play: the fish arrive home, the narrator
 * announces the total time played (a spoken Czech hour-count assembled from cas_hry),
 * then the two fish are telepathically walked to their armchairs (natvrdo possession),
 * exchange a few words, and the game ends (konec -> onWin). Player input is locked for
 * the duration (zavermode). A little blob (pldik) burbles in the corner throughout.
 *
 * The credits-sequence visual effects (morph/CreatePalette/pretoc) live OUTSIDE this
 * room script and are not referenced here — nothing is deferred for ZAVER itself, other
 * than exact cross-session playtime (cas_hry is session-scoped in the port).
 */
import type { RoomScript, Script } from '../core/script.js';

const R = {
  zaver: 0,
  zaver_uvod: 1,
  zaver_hlaska: 2,
  zaver_cas: 3,
  zidlev: 2,
  malar: 4,
  velkar: 5,
  pldik: 7,
  pldik_cinnost: 1,
  pldik_oci: 2,
  pldik_suckani: 3,
  pldik_suckfaze: 4,
} as const;

const MALA = 1;
const VELKA = 2;
const istr = (n: number): string => String(n);

function init(s: Script): void {
  const v = s.vars(R.zaver, 3);
  v[R.zaver_uvod] = 0;
  v[R.zaver_hlaska] = 0;
  s.zavermode = true;

  const p = s.vars(R.pldik, 4);
  p[R.pldik_cinnost] = 0;
  p[R.pldik_oci] = 0;
  p[R.pldik_suckani] = 0;
}

function prog(s: Script): void {
  const v = s.vars(R.zaver);

  if (v[R.zaver_uvod] === 0) {
    v[R.zaver_uvod] = 1;
    s.addv(20, 'z-v-doma');
    s.addm(10, 'z-m-pocit');
    s.addd(s.random(10) + 5, 'bar-x-suckano', 202, (val) => (s.vars(R.pldik)[R.pldik_cinnost] = val));
    s.addv(s.random(20) + 10, 'z-v-sef');
    s.addm(5, 'z-m-nemluv');
    s.addv(2, 'z-v-slyset');
    s.addm(6, 'z-m-netusi');
    s.addd(5, 'z-c-konkretne', 10);
    s.adddel(3);
    s.addset((val) => (v[R.zaver_hlaska] = val), 1);
  } else if (v[R.zaver_uvod] === 2) {
    v[R.zaver_uvod] = 3;
    s.adddel(5);
    s.addset((val) => (s.tvrdaryba = val), MALA);
    s.addset((val) => (s.tvrdex = val), 14);
    s.addset((val) => (s.tvrdey = val), 16);
    s.addset((val) => (s.natvrdo = val), 1);
    s.addm(5, 'z-m-dlouho');
    s.addset((val) => s.setBusy('big', val), 1);
    s.addv(10, 'z-v-pozdrav');
    s.addset((val) => s.setBusy('little', val), 1);
    s.addset((val) => s.setBusy('big', val), 0);
    s.addset((val) => s.setBusy('little', val), 1);
    s.addset((val) => (s.tvrdaryba = val), VELKA);
    s.addset((val) => (s.tvrdex = val), 15);
    s.addset((val) => (s.tvrdey = val), 15);
    s.addm(5, 'z-m-oblicej');
    s.addset((val) => (s.natvrdo = val), 1);
    s.addv(0, 'z-v-forky');
    s.adddel(2);
    s.addset((val) => s.setBusy('big', val), 1);
    s.addset((val) => s.setBusy('little', val), 1);
    s.addd(2, 'z-o-blahoprejeme', 3);
    s.adddel(20);
    s.addset((val) => {
      if (val) s.onWin?.(); // konec:=1 — the game is complete
    }, 1);
  }

  if (v[R.zaver_hlaska] === 1) {
    v[R.zaver_cas] = Math.round(s.casHry * 24);
    s.globtit = istr(v[R.zaver_cas]!);
  }

  // The narrator speaks the hour count one word-token per tick (waits on prior line).
  if (v[R.zaver_hlaska]! >= 1 && !s.talking(10)) {
    let pom1 = v[R.zaver_hlaska]!;
    v[R.zaver_hlaska]!++;
    const cas = v[R.zaver_cas]!;
    if (cas >= 1000) {
      if (cas >= 2000) {
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-' + istr(Math.floor(cas / 1000)), 10);
      }
      if ([2, 3, 4].includes(Math.floor(cas / 1000))) {
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-tisice', 10);
      } else {
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-tisic', 10);
      }
    }
    switch (Math.floor((cas % 1000) / 100)) {
      case 0:
        break;
      case 1:
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-100', 10);
        break;
      case 2:
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-200', 10);
        break;
      case 3:
      case 4:
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-' + istr(Math.floor((cas % 1000) / 100)), 10);
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-sta', 10);
        break;
      default:
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-' + istr(Math.floor((cas % 1000) / 100)), 10);
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-set', 10);
        break;
    }
    if (cas % 100 < 20 && cas % 100 > 0) {
      pom1--;
      if (pom1 === 0) s.talkNow('z-c-' + istr(cas % 100), 10);
    } else if (cas % 100 >= 20) {
      pom1--;
      if (pom1 === 0) s.talkNow('z-c-' + istr(Math.floor((cas % 100) / 10) * 10), 10);
      if (cas % 10 > 0) {
        pom1--;
        if (pom1 === 0) s.talkNow('z-c-' + istr(cas % 10), 10);
      }
    }
    pom1--;
    if (pom1 === 0) {
      v[R.zaver_hlaska] = 0;
      s.talkNow('z-c-hodin', 10);
      v[R.zaver_uvod] = 2;
    }
  }

  // ----- pldik: the burbling blob in the corner -----
  {
    const it = s.item(R.pldik);
    const p = s.vars(R.pldik);
    switch (p[R.pldik_cinnost]) {
      case 0:
        if (s.random(1000) < 5) p[R.pldik_cinnost] = 1;
        if (s.random(100) < 5) {
          p[R.pldik_oci] = s.random(5);
          if (p[R.pldik_oci]! > 0) p[R.pldik_oci]!++;
        }
        if (p[R.pldik_suckani] === 0 && s.random(100) < 2) {
          p[R.pldik_suckani] = s.random(5) + 1;
          p[R.pldik_suckfaze] = 0;
        }
        break;
      case 1:
        if (s.random(1000) < 10) p[R.pldik_cinnost] = 0;
        p[R.pldik_oci] = 6;
        if (p[R.pldik_suckani] === 0 && s.random(100) < 2) {
          p[R.pldik_suckani] = s.random(4) + 1;
          p[R.pldik_suckfaze] = 0;
        }
        break;
      case 201:
        if (!s.playing(201)) p[R.pldik_cinnost] = 0;
        p[R.pldik_oci] = 1;
        if (p[R.pldik_suckani] === 0) {
          p[R.pldik_suckani] = 1000;
          p[R.pldik_suckfaze] = 0;
        }
        break;
      case 202:
        if (!s.playing(202)) p[R.pldik_cinnost] = 0;
        p[R.pldik_oci] = 0;
        if (p[R.pldik_suckani] === 0) {
          p[R.pldik_suckani] = 1000;
          p[R.pldik_suckfaze] = 0;
        }
        break;
    }

    it.afaze = p[R.pldik_oci]! * 2;
    if (s.random(100) < 5) it.afaze = 12;

    if (p[R.pldik_suckani]! > 0) {
      switch (p[R.pldik_suckfaze]) {
        case 0:
          if (p[R.pldik_cinnost]! < 200)
            s.snd('bar-x-suck' + String.fromCharCode(s.random(4) + 48), 251);
          break;
        case 1:
        case 2:
        case 3:
          it.afaze++;
          break;
        case 5:
          p[R.pldik_suckani]!--;
          break;
      }
      p[R.pldik_suckfaze] = (p[R.pldik_suckfaze]! + 1) % 6;
    }
  }
}

export const ZAVER: RoomScript = { name: 'ZAVER', init, prog };
