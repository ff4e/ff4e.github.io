/**
 * Node-only helper to build EnhancedArt from PNG bytes, using the pure-TS
 * `pngDecode` (which relies on `node:zlib`). Kept separate from `enhancedArtSource.ts` so
 * the browser bundle — which decodes PNGs natively via createImageBitmap — never
 * imports `node:zlib` (Vite externalizes it). Used by the render/stage tools and
 * the Vitest tests, all of which run under Node.
 */
import { decodePng } from './pngDecode.js';
import type { EnhancedArt } from './enhancedArtSource.js';

/** Decode a room's `-w` (wall) and `-p` (background) PNGs into single-frame EnhancedArt. */
export function decodeEnhancedArt(wallPng: Uint8Array, bgPng: Uint8Array): EnhancedArt {
  const wall = decodePng(wallPng);
  const bg = decodePng(bgPng);
  if (wall.w !== bg.w || wall.h !== bg.h) {
    throw new Error(`enhanced art wall/bg size mismatch: ${wall.w}x${wall.h} vs ${bg.w}x${bg.h}`);
  }
  return { w: wall.w, h: wall.h, wall: [wall.rgba], bg: [bg.rgba] };
}
