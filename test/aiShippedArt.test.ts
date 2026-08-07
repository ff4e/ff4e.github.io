import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contract tests for the SHIPPED ai tier in public/enhanced-ai.
 *
 * These exist because this tier's failures are silent by construction: the runtime
 * falls back to the enhanced tier whenever an asset is missing or undecodable, so a
 * broken build renders a plausible game with no error, no exception and no 404 visible
 * to a human. Two real examples, both of which shipped briefly:
 *
 *  - room manifests listed object frames WITHOUT their `obj/` directory prefix, so every
 *    object 404'd, every room quietly fell back, and an asset-existence sweep that
 *    rebuilt the paths itself still reported everything present;
 *  - the panel's scroll frames rely on BAKED ALPHA (the faithful path colour-keys a
 *    palette index instead). Re-encoding them as opaque WebP would paint an opaque
 *    rectangle over the options sub-panel — and nothing would throw.
 *
 * So these assert the shipped bytes against the paths and properties the RUNTIME
 * actually requires, not against values the test recomputes.
 */

const AI = join(process.cwd(), 'public/enhanced-ai');
const ENHANCED = join(process.cwd(), 'public/enhanced');
const haveTier = existsSync(AI);

/**
 * Width/height/alpha out of a PNG IHDR — the upscaler's INPUT, and therefore the
 * reference the shipped WebP is checked against. Colour type 4 (grey+alpha) and 6
 * (RGBA) carry a channel; 0/2 do not, and 3 (palette) only via a tRNS chunk.
 */
function pngInfo(file: string): { w: number; h: number; alpha: boolean } {
  const b = readFileSync(file);
  const colorType = b.readUInt8(25);
  const alpha = colorType === 4 || colorType === 6 || (colorType === 3 && b.includes('tRNS'));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha };
}

/** Width/height/alpha straight out of a WebP RIFF header (no decoder needed). */
function webpInfo(file: string): { w: number; h: number; alpha: boolean } {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${file}: not a WebP`);
  }
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    // Extended format: flags byte (bit 4 = alpha), then 24-bit width-1 / height-1.
    const flags = b.readUInt8(20);
    return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1, alpha: (flags & 0x10) !== 0 };
  }
  if (kind === 'VP8 ') {
    // Simple lossy: no alpha channel at all. Dimensions follow the 3-byte start code.
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
  }
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, alpha: ((bits >> 28) & 1) !== 0 };
  }
  throw new Error(`${file}: unknown WebP chunk ${kind}`);
}

const roomDirs = haveTier
  ? readdirSync(AI).filter((d) => !d.startsWith('_') && statSync(join(AI, d)).isDirectory())
  : [];

describe.skipIf(!haveTier)('shipped room manifests', () => {
  it('ships at least the full room set', () => {
    expect(roomDirs.length).toBeGreaterThan(60);
  });

  for (const room of roomDirs) {
    describe(room, () => {
      const manFile = join(AI, room, 'ai.json');
      const man = JSON.parse(readFileSync(manFile, 'utf8')) as {
        scale: number; bg: string[]; wall: string[];
        objects: { item: number; frames: string[] }[];
      };

      it('declares a usable scale and the two base layers', () => {
        expect(Number.isInteger(man.scale) && man.scale >= 4, `scale ${man.scale}`).toBe(true);
        expect(man.bg?.length, 'bg layers').toBeGreaterThan(0);
        expect(man.wall?.length, 'wall layers').toBeGreaterThan(0);
      });

      it('references only files that exist, at the path the loader builds', () => {
        // roomAi.loadAiRoom resolves every manifest entry as `${dir}${name}` — so the
        // manifest must carry any subdirectory itself. Joining the bare name here would
        // reproduce the loader's bug instead of catching it.
        const referenced = [...man.bg, ...man.wall, ...(man.objects ?? []).flatMap((o) => o.frames)];
        const missing = referenced.filter((f) => !existsSync(join(AI, room, f)));
        expect(missing, `${referenced.length} referenced`).toEqual([]);
      });

      it('keeps object frames non-empty and under obj/', () => {
        for (const o of man.objects ?? []) {
          expect(o.frames.length, `item ${o.item}`).toBeGreaterThan(0);
          for (const f of o.frames) expect(f.startsWith('obj/'), f).toBe(true);
        }
      });

      it('renders the background at exactly the declared scale', () => {
        // The compositor sizes its canvas from the room's native size × this scale, so a
        // background that is not an exact multiple silently mis-scales the whole room.
        const bg = webpInfo(join(AI, room, man.bg[0]!));
        expect(bg.w % man.scale, `bg ${bg.w} vs x${man.scale}`).toBe(0);
        expect(bg.h % man.scale, `bg ${bg.h} vs x${man.scale}`).toBe(0);
      });

      it('preserves object-sprite transparency and the declared scale', () => {
        // The same failure this file's header describes for the panel, one layer down and
        // just as silent: a sprite whose transparency is lost paints an opaque rectangle
        // over the room, and one at the wrong scale lands offset from the position the
        // walk computes. Neither throws, 404s, nor fails any other check — the existing
        // alpha and size assertions covered only the panel and the background.
        //
        // The invariant is "matches the source", NOT "has alpha": plenty of shipped
        // sprites are fully opaque rectangles (BATHROOM's crate, BATYSKAF's hull) whose
        // PNG is truecolor-without-alpha, and the encoder correctly drops the channel.
        // Requiring alpha unconditionally would fail 29 rooms that are perfectly fine.
        //
        // The enhanced PNG is the upscaler's input, so it is also the only honest
        // reference for "×scale": object sprites take no layer padding
        // (tools/studio/lib/upscale.mjs pads only the desky/kufr layer kinds), which
        // makes the relation exact rather than approximate.
        for (const o of man.objects ?? []) {
          for (const f of o.frames) {
            const src = join(ENHANCED, room, f.replace(/\.webp$/, '.png'));
            if (!existsSync(src)) continue; // no enhanced counterpart to compare against
            const png = pngInfo(src);
            const info = webpInfo(join(AI, room, f));
            expect(info.alpha, `${room}/${f} alpha vs its source PNG`).toBe(png.alpha);
            expect([info.w, info.h], `${room}/${f} vs ${png.w}x${png.h} x${man.scale}`).toEqual([
              png.w * man.scale,
              png.h * man.scale,
            ]);
          }
        }
      });
    });
  }
});

describe.skipIf(!existsSync(join(AI, '_panel/ai.json')))('shipped panel art', () => {
  const man = JSON.parse(readFileSync(join(AI, '_panel/ai.json'), 'utf8')) as { scale: number };
  const S = man.scale;

  it('ships every colour variant at 155x395 x scale', () => {
    for (let i = 0; i < 16; i++) {
      const info = webpInfo(join(AI, '_panel', `img${String(i).padStart(2, '0')}.webp`));
      expect([info.w, info.h], `img${i}`).toEqual([155 * S, 395 * S]);
    }
  });

  it('keeps the slider handle square at 17 x scale', () => {
    const info = webpInfo(join(AI, '_panel/cudl.webp'));
    expect([info.w, info.h]).toEqual([17 * S, 17 * S]);
  });

  it('bakes alpha into the scroll frames and the handle', () => {
    // panelAi draws these with plain alpha compositing because a palette colour-key
    // cannot survive upscaling. Opaque re-encodes would cover the sub-panel with a
    // solid rectangle, silently.
    for (let i = 6; i < 16; i++) {
      const f = `img${String(i).padStart(2, '0')}.webp`;
      expect(webpInfo(join(AI, '_panel', f)).alpha, f).toBe(true);
    }
    expect(webpInfo(join(AI, '_panel/cudl.webp')).alpha, 'cudl').toBe(true);
  });
});

describe.skipIf(!existsSync(join(AI, '_credits/ai.json')))('shipped credits art', () => {
  const man = JSON.parse(readFileSync(join(AI, '_credits/ai.json'), 'utf8')) as { scale: number };
  const S = man.scale;

  it('ships the static frame at 640x480 x scale, with its window baked to alpha', () => {
    const stat = webpInfo(join(AI, '_credits/stat.webp'));
    expect([stat.w, stat.h]).toEqual([640 * S, 480 * S]);
    // The transparent "window" the scroll shows through IS the alpha channel here.
    expect(stat.alpha, 'stat alpha').toBe(true);
  });

  it('ships a scroll strip matching the source the faithful tier rolls', () => {
    // Both tiers pick CredMov_port.BMP when present and fall back to CredMov.BMP
    // independently (main.ts openCredits / tools/studio/stage-ui.mjs). If they ever
    // disagree the two tiers roll DIFFERENT credits, which no rendering test would show.
    const menu = join(process.cwd(), 'public/data/Menu');
    const src = existsSync(join(menu, 'CredMov_port.BMP'))
      ? join(menu, 'CredMov_port.BMP')
      : join(menu, 'CredMov.BMP');
    const nativeH = readFileSync(src).readInt32LE(22); // BMP DIB height
    const mov = webpInfo(join(AI, '_credits/mov.webp'));
    expect(mov.w).toBe(640 * S);
    expect(mov.h, `${src} is ${nativeH} rows`).toBe(nativeH * S);
  });
});

/**
 * Curation invariants — properties of the Studio's PICKS (tools/studio/selections.json),
 * not of the shipped bytes.
 *
 * These encode design decisions that a later curation pass could silently undo. The
 * Studio deliberately allows a different model per picture, which is right for
 * independent art but wrong where two pictures must agree.
 */
describe('curation invariants (tools/studio/selections.json)', () => {
  const idxFile = join(process.cwd(), 'tools/studio/index.json');
  const selFile = join(process.cwd(), 'tools/studio/selections.json');
  const have = existsSync(idxFile) && existsSync(selFile);
  const index = have ? (JSON.parse(readFileSync(idxFile, 'utf8')) as Record<string, never>) : null;
  const selections = have ? (JSON.parse(readFileSync(selFile, 'utf8')) as Record<string, string>) : {};

  /** The model picked for a picture whose staged path ends with `suffix`. */
  const modelForSample = (suffix: string): string | undefined => {
    const pics = (index as unknown as { pictures: Record<string, { sample: string }> } | null)?.pictures ?? {};
    for (const [hash, p] of Object.entries(pics)) if (p.sample.endsWith(suffix)) return selections[hash];
    return undefined;
  };

  it.runIf(have)('name plaques use the SAME model as the world map', () => {
    // The plaques are blitted OPAQUELY and carry a slice of the map background baked
    // into the rectangle (see tools/studio/stage-desky.ts). Upscaling them with a
    // different model than the map itself leaves that patch with different texture and
    // grain than the map around it — a visible rectangle on the world map, which no
    // asset check would catch because every file is present and correctly sized.
    const mapModel = modelForSample('_menu/mapa-0.png');
    expect(mapModel, 'the world map itself has a pick').toBeTruthy();
    const desky = (index as unknown as { desky?: string[] } | null)?.desky ?? [];
    expect(desky.length, 'plaques are staged').toBeGreaterThan(0);
    const wrong = desky.filter((h) => selections[h] !== mapModel);
    expect(wrong.length, `every plaque must use ${mapModel} (${wrong.length} of ${desky.length} differ)`).toBe(0);
  });

  it.runIf(have)('mapa-0 and mapa-1 agree, since the map cross-fades between them', () => {
    expect(modelForSample('_menu/mapa-1.png')).toBe(modelForSample('_menu/mapa-0.png'));
  });
});

/**
 * The three UI groups added after the rooms: leg story pages, world-map name plaques,
 * and the briefcase cutscene. Each is loaded by a DIFFERENT runtime path, and each
 * falls back silently to the original art when a file is missing — so, exactly like the
 * rooms above, a broken build renders a plausible game with nothing logged.
 */
describe('shipped _story / _desky / _kufr', () => {
  const S = 4;
  const dir = (g: string) => join(AI, g);
  const have = (g: string) => haveTier && existsSync(dir(g));

  it.runIf(have('_story'))('ships all nine leg pages at exactly ×4 of the original', () => {
    const man = JSON.parse(readFileSync(join(dir('_story'), 'ai.json'), 'utf8')) as { scale: number; files: string[] };
    expect(man.scale).toBe(S);
    for (let leg = 1; leg <= 9; leg++) {
      const f = `leg${leg}.webp`;
      expect(man.files, `${f} is in the manifest`).toContain(f);
      const p = join(dir('_story'), f);
      expect(existsSync(p), `${f} exists`).toBe(true);
      const { w, h } = webpInfo(p);
      // 005 is 641x481 in the original; the rest are 640x480 (see stage-story.mjs).
      const nw = leg === 5 ? 641 : 640;
      const nh = leg === 5 ? 481 : 480;
      expect([w, h], `${f} is ${nw * S}x${nh * S}`).toEqual([nw * S, nh * S]);
    }
  });

  it.runIf(have('_desky'))('ships every plaque the geometry declares, at ×4 of its rectangle', () => {
    const geom = JSON.parse(readFileSync(join(dir('_desky'), 'plaques.json'), 'utf8')) as {
      plaques: Record<string, { room: number; x: number; y: number; w: number; h: number }>;
    };
    const entries = Object.entries(geom.plaques);
    expect(entries.length, '72 rooms × 2 languages').toBe(144);
    for (const [key, g] of entries) {
      // The runtime derives the filename from the geometry key (see aiPlaqueFor).
      const p = join(dir('_desky'), key.replace(/\.png$/, '.webp'));
      expect(existsSync(p), `${key} has shipped art`).toBe(true);
      const { w, h } = webpInfo(p);
      expect([w, h], `${key} is ${g.w * S}x${g.h * S}`).toEqual([g.w * S, g.h * S]);
    }
  });

  it.runIf(have('_kufr'))('ships the cutscene base and every frame the playback order names', () => {
    const man = JSON.parse(readFileSync(join(dir('_kufr'), 'ai.json'), 'utf8')) as {
      scale: number; region: { x: number; y: number; w: number; h: number };
      base: { w: number; h: number }; order: string[]; frames: string[];
    };
    expect(man.scale).toBe(S);
    // The region must match the constants the DEMO decoder writes into (kufrDemo.ts).
    expect(man.region).toEqual({ x: 135, y: 25, w: 380, h: 285 });
    expect(man.base).toEqual({ w: 720, h: 555 });

    const base = join(dir('_kufr'), 'base.webp');
    expect(existsSync(base), 'base.webp exists').toBe(true);
    const bi = webpInfo(base);
    expect([bi.w, bi.h]).toEqual([720 * S, 555 * S]);

    // Every entry in the playback order must resolve — the runtime indexes this array
    // by KufrDemo.framesDrawn, so a hole is a frame that silently falls back.
    expect(man.order.length, 'the animation has frames').toBeGreaterThan(200);
    const missing = [...new Set(man.order)].filter((f) => !existsSync(join(dir('_kufr'), 'frames', f)));
    expect(missing.slice(0, 5), 'every ordered frame is shipped').toEqual([]);
    // ...and each is the region at ×4.
    const fi = webpInfo(join(dir('_kufr'), 'frames', man.order[0]!));
    expect([fi.w, fi.h]).toEqual([380 * S, 285 * S]);
  });
});

/**
 * LODE's falling wreck.
 *
 * `AiRoom.syncWreck` replays the destructive KresliLod swaps into a mutable ×S copy of
 * the background, exchanging an S×S block per native pixel. That only lines up if the
 * staged ×S ship sprites are an exact ×S of the native ones — and the tier has no
 * runtime check for it, deliberately: adding one would put back the very gate condition
 * this replaces. So it is pinned here, on the shipped bytes.
 *
 * The wreck object is looked up as item `itemCount - 1`, which for LODE is 15.
 */
const LODE = join(AI, 'LODE');
const ENH_LODE = join(process.cwd(), 'public/enhanced/LODE');

describe.skipIf(!existsSync(LODE) || !existsSync(ENH_LODE))('shipped LODE wreck art', () => {
  const man = JSON.parse(readFileSync(join(LODE, 'ai.json'), 'utf8')) as {
    scale: number; bg: string[]; objects: { item: number; frames: string[] }[];
  };
  const S = man.scale;
  const wreck = man.objects.find((o) => o.item === 15);

  /** Width/height straight out of a PNG IHDR (the enhanced tier ships native PNGs). */
  function pngSize(file: string): { w: number; h: number } {
    const b = readFileSync(file);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }

  it('stages the wreck under item 15 (itemCount - 1), with all five KresliLod phases', () => {
    expect(wreck, 'objects[] entry for item 15').toBeDefined();
    expect(wreck!.frames).toHaveLength(5);
  });

  it('ships each wreck phase at exactly x scale of the enhanced native sprite', () => {
    for (const [phase, frame] of wreck!.frames.entries()) {
      const native = pngSize(join(ENH_LODE, 'obj', `potop_${String(phase).padStart(2, '0')}.png`));
      const ai = webpInfo(join(LODE, frame));
      expect([ai.w, ai.h], `phase ${phase} (${frame})`).toEqual([native.w * S, native.h * S]);
    }
  });

  it('ships a single background frame, at exactly x scale of the enhanced one', () => {
    // syncWreck mutates frame 0 only, exactly as EnhancedArtSource does. A second frame
    // would render undamaged whenever the wall animation selected it.
    expect(man.bg).toHaveLength(1);
    const native = pngSize(join(ENH_LODE, 'p.png'));
    const ai = webpInfo(join(LODE, man.bg[0]!));
    expect([ai.w, ai.h]).toEqual([native.w * S, native.h * S]);
  });
});
