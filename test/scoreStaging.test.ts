/**
 * SCORE's `ai` tier art is the ORIGINAL, magnified — not something new.
 *
 * SCORE is the one room with no FFNG level, so `tools/stage-score.ts` derives its ×4
 * masters from the room's own FFR instead of upscaling a truecolor original. That makes
 * this the one room whose `ai` art is generated from bytes inside this repo, and the one
 * place a staging mistake would silently repaint a shipped room.
 *
 * Two things could plausibly be wrong, and both are silent:
 *
 *  - the background's `FFR_EXTRA` slack. Background bitmaps are read with
 *    `ReadBitMapExtra` and carry 10 columns of padding each side for the water wobble
 *    (SCORE's bitmap is 620 wide for a 600-wide room). Dropping the wrong ten columns
 *    shifts the whole room sideways by 10px, which looks entirely plausible on its own.
 *  - the wall's mask index. Get it wrong and the doorway holes turn opaque, or the wall
 *    vanishes — and the AI compositor would draw the result without complaint.
 *
 * So the oracle is the FAITHFUL renderer: composite the two staged layers the way
 * `blit2Rgba` does at rest, and require the result to equal `renderRoomBackgroundRgba`
 * through the classic art source, pixel for pixel. That is the same comparison the
 * enhanced tier's own art has to pass, applied to art this repo generates.
 *
 * The ×4 itself is deliberately NOT tested here: it is `ffmpeg scale=flags=neighbor`,
 * pixel replication, and asserting it would be asserting ffmpeg. What matters is that
 * what goes IN is the original. `tools/stage-score.ts --check` re-runs the whole pipeline
 * and byte-compares the shipped files, for when the binaries are available.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { ClassicArtSource } from '../src/render/classicArtSource.js';
import { renderRoomBackgroundRgba } from '../src/render/renderRoom.js';
import { bgRgba, wallRgba } from '../tools/stage-score.js';

const FFR = join(process.cwd(), 'public/data/Graphic/072.ffr');
const AI = join(process.cwd(), 'public/enhanced-ai/SCORE');
const have = existsSync(FFR);

describe.skipIf(!have)('SCORE staged ai art', () => {
  const ffr = parseFfr(new Uint8Array(readFileSync(FFR)));

  it('composites to exactly what the faithful renderer draws', () => {
    const wall = wallRgba(ffr);
    const bg = bgRgba(ffr, wall.w, wall.h);
    const room = new Room(ffr);
    // The water is stilled, and `count: 0` is NOT enough to do it — that was this test's
    // first mistake and it is worth writing down. The displacement is
    // `(wamp/2)·sin(i/wper + count/wspd)`, so at count=0 the phase term vanishes but the
    // per-ROW term does not: SCORE (wamp=5) is already displaced by up to ±2px on most
    // rows, and 27% of the room read as "wrong" against a perfectly correct master.
    //
    // A staged master is by definition the UNSHIFTED art — `blit2Rgba` samples it at
    // `j + k` and applies the wobble at draw time, exactly as the classic path samples
    // its own bitmap at `FFR_EXTRA + k + j`. So the comparison has to be made with the
    // water still, which is what wamp=0 means.
    room.wamp = 0;
    const ref = renderRoomBackgroundRgba(room, new ClassicArtSource(room.palette), { count: 0 });

    expect([wall.w, wall.h]).toEqual([ref.width, ref.height]);
    let diff = 0;
    let firstBad = -1;
    for (let p = 0; p < wall.w * wall.h; p++) {
      const o = p << 2;
      // blit2Rgba's rule at rest: an opaque wall texel wins, otherwise the background.
      const src = wall.rgba[o + 3] !== 0 ? wall.rgba : bg.rgba;
      for (let c = 0; c < 3; c++) {
        if (src[o + c] !== ref.rgba[o + c]) {
          if (firstBad < 0) firstBad = p;
          diff++;
          break;
        }
      }
    }
    const at = firstBad < 0 ? '' : ` (first at ${firstBad % wall.w},${Math.floor(firstBad / wall.w)})`;
    expect(diff, `${diff} of ${wall.w * wall.h} px differ from the classic render${at}`).toBe(0);
  });

  it('keeps the wall transparent exactly where the mask index is, and nowhere else', () => {
    const wall = wallRgba(ffr);
    const item = ffr.items[0]!;
    const bmp = ffr.bitmaps[item.bmp]!;
    let wrong = 0;
    for (let p = 0; p < bmp.w * bmp.h; p++) {
      const masked = bmp.pixels[p] === item.mask;
      if (masked !== (wall.rgba[(p << 2) + 3] === 0)) wrong++;
    }
    expect(wrong, 'pixels whose transparency disagrees with the mask index').toBe(0);
    // A wall that is entirely opaque (or entirely transparent) would pass the composite
    // test above by accident, because the background would never show through.
    const clear = [...Array(bmp.w * bmp.h).keys()].filter((p) => wall.rgba[(p << 2) + 3] === 0).length;
    expect(clear).toBeGreaterThan(0);
    expect(clear).toBeLessThan(bmp.w * bmp.h);
  });

  it('ships a manifest the runtime can load', () => {
    if (!existsSync(join(AI, 'ai.json'))) return; // art not staged in this checkout
    const man = JSON.parse(readFileSync(join(AI, 'ai.json'), 'utf8')) as {
      scale: number;
      bg: string[];
      wall: string[];
      objects: unknown[];
    };
    // loadAiRoom returns null — silently — for a manifest with no bg or no wall.
    expect(man.bg.length).toBeGreaterThan(0);
    expect(man.wall.length).toBeGreaterThan(0);
    expect(man.scale).toBe(4);
    for (const f of [...man.bg, ...man.wall]) expect(existsSync(join(AI, f)), `${f} exists`).toBe(true);
    // Empty by design: an item with no entry is drawn by AiRoom.drawClassicItem, which is
    // the same nearest ×4 of the same bitmap. See the tool's comment.
    expect(man.objects).toEqual([]);
  });
});
