/**
 * The room walk — ONE traversal deciding what is drawn, in what order, at what
 * coordinates. A faithful port of TRoom.Priprav (URoom.pas:26167-26283).
 *
 * Replayed by both renderers: `renderInto` (renderRoom.ts, native px into a
 * palette-indexed `CompositeTarget`) and `AiRoom.drawInto` (roomAi.ts, ×S into an RGBA
 * `AiTarget`). They used to encode these rules twice, independently — and hand-copied
 * game rules are what drifts: see `dissolveKeeps` in aiTarget.ts for the inequality that
 * shipped through a green gate because both copies were wrong the same way. They now
 * differ only in `RoomWalkSink`, the shape glCommon.ts already set for GlScreen and
 * GlAiScreen: share the mechanics, keep the classes apart.
 *
 * Deliberately NOT shared, because these genuinely differ:
 *
 *   - the target families — `CompositeTarget` is paletted and native, `AiTarget` RGBA at
 *     ×S. Unifying them needs stubs whose semantics mean nothing on the other side.
 *   - the background paint — different art containers, and the `ai` tier has no gspec=42.
 *   - the spec=1 mirror, the ONE effect reading the composited plane back
 *     (framebuffer.ts:145,154); the `ai` tier masks off its own sprite instead. The walk
 *     supplies the anchor, each sink reflects its own way.
 *   - the fishing hooks, faithful-only. They stay in `renderInto` rather than becoming an
 *     optional method, so this walk carries no "does this sink do hooks?" branch.
 *
 * Scale is NOT a parameter here: the walk emits native coordinates, exactly as
 * `ArtSource.drawItem` always took them, and the `ai` sink multiplies on the way out.
 */
import { Dir, DX_DIR, DY_DIR } from '../core/dir.js';
import type { Room, Item } from '../core/room.js';
import type { FfrBitmap } from '../data/ffr.js';

/** Grid cell size in native game pixels (URoom.pas: fsize). */
export const FSIZE = 15;

/** Which Tela body frame and Hlavy head frame to draw for a fish (headFrame 0 = no overlay). */
export interface FishFrame {
  bodyFrame: number;
  headFrame: number;
}

/** tl_zaklad (URoom.pas:380): the idle body frames; [0] is the resting pose. */
export const TL_ZAKLAD = [1, 2, 3] as const;

/** The resting pose, used when the host supplied no animation and in the gspec=5 bonus. */
export const BASE_FRAME: FishFrame = { bodyFrame: TL_ZAKLAD[0], headFrame: 0 };

/**
 * The spec=1 mirror's position and art, captured during the item pass and handed to the
 * sink after every item is drawn (KresliSpec ordering, URoom.pas:25890-25903).
 * `item`/`index` are carried because the `ai` sink needs them to find the mirror's own
 * ×S sprite, from which it derives the glass mask.
 */
export interface MirrorAnchor {
  readonly item: Item;
  readonly index: number;
  readonly bmp: FfrBitmap;
  readonly x: number;
  readonly y: number;
}

/**
 * What a renderer must supply to be walked. Every method receives NATIVE coordinates:
 * `sx`/`sy` are the item's slide offset, so the element's origin is
 * `(item.x * FSIZE + sx, item.y * FSIZE + sy)`.
 */
export interface RoomWalkSink {
  /** Wall over the water-wobbled background, or the gspec=2 darkness fill. Drawn first. */
  background(room: Room, count: number): void;
  /** KresliObjekt: item `index` at its slid position. */
  item(room: Room, item: Item, index: number, sx: number, sy: number): void;
  /** KresliRybu: a fish at its slid position, in the given animation frame. */
  fish(room: Room, which: 'little' | 'big', item: Item, sx: number, sy: number, frame: FishFrame): void;
  /** KresliZrcadlo: reflect the composited scene across the mirror, after all items. */
  mirror(room: Room, at: MirrorAnchor): void;
  /** KresliDvojlano: the ZDVIZ elevator's double cable, in the sampled palette colour. */
  rope(room: Room, x1: number, y1: number, x2: number, y2: number, col: number): void;
}

/**
 * Walk the room once and emit it to `sink`.
 *
 * `count` is the engine frame counter (drives the water displacement), `slide` the
 * in-flight move progress in [0,1], and `fishAnim` the host-computed body/head frames
 * (absent ⇒ the resting pose).
 */
export function walkRoom(
  sink: RoomWalkSink,
  room: Room,
  count: number,
  slide: number,
  fishAnim: { little: FishFrame; big: FishFrame } | undefined,
): void {
  sink.background(room, count);

  // gspec=5 (WIN bonus level, URoom.pas:26259-26260): the animated fish body is drawn
  // for the YOUNG fish (StartLittle/StartBig) — who sit still — while the controlled
  // "old" fish (littleIdx/bigIdx) are drawn as their plain item sprites. Outside the
  // bonus these both point at the same fish. Dropping `fishAnim` in the bonus is what
  // keeps the (elsewhere controlled) old pair's live animation off the young bodies.
  const bigFishIdx = room.gspec === 5 ? room.startBig : room.bigIdx;
  const littleFishIdx = room.gspec === 5 ? room.startLittle : room.littleIdx;
  const anim = room.gspec === 5 ? undefined : fishAnim;

  // specs[] anchors (KresliSpec, URoom.pas:25890-25903): effects drawn on top of the
  // items. spec=1 = mirror; spec=3 gear + spec=4 lift = the ZDVIZ elevator rope.
  // Captured at their slid positions during the item pass, applied after it.
  let mirror: MirrorAnchor | null = null;
  let gear: { bmp: FfrBitmap; x: number; y: number } | null = null;
  let lift: { x: number; y: number } | null = null;

  for (let j = 1; j <= room.itemCount; j++) {
    const it = room.items[j]!;
    // Visibility (Priprav, URoom.pas:26251): normally an item with spec=11 is hidden
    // (LODE's on-demand falling-ship sprite, PARTY window figures); `it.visible` covers
    // other room-toggled cases. In a gspec=2 "darkness" room (CHODBA) the rule flips:
    // only the two fish and items with spec=2 (the guard dogs' glowing eyes) are lit —
    // everything else is swallowed by the dark, regardless of spec/visible.
    if (room.gspec === 2) {
      if (it.spec !== 2 && j !== room.littleIdx && j !== room.bigIdx) continue;
    } else if (it.spec === 11 || !it.visible) {
      continue;
    }
    const shift = it.dir !== Dir.no ? Math.round(slide * FSIZE) : 0;
    const sx = shift * DX_DIR[it.dir]!;
    const sy = shift * DY_DIR[it.dir]!;
    if (it.spec === 1) {
      const bmp = room.bitmaps[it.bmp + it.afaze];
      if (bmp) mirror = { item: it, index: j, bmp, x: it.x * FSIZE + sx, y: it.y * FSIZE + sy };
    } else if (it.spec === 3) {
      const bmp = room.bitmaps[it.bmp]; // gear pulley (no afaze)
      if (bmp) gear = { bmp, x: it.x * FSIZE + sx, y: it.y * FSIZE + sy };
    } else if (it.spec === 4) {
      lift = { x: it.x * FSIZE + sx, y: it.y * FSIZE + sy }; // the cabin below
    }
    if (j === bigFishIdx) sink.fish(room, 'big', it, sx, sy, anim?.big ?? BASE_FRAME);
    else if (j === littleFishIdx) sink.fish(room, 'little', it, sx, sy, anim?.little ?? BASE_FRAME);
    else sink.item(room, it, j, sx, sy);
  }

  // The mirror reflection (KresliSpec spec=1 -> KresliZrcadlo, URoom.pas:25822): the
  // fish drawn to the mirror's left are reflected across it, in place.
  if (mirror) sink.mirror(room, mirror);

  // The elevator cable, after the mirror — KresliSpec's spec=3 case (URoom.pas:25896):
  // a double rope from the gear pulley (x+58, y+27) to the lift top (x+43, y), coloured
  // by the pixel sampled from the gear bitmap at (col 1, row 58).
  if (gear && lift) {
    const ci = 58 * gear.bmp.w + 1;
    const col = ci < gear.bmp.pixels.length ? gear.bmp.pixels[ci]! : 0;
    sink.rope(room, gear.x + 58, gear.y + 27, lift.x + 43, lift.y, col);
  }
}
