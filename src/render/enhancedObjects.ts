/**
 * The enhanced tier's object sprites: fetch a room's `objects.json` and decode the frames
 * it lists.
 *
 * Split out of main.ts so the rule below can be tested directly. It could not be, and the
 * rule it got wrong was invisible in every other way — no 404 the player could see, no
 * exception, and a room that rendered.
 */
import { withLoadSlot } from './loadSlot.js';
import { assetJson, optionalAsset, requiredAsset } from './assetFetch.js';
import type { EnhancedObject, EnhancedSprite } from './enhancedArtSource.js';

export interface ObjManifestEntry {
  item: number;
  frames: string[];
}

/** Decode a PNG response into straight RGBA. Injected because the browser decoder
 *  (createImageBitmap + a 2D canvas) has no counterpart under the unit suite. */
export type DecodePng = (res: Response) => Promise<EnhancedSprite>;

/**
 * Decode a room's enhanced object sprites from its objects.json manifest.
 *
 * ── Whole object, or no object ────────────────────────────────────────────────
 * An entry whose frames did not all arrive is dropped ENTIRELY, and the item then draws
 * in classic art (`EnhancedArtSource.drawItem` falls through to `classicItem` for an item
 * with no manifest entry). It used to keep whatever had arrived:
 *
 *     const valid = frames.filter((f) => f !== null);
 *     return valid.length > 0 ? { item: e.item, frames: valid } : null;
 *
 * which reads like graceful degradation and is not one. `filter` COMPACTS the array while
 * the renderer indexes it by animation phase — `obj.frames[frameIndex(item.afaze,
 * obj.frames.length)]` (enhancedArtSource.ts), and `frameIndex` returns `afaze` unchanged
 * for anything in range. So losing frame 10 of SCHODY's 44-frame snail does not lose one
 * picture: phase 11 draws frame 12, phase 12 draws frame 13, and every phase after the
 * gap is wrong for as long as the room is open. Silently.
 *
 * Dropping the whole entry cannot do that. It is also the outcome the tier ALREADY ships
 * for the 21 sprites that are legitimately absent from their manifests, so it is a
 * fallback the renderer has always had and the player has already seen: one item in 1998
 * bitmaps inside a truecolor room.
 *
 * ── Loud or quiet ─────────────────────────────────────────────────────────────
 * The two cases the old code could not tell apart get opposite treatment, and telling
 * them apart is the whole job of this function.
 *
 * An item ABSENT from the manifest is by design — 21 sprites ship that way and render as
 * 1998 bitmaps inside a truecolor room — and it is never fetched at all, so it cannot
 * fail. A room with no manifest is the same statement about every item, and reaches the
 * `optionalAsset` below.
 *
 * An item LISTED in the manifest and then not delivered is a broken build or a broken
 * deploy. That used to be reported to the console and treated as an absence, which is
 * indistinguishable from the design gap above — precisely how a broken build could ship
 * unnoticed. It now ends the session (see loadingUi.ts).
 *
 * A TRANSIENT failure (network error, abort, 5xx) says nothing about whether the file
 * exists, so it rejects out of here too and the caller declines to cache the room at all.
 */
export async function loadEnhancedObjects(
  base: string,
  jmeno: string,
  decodePng: DecodePng,
): Promise<EnhancedObject[]> {
  const dir = `${base}enhanced/${jmeno}/`;
  const url = `${dir}objects.json`;
  // Optional: a room with no staged object sprites ships no manifest, and that is the
  // design. (`expect` also screens out the dev server's index.html-with-200 fallback.)
  const res = await optionalAsset(url, 'mustHave', { expect: 'json' });
  if (!res) return [];
  const manifest = await assetJson<{ objects?: ObjManifestEntry[] }>(url, res, 'mustHave');
  const entries = manifest.objects ?? [];
  // One entry at a time was a per-object round trip: with the AI loads parallelised
  // this waterfall became the thing the first frame waits on (2.2s at a 150ms RTT
  // against 1.2s for the whole AI set). The sprites are independent, so fetch them
  // all at once and let the browser schedule.
  const loaded = await Promise.all(
    entries.map(async (e): Promise<EnhancedObject | null> => {
      if (typeof e.item !== 'number' || !Array.isArray(e.frames)) return null;
      const frames = await Promise.all(
        e.frames.map(async (f) =>
          withLoadSlot(async () => {
            const url = `${dir}obj/${f}`;
            // REQUIRED, even though the tier around it is optional: the manifest just
            // promised this file. A sprite the manifest never mentions is a gap by
            // design and is never fetched at all; one it lists and the server does not
            // have is a broken build, and the difference is the whole point of the split.
            return decodePng(await requiredAsset(url, `an enhanced sprite for ${jmeno}`, 'mustHave', { expect: 'image' }));
          }),
        ),
      );
      // No null frames to filter any more: a frame the manifest lists either decodes or
      // ends the session. Dropping the whole OBJECT for one missing frame is what used
      // to make a broken build render as a room with an invisible item.
      return { item: e.item, frames };
    }),
  );
  return loaded.filter((o): o is EnhancedObject => o !== null);
}
