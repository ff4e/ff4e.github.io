/**
 * Stage enhanced OBJECT sprites (Phase 3a) for each room, driven by FFNG's
 * script/<codename>/models.lua. For every `addModel("item_*", X, Y, ...)` +
 * `addItemAnim(var, "images/<codename>/<file>.png")` pair it:
 *   - matches the FFR item by position (X == xStart, Y == yStart), or by the
 *     explicit ITEM_OVERRIDES entry where FFNG's authored cell disagrees,
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
import { jmenoToCodename } from './lib/ffngCodename.js';

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

/**
 * Models whose authored grid cell does NOT equal their FFR item's (xStart,yStart),
 * keyed by room and then by the MODEL's own "x,y" -> the FFR item index it really is.
 *
 * Why this exists: the positional match below is the whole binding rule, and a model one
 * cell off is silently dropped as decor. That quietly cost 21 sprites — every one of them
 * present in fillets-ng-data, and every one of them rendering as a classic bitmap inside
 * an otherwise truecolor (and, at the ai tier, ×4) room. They are listed explicitly
 * rather than fixed by loosening the matcher to "nearest model of the same shape",
 * because a looser rule re-derives the bindings of all 72 rooms and could silently move
 * art that is already correct; this table can only ADD.
 *
 * Each entry is pinned by three independent signals, not by proximity: the item's cell
 * SHAPE equals the model's, the FFNG sprite NAME is the item's Delphi name, and the frame
 * count implied by the FFR bitmap range equals the number of FFNG frame files.
 *
 *  - KOSTE 2   `metla`, the broom               — FFNG (21,6)  vs FFR (20,6)
 *  - REAKTOR 18 `pld`, the blob creature        — FFNG (3,16)  vs FFR (3,15)
 *  - ZX 13     `knight`, the marching knightik  — FFNG (42,2)  vs FFR (41,2)
 *  - PARTY2 18..22, the window figures — a different miss: the FFR co-locates ALL SIX
 *    figures at (22,16) and reveals them one at a time (they are spec=11 until the script
 *    shows them), while FFNG spreads them along row 17. Only `kuk` (item 17) is authored
 *    at (22,16), so the other five never matched. The order below is models.lua order,
 *    confirmed against the FFR bitmap ranges: items 17..22 want 24/7/7/22/15/2 frames and
 *    kuk/ruka/frkavec/hnat/lahev/frk ship exactly 24/7/7/22/15/2.
 *
 * ZAVER's creature needs no entry — `pldik` is authored at exactly the FFR item's cell.
 * It was missing because the ROOM resolved to the wrong FFNG level; see
 * CODENAME_WRONG in lib/ffngCodename.ts.
 */
const ITEM_OVERRIDES: Record<string, Record<string, number>> = {
  KOSTE: { '21,6': 2 },
  REAKTOR: { '3,16': 18 },
  ZX: { '42,2': 13 },
  PARTY2: { '21,17': 18, '23,17': 19, '25,17': 20, '27,17': 21, '29,17': 22 },
};

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

const map = jmenoToCodename(MAPPING);
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
    const overrides = ITEM_OVERRIDES[room.jmeno] ?? {};
    for (const e of entries) {
      const key = `${e.x},${e.y}`;
      // An explicit override wins over the positional match: it exists precisely
      // because FFNG's authored cell is not the item's, so the lookup below would
      // either miss or (worse) land on some unrelated item that happens to sit there.
      const forced = overrides[key];
      if (forced !== undefined) {
        e.item = forced;
        continue;
      }
      const items = posToItems.get(key);
      if (items && items.length > 0) {
        const c = cursor.get(key) ?? 0;
        e.item = items[Math.min(c, items.length - 1)]!;
        cursor.set(key, c + 1);
      }
    }
    // An override naming an item this room does not have is a typo in the table,
    // and would otherwise ship as a manifest entry the runtime silently ignores.
    for (const [key, idx] of Object.entries(overrides)) {
      if (idx < 1 || idx > ffr.itemCount) {
        throw new Error(`ITEM_OVERRIDES[${room.jmeno}]["${key}"] = ${idx}: no such item (1..${ffr.itemCount})`);
      }
      if (!entries.some((e) => `${e.x},${e.y}` === key)) {
        throw new Error(`ITEM_OVERRIDES[${room.jmeno}]["${key}"]: no models.lua model at that position`);
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
