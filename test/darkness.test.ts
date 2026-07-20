/**
 * gspec=2 "darkness" rooms (CHODBA, room 56 — not yet ported). Two rules from the
 * original engine:
 *
 *  1. Visibility flip (Priprav, URoom.pas:26251): `Visible := (spec=2) or (j=Little)
 *     or (j=Big)` — only the two fish and items with spec=2 (the guard dogs' glowing
 *     eyes) are lit; everything else is swallowed by the dark, regardless of its own
 *     spec/visible flags.
 *  1b. Darkness fill (Priprav, URoom.pas:26210-26213): the wall/background is NOT drawn;
 *     the whole screen is filled with the palette's near-black index (VyplnMistnost
 *     fontcol['w',4]). So hidden items / winked-out fish fall back to near-black, not
 *     the wall colour.
 *  2. Fish silhouette (KresliRybu, URoom.pas:25746-25748): the fish body is the dark
 *     frame `Tela[.,tl_tma]` (tl_tma=23); while turning or on a ~6% flicker it becomes
 *     `Tela[.,0]` — a nil bitmap (URoom.pas:1293/1300), so the fish winks out.
 *
 * No ported room sets gspec=2 yet, so this drives a synthetic room + directly-supplied
 * fish frames, following the visibility/rope/mirror renderer-test pattern.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomState, darkBodyFrame, TL_TMA, type FishFrame } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
const BG = 50;
const NORMAL = 100; // a plain (spec=0) item's colour
const EYES = 120; // a spec=2 item's colour (lit in the dark)
const DARK = 130; // the fish dark-silhouette (tl_tma) colour
const DARK_FILL = 0; // palette index nearest to black (the gspec=2 fill)

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/** A body-frame table indexed 0..23: [0] nil (wink-out), [23] the dark silhouette. */
function bodyFrames(): (FfrBitmap | null)[] {
  const out: (FfrBitmap | null)[] = [null];
  for (let i = 1; i <= 23; i++) out.push(solid(FSIZE, FSIZE, i === TL_TMA ? DARK : 9));
  return out;
}

/**
 * A 6×6-cell room: a plain item at (2,2), a spec=2 item at (4,2), the little fish at
 * (2,4) and the big fish at (4,4). `dark` sets gspec=2. Fish mask 254 ≠ any body colour
 * (nothing transparent). Fish start facing left so the anchor is the cell's left edge.
 */
function darkRoom(dark: boolean): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 1, mask: 255, kind: Kind.static, fields: [] };
  const plain: FfrItem = { xStart: 2, yStart: 2, bmp: 2, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const eyes: FfrItem = { xStart: 4, yStart: 2, bmp: 3, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const little: FfrItem = { xStart: 2, yStart: 4, bmp: 0, mask: 254, kind: Kind.little, fields: [{ x: 0, y: 0 }] };
  const big: FfrItem = { xStart: 4, yStart: 4, bmp: 0, mask: 254, kind: Kind.big, fields: [{ x: 0, y: 0 }] };
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: false, big: false },
    wamp: 0,
    wper: 0,
    wspd: 0,
    width: 6,
    height: 6,
    itemCount: 4,
    items: [wall, plain, eyes, little, big],
    numBmp: 4,
    // [1] wall/background (BG); the wall item is opaque (mask 255 ≠ BG). [2] plain
    // item (NORMAL), [3] eyes (EYES). Fish bodies come from `bodies`, not `bitmaps`.
    bitmaps: [null, solid(90, 90, BG), solid(FSIZE, FSIZE, NORMAL), solid(FSIZE, FSIZE, EYES)],
    heads: { big: [null], small: [null] },
    bodies: { big: bodyFrames(), small: bodyFrames() },
    // Palette index i -> greyscale (i,i,i), so index 0 is pure black: the gspec=2
    // darkness fill (darkestIndex) resolves to DARK_FILL=0.
    palette: Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i })),
  };
  const room = new Room(ffr);
  room.items[2]!.spec = 2; // eyes
  if (dark) room.gspec = 2;
  return room;
}

/** Palette index at the centre of cell (cx,cy). */
function centre(screen: ReturnType<typeof renderRoomState>, cx: number, cy: number): number {
  const x = cx * FSIZE + 7;
  const y = cy * FSIZE + 7;
  return screen.px[y * screen.width + x]!;
}

const litFrame: { little: FishFrame; big: FishFrame } = {
  little: { bodyFrame: TL_TMA, headFrame: 0 },
  big: { bodyFrame: TL_TMA, headFrame: 0 },
};

describe('gspec=2 darkness visibility (URoom.pas:26251)', () => {
  it('lights only the fish and spec=2 items; a plain item is swallowed by the dark', () => {
    const lit = renderRoomState(darkRoom(false), { fishAnim: litFrame });
    const dark = renderRoomState(darkRoom(true), { fishAnim: litFrame });

    // Plain item: drawn in a normal room, swallowed by the near-black dark fill.
    expect(centre(lit, 2, 2)).toBe(NORMAL);
    expect(centre(dark, 2, 2)).toBe(DARK_FILL);

    // spec=2 item (glowing eyes): lit in both.
    expect(centre(lit, 4, 2)).toBe(EYES);
    expect(centre(dark, 4, 2)).toBe(EYES);

    // Both fish: drawn (as the dark silhouette) in the darkness room.
    expect(centre(dark, 2, 4)).toBe(DARK);
    expect(centre(dark, 4, 4)).toBe(DARK);
  });
});

describe('gspec=2 fish silhouette (URoom.pas:25746-25748)', () => {
  it('darkBodyFrame maps the wink-out flag to Tela[.,0] (nil) or tl_tma', () => {
    expect(darkBodyFrame(false)).toBe(TL_TMA); // steady: dark silhouette (frame 23)
    expect(darkBodyFrame(true)).toBe(0); // turning / 6% flicker: nil frame → not drawn
  });

  it('renders the dark silhouette for a steady fish and nothing on a wink-out', () => {
    const steady = renderRoomState(darkRoom(true), {
      fishAnim: {
        little: { bodyFrame: darkBodyFrame(false), headFrame: 0 },
        big: { bodyFrame: darkBodyFrame(false), headFrame: 0 },
      },
    });
    expect(centre(steady, 2, 4)).toBe(DARK);

    const winking = renderRoomState(darkRoom(true), {
      fishAnim: {
        little: { bodyFrame: darkBodyFrame(true), headFrame: 0 },
        big: { bodyFrame: darkBodyFrame(true), headFrame: 0 },
      },
    });
    // Frame 0 is nil → the little fish is not drawn → its cell falls back to the dark fill.
    expect(centre(winking, 2, 4)).toBe(DARK_FILL);
  });
});
