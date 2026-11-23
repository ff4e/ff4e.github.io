/**
 * Browser reference for the native spike: the SAME scene module as the native entry,
 * rendered by the real WebGL2 backend (`GlAiScreen`), read back for comparison.
 * Served by the dev server at /native/reference.html and driven by native/compare.mjs.
 */
import { GlAiScreen } from '../../src/render/glRoomAi.js';
import { compositeSize, frameFor, loadScene, pinRandom, probeFrame, replaySolution } from './scene.js';
import { CanvasSurface2D } from '../../src/render/canvasSurface2d.js';
import { AI_MAP_H, AI_MAP_W } from '../../src/render/worldMapAi.js';
import { loadMapScene, paintMapCase, type MapScene } from './mapScene.js';

interface RefOpts { room: number; replay?: number; still?: boolean; alpha?: number; probe?: boolean }

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`missing ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function base64(px: Uint8Array | Uint8ClampedArray): string {
  // In 32 KB chunks: one String.fromCharCode over 20 MB would blow the stack.
  let bin = '';
  for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return btoa(bin);
}

let mapScene: Promise<MapScene> | null = null;

/** One case of the world-map scene, painted by the web's own Surface2D: a plain 2D canvas, as #screen is. */
(window as unknown as Record<string, unknown>).__refMap = async (name: string) => {
  mapScene ??= loadMapScene({
    bytes: readBytes,
    image: async (url) => createImageBitmap(new Blob([(await readBytes(url)) as BlobPart])),
  });
  const scene = await mapScene;
  const canvas = document.createElement('canvas');
  canvas.width = AI_MAP_W;
  canvas.height = AI_MAP_H;
  const ctx = canvas.getContext('2d')!;
  paintMapCase(new CanvasSurface2D(canvas, ctx), scene, name);
  const px = ctx.getImageData(0, 0, AI_MAP_W, AI_MAP_H).data;
  return { w: AI_MAP_W, h: AI_MAP_H, b64: base64(px) };
};

(window as unknown as Record<string, unknown>).__ref = async (o: RefOpts) => {
  pinRandom(1); // the same draws the native headless run gets
  const scene = await loadScene(o.room, readBytes);
  if (o.replay) replaySolution(scene, o.replay);
  if (o.still) scene.room.wamp = 0;
  const f = o.probe ? probeFrame(scene, o.alpha ?? 0) : frameFor(scene, o.alpha ?? 0);
  const { w, h } = compositeSize(scene);
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('no WebGL2');
  const comp = new GlAiScreen(gl);
  if (!comp.begin(w, h)) throw new Error('GlAiScreen could not allocate the composite');
  scene.ai.drawInto(comp, scene.room, f);
  const px = comp.readback();
  return { w: px.w, h: px.h, jmeno: scene.jmeno, count: scene.count, b64: base64(px.rgba) };
};
