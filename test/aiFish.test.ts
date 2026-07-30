import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FISH_BODY_FILE, FISH_HEAD_FILE } from '../src/render/enhancedArtSource.js';

/**
 * The AI tier ships WebP, but fish frames are looked up through FISH_BODY_FILE /
 * FISH_HEAD_FILE, which are shared with the enhanced tier and therefore name PNGs.
 * loadAiFish bridges that by keying its map on the .png name.
 *
 * When that bridge was missing every lookup missed and `drawFish` returned early, so
 * NO fish were drawn in any room — and nothing failed loudly: the room still rendered,
 * the canvas was still the right size, no request 404'd. Only looking at the screen
 * revealed it. These tests assert the two names actually meet.
 */
const FISH_DIR = join(process.cwd(), 'public/enhanced-ai/_fish');
const SKELETON_FILE = 'body_skeleton_00.png';

type Manifest = Record<'small' | 'big', Record<'left' | 'right', string[]>>;

const scales = existsSync(FISH_DIR)
  ? readdirSync(FISH_DIR).filter((d) => /^x\d+$/.test(d)).sort()
  : [];

describe.skipIf(scales.length === 0)('AI fish manifests', () => {
  it('ships a set for every scale the rooms ask for', () => {
    const roomsDir = join(process.cwd(), 'public/enhanced-ai');
    const wanted = new Set<number>();
    for (const r of readdirSync(roomsDir)) {
      const f = join(roomsDir, r, 'ai.json');
      if (existsSync(f)) wanted.add(JSON.parse(readFileSync(f, 'utf8')).scale);
    }
    for (const s of wanted) expect(scales, `fish set for x${s}`).toContain(`x${s}`);
  });

  for (const scale of scales) {
    describe(scale, () => {
      const man = JSON.parse(
        readFileSync(join(FISH_DIR, scale, 'manifest.json'), 'utf8'),
      ) as Manifest;

      // What loadAiFish will end up keying its Map on.
      const keys = (size: 'small' | 'big', facing: 'left' | 'right'): Set<string> =>
        new Set((man[size]?.[facing] ?? []).map((f) => f.replace(/\.webp$/i, '.png')));

      it('normalises to the .png names the renderer looks up', () => {
        for (const size of ['small', 'big'] as const) {
          for (const facing of ['left', 'right'] as const) {
            const have = keys(size, facing);
            expect(have.size, `${size}/${facing} is not empty`).toBeGreaterThan(0);
            const missing = [...Object.values(FISH_BODY_FILE), ...Object.values(FISH_HEAD_FILE)]
              .filter((f) => !have.has(f));
            expect(missing, `${size}/${facing} covers every referenced frame`).toEqual([]);
          }
        }
      });

      it('ships the skeleton frame the death dissolve needs', () => {
        for (const size of ['small', 'big'] as const) {
          for (const facing of ['left', 'right'] as const) {
            expect(keys(size, facing).has(SKELETON_FILE), `${size}/${facing}`).toBe(true);
          }
        }
      });

      it('lists only files that exist on disk', () => {
        for (const size of ['small', 'big'] as const) {
          for (const facing of ['left', 'right'] as const) {
            for (const f of man[size]?.[facing] ?? []) {
              expect(existsSync(join(FISH_DIR, scale, size, facing, f)), f).toBe(true);
            }
          }
        }
      });
    });
  }
});
