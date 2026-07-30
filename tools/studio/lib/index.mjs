/**
 * Asset index for the Upscaler Studio.
 *
 * Scans public/enhanced/** for PNGs, content-hashes each (md5), and groups them
 * into distinct "pictures" (one decision per hash). Records, per picture: kind
 * (bg/wall/object/fish), pixel dims, alpha flag, and every (room, file, object,
 * frame) it is used by — so a picture shared across rooms (steel pipes, fish,
 * crabs) is a SINGLE entry the studio decides once.
 *
 * Dims + alpha are read straight from the PNG header (no ffprobe fan-out):
 *   IHDR: width@16, height@20, colortype@25 (2=RGB,6=RGBA,4=greyA,3=palette,0=grey);
 *   palette transparency = a tRNS chunk present.
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';

/** Parse width/height/colortype from a PNG buffer; detect tRNS for palette alpha. */
function pngHeader(buf) {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colortype = buf[25];
  let alpha = colortype === 6 || colortype === 4;
  if (colortype === 3) {
    // Scan chunk list for tRNS (palette transparency). Chunks start after IHDR (offset 33).
    let p = 8;
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('ascii', p + 4, p + 8);
      if (type === 'tRNS') { alpha = true; break; }
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
  }
  return { w, h, alpha };
}

function classify(relPath) {
  if (relPath.includes('/_fish/')) return 'fish';
  if (relPath.includes('/_menu/')) return 'menu';
  if (relPath.includes('/_panel/')) return 'panel';
  if (relPath.includes('/_credits/')) return 'credits';
  const b = basename(relPath);
  if (b === 'p.png') return 'bg';
  if (b === 'w.png') return 'wall';
  return 'object';
}

/**
 * Build the full index. `root` = repo root. Returns:
 *  { builtAt, enhancedDir, pictures:{hash:{hash,kind,w,h,alpha,sample,uses:[{room,file,object,frame}]}},
 *    rooms:{ROOM:{bg,wall,objects:[{name,item,x,y,frames:[hash]}]}}, sharedObjects:[hash], fish:[hash],
 *    menu:[hash], panel:[hash], credits:[hash] }
 */
export function buildIndex(root) {
  const enhancedDir = join(root, 'public', 'enhanced');
  const pictures = {};
  const rooms = {};

  const hashFile = (abs) => createHash('md5').update(readFileSync(abs)).digest('hex');
  const addUse = (hash, abs, rel, use) => {
    let pic = pictures[hash];
    if (!pic) {
      const { w, h, alpha } = pngHeader(readFileSync(abs));
      pic = pictures[hash] = { hash, kind: classify(rel), w, h, alpha, sample: rel, uses: [] };
    }
    pic.uses.push(use);
    return pic;
  };

  // Every underscore-prefixed directory is a SHARED set, not a room. Matching the
  // prefix (rather than listing names) means a new shared set can never be silently
  // indexed as a room, which would give it a bogus bg/wall and a nav entry.
  const roomDirs = readdirSync(enhancedDir).filter((d) => {
    const p = join(enhancedDir, d);
    return statSync(p).isDirectory() && !d.startsWith('_');
  }).sort();

  for (const room of roomDirs) {
    const rdir = join(enhancedDir, room);
    const rec = { bg: null, wall: null, objects: [] };
    // bg + wall
    for (const [file, key] of [['p.png', 'bg'], ['w.png', 'wall']]) {
      const abs = join(rdir, file);
      if (!existsSync(abs)) continue;
      const rel = `enhanced/${room}/${file}`;
      const hash = hashFile(abs);
      addUse(hash, abs, rel, { room, file, object: null, frame: 0 });
      rec[key] = hash;
    }
    // objects (grouped by objects.json so all frames of an object share one decision)
    const objPath = join(rdir, 'objects.json');
    const seen = new Set();
    if (existsSync(objPath)) {
      const objs = JSON.parse(readFileSync(objPath, 'utf8')).objects || [];
      for (const obj of objs) {
        const frames = [];
        (obj.frames || []).forEach((frame, fi) => {
          const abs = join(rdir, 'obj', frame);
          if (!existsSync(abs)) return;
          const rel = `enhanced/${room}/obj/${frame}`;
          const hash = hashFile(abs);
          const name = frame.replace(/_\d+\.png$/, '').replace(/\.png$/, '');
          addUse(hash, abs, rel, { room, file: `obj/${frame}`, object: name, frame: fi });
          frames.push(hash);
          seen.add(frame);
        });
        if (frames.length) rec.objects.push({ name: (obj.frames[0] || '').replace(/_\d+\.png$/, '').replace(/\.png$/, ''), item: obj.item, x: obj.x, y: obj.y, frames });
      }
    }
    // any obj/*.png not referenced by objects.json (standalone)
    const objDir = join(rdir, 'obj');
    if (existsSync(objDir)) {
      for (const frame of readdirSync(objDir)) {
        if (!frame.endsWith('.png') || seen.has(frame)) continue;
        const abs = join(objDir, frame);
        const rel = `enhanced/${room}/obj/${frame}`;
        const hash = hashFile(abs);
        const name = frame.replace(/_\d+\.png$/, '').replace(/\.png$/, '');
        addUse(hash, abs, rel, { room, file: `obj/${frame}`, object: name, frame: 0 });
        rec.objects.push({ name, item: null, x: null, y: null, frames: [hash] });
      }
    }
    rooms[room] = rec;
  }

  // shared fish set
  const fish = [];
  const fishDir = join(enhancedDir, '_fish');
  const walkFish = (dir, prefix) => {
    for (const e of readdirSync(dir)) {
      const abs = join(dir, e);
      if (statSync(abs).isDirectory()) walkFish(abs, `${prefix}${e}/`);
      else if (e.endsWith('.png')) {
        const rel = `enhanced/_fish/${prefix}${e}`;
        const hash = hashFile(abs);
        addUse(hash, abs, rel, { room: '_fish', file: `${prefix}${e}`, object: 'fish', frame: 0 });
        if (!fish.includes(hash)) fish.push(hash);
      }
    }
  };
  if (existsSync(fishDir)) walkFish(fishDir, '');

  // Flat shared sets: one directory of PNGs, one decision per file.
  //   _menu    world map / menu art        (stage-menu.mjs)
  //   _panel   control panel + options     (stage-ui.mjs, from panel.ffp)
  //   _credits end-credits frame + strip   (stage-ui.mjs, from CredStat1/CredMov)
  const flatShared = (dirName) => {
    const out = [];
    const dir = join(enhancedDir, dirName);
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir).sort()) {
      if (!e.endsWith('.png')) continue;
      const abs = join(dir, e);
      const hash = hashFile(abs);
      addUse(hash, abs, `enhanced/${dirName}/${e}`,
        { room: dirName, file: e, object: e.replace(/\.png$/, ''), frame: 0 });
      if (!out.includes(hash)) out.push(hash);
    }
    return out;
  };
  const menu = flatShared('_menu');
  const panel = flatShared('_panel');
  const credits = flatShared('_credits');

  const sharedObjects = Object.values(pictures)
    .filter((p) => p.kind === 'object' && new Set(p.uses.map((u) => u.room)).size > 1)
    .map((p) => p.hash);

  return { builtAt: new Date().toISOString(), enhancedDir, pictures, rooms, sharedObjects, fish, menu, panel, credits };
}

/** Build the index and write it to `file` (also returns it). */
export function buildAndSave(root, file) {
  const idx = buildIndex(root);
  writeFileSync(file, JSON.stringify(idx));
  return idx;
}
