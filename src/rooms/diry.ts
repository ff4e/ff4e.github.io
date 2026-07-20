/**
 * DIRY ("Uneven Pavement", room 24) — a faithful port of DIRY_InitProgramky /
 * DIRY_Programky (URoom.pas:5206-5271, 10003-10207).
 *
 * A hall of a stone RULER (vladce, item 5) who periodically recites a two-part
 * announcement ("dir-hs-uvod<n>" + a never-repeating "dir-hs-konec<n>" chosen via
 * a 9-bit used-mask), sometimes echoed by the fish. His face runs a rich
 * expression state machine (`ksichty`): DIRY only drives the "talking" states
 * 1..4, but the machine also implements the smile/wink/cheer sequences 10..22 that
 * the sibling VITEJTE1 room uses — ported here in full so it can be shared later.
 * Also: a small idle face (xichtik, 8) and a pushable OCTOPUS (chobot, 20) that
 * squelches when shoved, waves its tentacles, and opens its eyes when a fish is
 * directly above it. malar (22) / velkar (23) are the little / big fish.
 */
import type { RoomScript, Script } from '../core/script.js';
import { Dir } from '../core/dir.js';
import { vladceKsichtyFrame } from './vladce.js';

const R = {
  room: 0,
  room_pocetrad: 1,
  room_kdydalsi: 2,
  room_posluvod: 3,
  room_konce: 4,
  vladce: 5,
  vladce_ksichty: 1,
  vladce_faze: 2,
  xichtik: 8,
  chobot: 20,
  chobot_chapadla: 1,
  chobot_oci: 2,
  chobot_akcnost: 3,
  chobot_lastdir: 4,
  malar: 22, // little fish
  velkar: 23, // big fish
} as const;

const KONCE_ALL = 0x1ff; // 511: all nine "konec" lines used
const digit = (n: number): string => String.fromCharCode(48 + n);

/**
 * DIRY's ruler face: idle picks a talking sub-state when the voice starts, then
 * the shared ksichty machine animates it (URoom.pas:10044-10156). Bracketed by
 * inc(afaze)/dec(afaze) so a branch assigning afaze:=N shows frame N-1.
 */
function vladceFace(s: Script, idx: number, voicePrior: number): void {
  const it = s.item(idx);
  const v = s.vars(idx);
  it.afaze++;
  if (v[R.vladce_ksichty] === 0) {
    if (s.playing(voicePrior)) v[R.vladce_ksichty] = s.random(4) + 1;
  } else {
    vladceKsichtyFrame(s, idx, R.vladce_ksichty, R.vladce_faze, voicePrior);
  }
  it.afaze--;
}

function init(s: Script): void {
  const v = s.vars(R.room, 4);
  v[R.room_pocetrad] = 0;
  v[R.room_kdydalsi] = s.random(200) + 200;
  v[R.room_posluvod] = s.random(5);
  v[R.room_konce] = 0;

  const vl = s.vars(R.vladce, 2);
  vl[R.vladce_ksichty] = 0;
  vl[R.vladce_faze] = 0;

  const ch = s.vars(R.chobot, 4);
  ch[R.chobot_lastdir] = Dir.no;
  ch[R.chobot_oci] = 0;
  ch[R.chobot_chapadla] = 0;
  ch[R.chobot_akcnost] = 2;
}

function prog(s: Script): void {
  const v = s.vars(R.room);

  // ---- room: the ruler's periodic two-part announcement ----
  if (s.noDialog() && s.alive('little') && s.alive('big')) {
    if (v[R.room_kdydalsi]! > 0) v[R.room_kdydalsi]!--;
    if (v[R.room_kdydalsi] === 0) {
      v[R.room_pocetrad]!++;
      v[R.room_kdydalsi] = (s.random(200) + 100) * (v[R.room_pocetrad]! + 2);

      let pom1 = s.random(4);
      if (pom1 === v[R.room_posluvod]) pom1 = 4;
      v[R.room_posluvod] = pom1;
      s.addd(20, 'dir-hs-uvod' + digit(pom1), 302);

      // Pick a "konec" line whose bit is not yet set in `konce`; reset once all 9 used.
      if (v[R.room_konce] !== KONCE_ALL) {
        do {
          pom1 = s.random(9);
        } while (((1 << pom1) & v[R.room_konce]!) !== 0);
      } else {
        v[R.room_konce] = 0;
        pom1 = s.random(9);
      }
      v[R.room_konce]! |= 1 << pom1;
      s.addd(0, 'dir-hs-konec' + digit(pom1), 302);

      // Occasionally a fish echoes with a "rada" (row) remark.
      if (v[R.room_pocetrad]! >= 5) pom1 = s.random(6);
      else pom1 = s.random(v[R.room_pocetrad]! + 1);
      s.adddel(s.random(10));
      if (pom1 > 0) {
        switch (s.random(2)) {
          case 0:
            s.addm(0, 'dir-m-rada' + digit(pom1 - 1));
            break;
          case 1:
            s.addv(0, 'dir-v-rada' + digit(pom1 - 1));
            break;
        }
      }
    }
  }

  // ---- vladce (ruler face) ----
  vladceFace(s, R.vladce, 302);

  // ---- xichtik (small idle face) ----
  {
    const it = s.item(R.xichtik);
    if (s.random(1000) < 5) it.afaze = s.random(3);
  }

  // ---- chobot (octopus): squelch when shoved, wave tentacles, open eyes near a fish ----
  {
    const it = s.item(R.chobot);
    const cv = s.vars(R.chobot);

    if (it.dir !== Dir.no) cv[R.chobot_akcnost] = 7;
    else if (cv[R.chobot_akcnost]! > 2 && s.count % 5 === 0) cv[R.chobot_akcnost]!--;

    if (it.dir !== cv[R.chobot_lastdir]) {
      if (!s.playing(301)) {
        // The original DIRY code calls bare 'chob-p'/'chob1..3', but those names do
        // NOT exist — DIRY's own package (024.fft) ships the octopus SFX as
        // 'k1-chob-*' (the same assets KAJUTA1's byte-identical octopus uses). The
        // shipped game forgot the 'k1-' prefix here, so the original octopus is
        // silent (Search fails, no loose chob*.wav to fall back to). We use the
        // packaged names so the octopus actually squelches, as the data intends.
        if (it.dir === Dir.down) s.snd('k1-chob-p', 301);
        else if (it.dir !== Dir.no) {
          switch (s.random(3)) {
            case 0:
              s.snd('k1-chob-1', 301);
              break;
            case 1:
              s.snd('k1-chob-2', 301);
              break;
            case 2:
              s.snd('k1-chob-3', 301);
              break;
          }
        }
      }
      cv[R.chobot_lastdir] = it.dir;
    }

    if (it.dir === Dir.no && s.count % cv[R.chobot_akcnost]! === 0) {
      if (s.random(2) === 0) {
        if (cv[R.chobot_chapadla]! < 2) cv[R.chobot_chapadla]!++;
        else cv[R.chobot_chapadla] = 0;
      } else {
        if (cv[R.chobot_chapadla]! > 0) cv[R.chobot_chapadla]!--;
        else cv[R.chobot_chapadla] = 2;
      }
    }

    let pomb1 =
      (s.xdist(R.malar, R.chobot) === 0 &&
        s.ydist(R.malar, R.chobot) <= 0 &&
        s.ydist(R.malar, R.chobot) > -2) ||
      (s.xdist(R.velkar, R.chobot) === 0 &&
        s.ydist(R.velkar, R.chobot) <= 0 &&
        s.ydist(R.velkar, R.chobot) > -2);
    pomb1 = pomb1 || it.dir !== Dir.no;

    if (pomb1) cv[R.chobot_oci] = 1;
    switch (cv[R.chobot_oci]) {
      case 0:
        if (s.random(100) < 5) cv[R.chobot_oci] = 2;
        break;
      case 2:
        if (s.random(100) < 7) cv[R.chobot_oci] = 0;
        break;
      case 1:
        if (!pomb1 && s.random(100) < 20) cv[R.chobot_oci] = 0;
        break;
    }
    it.afaze = cv[R.chobot_oci]! + 3 * cv[R.chobot_chapadla]!;
  }
}

export const DIRY: RoomScript = { name: 'DIRY', init, prog };
