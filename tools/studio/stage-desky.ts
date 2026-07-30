/**
 * Stage the WORLD-MAP ROOM-NAME PLAQUES ("desky") into the Upscaler Studio.
 *
 * Hovering a room on the world map — or opening its record panel — shows the room's
 * name on a carved plaque (KresliDesku, UMain.pas:1386). The art is not a font: each
 * plaque is a pre-rendered, palette-indexed RECTANGLE inside a per-language atlas
 * (`desky<n>.dat`, positioned by `popdesk<n>.dat`), blitted OPAQUELY over the map.
 *
 * That opacity is why this matters for the `ai` tier. The rectangle contains the carved
 * lettering AND a slice of the map background behind it, so drawing it at native
 * resolution over the hi-res map pastes a 640×480-resolution patch into an otherwise
 * upscaled picture — a visibly pixelated band around the name, not merely blocky text.
 *
 * 72 plaques per language × 2 languages (1 = cz, 2 = en), 42–303 wide and 15–32 tall.
 * They are expanded to RGBA PNGs under `public/enhanced/_desky/`, from where they flow
 * through the existing pipeline — indexing, per-model generation, Compare, picks and
 * the build — exactly like any other shared art. Mirrors stage-ui.mjs / stage-story.mjs.
 *
 * Written in TypeScript so it can import the REAL parseDesky/BRANCHES from src/ rather
 * than re-implementing the record layout: the plaque→room mapping is branch-major over
 * BRANCHES, which is precisely the kind of ordering rule that rots when copied.
 *
 * The palette is `mapa-0.BMP`'s, the shared menu palette blitDeska resolves against.
 *
 * NOTE these are TEXT. Upscalers are at their worst on lettering, so compare models on
 * a few plaques before batch-applying one to all 144.
 *
 * Idempotent: only rewrites a PNG when the bytes differ, so the Studio's content-hash
 * index and its generated variants stay stable across runs.
 *
 * Usage: npx tsx tools/studio/stage-desky.ts [--force]
 * Then rebuild the index (delete tools/studio/index.json or restart the server).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseDesky } from '../../src/data/desky.js';
import { parseBmp } from '../../src/data/bmp.js';

const studioDir = dirname(fileURLToPath(import.meta.url));
const root = join(studioDir, '..', '..');
const menuDir = join(root, 'public', 'data', 'Menu');
const outDir = join(root, 'public', 'enhanced', '_desky');

const FORCE = process.argv.includes('--force');

/** lang code → the digit the original uses in the filenames. */
const LANGS = [
  { id: 'cz', n: '1' },
  { id: 'en', n: '2' },
] as const;

function encodePng(rgba: Uint8Array, w: number, h: number, dst: string): void {
  const work = mkdtempSync(join(tmpdir(), 'desky-'));
  try {
    const raw = join(work, 'in.rgba');
    writeFileSync(raw, Buffer.from(rgba));
    const r = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', raw,
      '-frames:v', '1', dst,
    ]);
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(0, 200)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function writeIfChanged(dst: string, bytes: Buffer): boolean {
  if (!FORCE && existsSync(dst)) {
    const cur = readFileSync(dst);
    if (cur.length === bytes.length && cur.equals(bytes)) return false;
  }
  writeFileSync(dst, bytes);
  return true;
}

// The plaques index into the shared menu palette, the same one blitDeska uses.
const palette = parseBmp(new Uint8Array(readFileSync(join(menuDir, 'mapa-0.BMP')))).palette;

mkdirSync(outDir, { recursive: true });
let wrote = 0, skipped = 0, total = 0;
const geometry: Record<string, { room: number; x: number; y: number; w: number; h: number }> = {};

for (const lang of LANGS) {
  const pop = join(menuDir, `popdesk${lang.n}.dat`);
  const atlasFile = join(menuDir, `desky${lang.n}.dat`);
  if (!existsSync(pop) || !existsSync(atlasFile)) {
    console.warn(`  ! ${lang.id}: popdesk/desky missing, skipping`);
    continue;
  }
  const data = parseDesky(new Uint8Array(readFileSync(pop)), new Uint8Array(readFileSync(atlasFile)));
  for (const [room, d] of [...data.byRoom.entries()].sort((a, b) => a[0] - b[0])) {
    if (d.dx <= 0 || d.dy <= 0) continue;
    const rgba = new Uint8Array(d.dx * d.dy * 4);
    for (let y = 0; y < d.dy; y++) {
      for (let x = 0; x < d.dx; x++) {
        const idx = data.atlas[d.data + y * d.dx + x];
        const c = idx === undefined ? undefined : palette[idx];
        const o = (y * d.dx + x) * 4;
        rgba[o] = c ? c.r : 0;
        rgba[o + 1] = c ? c.g : 0;
        rgba[o + 2] = c ? c.b : 0;
        rgba[o + 3] = 255;   // KresliDesku blits opaquely — no colour key, no alpha
      }
    }
    const name = `${lang.id}${String(room).padStart(2, '0')}.png`;
    const tmp = join(outDir, `${name}.tmp.png`);
    encodePng(rgba, d.dx, d.dy, tmp);
    const bytes = readFileSync(tmp);
    rmSync(tmp, { force: true });
    if (writeIfChanged(join(outDir, name), bytes)) wrote++; else skipped++;
    total++;
    geometry[name] = { room, x: d.x1, y: d.y1, w: d.dx, h: d.dy };
  }
}

// Where each plaque goes, so the build and the runtime place it without re-parsing the
// .dat files (the offsets DESKA_X_OFFSET/DESKA_Y_OFFSET are applied by the renderer).
writeIfChanged(join(outDir, 'plaques.json'), Buffer.from(JSON.stringify({ plaques: geometry }), 'utf8'));

console.log(`_desky: ${wrote} written, ${skipped} unchanged (${total} plaques across ${LANGS.length} languages) → public/enhanced/_desky`);
