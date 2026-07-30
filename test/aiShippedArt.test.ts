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
const haveTier = existsSync(AI);

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
