/**
 * Enhanced (truecolor) art source.
 *
 * One of the two ArtSource implementations plugged into the single room
 * compositor (renderInto). It draws each element from the FFNG fillets-ng-data
 * truecolor masters, and delegates to the shared classic draw helpers
 * (classicBackground / classicItem / classicFish) for anything with no truecolor
 * form: the gspec=2 darkness fill, gspec=42 ZX band render, gspec=5 WIN bonus,
 * the spec=1 mirror glass (kept classic so the reflection's index hit-test
 * works), a dead fish's skeleton, and any un-mapped item/fish frame. There is no
 * per-room eligibility gate — the compositor is uniform and this source decides,
 * per element, whether it has truecolor art or falls back to classic.
 */
import { FSIZE, classicBackground, classicItem, classicFish } from './renderRoom.js';
import { buildPaletteLut } from './artSource.js';
import { isTruecolorTarget } from './framebuffer.js';
import type { ArtSource } from './artSource.js';
import type { FishFrame } from './renderRoom.js';
import type { CompositeTarget } from './framebuffer.js';
import type { FfrPaletteEntry, FfrBitmap } from '../data/ffr.js';
import type { Room, Item } from '../core/room.js';

/**
 * A room's decoded FFNG truecolor background. `wall`/`bg` are frame arrays
 * indexed by the wall item's `afaze` (usually length 1; STEEL's red-alert cycles
 * multiple wall+bg frames).
 */
export interface EnhancedArt {
  readonly w: number;
  readonly h: number;
  /** Wall layer frames, each straight RGBA (length w*h*4). */
  readonly wall: readonly Uint8Array[];
  /** Background layer frames, each straight RGBA (length w*h*4). */
  readonly bg: readonly Uint8Array[];
}

/** A single decoded object sprite frame (straight RGBA). */
export interface EnhancedSprite {
  readonly w: number;
  readonly h: number;
  readonly rgba: Uint8Array;
}

/** An enhanced object bound to an FFR item index, with its animation frames. */
export interface EnhancedObject {
  /** FFR item index (stable as the item is pushed around). */
  readonly item: number;
  /** Animation frames, indexed by the item's `afaze`. */
  readonly frames: readonly EnhancedSprite[];
}

/** A decoded set of fish sprites: size -> facing -> filename -> sprite. */
export interface FishSprites {
  small: { left: Map<string, EnhancedSprite>; right: Map<string, EnhancedSprite> };
  big: { left: Map<string, EnhancedSprite>; right: Map<string, EnhancedSprite> };
}

/**
 * Port Tela body-frame index -> FFNG body sprite file (TL_ZAKLAD/PLAV/OTOCKA/
 * NAHORU/DOLU/MLUVI_NA). The skeleton (19) and darkness silhouette (23) are
 * intentionally absent - those fall back to the classic pixels.
 */
const FISH_BODY_FILE: Record<number, string> = {
  1: 'body_rest_00.png', 2: 'body_rest_01.png', 3: 'body_rest_02.png',
  4: 'body_swam_00.png', 5: 'body_swam_01.png', 6: 'body_swam_02.png',
  7: 'body_swam_03.png', 8: 'body_swam_04.png', 9: 'body_swam_05.png',
  10: 'body_turn_00.png', 11: 'body_turn_01.png', 12: 'body_turn_02.png',
  13: 'body_vertical_00.png', 14: 'body_vertical_01.png', 15: 'body_vertical_02.png',
  16: 'body_vertical_03.png', 17: 'body_vertical_04.png', 18: 'body_vertical_05.png',
  20: 'body_talk_00.png', 21: 'body_talk_01.png', 22: 'body_talk_02.png',
};

/** Port Hlavy head-frame index -> FFNG head overlay file (HL_TLACI/MRK/MLUVI). */
const FISH_HEAD_FILE: Record<number, string> = {
  1: 'head_pushing.png',
  2: 'head_blink.png',
  5: 'head_talking_01.png',
  6: 'head_talking_02.png',
};

/** Clamp an animation-frame index into a frame array's bounds. */
function frameIndex(afaze: number, len: number): number {
  if (afaze < 0) return 0;
  if (afaze >= len) return len - 1;
  return afaze;
}

export class EnhancedArtSource implements ArtSource {
  readonly lut: Uint8Array;

  constructor(
    palette: readonly FfrPaletteEntry[],
    private readonly art: EnhancedArt | null,
    private readonly objects: readonly EnhancedObject[],
    private readonly fish: FishSprites | null,
  ) {
    this.lut = buildPaletteLut(palette);
  }

  /**
   * FFNG wall over the wobbled FFNG background for a normal room with a
   * dimension-matching master; otherwise the classic background (darkness/ZX/
   * bonus, or a room with no truecolor master).
   */
  paintBackground(screen: CompositeTarget, room: Room, wall: FfrBitmap, bg: FfrBitmap, count: number): void {
    const art = this.art;
    if (
      isTruecolorTarget(screen) &&
      room.gspec === 0 &&
      art !== null &&
      art.w === screen.width &&
      art.h === screen.height
    ) {
      const afaze = room.wallItem.afaze;
      const wf = frameIndex(afaze, art.wall.length);
      const bf = frameIndex(afaze, art.bg.length);
      screen.blit2Rgba(wall, bg, art.wall[wf]!, art.bg[bf]!, room.wallItem.mask, count, room.wamp, room.wper, room.wspd);
      return;
    }
    classicBackground(screen, room, wall, bg, count);
  }

  /**
   * The item's truecolor sprite at its slid screen position, or the classic
   * bitmap when there is no FFNG art for it (darkness/bonus room, the spec=1
   * mirror glass, a fish drawn as an item, or an un-mapped item). FFNG object
   * sprites are stored in their final orientation, so spec=10 items are NOT
   * mirrored here (unlike the classic KresliRev path).
   */
  drawItem(screen: CompositeTarget, room: Room, item: Item, index: number, sx: number, sy: number): void {
    if (
      isTruecolorTarget(screen) &&
      room.gspec !== 2 &&
      room.gspec !== 5 &&
      item.spec !== 1 &&
      item.kind !== 3 &&
      item.kind !== 4
    ) {
      // Match the classic KresliRev flip for spec=10, but only where the FFNG art
      // isn't already staged mirrored. Statically-spec=10 items (initSpec===10,
      // e.g. DRAKAR1's band) have pre-mirrored art → draw as-is; items whose spec
      // toggles to 10 at runtime (initSpec!==10, e.g. PARTY1's window figures)
      // have base art → mirror when spec=10 so they face the classic direction.
      const preMirrored = (item.initSpec ?? item.spec) === 10;
      const mirror = (item.spec === 10) !== preMirrored;
      // An item can map to several stacked sprites (e.g. PARTY1's cabin = body +
      // window glass); draw every one bound to this index, in manifest order.
      let drew = false;
      const x0 = item.x * FSIZE + sx;
      const y0 = item.y * FSIZE + sy;
      for (const obj of this.objects) {
        if (obj.item !== index || obj.frames.length === 0) continue;
        const spr = obj.frames[frameIndex(item.afaze, obj.frames.length)]!;
        screen.blitSpriteRgba(spr.rgba, spr.w, spr.h, x0, y0, mirror);
        drew = true;
      }
      if (drew) return;
    }
    classicItem(screen, room, item, sx, sy);
  }

  /**
   * The fish's truecolor body (+ optional head overlay) at its slid screen
   * position for an alive, in-room fish with a mapped frame; otherwise the
   * classic fish (exited = nothing, dead = eroding skeleton, un-mapped pose, or a
   * darkness/bonus room). FFNG ships pre-mirrored left/right full-frame sprites.
   */
  drawFish(
    screen: CompositeTarget,
    room: Room,
    which: 'little' | 'big',
    item: Item,
    sx: number,
    sy: number,
    frame: FishFrame,
  ): void {
    if (isTruecolorTarget(screen) && this.fish && room.gspec !== 2 && room.gspec !== 5) {
      const venku = which === 'little' ? room.venku.little : room.venku.big;
      const alive = which === 'little' ? room.alive.little : room.alive.big;
      const bodyFile = FISH_BODY_FILE[frame.bodyFrame];
      if (!venku && alive && bodyFile) {
        const size = which === 'little' ? 'small' : 'big';
        const facingRight = which === 'little' ? room.facingRight.little : room.facingRight.big;
        const set = this.fish[size][facingRight ? 'right' : 'left'];
        const body = set.get(bodyFile);
        if (body) {
          const x0 = item.x * FSIZE + sx;
          const y0 = item.y * FSIZE + sy;
          screen.blitSpriteRgba(body.rgba, body.w, body.h, x0, y0, false);
          if (frame.headFrame > 0) {
            const headFile = FISH_HEAD_FILE[frame.headFrame];
            const head = headFile ? set.get(headFile) : undefined;
            if (head) screen.blitSpriteRgba(head.rgba, head.w, head.h, x0, y0, false);
          }
          return;
        }
      }
    }
    classicFish(screen, room, which, item, sx, sy, frame);
  }
}
