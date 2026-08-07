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
 * Models whose authored grid cell does NOT equal their FFR item's (xStart,yStart).
 *
 * Why this exists: the positional match below is the whole binding rule, and a model one
 * cell off is silently dropped as decor. That quietly cost 8 object animations here (plus
 * a ninth, ZAVER's, to a different bug) — every one present in fillets-ng-data, and every
 * one rendering as a classic bitmap inside an otherwise truecolor (and, at the ai tier,
 * ×4) room.
 *
 * They are listed explicitly rather than recovered by loosening the matcher to "nearest
 * unbound item of the same shape". That alternative was MEASURED, not merely disliked:
 * across all 71 staged rooms it changes no existing binding, but it recovers only KOSTE,
 * REAKTOR and ZX. It cannot recover PARTY2 at all, because all six of that room's window
 * figures occupy the SAME cell (22,16) with the SAME one-cell shape — there is no
 * geometric signal to tell them apart, only models.lua order. So a shape rule would leave
 * this table in place for PARTY2 anyway, and we would be maintaining a fuzzy implicit
 * rule AND a table instead of just a table.
 *
 * `expect` is what makes the table safe to hand-maintain: the binding is not taken on
 * trust, it is CHECKED at staging time against the sprite the model actually carries and
 * the frame count the FFR reserves for that item (the gap to the next item's `bmp`). A
 * mistyped index has to disagree with one of those to be wrong, and then it throws rather
 * than silently shipping art on the wrong object.
 */
interface ItemOverride {
  /** The MODEL's authored cell in models.lua — the key we match on. */
  readonly modelX: number;
  readonly modelY: number;
  /** The FFR item index it really is. */
  readonly item: number;
  /** First frame file, i.e. the FFNG sprite name — which is the item's Delphi name. */
  readonly firstFrame: string;
  /** How many animation frames, cross-checked against the FFR's bitmap range. */
  readonly frames: number;
}

const ITEM_OVERRIDES: Record<string, readonly ItemOverride[]> = {
  // `metla`, the broom.
  KOSTE: [{ modelX: 21, modelY: 6, item: 2, firstFrame: 'koste_00.png', frames: 3 }],
  // `pld`, the blob creature.
  REAKTOR: [{ modelX: 3, modelY: 16, item: 18, firstFrame: 'pld_00.png', frames: 16 }],
  // `knight`, the marching knightik.
  ZX: [{ modelX: 42, modelY: 2, item: 13, firstFrame: 'knight_00.png', frames: 7 }],
  // The window figures. The FFR co-locates ALL SIX at (22,16) and reveals them one at a
  // time (they are spec=11 until the script shows them), while FFNG spreads them along
  // row 17. Only `kuk` (item 17) is authored at (22,16), so the other five never matched.
  // Order is models.lua order; the frame counts are what disambiguates it.
  PARTY2: [
    { modelX: 21, modelY: 17, item: 18, firstFrame: 'ruka_00.png', frames: 7 },
    { modelX: 23, modelY: 17, item: 19, firstFrame: 'frkavec_00.png', frames: 7 },
    { modelX: 25, modelY: 17, item: 20, firstFrame: 'hnat_00.png', frames: 22 },
    { modelX: 27, modelY: 17, item: 21, firstFrame: 'lahev_00.png', frames: 15 },
    { modelX: 29, modelY: 17, item: 22, firstFrame: 'frk_00.png', frames: 2 },
  ],
};

/**
 * How many bitmaps the FFR reserves for an item: the gap to the next item's first bitmap
 * (`numBmp` bounds the last one). This is NOT a general frame count — items routinely
 * SHARE a bitmap range (PARTY2's three `14-ocel` steel blocks, VITEJTE1's six crabs all
 * point at one range), so a mismatch proves nothing on its own. It is used only to
 * cross-check the overrides above, where every target item owns its range exclusively.
 */
function ffrFrameCount(ffr: { itemCount: number; numBmp: number; items: readonly { bmp: number }[] }, item: number): number {
  const next = item + 1 <= ffr.itemCount ? ffr.items[item + 1]!.bmp : ffr.numBmp + 1;
  return next - ffr.items[item]!.bmp;
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
    const overrides = ITEM_OVERRIDES[room.jmeno] ?? [];
    for (const e of entries) {
      const key = `${e.x},${e.y}`;
      // An explicit override wins over the positional match: it exists precisely
      // because FFNG's authored cell is not the item's, so the lookup below would
      // either miss or (worse) land on some unrelated item that happens to sit there.
      // Note it also skips the `cursor` bookkeeping, which is what it must do — the
      // forced model is NOT one of the co-located models that cursor is sequencing
      // (PARTY2: `kuk` still takes (22,16) slot 0 while the five forced figures,
      // authored a row lower, never touch that counter).
      const forced = overrides.find((o) => o.modelX === e.x && o.modelY === e.y);
      if (forced) {
        e.item = forced.item;
        continue;
      }
      const items = posToItems.get(key);
      if (items && items.length > 0) {
        const c = cursor.get(key) ?? 0;
        e.item = items[Math.min(c, items.length - 1)]!;
        cursor.set(key, c + 1);
      }
    }
    // Validate the hand-maintained table against reality rather than trusting it. Each
    // check corresponds to a way a mistyped entry could ship silently: a bad index
    // becomes a manifest entry the runtime ignores; a stale position becomes a dropped
    // sprite; a wrong item lands correct-looking art on the wrong object, which no
    // amount of "is anything missing?" checking can see.
    const claimed = new Set<number>();
    for (const o of overrides) {
      const at = `${room.jmeno} (${o.modelX},${o.modelY})`;
      if (o.item < 1 || o.item > ffr.itemCount) {
        throw new Error(`ITEM_OVERRIDES ${at} -> item ${o.item}: no such item (1..${ffr.itemCount})`);
      }
      const model = entries.find((e) => e.x === o.modelX && e.y === o.modelY);
      if (!model) throw new Error(`ITEM_OVERRIDES ${at}: no models.lua model at that position`);
      if (model.frames[0] !== o.firstFrame) {
        throw new Error(`ITEM_OVERRIDES ${at}: expected sprite ${o.firstFrame}, models.lua has ${model.frames[0]}`);
      }
      if (model.frames.length !== o.frames) {
        throw new Error(`ITEM_OVERRIDES ${at}: expected ${o.frames} frames, FFNG ships ${model.frames.length}`);
      }
      const reserved = ffrFrameCount(ffr, o.item);
      if (reserved !== o.frames) {
        throw new Error(`ITEM_OVERRIDES ${at} -> item ${o.item}: FFR reserves ${reserved} bitmaps, sprite has ${o.frames}`);
      }
      if (claimed.has(o.item)) throw new Error(`ITEM_OVERRIDES ${at}: item ${o.item} is claimed twice`);
      claimed.add(o.item);
      // A forced item that a POSITIONAL match also lands on would be double-bound, and
      // drawItem blits every object carrying the index — two stacked sprites, silently.
      const alsoPositional = entries.some(
        (e) => e.item === o.item && !(e.x === o.modelX && e.y === o.modelY),
      );
      if (alsoPositional) throw new Error(`ITEM_OVERRIDES ${at}: item ${o.item} is also matched positionally`);
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
