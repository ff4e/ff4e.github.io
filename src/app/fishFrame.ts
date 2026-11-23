/**
 * Which sprite frame each fish shows this tick — `KresliRybu`'s frame selection.
 *
 * DOM-free, including everything it imports: it reads the live room and the
 * per-fish animation state from `gameState.ts` and nothing from the document, so a
 * host without a browser can import it instead of restating it. `test/fishFrame.test.ts`
 * holds that line.
 */
import { Dir } from '../core/dir.js';
import { TURN_FRAMES } from '../core/stepEngine.js';
import {
  type FishFrame,
  TL_ZAKLAD,
  TL_PLAV,
  TL_OTOCKA,
  TL_NAHORU,
  TL_DOLU,
  TL_MLUVI_NA,
  darkBodyFrame,
  HL_TLACI,
  HL_MRK,
  HL_MLUVI,
} from '../render/renderRoom.js';
import { blink, count, darkFlicker, engine, poslMluv, room } from './gameState.js';

/** Head frame (URoom.pas:25756-25760): talking mouth > pushing > blink > default face. */
function headFor(which: 'little' | 'big', tlaci: boolean): number {
  if (poslMluv[which] !== -1) return HL_MLUVI[poslMluv[which]]!;
  if (tlaci) return HL_TLACI;
  // xicht (URoom.pas:25759-25760): a room-set face wins over the idle blink; only
  // a neutral face (xicht=0) shows the occasional blink.
  const face = room ? room.xicht[which] : 0;
  if (face !== 0) return face;
  if (blink[which] > 0) return HL_MRK;
  return 0;
}

/** KresliRybu frame selection (URoom.pas:25658-25760), per fish. */
export function fishFrameFor(which: 'little' | 'big'): FishFrame {
  const phase = engine?.phase ?? 'idle';
  const activeAnimFish = engine?.activeAnimFish ?? 'little';
  const animFrame = engine?.animFrame ?? 0;
  const exiting = engine?.exiting ?? null;
  // gspec=2 darkness (URoom.pas:25746-25748): overrides every other body state —
  // the fish is a dark silhouette (tl_tma) that winks out while turning or on a
  // ~6% per-tick flicker. No head overlay (BMh stays nil).
  if (room?.gspec === 2) {
    const turning = phase === 'turn' && activeAnimFish === which;
    return { bodyFrame: darkBodyFrame(turning || darkFlicker[which]), headFrame: 0 };
  }
  const moving = phase === 'move' && activeAnimFish === which && room !== null;
  if (moving) {
    const dir = room!.items[which === 'little' ? room!.littleIdx : room!.bigIdx]!.dir;
    const tagr = count % 6; // tl_plav cycles per game tick during the swim
    const bodyFrame =
      dir === Dir.up ? TL_NAHORU[tagr]! : dir === Dir.down ? TL_DOLU[tagr]! : TL_PLAV[tagr]!;
    return { bodyFrame, headFrame: headFor(which, room!.tlaceno) };
  }
  if (phase === 'turn' && activeAnimFish === which) {
    const tf = Math.min(Math.floor(animFrame / (TURN_FRAMES / 3)), 2);
    return { bodyFrame: TL_OTOCKA[tf]!, headFrame: 0 }; // otocka: no head
  }
  if (phase === 'kuk' && activeAnimFish === which) {
    // stav_kuk (URoom.pas:25693-25698): the peek-at-player pose — body turned to face
    // the user (tl_otocka[1]) with the head hidden (otocka).
    return { bodyFrame: TL_OTOCKA[0]!, headFrame: 0 };
  }
  if (phase === 'exit' && exiting?.which === which) {
    const tagr = count % 6;
    const bodyFrame =
      exiting.dir === Dir.up ? TL_NAHORU[tagr]! : exiting.dir === Dir.down ? TL_DOLU[tagr]! : TL_PLAV[tagr]!;
    return { bodyFrame, headFrame: 0 };
  }
  // Resting: a `busy` fish is turned to its partner (tl_mluvi_na body, head baked in);
  // otherwise idle body + a talking/blink/default head overlay (URoom.pas:25750-25760).
  const busy = room ? (which === 'little' ? room.busy.little : room.busy.big) === 1 : false;
  if (busy) {
    const bodyFrame = poslMluv[which] !== -1 ? TL_MLUVI_NA[poslMluv[which]]! : TL_OTOCKA[0]!;
    return { bodyFrame, headFrame: 0 };
  }
  const fazer = Math.floor(count / 8) % 3; // gentle idle cycle
  return { bodyFrame: TL_ZAKLAD[fazer]!, headFrame: headFor(which, false) };
}
