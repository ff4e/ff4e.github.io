/**
 * Browser reference for the native spike: the SAME scene module as the native entry,
 * rendered by the real WebGL2 backend (`GlAiScreen`), read back for comparison.
 * Served by the dev server at /native/reference.html and driven by native/compare.mjs.
 */
import { GlAiScreen } from '../../src/render/glRoomAi.js';
import { compositeSize, frameFor, loadScene, pinRandom, probeFrame, replaySolution } from './scene.js';

interface RefOpts { room: number; replay?: number; still?: boolean; alpha?: number; probe?: boolean }

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`missing ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

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
  // Base64 in 32 KB chunks: one String.fromCharCode over 20 MB would blow the stack.
  let bin = '';
  for (let i = 0; i < px.rgba.length; i += 0x8000) bin += String.fromCharCode(...px.rgba.subarray(i, i + 0x8000));
  return { w: px.w, h: px.h, jmeno: scene.jmeno, count: scene.count, b64: btoa(bin) };
};
