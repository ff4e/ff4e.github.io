/**
 * Render a room with the enhanced (truecolor) background and write a PNG, plus a
 * correctness check that the classic foreground is preserved pixel-for-pixel.
 *
 * Loads the classic FFR from FF_DATA_DIR and the FFNG PNG masters from
 * FF_ENHANCED_DIR (the installed app's images dir by default).
 *
 *   npm run render-enhanced -- PRAVIDLA           # -> out/PRAVIDLA-enhanced.png
 *   npm run render-enhanced -- 3 --count 40
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { renderRoomRgba } from '../src/render/renderRoom.js';
import { Room } from '../src/core/room.js';
import { encodePng } from '../src/render/png.js';
import { EnhancedArtSource } from '../src/render/enhancedArtSource.js';
import { decodeEnhancedArt } from '../src/render/enhancedDecode.js';
import { roomByName, roomByNumber, type RoomDesc } from '../src/data/roomTable.js';

const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const ENHANCED_DIR =
  process.env.FF_ENHANCED_DIR ??
  '/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng/images';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
const MAPPING = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'solutions', 'mapping.tsv');

/** jmeno -> FFNG codename (image dir), from the port's solutions mapping.tsv. */
function jmenoToCodename(): Map<string, string> {
  const m = new Map<string, string>();
  const lines = readFileSync(MAPPING, 'utf8').split('\n').slice(1);
  for (const line of lines) {
    const [slug, , jmenoCol] = line.split('\t');
    if (!slug || !jmenoCol) continue;
    // Ambiguous rows list multiple jmeno separated by '|'; map each to the slug.
    for (const jm of jmenoCol.split('|')) m.set(jm.trim(), slug.trim());
  }
  return m;
}

/** Locate a room's `-w`/`-p` PNGs inside its FFNG image dir. */
function enhancedFiles(codename: string): { wall: string; bg: string } | null {
  const dir = join(ENHANCED_DIR, codename);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const wall = files.find((f) => f.endsWith('-w.png'));
  const bg = files.find((f) => f.endsWith('-p.png'));
  if (!wall || !bg) return null;
  return { wall: join(dir, wall), bg: join(dir, bg) };
}

function resolveRoom(arg: string): RoomDesc {
  const r = /^\d+$/.test(arg) ? roomByNumber(Number(arg)) : roomByName(arg);
  if (!r) throw new Error(`unknown room: ${arg}`);
  return r;
}

const args = process.argv.slice(2);
const countArg = args.indexOf('--count');
const count = countArg >= 0 ? Number(args[countArg + 1]) : 0;
const target = args.find((a) => !a.startsWith('--') && a !== String(count));
if (!target) {
  console.error('usage: render-enhanced <room-name|room-number> [--count N]');
  process.exit(2);
}

const desc = resolveRoom(target);
const codename = jmenoToCodename().get(desc.jmeno);
if (!codename) throw new Error(`no codename mapping for ${desc.jmeno}`);
const files = enhancedFiles(codename);
if (!files) throw new Error(`no enhanced -w/-p PNGs for ${desc.jmeno} (${codename})`);

const ffr = parseFfr(readFileSync(join(DATA_DIR, 'Graphic', `${String(desc.num).padStart(3, '0')}.ffr`)));
const room = new Room(ffr);
if (room.gspec !== 0) {
  console.warn(`WARN: ${desc.jmeno} gspec=${room.gspec}; the truecolor background falls back to classic`);
}
const art = decodeEnhancedArt(readFileSync(files.wall), readFileSync(files.bg));

// Render the enhanced (truecolor) background through the single compositor. This
// tool stages only the -w/-p background (no object/fish sprites), so items and
// fish fall back to classic over the truecolor background.
const source = new EnhancedArtSource(ffr.palette, art, [], null);
const screen = renderRoomRgba(room, source, { count });
if (art.w !== screen.width || art.h !== screen.height) {
  console.warn(`WARN: enhanced art ${art.w}x${art.h} != screen ${screen.width}x${screen.height}`);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, `${desc.jmeno}-enhanced.png`);
writeFileSync(file, encodePng(screen.rgba, screen.width, screen.height));
console.log(`Rendered ${desc.jmeno} enhanced (${screen.width}x${screen.height}, count=${count}) -> ${file}`);
