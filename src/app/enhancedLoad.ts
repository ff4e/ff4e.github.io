/**
 * Fetching and decoding the enhanced (FFNG truecolor) art for one room.
 *
 * Split out of `art.ts` because the two halves want different things. This half is a
 * pure function of a room name: it fetches, it decodes, it returns what it found, and
 * it touches no module state — so it can be reasoned about (and, for the object sprites,
 * tested) without a running game. The other half is the part that has to be stateful:
 * which room is on screen, what has already been loaded, and whether the frame is still
 * holding for it.
 *
 * ── What this file does NOT decide ────────────────────────────────────────────
 * Nothing here caches. Remembering an outcome is a decision about what a failure MEANS,
 * and `src/render/assetFetch.ts` is where that meaning lives: an ABSENT asset is a
 * stable fact worth remembering, a FAILED one is no answer at all and remembering it is
 * remembering a lie. So this file's contract is:
 *
 *   - it resolves with whatever legitimately exists (including nothing at all), and
 *   - it REJECTS with a TransientAssetError when it learned nothing.
 *
 * `art.ts` caches the first and drops the second. That split is the whole fix: before
 * it, one blip on one sprite cost a room its background masters for the session.
 */
import type { EnhancedArt, EnhancedObject, EnhancedSprite } from '../render/enhancedArtSource.js';
import { assetBlob, decodeAsset, fetchAsset, isPngResponse } from '../render/assetFetch.js';
import { loadEnhancedObjects } from '../render/enhancedObjects.js';

// Re-exported so main.ts's leg-story art keeps its existing import site.
export { isPngResponse } from '../render/assetFetch.js';

/** One room's enhanced art: background masters (null = none staged) and object sprites. */
export interface RoomEnhanced {
  art: EnhancedArt | null;
  objects: EnhancedObject[];
}

/**
 * Decode a PNG Response into straight RGBA using the browser's native decoder
 * (createImageBitmap + a 2D canvas) — no `node:zlib`, unlike the Node tools.
 *
 * The decode is classified as TRANSIENT. A truncated download and a genuinely corrupt
 * file are indistinguishable to a decoder, and the two mistakes do not cost the same —
 * see `decodeAsset`.
 */
export async function decodePngResponse(res: Response): Promise<EnhancedSprite> {
  return decodeAsset(res.url, async () => {
    const bmp = await createImageBitmap(await assetBlob(res.url, res));
    const w = bmp.width;
    const h = bmp.height;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const g = off.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, w, h).data;
    bmp.close();
    return { w, h, rgba: new Uint8Array(data.buffer.slice(0)) };
  });
}

/**
 * Fetch + decode a room's enhanced background masters and object sprites, staged under
 * public/enhanced/<JMENO>/ (w.png, p.png, objects.json + obj/*.png).
 *
 * Resolves `{ art: null, objects: [] }` for a room that genuinely has none — several
 * rooms ship that way by design. THROWS `TransientAssetError` when a request got no
 * answer at all, so the caller knows it has learned nothing.
 */
export async function loadEnhancedRoom(jmeno: string): Promise<RoomEnhanced> {
  const dir = `/enhanced/${jmeno}/`;
  // A fetch that actually returns a PNG (dev server SPA-fallback serves the
  // index HTML with 200 for missing files, so ok/status is not enough).
  const [w, p] = await Promise.all([fetchAsset(`${dir}w.png`), fetchAsset(`${dir}p.png`)]);
  let art: EnhancedArt | null = null;
  if (isPngResponse(w) && isPngResponse(p)) {
    const [wall0, bg0] = await Promise.all([decodePngResponse(w), decodePngResponse(p)]);
    if (wall0.w === bg0.w && wall0.h === bg0.h) {
      // Additional animation frames (STEEL red-alert): w1.png/p1.png, w2.png/p2.png…
      const walls = [wall0.rgba];
      const bgs = [bg0.rgba];
      for (let f = 1; ; f++) {
        const [wf, pf] = await Promise.all([fetchAsset(`${dir}w${f}.png`), fetchAsset(`${dir}p${f}.png`)]);
        if (!isPngResponse(wf) || !isPngResponse(pf)) break;
        const [wd, pd] = await Promise.all([decodePngResponse(wf), decodePngResponse(pf)]);
        if (wd.w !== wall0.w || wd.h !== wall0.h || pd.w !== wall0.w || pd.h !== wall0.h) break;
        walls.push(wd.rgba);
        bgs.push(pd.rgba);
      }
      art = { w: wall0.w, h: wall0.h, wall: walls, bg: bgs };
    }
  }
  return { art, objects: await loadEnhancedObjects('/', jmeno, decodePngResponse) };
}
