/**
 * Which way up a phone has to be held (src/app/orientation.ts).
 *
 * The rule is a threshold, so the cases that matter are the ones AT it: the six rooms
 * that land on the portrait side, the widest room that must not, and the tie. Real room
 * sizes throughout — they are what the threshold was chosen against, and a synthetic
 * 100×200 would prove nothing about whether it was chosen well.
 *
 * `rotatePrompt.ts` is not covered here: it is DOM work, this suite runs in node with no
 * DOM environment, and it is covered against a real browser by tools/test-rotate.mjs.
 */
import { describe, it, expect } from 'vitest';
import {
  preferredOrientation,
  rotationDemand,
  viewportOrientation,
} from '../src/app/orientation.js';
import type { DeviceClass } from '../src/app/deviceGate.js';

/** Native sizes from the FFR files (cells × 15 px), the rooms nearest the threshold. */
const ROOM = {
  VRAK: { w: 315, h: 555 }, // 0.57 — the one room the rule genuinely exists for
  CHODBA: { w: 510, h: 555 }, // 0.92
  ZDVIZ1: { w: 510, h: 540 }, // 0.94
  BATHROOM: { w: 465, h: 480 }, // 0.97 — the tightest portrait case
  NOGROUND: { w: 285, h: 285 }, // 1.00 — the tie, deliberately portrait
  WC: { w: 345, h: 330 }, // 1.05 — the tightest landscape case
  PUCLIK: { w: 795, h: 585 }, // 1.36 — the widest room there is
  MIKRO: { w: 360, h: 210 }, // 1.71 — the flattest room there is
};

/** A phone, both ways up, in CSS px (iPhone 15 Pro). */
const VIEW = {
  landscape: { w: 852, h: 393 },
  portrait: { w: 393, h: 852 },
};

const demand = (device: DeviceClass, room: { w: number; h: number }, view: { w: number; h: number }) =>
  rotationDemand({
    device,
    contentW: room.w,
    contentH: room.h,
    viewW: view.w,
    viewH: view.h,
  });

describe('preferredOrientation', () => {
  it('sends the six rooms that are not wider than they are tall to portrait', () => {
    // The whole portrait set, measured: everything else in the 72 is landscape.
    expect(preferredOrientation(ROOM.VRAK.w, ROOM.VRAK.h)).toBe('portrait');
    expect(preferredOrientation(ROOM.CHODBA.w, ROOM.CHODBA.h)).toBe('portrait');
    expect(preferredOrientation(ROOM.ZDVIZ1.w, ROOM.ZDVIZ1.h)).toBe('portrait');
    expect(preferredOrientation(ROOM.BATHROOM.w, ROOM.BATHROOM.h)).toBe('portrait');
  });

  it('counts a square room as portrait — the tie the 1.00 threshold takes', () => {
    expect(preferredOrientation(ROOM.NOGROUND.w, ROOM.NOGROUND.h)).toBe('portrait');
  });

  it('leaves the room just past the threshold in landscape', () => {
    // 345×330 is the nearest room on the other side; if the threshold ever drifted up
    // past 1.05 this is the case that would catch it.
    expect(preferredOrientation(ROOM.WC.w, ROOM.WC.h)).toBe('landscape');
    expect(preferredOrientation(ROOM.PUCLIK.w, ROOM.PUCLIK.h)).toBe('landscape');
    expect(preferredOrientation(ROOM.MIKRO.w, ROOM.MIKRO.h)).toBe('landscape');
  });

  it('reports landscape for an unusable size rather than demanding a rotation', () => {
    expect(preferredOrientation(0, 0)).toBe('landscape');
    expect(preferredOrientation(-1, 500)).toBe('landscape');
    expect(preferredOrientation(NaN, NaN)).toBe('landscape');
  });
});

describe('viewportOrientation', () => {
  it('reads the viewport, both ways up', () => {
    expect(viewportOrientation(VIEW.landscape.w, VIEW.landscape.h)).toBe('landscape');
    expect(viewportOrientation(VIEW.portrait.w, VIEW.portrait.h)).toBe('portrait');
  });

  it('counts a square viewport as landscape', () => {
    expect(viewportOrientation(500, 500)).toBe('landscape');
  });
});

describe('rotationDemand', () => {
  it('asks a phone to turn upright for a portrait room', () => {
    expect(demand('phone', ROOM.VRAK, VIEW.landscape)).toBe('portrait');
  });

  it('asks a phone to turn sideways for an ordinary room', () => {
    expect(demand('phone', ROOM.PUCLIK, VIEW.portrait)).toBe('landscape');
  });

  it('says nothing when the phone is already the right way up', () => {
    expect(demand('phone', ROOM.VRAK, VIEW.portrait)).toBe('ok');
    expect(demand('phone', ROOM.PUCLIK, VIEW.landscape)).toBe('ok');
  });

  it('never asks a tablet or a desktop, whatever the shapes are', () => {
    // Martin's decision (2026-08-26): a tablet is big enough that the worse fit is
    // still comfortable, so it is free to be held either way. This is the assertion
    // that keeps a phone-only feature phone-only.
    for (const device of ['tablet', 'desktop'] as const) {
      expect(demand(device, ROOM.VRAK, VIEW.landscape)).toBe('ok');
      expect(demand(device, ROOM.PUCLIK, VIEW.portrait)).toBe('ok');
    }
  });

  it('says nothing when the viewport cannot be measured', () => {
    // A hidden tab and a phone mid-rotation both report zero. Demanding then would
    // flash the prompt at a player who is not looking — or leave it up.
    expect(demand('phone', ROOM.VRAK, { w: 0, h: 0 })).toBe('ok');
    expect(demand('phone', ROOM.VRAK, { w: 852, h: 0 })).toBe('ok');
  });

  it('says nothing when the content cannot be measured', () => {
    expect(demand('phone', { w: 0, h: 0 }, VIEW.landscape)).toBe('ok');
  });
});
