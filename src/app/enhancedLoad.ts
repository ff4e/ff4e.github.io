/**
 * Fetching and decoding the enhanced (FFNG truecolor) art for one room.
 *
 * Split out of `art.ts` because the two halves want different things. This half is a
 * pure function of a room name: it fetches, it decodes, it returns what it found, and
 * it touches no module state — so it can be reasoned about (and later, tested) without
 * a running game. The other half is the part that has to be stateful: which room is on
 * screen, what has already been loaded, and whether the frame is still holding for it.
 *
 * That seam is also where the next change lands. PR #32 moves the object loader behind
 * an injected decode so the "one sprite frame failed" case can be asserted on pixels;
 * this is the file it lands in.
 *
 * Nothing here caches. Remembering an outcome is a decision about what a failure MEANS,
 * and that decision belongs with the state, not with the transport.
 */
import type { EnhancedArt, EnhancedObject } from '../render/enhancedArtSource.js';
import { withLoadSlot } from '../render/loadSlot.js';

/** One room's enhanced art: background masters (null = none staged) and object sprites. */
export interface RoomEnhanced {
  art: EnhancedArt | null;
  objects: EnhancedObject[];
}

interface ObjManifestEntry {
  item: number;
  frames: string[];
}

/**
 * The dev server serves index.html (HTTP 200) for a missing asset, so `res.ok`
 * is not enough to know a file exists — verify the content-type is an image.
 */
export function isPngResponse(res: Response): boolean {
  return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
}

/**
 * Decode a PNG Response into straight RGBA using the browser's native decoder
 * (createImageBitmap + a 2D canvas) — no `node:zlib`, unlike the Node tools.
 */
export async function decodePngResponse(res: Response): Promise<{ w: number; h: number; rgba: Uint8Array }> {
  const bmp = await createImageBitmap(await res.blob());
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
}

/**
 * Fetch + decode a room's enhanced background masters and object sprites, staged under
 * public/enhanced/<JMENO>/ (w.png, p.png, objects.json + obj/*.png).
 *
 * Never rejects: a missing master or a decode failure resolves to an empty result, and
 * the room silently falls back to classic. Whether that emptiness is worth REMEMBERING
 * is the caller's question — see the file header.
 */
export async function loadEnhancedRoom(jmeno: string): Promise<RoomEnhanced> {
  try {
    // A fetch that actually returns a PNG (dev server SPA-fallback serves the
    // index HTML with 200 for missing files, so ok/status is not enough).
    const isPng = isPngResponse;
    const [w, p] = await Promise.all([fetch(`/enhanced/${jmeno}/w.png`), fetch(`/enhanced/${jmeno}/p.png`)]);
    let art: EnhancedArt | null = null;
    if (isPng(w) && isPng(p)) {
      const [wall0, bg0] = await Promise.all([decodePngResponse(w), decodePngResponse(p)]);
      if (wall0.w === bg0.w && wall0.h === bg0.h) {
        // Additional animation frames (STEEL red-alert): w1.png/p1.png, w2.png/p2.png…
        const walls = [wall0.rgba];
        const bgs = [bg0.rgba];
        for (let f = 1; ; f++) {
          const [wf, pf] = await Promise.all([
            fetch(`/enhanced/${jmeno}/w${f}.png`),
            fetch(`/enhanced/${jmeno}/p${f}.png`),
          ]);
          if (!isPng(wf) || !isPng(pf)) break;
          const [wd, pd] = await Promise.all([decodePngResponse(wf), decodePngResponse(pf)]);
          if (wd.w !== wall0.w || wd.h !== wall0.h || pd.w !== wall0.w || pd.h !== wall0.h) break;
          walls.push(wd.rgba);
          bgs.push(pd.rgba);
        }
        art = { w: wall0.w, h: wall0.h, wall: walls, bg: bgs };
      }
    }
    return { art, objects: await loadEnhancedObjects(jmeno) };
  } catch {
    return { art: null, objects: [] };
  }
}

/** Decode a room's enhanced object sprites from its objects.json manifest. */
async function loadEnhancedObjects(jmeno: string): Promise<EnhancedObject[]> {
  const res = await fetch(`/enhanced/${jmeno}/objects.json`);
  // The dev server serves index.html (200) for a missing manifest, so verify it
  // is actually JSON before parsing.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
  const manifest = (await res.json()) as { objects?: ObjManifestEntry[] };
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
            const r = await fetch(`/enhanced/${jmeno}/obj/${f}`);
            if (!isPngResponse(r)) return null;
            const d = await decodePngResponse(r);
            return { w: d.w, h: d.h, rgba: d.rgba };
          }),
        ),
      );
      const valid = frames.filter((f): f is { w: number; h: number; rgba: Uint8Array } => f !== null);
      return valid.length > 0 ? { item: e.item, frames: valid } : null;
    }),
  );
  return loaded.filter((o): o is EnhancedObject => o !== null);
}
