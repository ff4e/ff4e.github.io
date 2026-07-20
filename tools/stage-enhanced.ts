/**
 * Stage the GPL fillets-ng-data truecolor background masters into the repo so
 * enhanced graphics mode can ship them. For each of the 72 rooms it maps
 * jmeno -> FFNG codename (via test/fixtures/solutions/mapping.tsv), finds the
 * room's `*-w.png` (wall) + `*-p.png` (background) in the installed images dir,
 * and copies them to public/enhanced/<JMENO>/{w,p}.png.
 *
 * Optionally verifies each master's pixel size matches the room's screen
 * (grid*FSIZE) and that the room is enhance-eligible, warning (not failing) on
 * mismatch so those rooms simply fall back to classic at runtime.
 *
 *   FF_ENHANCED_DIR=/path/to/fillets-ng/images npm run stage-enhanced
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { renderRoomState, FSIZE } from '../src/render/renderRoom.js';
import { ROOMS } from '../src/data/roomTable.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENHANCED_DIR =
  process.env.FF_ENHANCED_DIR ??
  '/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng/images';
const SCRIPT_DIR = join(dirname(ENHANCED_DIR), 'script');
const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const MAPPING = join(ROOT, 'test', 'fixtures', 'solutions', 'mapping.tsv');
const OUT_ROOT = join(ROOT, 'public', 'enhanced');

function jmenoToCodename(): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of readFileSync(MAPPING, 'utf8').split('\n').slice(1)) {
    const [slug, , jmenoCol] = line.split('\t');
    if (!slug || !jmenoCol) continue;
    for (const jm of jmenoCol.split('|')) m.set(jm.trim(), slug.trim());
  }
  // Rooms whose FFNG codename mapping.tsv doesn't cover (verified via their
  // script/<cn>/models.lua createRoom background filename).
  for (const [jmeno, cn] of Object.entries(CODENAME_OVERRIDE)) {
    if (!m.has(jmeno)) m.set(jmeno, cn);
  }
  return m;
}

/** jmeno -> FFNG codename for rooms missing from mapping.tsv. */
const CODENAME_OVERRIDE: Record<string, string> = {
  ZELVA: 'turtle',
  BARELY: 'barrel',
  GRAL: 'grail',
  PARTY2: 'party2',
  POHON: 'propulsion',
  SPUNT: 'atlantis',
  LODE: 'gods',
  DISKETA: 'floppy',
  MAPA: 'map',
  CHODBA: 'corridor',
};

/**
 * The room's background + wall PNG filenames from its models.lua — authoritative
 * (FFNG names them inconsistently: pozadi.png, vrak-okoli.png, kajuta1w.png,
 * bathroom-zed.png, ...). `createRoom(w,h,"images/<cn>/<bg>.png")` gives the
 * background; the first `addItemAnim(room, "images/<cn>/<wall>.png")` gives the
 * wall. Handles the Lua `"images/"..codename.."/<file>.png"` concatenation.
 */
function roomBgWall(lua: string): { bg?: string; wall?: string } {
  // Anchor on the last "/<file>.png" before the closing paren (greedy [^)]* + /)
  // to avoid catastrophic backtracking from a lazy [^)]*? overlapping [\w-]+.
  const bgM = /createRoom\([^)]*\/([\w-]+)\.png"/.exec(lua);
  const wallM = /addItemAnim\(\s*room\b[^)]*\/([\w-]+)\.png"/.exec(lua);
  const out: { bg?: string; wall?: string } = {};
  if (bgM) out.bg = `${bgM[1]}.png`;
  if (wallM) out.wall = `${wallM[1]}.png`;
  return out;
}

function pngSize(path: string): { w: number; h: number } {
  const d = readFileSync(path);
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
}

const map = jmenoToCodename();
let staged = 0;
let skipped = 0;
const warnings: string[] = [];

for (const room of ROOMS) {
  const codename = map.get(room.jmeno);
  if (!codename) {
    skipped++;
    continue;
  }
  const dir = join(ENHANCED_DIR, codename);
  const modelsPath = join(SCRIPT_DIR, codename, 'models.lua');
  if (!existsSync(dir) || !existsSync(modelsPath)) {
    skipped++;
    continue;
  }
  const { bg, wall } = roomBgWall(readFileSync(modelsPath, 'utf8'));
  // Require both a truecolor background and wall layer for the -w/-p compositor.
  if (!wall || !bg || !existsSync(join(dir, wall)) || !existsSync(join(dir, bg))) {
    skipped++;
    if (bg || wall) warnings.push(`${room.jmeno} (${codename}): incomplete bg/wall (bg=${bg ?? '-'} wall=${wall ?? '-'})`);
    continue;
  }

  // Verify against the classic room (dims + eligibility) when the FFR is present.
  const ffrPath = join(DATA_DIR, 'Graphic', `${String(room.num).padStart(3, '0')}.ffr`);
  if (existsSync(ffrPath)) {
    try {
      const ffr = parseFfr(readFileSync(ffrPath));
      const screen = renderRoomState(new Room(ffr));
      const ws = pngSize(join(dir, wall));
      if (ws.w !== screen.width || ws.h !== screen.height) {
        warnings.push(`${room.jmeno}: art ${ws.w}x${ws.h} != screen ${screen.width}x${screen.height} (will fall back)`);
      }
      if (new Room(ffr).gspec !== 0) {
        warnings.push(`${room.jmeno}: gspec != 0 (darkness/ZX/bonus) — bg staged but classic background used`);
      }
    } catch (e) {
      warnings.push(`${room.jmeno}: FFR check failed: ${(e as Error).message}`);
    }
  }

  const outDir = join(OUT_ROOT, room.jmeno);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'w.png'), readFileSync(join(dir, wall)));
  writeFileSync(join(outDir, 'p.png'), readFileSync(join(dir, bg)));

  // Animated wall (STEEL red-alert): the wall file has a `_NN` frame suffix and
  // multiple frames exist. Stage the extra wall frames (w1.png, w2.png…) and the
  // matching background frames (p1.png…) — the classic renderer switches both in
  // lockstep with the wall item's afaze (Bgfaze === afaze).
  const wm = /^(.*)_(\d+)\.png$/.exec(wall);
  if (wm) {
    const wallFrames = readdirSync(dir)
      .filter((f) => new RegExp(`^${wm[1]}_\\d+\\.png$`).test(f))
      .sort();
    if (wallFrames.length > 1) {
      // Background frames share a base with a trailing digit (e.g. steel-pozadi0).
      const bgBase = bg.replace(/(\d+)\.png$/, '');
      const bgFrames = readdirSync(dir)
        .filter((f) => new RegExp(`^${bgBase}\\d+\\.png$`).test(f))
        .sort();
      const n = Math.min(wallFrames.length, bgFrames.length);
      for (let f = 1; f < n; f++) {
        writeFileSync(join(outDir, `w${f}.png`), readFileSync(join(dir, wallFrames[f]!)));
        writeFileSync(join(outDir, `p${f}.png`), readFileSync(join(dir, bgFrames[f]!)));
      }
      if (n > 1) warnings.push(`${room.jmeno}: staged ${n} animated wall+bg frames`);
    }
  }
  staged++;
}

console.log(`Staged ${staged} rooms to ${OUT_ROOT} (${skipped} without a usable master).`);
if (warnings.length) console.log('Warnings:\n  ' + warnings.join('\n  '));
void FSIZE;
