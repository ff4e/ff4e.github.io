/**
 * The native host's room size cap (native/js/roomFit.ts): a room's cell no larger than 45 px
 * per 1080 lines of window, over the real 72 rooms. The host's C copy of `letterboxRect` is
 * held to this one by the smoke gate (roomFitSmoke.ts), which has the host to ask.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { ROOMS } from '../src/data/roomTable.js';
import { AI_ROOM_SCALE } from '../src/render/roomAi.js';
import { CELL_NATIVE, computeStageScale } from '../src/app/layout.js';
import { clampTextScale, fitScreenW, subtitleScale } from '../src/render/subtitleGeom.js';
import { ROOM_CELL_PX, letterboxRect, roomCapH } from '../native/js/roomFit.js';

const CAPPED = ['WC', 'ZRC', 'POTOPENA', 'MIKRO', 'NOGROUND', 'ODPADKY', 'KAJUTA1', 'TRUP', 'ZAVAL'];

/** Every room's composite on the `ai` tier: native pixels ×4. */
const rooms = ROOMS.map((r) => {
  const ffr = parseFfr(new Uint8Array(readFileSync(join(__dirname, '..', 'public/data/Graphic', `${String(r.num).padStart(3, '0')}.ffr`))));
  const nw = ffr.width * CELL_NATIVE, nh = ffr.height * CELL_NATIVE;
  return { name: r.jmeno, nw, nh, w: nw * AI_ROOM_SCALE, h: nh * AI_ROOM_SCALE };
});
const capH = roomCapH(AI_ROOM_SCALE);

describe('the room size cap', () => {
  it('is 45 px a cell at 1080 lines: a ×4 composite fills the height at 24 rows', () => {
    expect(ROOM_CELL_PX).toBe(45);
    expect(capH).toBe(24 * CELL_NATIVE * AI_ROOM_SCALE);
  });

  it('letterboxes as before when uncapped: as large as fits, centred, whole pixels', () => {
    expect(letterboxRect(800, 600, 1920, 1080)).toEqual([240, 0, 1440, 1080]);
    // The host's float32: 720/555 rounds down, and 555 × it floors to 719, not 720.
    expect(letterboxRect(720, 555, 1280, 720)).toEqual([173, 0, 934, 719]);
    expect(letterboxRect(2560, 1920, 1920, 1080, 0)).toEqual([240, 0, 1440, 1080]);
  });

  for (const [sw, sh] of [[1920, 1080], [3840, 2160]] as const) {
    it(`binds on exactly the 9 small rooms at ${sw}×${sh}, at the cap, and leaves the rest alone`, () => {
      const cellPx = (ROOM_CELL_PX * sh) / 1080;
      const changed: string[] = [];
      for (const r of rooms) {
        const full = letterboxRect(r.w, r.h, sw, sh), capped = letterboxRect(r.w, r.h, sw, sh, capH);
        if (capped.every((v, i) => v === full[i])) {
          expect(full[3] / (r.nh / CELL_NATIVE), r.name).toBeLessThanOrEqual(cellPx);
          continue;
        }
        changed.push(r.name);
        const [ox, oy, dw, dh] = capped;
        expect([dw, dh], r.name).toEqual([(r.nw / CELL_NATIVE) * cellPx, (r.nh / CELL_NATIVE) * cellPx]);
        expect([ox, oy], r.name).toEqual([Math.floor((sw - dw) / 2), Math.floor((sh - dh) / 2)]);
        expect(dh, r.name).toBeLessThan(full[3]);
      }
      expect(changed.sort()).toEqual([...CAPPED].sort());
    });
  }

  it('takes MIKRO (24×14) from 77 px a cell to 45 at 1080 lines, and to 90 at 2160', () => {
    const m = rooms.find((r) => r.name === 'MIKRO')!;
    expect(letterboxRect(m.w, m.h, 1920, 1080)[3] / 14).toBeCloseTo(77.1, 1);
    expect(letterboxRect(m.w, m.h, 1920, 1080, capH)).toEqual([420, 225, 1080, 630]);
    expect(letterboxRect(m.w, m.h, 3840, 2160, capH)).toEqual([840, 450, 2160, 1260]);
  });

  it('leaves the subtitles of a capped room their size, with room to spare for every line', () => {
    // As roomSubtitles.ts sizes them: CSS px from the window, the stage the whole window.
    for (const [sw, sh, density] of [[1920, 1080, 1], [3840, 2160, 2]] as const) {
      const stage = computeStageScale(sw / density, sh / density, false);
      for (const r of rooms.filter((x) => CAPPED.includes(x.name))) {
        const text = (rect: readonly number[]): { scale: number; budget: number } => {
          const boxScale = rect[2]! / density / r.nw;
          const scale = clampTextScale(subtitleScale(stage, boxScale), boxScale);
          return { scale, budget: fitScreenW(r.nw, boxScale, scale) };
        };
        const full = text(letterboxRect(r.w, r.h, sw, sh)), capped = text(letterboxRect(r.w, r.h, sw, sh, capH));
        expect(capped.scale, r.name).toBe(full.scale);
        // A line is shrunk only when it measures wider than this, twice the room's own width.
        expect(capped.budget, r.name).toBeGreaterThan(2 * r.nw);
      }
    }
  });
});
