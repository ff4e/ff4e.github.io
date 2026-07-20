/**
 * The stone RULER's face-frame machine, shared by DIRY (24) and VITEJTE1 (21) —
 * both drive a `vladce` item with the identical `ksichty` (expression) states
 * (URoom.pas:10056-10156 DIRY, 20661-20789 VITEJTE1). Extracted so the two rooms
 * share one copy.
 *
 * This handles ONLY the `ksichty` frame animation for states 1..4 (the mouth
 * flapping while the ruler speaks, keyed off `playing(voicePrior)`) and 10..22
 * (the smile / wink / cheer keyframe sequences). It is a no-op when `ksichty === 0`
 * — each room supplies its own idle/scheduler behaviour around it.
 *
 * IMPORTANT: the caller must bracket this with `it.afaze++` before and `it.afaze--`
 * after (the original's inc(afaze)/case/dec(afaze) wrapper), so a branch assigning
 * `afaze := N` actually shows frame N-1 and an untouched tick holds the frame. The
 * ksichty slot is 1 in both rooms; the faze slot differs (DIRY=2, VITEJTE1=3).
 */
import type { Script } from '../core/script.js';

export function vladceKsichtyFrame(
  s: Script,
  idx: number,
  ksichtySlot: number,
  fazeSlot: number,
  voicePrior: number,
): void {
  const it = s.item(idx);
  const v = s.vars(idx);
  switch (v[ksichtySlot]) {
    case 1:
    case 2:
    case 3:
    case 4:
      if (s.count % 2 === 0) {
        const pom1 = s.playing(voicePrior) ? s.random(3) : 3;
        switch (v[ksichtySlot]) {
          case 1:
            if (pom1 === 0 || pom1 === 3) it.afaze = 1;
            else if (pom1 === 1) it.afaze = 15;
            else if (pom1 === 2) it.afaze = 18;
            break;
          case 2:
            if (pom1 === 0) it.afaze = 4;
            else if (pom1 === 1) it.afaze = 16;
            else if (pom1 === 2) it.afaze = 20;
            else if (pom1 === 3) it.afaze = 1;
            break;
          case 3:
            if (pom1 === 0 || pom1 === 3) it.afaze = 14;
            else if (pom1 === 1) it.afaze = 17;
            else if (pom1 === 2) it.afaze = 19;
            break;
          case 4:
            if (pom1 === 0) it.afaze = 6;
            else if (pom1 === 1) it.afaze = 15;
            else if (pom1 === 2) it.afaze = 18;
            else if (pom1 === 3) it.afaze = 11;
            break;
        }
        if (pom1 === 3) v[ksichtySlot] = 0;
      }
      break;
    case 10:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1) it.afaze = 5;
      else if (v[fazeSlot] === 2) it.afaze = 9;
      else if (v[fazeSlot] === 3) it.afaze = 10;
      else if (v[fazeSlot] === 4) v[ksichtySlot] = 0;
      break;
    case 11:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1) it.afaze = 9;
      else if (v[fazeSlot] === 2) it.afaze = 5;
      else if (v[fazeSlot] === 3) it.afaze = 1;
      else if (v[fazeSlot] === 4) v[ksichtySlot] = 0;
      break;
    case 12:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1) it.afaze = 6;
      else if (v[fazeSlot] === 2) it.afaze = 7;
      else if (v[fazeSlot] === 3) it.afaze = 11;
      else if (v[fazeSlot] === 4) v[ksichtySlot] = 0;
      break;
    case 13:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1) it.afaze = 7;
      else if (v[fazeSlot] === 2) it.afaze = 6;
      else if (v[fazeSlot] === 3) it.afaze = 1;
      else if (v[fazeSlot] === 4) v[ksichtySlot] = 0;
      break;
    case 14:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1) it.afaze = 9;
      else if (v[fazeSlot] === 2) it.afaze = 5;
      else if (v[fazeSlot] === 3) it.afaze = 14;
      else if (v[fazeSlot] === 4) v[ksichtySlot] = 0;
      break;
    case 20:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1) it.afaze = 6;
      else if (v[fazeSlot] === 2 || v[fazeSlot] === 3) it.afaze = 8;
      else if (v[fazeSlot] === 4) it.afaze = 6;
      else if (v[fazeSlot] === 5) v[ksichtySlot] = 0;
      break;
    case 21:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1 || v[fazeSlot] === 3 || v[fazeSlot] === 5) it.afaze = 1;
      else if (v[fazeSlot] === 2) it.afaze = 4;
      else if (v[fazeSlot] === 6) v[ksichtySlot] = 0;
      break;
    case 22:
      v[fazeSlot]!++;
      if (v[fazeSlot] === 1 || v[fazeSlot] === 3 || v[fazeSlot] === 5) it.afaze = 11;
      else if (v[fazeSlot] === 2) it.afaze = 12;
      else if (v[fazeSlot] === 6) v[ksichtySlot] = 0;
      break;
  }
}
