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
 *     for the harness to screenshot what the compositor makes of it.
 */
import { AiCredits, loadAiCredits } from '../../src/render/creditsAi.js';

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
