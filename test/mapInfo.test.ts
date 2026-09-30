/**
 * The world-map record info panel: pure geometry/parse helpers (mapInfo.ts +
 * desky.ts). Verifies the odometer roll maths, button hit bands, and the
 * branch-major popdesk record layout against the original (UMain.pas:1364/341).
 */
import { describe, it, expect } from 'vitest';
import {
  hitInfoButton,
  infoPanelCutout,
  infoPanelOrigin,
  digitRollY,
  INFO_PHONE_ZOOM,
  INFO_BUTTONS,
  INFO_SETTLE_FAZE,
  ICON_Y,
  ICON_H,
  ICON_W,
  DIGIT_H,
  PANEL_X,
  PANEL_Y,
  PANEL_W,
  PANEL_H,
} from '../src/render/mapInfo.js';
import { parseDesky, DESKA_X_OFFSET, DESKA_Y_OFFSET } from '../src/data/desky.js';
import type { Bmp } from '../src/data/bmp.js';
import { BRANCHES } from '../src/data/world.js';

describe('info-panel cutout (the phone zoom lifts the device off the map)', () => {
  // Palette: 0-99 map greys-ish colours, 100-199 the same at 60% (shadow), 200 a device
  // colour no darkening of the map can produce, 201 a lone speck of the same.
  const palette: Bmp['palette'] = [];
  for (let i = 0; i < 100; i++) palette.push({ r: 100 + i, g: 80 + i, b: 40 + i });
  for (let i = 0; i < 100; i++) {
    const c = palette[i]!;
    palette.push({ r: Math.round(c.r * 0.6), g: Math.round(c.g * 0.6), b: Math.round(c.b * 0.6) });
  }
  palette.push({ r: 250, g: 20, b: 20 }, { r: 20, g: 250, b: 20 });
  const mapIdx = (x: number, y: number) => (x * 7 + y * 13) % 100;
  const map = new Uint8ClampedArray(640 * 480 * 4);
  for (let y = 0; y < 480; y++) {
    for (let x = 0; x < 640; x++) {
      const c = palette[mapIdx(x, y)]!;
      map.set([c.r, c.g, c.b, 255], (y * 640 + x) * 4);
    }
  }
  const pixels = new Uint8Array(PANEL_W * PANEL_H);
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const under = mapIdx(PANEL_X + x, PANEL_Y + y);
      const device = x >= 60 && x < 200 && y >= 20 && y < 150;
      const shadow = !device && y >= 150 && y < 170 && x >= 40 && x < 230;
      pixels[y * PANEL_W + x] = device ? 200 : shadow ? 100 + under : under;
    }
  }
  pixels[160 * PANEL_W + 20] = 201; // a speck in plain map, well away from the device
  const cut = infoPanelCutout({ w: PANEL_W, h: PANEL_H, pixels, palette }, map, 640);
  const alpha = (x: number, y: number) => cut[(y * PANEL_W + x) * 4 + 3];

  it('keeps the device opaque in its own colour', () => {
    expect(alpha(130, 80)).toBe(255);
    expect([...cut.slice((80 * PANEL_W + 130) * 4, (80 * PANEL_W + 130) * 4 + 3)]).toEqual([250, 20, 20]);
  });
  it('drops the baked-in map, and turns its cast shadow into a black wash of the same strength', () => {
    expect(alpha(5, 5)).toBe(0);
    expect(alpha(265, 180)).toBe(0);
    const i = (160 * PANEL_W + 100) * 4;
    expect([cut[i], cut[i + 1], cut[i + 2]]).toEqual([0, 0, 0]);
    expect(Math.abs(cut[i + 3]! - 0.4 * 255)).toBeLessThanOrEqual(3);
  });
  it('treats a lone speck as not being the device', () => {
    expect(alpha(20, 160)).not.toBe(255);
  });
});

describe('info-panel button hit bands (UMain.pas:1626)', () => {
  it('splits the icon row into Run / Replay / Cancel', () => {
    const y = ICON_Y + 10;
    expect(hitInfoButton(258, y)).toBe('run');
    expect(hitInfoButton(300, y)).toBe('run');
    expect(hitInfoButton(301, y)).toBe('replay');
    expect(hitInfoButton(343, y)).toBe('replay');
    expect(hitInfoButton(344, y)).toBe('cancel');
    expect(hitInfoButton(386, y)).toBe('cancel');
  });
  it('is null outside the icon band', () => {
    expect(hitInfoButton(300, ICON_Y - 1)).toBeNull();
    expect(hitInfoButton(300, ICON_Y + ICON_H)).toBeNull();
    expect(hitInfoButton(257, ICON_Y + 5)).toBeNull(); // left of Run
    expect(hitInfoButton(387, ICON_Y + 5)).toBeNull(); // right of Cancel
  });
  it('zoom 1 is the faithful panel, exactly', () => {
    expect(infoPanelOrigin(1)).toEqual({ x: PANEL_X, y: PANEL_Y });
  });
  it('the phone zoom keeps the panel centred, on the pixel grid, above the name plaque', () => {
    const z = INFO_PHONE_ZOOM;
    const o = infoPanelOrigin(z);
    expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
    expect(Math.abs(o.x + (PANEL_W * z) / 2 - (PANEL_X + PANEL_W / 2))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(o.y + (PANEL_H * z) / 2 - (PANEL_Y + PANEL_H / 2))).toBeLessThanOrEqual(0.5);
    expect(o.x).toBeGreaterThanOrEqual(0);
    expect(o.y).toBeGreaterThanOrEqual(0);
    expect(o.x + PANEL_W * z).toBeLessThanOrEqual(640);
    expect(o.y + PANEL_H * z).toBeLessThanOrEqual(DESKA_Y_OFFSET); // plaques start at 434+
  });
  it('the zoomed buttons are hit where they are drawn', () => {
    const z = INFO_PHONE_ZOOM;
    const o = infoPanelOrigin(z);
    const drawn = (x: number, y: number) => [o.x + (x - PANEL_X) * z, o.y + (y - PANEL_Y) * z] as const;
    for (const [name, b] of Object.entries(INFO_BUTTONS)) {
      const [cx, cy] = drawn(b.x + ICON_W / 2, ICON_Y + ICON_H / 2);
      expect(hitInfoButton(cx, cy, z)).toBe(name);
    }
    const [, top] = drawn(0, ICON_Y);
    const [, bottom] = drawn(0, ICON_Y + ICON_H);
    const [left] = drawn(INFO_BUTTONS.run.x, 0);
    const [right] = drawn(INFO_BUTTONS.cancel.x + ICON_W, 0);
    const midX = drawn(INFO_BUTTONS.replay.x + ICON_W / 2, 0)[0];
    expect(hitInfoButton(midX, top - 1, z)).toBeNull();
    expect(hitInfoButton(midX, bottom + 1, z)).toBeNull();
    expect(hitInfoButton(left - 1, top + 5, z)).toBeNull();
    expect(hitInfoButton(right + 1, top + 5, z)).toBeNull();
    // The enlarged Run's left edge lies left of the faithful panel's buttons: it hits
    // only when the zoom is applied, which proves the zoom is not a no-op.
    const [ex, ey] = drawn(INFO_BUTTONS.run.x + 2, ICON_Y + ICON_H / 2);
    expect(hitInfoButton(ex, ey, z)).toBe('run');
    expect(hitInfoButton(ex, ey, 1)).toBeNull();
  });
  it('button source columns are 0/43/86', () => {
    expect(INFO_BUTTONS.run.srcX).toBe(0);
    expect(INFO_BUTTONS.replay.srcX).toBe(43);
    expect(INFO_BUTTONS.cancel.srcX).toBe(86);
  });
});

describe('odometer digit roll (UMain.pas:1378)', () => {
  it('starts every digit at the 0 row (y=216) on frame 0', () => {
    for (let cif = 0; cif <= 9; cif++) expect(digitRollY(0, cif)).toBe(9 * DIGIT_H);
  });
  it('decreases by 8 per frame until it reaches the digit rest row', () => {
    expect(digitRollY(1, 5)).toBe(9 * DIGIT_H - 8);
    expect(digitRollY(2, 5)).toBe(9 * DIGIT_H - 16);
    // digit 5 rests at (9-5)*24 = 96; reached once 216-8f <= 96 → f >= 15.
    expect(digitRollY(15, 5)).toBe((9 - 5) * DIGIT_H);
    expect(digitRollY(100, 5)).toBe((9 - 5) * DIGIT_H); // clamped, never below rest
  });
  it('every digit is settled by INFO_SETTLE_FAZE', () => {
    for (let cif = 0; cif <= 9; cif++) {
      expect(digitRollY(INFO_SETTLE_FAZE, cif)).toBe((9 - cif) * DIGIT_H);
    }
  });
});

describe('parseDesky (NactiDesky branch-major layout)', () => {
  // Build a synthetic popdesk of 72 records where each field encodes its sequence
  // index, so we can assert the room→record mapping follows the branch order.
  const total = BRANCHES.reduce((n, b) => n + b.length, 0);
  const popdesk = new Uint8Array(total * 12);
  const dv = new DataView(popdesk.buffer);
  for (let seq = 0; seq < total; seq++) {
    const o = seq * 12;
    dv.setUint16(o, seq, true); // x1 = seq
    dv.setUint16(o + 2, seq + 1, true); // y1
    dv.setUint16(o + 4, seq + 2, true); // dx
    dv.setUint16(o + 6, seq + 3, true); // dy
    dv.setInt32(o + 8, seq * 10, true); // data offset
  }
  const atlas = new Uint8Array(4);
  const desky = parseDesky(popdesk, atlas);

  it('maps 72 rooms branch-major', () => {
    expect(desky.byRoom.size).toBe(total);
    // First room of the first branch = seq 0.
    const r1 = desky.byRoom.get(1)!;
    expect(r1.x1).toBe(0);
    expect(r1.data).toBe(0);
    // First room of the second branch (start=9) = seq 8 (after branch 0's 8 rooms).
    const r9 = desky.byRoom.get(9)!;
    expect(r9.x1).toBe(8);
    expect(r9.dy).toBe(8 + 3);
  });

  it('exposes the map placement offsets', () => {
    expect(DESKA_X_OFFSET).toBe(160);
    expect(DESKA_Y_OFFSET).toBe(434);
  });
});
