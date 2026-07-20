/**
 * Stage enhanced OBJECT sprites (Phase 3a) for each room, driven by FFNG's
 * script/<codename>/models.lua. For every `addModel("item_*", X, Y, ...)` +
 * `addItemAnim(var, "images/<codename>/<file>.png")` pair it:
 *   - matches the FFR item by position (X == xStart, Y == yStart),
 *   - collects the sprite's animation frames (`<base>_00..0N.png`, or one file),
 *   - copies them to public/enhanced/<JMENO>/obj/,
 *   - records the mapping in public/enhanced/<JMENO>/objects.json.
 *
 * Fish (addFishAnim) are handled separately (Phase 3b) and skipped here.
 *
 *   FF_ENHANCED_DIR=/path/to/fillets-ng/images npm run stage-enhanced-objects
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFfr } from '../src/data/ffr.js';
import { ROOMS } from '../src/data/roomTable.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES_DIR =
  process.env.FF_ENHANCED_DIR ??
  '/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng/images';
const SCRIPT_DIR = join(dirname(IMAGES_DIR), 'script');
const DATA_DIR = process.env.FF_DATA_DIR ?? join(homedir(), '.cache', 'ffng-orig', 'extracted', 'MAINDIR');
const MAPPING = join(ROOT, 'test', 'fixtures', 'solutions', 'mapping.tsv');
const OUT_ROOT = join(ROOT, 'public', 'enhanced');

interface ObjEntry {
  x: number;
  y: number;
  type: string;
  frames: string[];
  /** FFR item index this object binds to (stable as the item moves). */
  item?: number;
}

function jmenoToCodename(): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of readFileSync(MAPPING, 'utf8').split('\n').slice(1)) {
    const [slug, , jmenoCol] = line.split('\t');
    if (!slug || !jmenoCol) continue;
    for (const jm of jmenoCol.split('|')) m.set(jm.trim(), slug.trim());
  }
  // Rooms missing from mapping.tsv (codename verified via script/<cn>/models.lua).
  const overrides: Record<string, string> = {
    ZELVA: 'turtle', BARELY: 'barrel', GRAL: 'grail', PARTY2: 'party2',
    POHON: 'propulsion', SPUNT: 'atlantis', LODE: 'gods', DISKETA: 'floppy', MAPA: 'map',
    CHODBA: 'corridor',
  };
  for (const [jmeno, cn] of Object.entries(overrides)) if (!m.has(jmeno)) m.set(jmeno, cn);
  return m;
}

/** Parse models.lua: addModel(...) followed by addItemAnim(var, ".../<file>.png"). */
function parseModels(lua: string, codename: string, imgDir: string): ObjEntry[] {
  const out: ObjEntry[] = [];
  const dirFiles = existsSync(imgDir) ? readdirSync(imgDir) : []; // read the dir once
  const modelRe = /(\w+)\s*=\s*addModel\(\s*"([^"]+)"\s*,\s*(-?\d+)\s*,\s*(-?\d+)/g;
  const models = [...lua.matchAll(modelRe)];
  for (let i = 0; i < models.length; i++) {
    const m = models[i]!;
    const [, varName, type, xs, ys] = m;
    if (!type!.startsWith('item') || type === 'item_fixed') continue; // skip wall/background
    // Search only this model's block (up to the next addModel) for its sprite —
    // bounds the work and avoids O(n^2) slicing / whole-file scans for fish vars.
    const start = m.index!;
    const end = i + 1 < models.length ? models[i + 1]!.index! : lua.length;
    const block = lua.slice(start, end);
    // Anchor on the last "/<file>.png" before ')' (greedy [^)]* + /); a lazy
    // [^)]*? overlapping [\w-]+ backtracks catastrophically on some rooms.
    const a = new RegExp(`addItemAnim\\(\\s*${varName}\\b[^)]*/([\\w-]+)\\.png"`).exec(block);
    if (!a) continue; // fish (addFishAnim) or no sprite -> skip
    const first = a[1]!; // e.g. "sekera_00" or "misa"
    const base = first.replace(/_\d+$/, '');
    let frames: string[];
    if (/_\d+$/.test(first)) {
      const re = new RegExp(`^${base}_\\d+\\.png$`);
      frames = dirFiles.filter((f) => re.test(f)).sort();
    } else {
      frames = dirFiles.includes(`${first}.png`) ? [`${first}.png`] : [];
    }
    if (frames.length === 0) continue;
    out.push({ x: Number(xs), y: Number(ys), type: type!, frames });
  }
  return out;
}

const map = jmenoToCodename();
let rooms = 0;
let objects = 0;
const warnings: string[] = [];

for (const room of ROOMS) {
  const codename = map.get(room.jmeno);
  if (!codename) continue;
  const imgDir = join(IMAGES_DIR, codename);
  const modelsPath = join(SCRIPT_DIR, codename, 'models.lua');
  if (!existsSync(imgDir) || !existsSync(modelsPath)) continue;

  const entries = parseModels(readFileSync(modelsPath, 'utf8'), codename, imgDir);
  if (entries.length === 0) continue;

  // Cross-check each entry against a real FFR item position (skip unmatched decor)
  // and record the item index so the runtime binds to the (moving) item, not a cell.
  const ffrPath = join(DATA_DIR, 'Graphic', `${String(room.num).padStart(3, '0')}.ffr`);
  let matched = entries;
  if (existsSync(ffrPath)) {
    const ffr = parseFfr(readFileSync(ffrPath));
    // A room can have several items at the SAME (xStart,yStart) — e.g. PARTY1's
    // cabin interior + frame, or its four window figures. Keep ALL item indices
    // per position (ascending) and assign the Nth model at a position to the Nth
    // item there (models.lua order == FFR item order for co-located items), so
    // co-located objects don't all collapse onto the last item index.
    const posToItems = new Map<string, number[]>();
    for (let j = 1; j <= ffr.itemCount; j++) {
      const key = `${ffr.items[j]!.xStart},${ffr.items[j]!.yStart}`;
      const list = posToItems.get(key);
      if (list) list.push(j);
      else posToItems.set(key, [j]);
    }
    const cursor = new Map<string, number>();
    for (const e of entries) {
      const key = `${e.x},${e.y}`;
      const items = posToItems.get(key);
      if (items && items.length > 0) {
        const c = cursor.get(key) ?? 0;
        e.item = items[Math.min(c, items.length - 1)]!;
        cursor.set(key, c + 1);
      }
    }
    matched = entries.filter((e) => e.item !== undefined);
    const unmatched = entries.length - matched.length;
    if (unmatched > 0) warnings.push(`${room.jmeno}: ${unmatched} model(s) with no FFR item at their position (decor/fish, skipped)`);
  }
  if (matched.length === 0) continue;

  const outDir = join(OUT_ROOT, room.jmeno, 'obj');
  mkdirSync(outDir, { recursive: true });
  const seen = new Set<string>();
  for (const e of matched) {
    for (const f of e.frames) {
      if (seen.has(f)) continue;
      seen.add(f);
      writeFileSync(join(outDir, f), readFileSync(join(imgDir, f)));
    }
  }
  writeFileSync(join(OUT_ROOT, room.jmeno, 'objects.json'), JSON.stringify({ objects: matched }, null, 0) + '\n');
  rooms++;
  objects += matched.length;
}

console.log(`Staged objects for ${rooms} rooms (${objects} objects total) to ${OUT_ROOT}.`);
if (warnings.length) console.log('Notes:\n  ' + warnings.join('\n  '));
