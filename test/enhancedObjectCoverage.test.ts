import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFfr, Kind } from '../src/data/ffr.js';
import { ROOMS } from '../src/data/roomTable.js';

/**
 * Every FFR item that CAN have truecolor art must actually have it staged.
 *
 * This is the check that was missing when the enhanced tier shipped with 21 sprites
 * silently absent — the broom in KOSTE, the blob in REAKTOR, the little creature under
 * ZAVER's table, PARTY2's five window figures and ZX's marching knight. Nothing was
 * broken enough to notice: `EnhancedArtSource.drawItem` falls through to `classicItem`
 * for an item with no manifest entry, and `AiRoom` does the same, so those objects simply
 * rendered as 1998 palette bitmaps inside an otherwise truecolor (and, at the ai tier,
 * ×4) room. No 404, no exception, no failing test.
 *
 * The gap was invisible to the tier's own comparisons too: the ai manifest was IDENTICAL
 * to the enhanced manifest in all three rooms, which reads as "the upscaler processed
 * everything it was given" — and it had. The only comparison that finds this is against
 * the room's own FFR item list, which is what this file does.
 *
 * The remaining gaps are pinned in EXPECTED_GAPS rather than merely tolerated, so that
 * closing one (or opening a new one) has to be a deliberate edit.
 */

const ROOT = process.cwd();
const ENHANCED = join(ROOT, 'public/enhanced');
const AI = join(ROOT, 'public/enhanced-ai');
const haveArt = existsSync(ENHANCED) && existsSync(AI);

/**
 * Non-fish items that legitimately have no truecolor sprite, by room -> item -> why.
 *
 * All four reasons are "FFNG has no art for it", never "we forgot": three of them are
 * items FFNG models without a sprite at all, and SCORE has no FFNG level whatsoever.
 * WIN's pair is the one open judgement call rather than a settled gap.
 */
const EXPECTED_GAPS: Record<string, Record<number, string>> = {
  // `maska`, the LODE falling-ship stencil. spec=11 for the room's whole life
  // (src/rooms/lode.ts:100), and walkRoom skips spec=11, so it is never drawn.
  LODE: { 16: 'maska — permanently spec=11, never drawn' },
  // The ELDERLY fish. In normal play they sit in the room as Kind.light ITEMS, so they
  // do render; FFNG has the art but only as fish animation SETS (images/fishes/ex_big,
  // ex_small), so staging it means choosing a resting frame and a facing. Deferred with
  // the rest of the gspec=5 bonus render (src/rooms/win.ts:12).
  WIN: {
    32: 'staravelka — FFNG art is a fish anim set, not an item sprite',
    33: 'staramala — FFNG art is a fish anim set, not an item sprite',
    39: 'spuntik — FFNG models it output_left with no addItemAnim; no art exists',
  },
  // The score screen has no FFNG level at all, so it has no enhanced background either
  // and renders wholly classic — there is no resolution contrast to expose.
  SCORE: Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14].map((i) => [i, 'SCORE has no FFNG level']),
  ),
};

function manifestItems(path: string): Set<number> | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { objects?: { item?: number }[] };
  const out = new Set<number>();
  for (const o of parsed.objects ?? []) if (typeof o.item === 'number') out.add(o.item);
  return out;
}

/** Item indices a room draws through the ITEM path (the fish have their own). */
function drawableItems(roomNum: number): number[] {
  const ffr = parseFfr(
    new Uint8Array(readFileSync(join(ROOT, 'public/data/Graphic', `${String(roomNum).padStart(3, '0')}.ffr`))),
  );
  const out: number[] = [];
  for (let j = 1; j <= ffr.itemCount; j++) {
    const kind = ffr.items[j]!.kind;
    if (kind === Kind.little || kind === Kind.big) continue;
    out.push(j);
  }
  return out;
}

describe.skipIf(!haveArt)('enhanced object coverage', () => {
  for (const room of ROOMS) {
    it(`${room.num} ${room.jmeno} stages every item FFNG has art for`, () => {
      const staged = manifestItems(join(ENHANCED, room.jmeno, 'objects.json')) ?? new Set<number>();
      const expected = EXPECTED_GAPS[room.jmeno] ?? {};
      const missing = drawableItems(room.num).filter((j) => !staged.has(j));
      expect(missing.map((j) => `${j}: ${expected[j] ?? 'UNEXPECTED GAP'}`).sort()).toEqual(
        Object.keys(expected)
          .map((j) => `${j}: ${expected[Number(j)]}`)
          .sort(),
      );
    });
  }

  /**
   * The sprites this task recovered, named individually. The coverage test above would
   * pass again if someone re-pinned them into EXPECTED_GAPS; these will not.
   */
  const RECOVERED: [string, number, string][] = [
    ['KOSTE', 2, 'koste_00.png'],
    ['REAKTOR', 18, 'pld_00.png'],
    ['ZAVER', 7, 'pldik_00.png'],
    ['ZX', 13, 'knight_00.png'],
    ['PARTY2', 18, 'ruka_00.png'],
    ['PARTY2', 19, 'frkavec_00.png'],
    ['PARTY2', 20, 'hnat_00.png'],
    ['PARTY2', 21, 'lahev_00.png'],
    ['PARTY2', 22, 'frk_00.png'],
  ];

  for (const [jmeno, item, firstFrame] of RECOVERED) {
    it(`${jmeno} item ${item} is bound to ${firstFrame}`, () => {
      const parsed = JSON.parse(readFileSync(join(ENHANCED, jmeno, 'objects.json'), 'utf8')) as {
        objects: { item: number; frames: string[] }[];
      };
      const obj = parsed.objects.find((o) => o.item === item);
      expect(obj?.frames[0]).toBe(firstFrame);
      for (const f of obj!.frames) {
        expect(existsSync(join(ENHANCED, jmeno, 'obj', f)), `${jmeno}/obj/${f}`).toBe(true);
      }
    });
  }
});

describe.skipIf(!haveArt)('ai object coverage', () => {
  /**
   * The ai tier upscales exactly the enhanced set, so any item the enhanced tier has must
   * appear in ai.json too — otherwise the room silently mixes ×4 art with native sprites.
   * Rooms the Studio deliberately excludes ship no ai.json at all and are skipped.
   */
  for (const room of ROOMS) {
    it(`${room.num} ${room.jmeno} upscales every enhanced object`, () => {
      const enhanced = manifestItems(join(ENHANCED, room.jmeno, 'objects.json'));
      const ai = manifestItems(join(AI, room.jmeno, 'ai.json'));
      if (enhanced === null || ai === null) return; // room not in one of the tiers
      expect([...enhanced].filter((j) => !ai.has(j)).sort((a, b) => a - b)).toEqual([]);
    });
  }
});
