import { describe, expect, it } from 'vitest';
import { Script } from '../src/core/script.js';
import { MOTOR } from '../src/rooms/motor.js';
import { makeRoom, type ItemSpec } from './roomBuilder.js';

function motor(running = true): Script {
  const items: ItemSpec[] = [
    { kind: 'static', x: running ? 10 : 9, y: 6 },
    { kind: 'static', x: 12, y: 4 },
    { kind: 'little', x: 20, y: 20 },
    { kind: 'big', x: 25, y: 20 },
  ];
  for (let i = 5; i <= 11; i++) items.push({ kind: 'static', x: i, y: 12 });
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0);
  MOTOR.init(s);
  return s;
}

function tick(s: Script, count: number): void {
  s.count = count;
  MOTOR.prog(s);
}

describe('MOTOR screen motion', () => {
  it('keeps the original circle and three-tick cadence while running', () => {
    const s = motor();
    for (let n = 1; n <= 120; n++) {
      tick(s, n);
      const angle = Math.floor(n / 3) * Math.PI / 20;
      expect(s.screenOffset.x).toBeCloseTo(-Math.round(20 * Math.sin(angle)), 10);
      expect(s.screenOffset.y).toBe(Math.round(20 * Math.cos(angle)) - 20);
      expect(s.roompole[0]).toBe(Math.floor(n / 3));
    }
  });

  it.each([31, 32, 33])('recenters immediately when stopped on tick %i', count => {
    const s = motor();
    for (let n = 1; n <= 30; n++) tick(s, n);
    expect(s.screenOffset).toEqual({ x: -20, y: -20 });
    s.item(1).x--;
    tick(s, count);
    expect(s.screenOffset).toEqual({ x: 0, y: 0 });
    tick(s, 36);
    expect(s.screenOffset).toEqual({ x: 0, y: 0 });
    expect(s.roompole[0]).toBe(10);
  });

  it('keeps the live phase through repeated instant restores, not the saved phase', () => {
    let live = motor();
    const saved = live.snapshot();
    for (let n = 1; n <= 30; n++) tick(live, n);
    for (let i = 0; i < 4; i++) {
      const restored = motor();
      restored.applySnapshot(saved);
      MOTOR.restorePresentation!(restored, live);
      expect(restored.roompole[0]).toBe(10 + i);
      expect(restored.screenOffset).toEqual(live.screenOffset);
      tick(restored, 1);
      expect(restored.screenOffset).toEqual(live.screenOffset);
      tick(restored, 3);
      expect(restored.roompole[0]).toBe(11 + i);
      live = restored;
    }
    expect(saved.roompole[0] ?? 0).toBe(0);
  });

  it('keeps advancing at the same cadence even when undo rebuilds on every tick', () => {
    let live = motor();
    const saved = live.snapshot();
    for (let n = 1; n <= 30; n++) tick(live, n);
    for (let n = 31; n <= 45; n++) {
      const restored = motor();
      restored.applySnapshot(saved);
      MOTOR.restorePresentation!(restored, live);
      expect(restored.screenOffset).toEqual(live.screenOffset);
      tick(restored, 1);
      expect(restored.roompole[0]).toBe(Math.floor(n / 3));
      live = restored;
    }
  });

  it.each([true, false])('recomputes the restored on/off state (running=%s)', running => {
    const live = motor();
    for (let n = 1; n <= 30; n++) tick(live, n);
    const restored = motor(running);
    MOTOR.restorePresentation!(restored, live);
    expect(restored.screenOffset).toEqual(running ? { x: -20, y: -20 } : { x: 0, y: 0 });
    expect(restored.roompole[0]).toBe(10);
  });

  it('recreates the saved offset after an animated load, without advancing the script', () => {
    const saved = motor();
    for (let n = 1; n <= 30; n++) tick(saved, n);
    const restored = motor();
    restored.applySnapshot(saved.snapshot());
    const before = restored.snapshot();
    MOTOR.restorePresentation!(restored);
    expect(restored.screenOffset).toEqual({ x: -20, y: -20 });
    expect(restored.snapshot()).toEqual(before);
  });
});
