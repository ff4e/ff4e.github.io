import { describe, expect, it } from 'vitest';
import { SubtitleLayout, sampledWaveDy, type SubtitleBox, type SubtitleFace, type SubtitleRow, type SubtitleSource } from '../native/js/subtitleLayout.js';
import { VECTOR_GEOM, bevelBottomRgb, bevelSpan, clampTextScale, lineOffset, waveDy } from '../src/render/subtitleGeom.js';

/** Every character half an em wide; no line gap, so the bevel is `bevelSpan` exactly. */
const face: SubtitleFace = {
  advances: (chars, px) => chars.map(() => px / 2),
  metrics: (px) => [px * 0.8, px * 0.2, 0],
};

const box: SubtitleBox = { cssW: 960, cssH: 720, boxScale: 1.5, textScale: 1.2, tier: 0.75 };
const SCREEN_W = 640, SCREEN_H = 480;

let seq = 0;
const row = (obsah: string, o: Partial<SubtitleRow> = {}): SubtitleRow => ({
  obsah, barva: 'M', ys: -26, cilys: -26, startcount: 0, id: ++seq, block: seq, rgb: [200, 150, 60], ...o,
});
/** A subtitle system showing `rows`. */
const sys = (...rows: SubtitleRow[]): SubtitleSource => ({ debugLines: () => rows, vectorScreen: { w: SCREEN_W, h: SCREEN_H } });
const FULL = Number((VECTOR_GEOM.fontPx * clampTextScale(box.textScale, box.boxScale)).toFixed(2));

describe('native subtitle layout', () => {
  it('centres a settled line in the box, on the browser baseline, in the speaker bevel', () => {
    const t = row('Ahoj', { ys: -52 });
    const f = new SubtitleLayout(face).layout(sys(t), 100, box);
    const scale = clampTextScale(box.textScale, box.boxScale);
    const px = Number((VECTOR_GEOM.fontPx * scale).toFixed(2));
    const [line] = f.lines;
    expect(line!.fontPx).toBe(px);
    expect(line!.baseline).toBeCloseTo(SCREEN_H * box.boxScale + lineOffset(-52) * scale, 9);
    const w = Math.ceil((px / 2) * 64) / 64;
    expect(line!.glyphs.map((g) => g.x)).toEqual([0, 1, 2, 3].map((i) => Math.round(((box.cssW - 4 * w) / 2) * 64) / 64 + i * w));
    expect(line!.glyphs.every((g) => g.dy === 0)).toBe(true);
    expect(line!.top).toEqual([200, 150, 60]);
    expect(line!.bottom).toEqual(bevelBottomRgb(200, 150, 60));
    const fs = VECTOR_GEOM.fontPx * scale;
    expect(line!.bevelTop).toBeCloseTo(bevelSpan(fs).top, 1);
    expect(line!.bevelBottom).toBeCloseTo(bevelSpan(fs).bottom, 1);
    // The tier shrinks the layer about its bottom centre, a border's width below the room.
    expect([f.tier, f.originX, f.originY]).toEqual([0.75, 480, 721]);
  });

  it('draws the FFT quote bytes as an ellipsis and a closing quote, and inks no spaces', () => {
    const f = new SubtitleLayout(face).layout(sys(row('a "b`')), 100, box);
    expect(f.lines[0]!.glyphs.map((g) => g.ch).join('')).toBe('a\u2026b\u2019');
  });

  it('shows glyph i once the wave reaches it, riding the keyframed curve until it settles', () => {
    const t = row('abcdef', { startcount: 10 });
    const L = new SubtitleLayout(face);
    expect(L.layout(sys(t), 10, box).lines[0]!.glyphs).toEqual([]);
    // Half a tick in: p = 2.5 - (i + 1), so glyphs 0 and 1 have started.
    const mid = L.layout(sys(t), 10.5, box).lines[0]!.glyphs;
    expect(mid.map((g) => g.ch).join('')).toBe('ab');
    const amp = (VECTOR_GEOM.under * VECTOR_GEOM.scale - -26 * VECTOR_GEOM.scale) * clampTextScale(box.textScale, box.boxScale);
    expect(mid[0]!.dy).toBeCloseTo(sampledWaveDy(1.5, amp), 9);
    expect(mid[0]!.dy).not.toBe(0);
    expect(L.layout(sys(t), 30, box).lines[0]!.glyphs.every((g) => g.dy === 0)).toBe(true);
  });

  it('samples the wave as the compositor runs it: waveDy at each keyframe, straight between', () => {
    const step = VECTOR_GEOM.waveLen / 24;
    for (const k of [0, 5, 23]) expect(sampledWaveDy(k * step, 30)).toBeCloseTo(Number(waveDy(k * step, 30).toFixed(2)), 9);
    const half = sampledWaveDy(5.5 * step, 30);
    expect(half).toBeCloseTo((sampledWaveDy(5 * step, 30) + sampledWaveDy(6 * step, 30)) / 2, 9);
    expect(sampledWaveDy(VECTOR_GEOM.waveLen + 7, 30)).toBe(0);
  });

  it('fits a message to the room as one size, and keeps a built row at the fit it was built with', () => {
    // Too wide at full size: 120 glyphs of half an em in a 640-px room.
    const wide = row('x'.repeat(120), { block: 900 });
    const short = row('xx', { block: 900, ys: 0 });
    const L = new SubtitleLayout(face);
    const rows = [wide, short];
    const one: SubtitleSource = { debugLines: () => rows, vectorScreen: { w: SCREEN_W, h: SCREEN_H } };
    const [a, b] = L.layout(one, 100, box).lines;
    expect(a!.fontPx).toBeLessThan(VECTOR_GEOM.fontPx * clampTextScale(box.textScale, box.boxScale));
    expect(b!.fontPx).toBe(a!.fontPx);
    // A later, short message in its own block is full size; the built ones do not change.
    const next = row('yy', { ys: 26 });
    rows.push(next);
    const again = L.layout(one, 101, box).lines;
    expect(again.map((l) => l.fontPx)).toEqual([a!.fontPx, a!.fontPx, FULL]);
  });

  it('forgets the fits when the subtitle system changes or is torn down: row ids start again at 1', () => {
    const L = new SubtitleLayout(face);
    const wide = row('x'.repeat(120), { id: 1, block: 1 });
    expect(L.layout(sys(wide), 100, box).lines[0]!.fontPx).toBeLessThan(FULL);
    // A restart or a room entry: a new system, whose first row is id 1 again.
    expect(L.layout(sys(row('Ahoj', { id: 1, block: 1 })), 100, box).lines[0]!.fontPx).toBe(FULL);
    // Torn down while nothing is shown (`reset`, the browser's clearDomSubtitles): even the
    // same source no longer remembers the fit row 1 was built with.
    const rows = [wide];
    const same: SubtitleSource = { debugLines: () => rows, vectorScreen: { w: SCREEN_W, h: SCREEN_H } };
    expect(L.layout(same, 100, box).lines[0]!.fontPx).toBeLessThan(FULL);
    L.reset();
    rows[0] = row('Ahoj', { id: 1, block: 1 });
    expect(L.layout(same, 100, box).lines[0]!.fontPx).toBe(FULL);
  });
});
