/**
 * The landscape phone Options face is the original panel cut at SPLIT_ROW and laid side by
 * side, the right half fading in over the last SEAM columns of the left (optionsLayout.ts).
 *
 * The geometry is checked against panel.ffp itself rather than restated: every pixel any
 * option state can change, and every hit region, must lie wholly in one half and outside
 * the fade. A control that straddled the cut, or that the fade dimmed, would fail here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const env = vi.hoisted(() => ({ phone: true, open: true }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => env.phone }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => env.open }));
vi.mock('../src/app/stageGeometry.js', () => ({ stage: { scale: 2 } }));

import { parseFfp } from '../src/data/ffp.js';
import { composeOptions, hitTest, NOBLMYSI, OBLMYSI, OBLROH, PANEL_H, PANEL_W, type OptionsState } from '../src/render/hud.js';
import {
  composeLandscape, faceSize, fitScale, optionsLayout, SEAM, SPLIT_ROW, toPanelPoint, touchFaceCss,
} from '../src/app/optionsLayout.js';

const RIGHT_X = PANEL_W - SEAM;

/** Landscape face -> panel, computed independently of toPanelPoint. */
function expected(x: number, y: number): { x: number; y: number } {
  return x < RIGHT_X + SEAM / 2 ? { x, y } : { x: x - RIGHT_X, y: y + SPLIT_ROW };
}

beforeEach(() => {
  env.phone = true;
  env.open = true;
  vi.stubGlobal('window', { innerWidth: 844, innerHeight: 390 });
});
afterEach(() => vi.unstubAllGlobals());

describe('optionsLayout', () => {
  it('cuts only a phone\'s open touch dialog', () => {
    expect(optionsLayout()).toBe('landscape');
    env.phone = false;
    expect(optionsLayout()).toBe('portrait');
    env.phone = true;
    env.open = false;
    expect(optionsLayout()).toBe('portrait');
  });

  it('follows the viewport', () => {
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
    expect(optionsLayout()).toBe('portrait');
  });

  it('sizes the two faces', () => {
    expect(faceSize('portrait')).toEqual({ w: 155, h: 395 });
    expect(faceSize('landscape')).toEqual({ w: 305, h: 198 });
  });

  it('fits a face to a box by its tighter side', () => {
    expect(fitScale(305, 198, 610, 1000)).toBe(2);
    expect(fitScale(305, 198, 1000, 99)).toBe(0.5);
    expect(fitScale(305, 198, -5, 100)).toBe(0);
  });

  it('keeps the stage scale on a tablet', () => {
    env.phone = false;
    expect(touchFaceCss('portrait')).toEqual({ w: 310, h: 790 });
  });
});

describe('toPanelPoint', () => {
  it('passes portrait points through', () => {
    expect(toPanelPoint(150, 300, 'portrait', false)).toEqual({ x: 150, y: 300 });
  });

  it('maps each landscape column to the half mostly showing there', () => {
    for (let x = 0; x < 305; x++) {
      for (const y of [0, 100, 197]) expect(toPanelPoint(x, y, 'landscape', false)).toEqual(expected(x, y));
    }
    expect(toPanelPoint(152.4, 10, 'landscape', false)).toEqual({ x: 152.4, y: 10 });
    expect(toPanelPoint(152.5, 10, 'landscape', false)).toEqual({ x: 2.5, y: 207 });
  });

  it('keeps a slider drag in the left half past the seam, where it clamps to loudest', () => {
    expect(toPanelPoint(290, 85, 'landscape', true)).toEqual({ x: 290, y: 85 });
  });

  it('reaches every option region on the landscape face', () => {
    for (let r = OBLROH; r <= NOBLMYSI; r++) {
      const [, x1, y1, x2, y2] = OBLMYSI[r]!;
      const lx = y1! >= SPLIT_ROW ? (x1! + x2!) / 2 + RIGHT_X : (x1! + x2!) / 2;
      const ly = y1! >= SPLIT_ROW ? (y1! + y2!) / 2 - SPLIT_ROW : (y1! + y2!) / 2;
      const p = toPanelPoint(lx, ly, 'landscape', false);
      expect(hitTest(p.x, p.y, true), `region ${r}`).toBe(r);
    }
  });
});

describe('the cut against panel.ffp', () => {
  const ffp = parseFfp(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'data', 'Menu', 'panel.ffp'))));
  const base: OptionsState = { volume: { effect: 0, voice: 0, music: 0 }, subtitles: 'cz', helpActive: false, scrollFrame: -1 };
  const states: OptionsState[] = [base];
  for (const v of [0, 6, 12]) states.push({ ...base, volume: { effect: v, voice: v, music: v } });
  for (const s of ['cz', 'en', 'off'] as const) states.push({ ...base, subtitles: s });
  states.push({ ...base, helpActive: true });

  /** Inside a half's fade, or crossing from one half into the other. */
  const unsafe = (x: number, y: number): boolean =>
    y < SPLIT_ROW ? x >= RIGHT_X : x < SEAM || y === SPLIT_ROW;

  it('fades and cuts through no pixel an option can change', () => {
    const faces = states.map((s) => composeOptions(ffp.images, ffp.cudl, s));
    const live: string[] = [];
    for (let y = 0; y < PANEL_H; y++) {
      for (let x = 0; x < PANEL_W; x++) {
        const i = y * PANEL_W + x;
        if (faces.some((f) => f[i] !== faces[0]![i]) && unsafe(x, y)) live.push(`${x},${y}`);
      }
    }
    expect(live).toEqual([]);
  });

  it('keeps every option region in one half and clear of the fade', () => {
    for (let r = OBLROH; r <= NOBLMYSI; r++) {
      const [, x1, y1, x2, y2] = OBLMYSI[r]!;
      const upper = y2! < SPLIT_ROW;
      const lower = y1! > SPLIT_ROW;
      expect(upper || lower, `region ${r} straddles the cut`).toBe(true);
      if (upper) expect(x2!, `region ${r}`).toBeLessThan(RIGHT_X);
      else expect(x1!, `region ${r}`).toBeGreaterThanOrEqual(SEAM);
    }
  });
});

describe('composeLandscape', () => {
  it('draws the left half, the solid right half, then the fade one backing column at a time', () => {
    const calls: { a: number; args: number[] }[] = [];
    const dst = {
      canvas: { width: 305 * 2, height: 198 * 2 },
      globalAlpha: 1, imageSmoothingEnabled: true,
      clearRect: vi.fn(),
      drawImage(_src: unknown, ...args: number[]) { calls.push({ a: this.globalAlpha, args }); },
    };
    composeLandscape(dst as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, 2);
    expect(dst.clearRect).toHaveBeenCalledWith(0, 0, 610, 396);
    expect(dst.imageSmoothingEnabled).toBe(false);
    expect(dst.globalAlpha).toBe(1);
    expect(calls[0]).toEqual({ a: 1, args: [0, 0, 310, 396, 0, 0, 310, 396] });
    expect(calls[1]).toEqual({ a: 1, args: [10, 394, 300, 396, 310, 0, 300, 396] });
    const fade = calls.slice(2);
    expect(fade).toHaveLength(10);
    fade.forEach((c, i) => expect(c).toEqual({ a: (i + 0.5) / 10, args: [i, 394, 1, 396, 300 + i, 0, 1, 396] }));
  });
});
