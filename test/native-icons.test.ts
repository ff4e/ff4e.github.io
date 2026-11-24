/**
 * The native carved icons' fast rasteriser (`native/js/rusticIcons.ts`) must make the masks
 * the exhaustive one does — every sample tested against every segment — at any size the
 * window's height can ask for. The menu smoke checks a few sizes in the host's interpreter,
 * where the exhaustive way is ~50× slower; this sweeps many more under V8. A stroke once lost
 * a sample at exactly half its width from a segment's end, at 25, 55 and 115 px only.
 */
import { describe, expect, it, vi } from 'vitest';

// The masks' textures are the host's: the counts are what is compared.
vi.mock('../native/js/uiDraw.js', () => ({ countMask: () => ({}) }));
const { iconNames, partCounts } = await import('../native/js/rusticIcons.js');

/** Every size up to 1080 lines' confirm prompt, then the 2160-line sizes and the three that once differed. */
const SIZES = [...Array.from({ length: 41 }, (_, i) => 8 + i), 55, 80, 96, 115];

describe('native carved icons', () => {
  it.each(SIZES)('the fast rasteriser matches the exhaustive one at %i px', (size) => {
    const differ: string[] = [];
    for (const name of iconNames()) {
      const exhaustive = partCounts(name, size, true);
      partCounts(name, size).forEach((counts, part) => {
        const p = counts.findIndex((v, i) => v !== exhaustive[part]![i]);
        if (p >= 0) differ.push(`${name} part ${part} at (${p % size}, ${Math.floor(p / size)}): ${counts[p]} vs ${exhaustive[part]![p]}`);
      });
    }
    expect(differ).toEqual([]);
  });
});
