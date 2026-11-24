/**
 * Browser reference for the native movies and credits, served at /native/media-reference.html
 * and driven by native/compare-media.mjs:
 *
 *   - `__refMovieFrames(url, times)`: the frame a <video> shows at each time — seeked there,
 *     then drawn 1:1 onto a canvas the movie's size, as the intro's <video> element decodes
 *     it (Chromium's own H.264 decoder and YUV conversion);
 *   - `__refMovieAudio(url)`: its sound as Chromium decodes it, at the track's own rate
 *     (an OfflineAudioContext at 22050 Hz does not resample a 22050 Hz track);
 *   - `__refCredits(posun)`: the game's REAL `AiCredits` (src/render/creditsAi.ts) — its two
 *     DOM layers and CSS transform — laid out at the art's own size, at scroll offset `posun`,
 *     for the harness to screenshot what the compositor makes of it;
 *   - `__refStory(ticks)`: KUFRIK's briefcase story at each tick, run silent from its first as
 *     `native/js/storyScene.ts` runs it, painted as the browser's `ai` tier paints it
 *     (`drawCutscene`): the upscaled base, then the shown frame's upscale over the region —
 *     or, for a frame shipped without one, the original pixels through the game's own
 *     `drawIndexedRegion` — on a 2D canvas at the art's scale.
 */
import { AiCredits, loadAiCredits } from '../../src/render/creditsAi.js';
import { KufrDemo } from '../../src/intro/kufrDemo.js';
import { drawIndexedRegion } from '../../src/render/indexedRegion.js';

const b64 = (u8: Uint8Array | Uint8ClampedArray): string => {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(out);
};

const once = (el: EventTarget, ev: string): Promise<void> =>
  new Promise((ok, fail) => {
    el.addEventListener(ev, () => ok(), { once: true });
    el.addEventListener('error', () => fail(new Error(`media error waiting for ${ev}`)), { once: true });
  });

const w = window as unknown as Record<string, unknown>;

w.__refMovieFrames = async (url: string, times: number[]) => {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  await once(v, 'loadeddata');
  const cv = document.createElement('canvas');
  cv.width = v.videoWidth;
  cv.height = v.videoHeight;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const frames: Array<{ t: number; w: number; h: number; b64: string }> = [];
  for (const t of times) {
    v.currentTime = t;
    await once(v, 'seeked');
    ctx.drawImage(v, 0, 0);
    frames.push({ t, w: cv.width, h: cv.height, b64: b64(ctx.getImageData(0, 0, cv.width, cv.height).data) });
  }
  return { duration: v.duration, frames };
};

w.__refMovieAudio = async (url: string) => {
  const bytes = await (await fetch(url)).arrayBuffer();
  const buf = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(bytes);
  const n = buf.length, ch = buf.numberOfChannels;
  const inter = new Float32Array(n * ch);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) inter[i * ch + c] = d[i]!;
  }
  return { rate: buf.sampleRate, channels: ch, b64: b64(new Uint8Array(inter.buffer)) };
};

let credits: AiCredits | null = null;
w.__refCredits = async (posun: number) => {
  if (!credits) {
    credits = await loadAiCredits('/');
    document.body.append(credits.el);
    credits.layout(credits.nativeW * credits.scale, credits.nativeH * credits.scale);
    credits.show();
  }
  credits.setScroll(posun);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { w: credits.nativeW * credits.scale, h: credits.nativeH * credits.scale, delka: credits.delka };
};

w.__refStory = async (ticks: number[]) => {
  const bytes = async (u: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const demo = new KufrDemo(await bytes('/data/Intro/kufr256.BMP'), await bytes('/data/Intro/demo.pck'),
    await (await fetch('/data/Intro/script.txt')).text());
  const man = await (await fetch('/enhanced-ai/_kufr/ai.json')).json() as {
    scale: number; region: { x: number; y: number; w: number; h: number }; order: string[]; original?: string[];
  };
  const img = async (u: string): Promise<ImageBitmap> => createImageBitmap(await (await fetch(u)).blob());
  const base = await img('/enhanced-ai/_kufr/base.webp');
  const S = man.scale, R = man.region;
  const cv = document.createElement('canvas');
  cv.width = demo.width * S;
  cv.height = demo.height * S;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const out: Array<{ tick: number; frame: string; w: number; h: number; b64: string }> = [];
  let t = 0;
  for (const at of ticks) {
    while (t < at) {
      demo.tick(() => 1, () => false);
      t++;
    }
    const name = man.order[Math.max(0, demo.framesShown - 1)] ?? '';
    const shipped = name !== '' && !(man.original ?? []).includes(name);
    ctx.drawImage(base, 0, 0);
    if (shipped) ctx.drawImage(await img(`/enhanced-ai/_kufr/frames/${name}`), R.x * S, R.y * S);
    else drawIndexedRegion(ctx, demo.pixels, demo.palette, demo.width, R, S);
    out.push({ tick: at, frame: shipped ? name : 'pixels', w: cv.width, h: cv.height, b64: b64(ctx.getImageData(0, 0, cv.width, cv.height).data) });
  }
  return out;
};

w.__decodePng = async (data: string) => {
  const bin = atob(data);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, b64: b64(ctx.getImageData(0, 0, bmp.width, bmp.height).data) };
};
w.__mediaReady = true;
