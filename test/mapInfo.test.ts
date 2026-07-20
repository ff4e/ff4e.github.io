/**
 * The world-map record info panel: pure geometry/parse helpers (mapInfo.ts +
 * desky.ts). Verifies the odometer roll maths, button hit bands, and the
 * branch-major popdesk record layout against the original (UMain.pas:1364/341).
 */
import { describe, it, expect } from 'vitest';
import {
  hitInfoButton,
  digitRollY,
  INFO_BUTTONS,
  INFO_SETTLE_FAZE,
  ICON_Y,
  ICON_H,
  DIGIT_H,
} from '../src/render/mapInfo.js';
import { parseDesky, DESKA_X_OFFSET, DESKA_Y_OFFSET } from '../src/data/desky.js';
import { BRANCHES } from '../src/data/world.js';

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
