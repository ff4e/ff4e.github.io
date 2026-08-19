/**
 * The enhanced tier's object sprites: fetch a room's `objects.json` and decode the frames
 * it lists.
 *
 * Split out of main.ts so the rule below can be tested directly. It could not be, and the
 * rule it got wrong was invisible in every other way — no 404 the player could see, no
 * exception, and a room that rendered.
 */
import { withLoadSlot } from './loadSlot.js';
import { assetJson, isMissing, optionalAsset, reportMissingAsset, requiredAsset } from './assetFetch.js';
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
 * Whole-ROOM atomicity — what the AI tier does, dropping the room to the tier below on
 * any missing asset — would be the other self-consistent answer, and it is the wrong one
 * here. The two tiers are not in the same position: an AI set is generated complete, so a
 * hole in it means the set is broken, while the enhanced tier is deliberately incomplete
 * and already has a per-object fallback. Making one bad file cost a whole room its art
 * would be a much bigger regression than the one being fixed.
 *
 * ── Loud or quiet ─────────────────────────────────────────────────────────────
 * The two cases the old code could not tell apart get different volumes. An item absent
 * from the manifest is by design and stays silent. An item LISTED in the manifest and
 * then not delivered is a broken build or a broken deploy — nothing at runtime can fix
 * it, so it is treated as an absence, but it says so (see reportMissingAsset).
 *
 * A TRANSIENT failure (network error, abort, 5xx) is neither: it rejects out of here so
 * the caller declines to cache the room at all, and the next entry retries.
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
  const res = await optionalAsset(url, { expect: 'json' });
  if (!res) return [];
  const manifest = await assetJson<{ objects?: ObjManifestEntry[] }>(url, res);
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
            try {
              return await decodePng(await requiredAsset(url, `an enhanced sprite for ${jmeno}`, { expect: 'image' }));
            } catch (err) {
              if (!isMissing(err)) throw err;
              reportMissingAsset(`enhanced tier, ${jmeno} item ${e.item}`, url);
              return null;
            }
          }),
        ),
      );
      if (frames.some((f) => f === null)) return null;
      return { item: e.item, frames: frames as EnhancedSprite[] };
    }),
  );
  return loaded.filter((o): o is EnhancedObject => o !== null);
}
