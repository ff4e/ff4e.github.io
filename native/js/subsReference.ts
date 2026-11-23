/**
 * Browser reference for the native subtitles: each case of `subtitleScene.ts` drawn by the
 * game's REAL subtitle renderer, `syncDomSubtitles` (src/app/subtitleDom.ts), into its real
 * layer, over black. Served at /native/subs-reference.html and driven by
 * native/compare-subs.mjs, which screenshots the room's box.
 *
 * The layer animates each glyph's wave on the compositor from the moment it is built, with
 * the line's age folded into the animation's delay. Every animation is paused at time 0 as
 * soon as the layer is built, which is the state at the case's tick exactly — the same
 * instant the native side lays out.
 */
import { clearDomSubtitles, syncDomSubtitles } from '../../src/app/subtitleDom.js';
import { wrap } from '../../src/app/dom.js';
import { SUB_CASES, buildSubScene } from './subtitleScene.js';
import { SUB_FACES } from './subtitleFonts.js';

async function readBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`missing ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The browser's subtitle families (boot.ts), by `SUB_FACES` name. */
const FAMILY: Record<string, [string, string, string, string]> = {
  'Mulish Medium': ['Mulish', '/fonts/Mulish.ttf', '100 900', 'Mulish, sans-serif'],
  'Manrope Medium': ['Manrope', '/fonts/Manrope.ttf', '100 900', 'Manrope, sans-serif'],
  'Jost Medium': ['Jost', '/fonts/Jost.ttf', '100 900', 'Jost, sans-serif'],
  'FreeSans Bold': ['FFSubtitle', '/enhanced/subtitle.ttf', '700', 'FFSubtitle, sans-serif'],
};

const loaded = new Set<string>();

wrap.style.cssText = 'position:absolute;left:0;top:0';
document.body.appendChild(wrap);

(window as unknown as Record<string, unknown>).__refSubs = async (name: string) => {
  const c = SUB_CASES.find((x) => x.name === name);
  if (!c) throw new Error(`no subtitle case ${name}`);
  const scene = await buildSubScene(c, readBytes);
  const faceName = scene.face ?? SUB_FACES[0]!.name;
  const [family, url, range, css] = FAMILY[faceName]!;
  if (!loaded.has(family)) {
    const face = new FontFace(family, (await readBytes(url)).buffer as ArrayBuffer, { weight: range });
    document.fonts.add(await face.load());
    loaded.add(family);
  }
  const weight = SUB_FACES.find((f) => f.name === faceName)!.weight;
  clearDomSubtitles();
  const { cssW, cssH, boxScale, textScale } = scene.box;
  syncDomSubtitles('room', scene.sys, scene.count, cssW, cssH, boxScale, textScale, css, String(weight));
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = 0;
  }
  // The room's box: inside the layer's 1px border, where #screen's content is.
  return { x: 1, y: 1, w: cssW, h: cssH, devW: scene.devW, devH: scene.devH, density: scene.density };
};

/** Decode a screenshot (PNG bytes, base64) to RGBA, base64 — the page has the decoder. */
(window as unknown as Record<string, unknown>).__decodePng = async (b64: string) => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  let out = '';
  for (let i = 0; i < px.length; i += 0x8000) out += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return { w: bmp.width, h: bmp.height, b64: btoa(out) };
};
