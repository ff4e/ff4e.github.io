/**
 * Stage the `ai` tier's ×4 art for SCORE — the one room the upscaler never saw.
 *
 * ── Why this room needs its own tool ──────────────────────────────────────────
 * Every other room's `ai` art is upscaled from FFNG's truecolor masters
 * (`tools/studio/build-ai.mjs`, sourced from the installed Fillets app). SCORE has no
 * FFNG level at all, so it has no master to upscale, so it was skipped — it is absent
 * from `tools/studio/index.json`'s 71 rooms.
 *
 * The consequence was measurable and visible: SCORE is the ONLY room in the game whose
 * `ai` tier never engages. With no `ai.json`, `loadAiRoom` resolves null,
 * `aiRoomRenderActive` is false and the room composites at NATIVE resolution — measured
 * at a 600 px backing store stretched to a 739 px CSS box, while all 71 other rooms
 * composite at ×4. It is the one soft room in the tier.
 *
 * ── Nearest-neighbour, deliberately ───────────────────────────────────────────
 * The upscale is a plain ×4 pixel replication — `ffmpeg scale=flags=neighbor`, the same
 * operation the studio pipeline calls its `orig` model (`tools/studio/lib/upscale.mjs`
 * MODELS[0], `model: null`). No network, no invented detail.
 *
 * That is the only defensible choice here, and for a stronger reason than taste: this
 * room has no truecolor original ANYWHERE. For every other room an AI upscale is
 * guessing at detail that FFNG's own artists really drew; for SCORE it would be
 * inventing detail that has never existed in any version of this game. Fidelity to the
 * 1998 art is the project's whole value, so the room is magnified, not imagined — every
 * output pixel is exactly one input pixel, repeated.
 *
 * Lossless WebP for the same reason. The other rooms ship q92, which is right for
 * photographic upscales and wrong for flat 256-colour art: lossy encoding rings around
 * the hard palette edges this room is made of.
 *
 * ── Provenance ────────────────────────────────────────────────────────────────
 * The source is `public/data/Graphic/072.ffr`, in this repo — so unlike every other
 * room, SCORE's `ai` art can be regenerated from scratch by anyone, with no external
 * install and no model weights. Re-run this tool and the bytes come back identical.
 *
 *   npx tsx tools/stage-score.ts            # writes public/enhanced-ai/SCORE/
 *   npx tsx tools/stage-score.ts --check    # verify the shipped bytes match, write nothing
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FFR_EXTRA, parseFfr, type FfrRoom } from '../src/data/ffr.js';
import { encodePng } from '../src/render/png.js';

const ROOT = process.cwd();
const FFR = join(ROOT, 'public/data/Graphic/072.ffr');
const OUT = join(ROOT, 'public/enhanced-ai/SCORE');
const SCALE = 4;

/**
 * The wall layer: the room's own wall bitmap, with its mask index turned transparent.
 *
 * This is what a staged `w.png` IS for every other room — a screen-sized RGBA image whose
 * alpha carries the doorway holes (`RgbaScreen.blit2Rgba` reads it at `(i*W + j) << 2`,
 * i.e. unpadded and one texel per screen pixel).
 */
export function wallRgba(ffr: FfrRoom): { w: number; h: number; rgba: Uint8Array } {
  const item = ffr.items[0]!; // Room.wallItem
  const bmp = ffr.bitmaps[item.bmp]!;
  const out = new Uint8Array(bmp.w * bmp.h * 4);
  for (let i = 0; i < bmp.h; i++) {
    for (let j = 0; j < bmp.w; j++) {
      const idx = bmp.pixels[i * bmp.w + j]!;
      const o = (i * bmp.w + j) * 4;
      if (idx === item.mask) continue; // transparent: the background shows through
      const c = ffr.palette[idx] ?? { r: 0, g: 0, b: 0 };
      out[o] = c.r;
      out[o + 1] = c.g;
      out[o + 2] = c.b;
      out[o + 3] = 255;
    }
  }
  return { w: bmp.w, h: bmp.h, rgba: out };
}

/**
 * The background layer, unpadded.
 *
 * Background bitmaps are read with `ReadBitMapExtra` and carry `FFR_EXTRA` columns of
 * slack on each side so the water wobble can shift them without sampling out of bounds
 * (SCORE's is 620 wide for a 600-wide room, and it does wobble: wamp=5). The staged
 * master is SCREEN-sized and the wobble is applied to it at draw time instead
 * (`blit2Rgba` clamps `j + k` into the screen), so the slack is dropped here — taking
 * the columns the unshifted room shows, which is `FFR_EXTRA` in.
 */
export function bgRgba(ffr: FfrRoom, w: number, h: number): { w: number; h: number; rgba: Uint8Array } {
  const bmp = ffr.bitmaps[1]!; // Room.bgBmp
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const idx = bmp.pixels[i * bmp.w + (j + FFR_EXTRA)]!;
      const c = ffr.palette[idx] ?? { r: 0, g: 0, b: 0 };
      const o = (i * w + j) * 4;
      out[o] = c.r;
      out[o + 1] = c.g;
      out[o + 2] = c.b;
      out[o + 3] = 255;
    }
  }
  return { w, h, rgba: out };
}

/**
 * ×SCALE by pixel replication, then WebP — the same two binaries the studio pipeline
 * uses (`generateVariant` for the `orig` model, then `toWebp`), in the same order.
 *
 * `-pix_fmt rgba` on the ffmpeg step is load-bearing and copied from that pipeline for
 * the reason its comment gives: letting ffmpeg choose re-encodes to pal8 and LOSES the
 * tRNS transparency, turning the wall's doorway holes opaque.
 *
 * `cwebp -lossless -exact` rather than the pipeline's q90. Lossy is right for a
 * photographic upscale and wrong for flat 256-colour art — it rings around exactly the
 * hard palette edges this room is made of. `-exact` keeps the RGB under fully
 * transparent pixels, which lossless alone does not promise.
 */
function upscale(srcPng: string, dstWebp: string, tmp: string): void {
  const big = join(tmp, 'big.png');
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-i', srcPng,
    '-vf', `scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor`,
    '-pix_fmt', 'rgba',
    big,
  ]);
  execFileSync('cwebp', ['-quiet', '-lossless', '-exact', big, '-o', dstWebp]);
}

/**
 * Everything below is the CLI. Guarded so the two layer functions above can be imported
 * and tested — they are the part that can be wrong (the FFR_EXTRA offset, the mask
 * index), and testing them needs no ffmpeg, no cwebp and no shipped bytes.
 */
const isCli = process.argv[1]?.endsWith('stage-score.ts') === true;
if (isCli) main();

function main(): void {
const check = process.argv.includes('--check');
const ffr = parseFfr(new Uint8Array(readFileSync(FFR)));
const wall = wallRgba(ffr);
const bg = bgRgba(ffr, wall.w, wall.h);

const tmp = mkdtempSync(join(tmpdir(), 'ff4e-score-'));
const dest = check ? mkdtempSync(join(tmpdir(), 'ff4e-score-out-')) : OUT;
try {
  mkdirSync(dest, { recursive: true });
  for (const [name, layer] of [['w', wall], ['p', bg]] as const) {
    const src = join(tmp, `${name}.png`);
    writeFileSync(src, encodePng(layer.rgba, layer.w, layer.h));
    upscale(src, join(dest, `${name}.webp`), tmp);
  }
  // `objects` is deliberately EMPTY, and that is not an omission. An item with no
  // manifest entry is drawn by `AiRoom.drawClassicItem` — the room's own FFR bitmap
  // rendered to an ×S canvas with `imageSmoothingEnabled = false`, which is pixel-for-
  // pixel the same nearest ×4 this tool would otherwise have written to a file. Staging
  // them would add ~12 assets, ~12 more requests per entry, and change nothing on screen.
  const manifest = { scale: SCALE, bg: ['p.webp'], wall: ['w.webp'], objects: [] };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(dest, 'ai.json'), json);

  if (check) {
    let bad = 0;
    for (const f of ['w.webp', 'p.webp', 'ai.json']) {
      const shipped = join(OUT, f);
      if (!existsSync(shipped)) { console.error(`  MISSING ${f}`); bad++; continue; }
      const same = Buffer.compare(readFileSync(shipped), readFileSync(join(dest, f))) === 0;
      console.log(`  ${same ? 'ok     ' : 'DIFFERS'} ${f}`);
      if (!same) bad++;
    }
    console.log(bad === 0 ? 'SCORE ai art matches this tool' : `${bad} file(s) differ`);
    process.exit(bad === 0 ? 0 : 1);
  }
  console.log(`wrote ${dest}: ${wall.w}x${wall.h} -> ${wall.w * SCALE}x${wall.h * SCALE} (nearest x${SCALE})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (check) rmSync(dest, { recursive: true, force: true });
}
}
