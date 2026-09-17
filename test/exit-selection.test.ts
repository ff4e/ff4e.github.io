import { describe, expect, it, vi } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { StepEngine, type Which } from '../src/core/stepEngine.js';
import { makeRoom } from './roomBuilder.js';

function nearExit(which: Which, dir: Dir = Dir.left) {
  const other: Which = which === 'little' ? 'big' : 'little';
  const width = which === 'little' ? 3 : 4;
  const height = which === 'little' ? 1 : 2;
  const room = makeRoom({
    w: 16,
    h: 10,
    items: [
      {
        kind: which,
        x: dir === Dir.left ? 1 : dir === Dir.right ? 15 - width : 2,
        y: dir === Dir.up ? 1 : dir === Dir.down ? 9 - height : 2,
      },
      { kind: other, x: 7, y: 4 },
    ],
    facing: { small: dir !== Dir.left, big: dir !== Dir.left },
  });
  const onWin = vi.fn();
  const engine = new StepEngine(room, null, null, { random: () => 0, onWin });
  engine.active = which;
  return { room, engine, other, onWin };
}

function startExit(engine: StepEngine, which: Which, dir: Dir = Dir.left): void {
  expect(engine.press(which, dir)).toBe('moving');
  for (let tick = 0; tick < 20 && engine.phase !== 'exit'; tick++) engine.advance();
  expect(engine.phase).toBe('exit');
}

function finishExit(engine: StepEngine): void {
  for (let tick = 0; tick < engine.exitFrames; tick++) engine.advance();
  expect(engine.phase).toBe('idle');
}

describe.each(['little', 'big'] as const)('selection after %s exits', (which) => {
  it.each([Dir.left, Dir.right, Dir.up, Dir.down])('hands over at the end of exit direction %s', (dir) => {
    const { room, engine, other, onWin } = nearExit(which, dir);
    startExit(engine, which, dir);
    const record = engine.srecord;
    for (let tick = 1; tick < engine.exitFrames; tick++) {
      engine.advance();
      expect(engine.active).toBe(which);
      expect(room.venku[which]).toBe(false);
    }
    engine.advance();

    expect(room.venku[which]).toBe(true);
    expect(room.alive[which]).toBe(false);
    expect(engine.active).toBe(other);
    expect(engine.phase).toBe('idle');
    expect(engine.srecord).toBe(record);
    expect(engine.won).toBe(false);
    expect(onWin).not.toHaveBeenCalled();
    expect(engine.press(engine.active, Dir.up)).toBe('moving');
  });

  it('preserves selection when the remaining fish was already active', () => {
    const { engine, other } = nearExit(which);
    engine.active = other;
    startExit(engine, which);
    finishExit(engine);
    expect(engine.active).toBe(other);
  });

  it('does not select a dead partner', () => {
    const { room, engine, other, onWin } = nearExit(which);
    room.killFish(other);
    startExit(engine, which);
    finishExit(engine);
    expect(engine.active).toBe(which);
    expect(onWin).not.toHaveBeenCalled();
  });

  it('does not switch back to an exited partner when the room is won', () => {
    const { room, engine, other, onWin } = nearExit(which);
    room.exitFish(other);
    startExit(engine, which);
    finishExit(engine);
    expect(engine.active).toBe(which);
    expect(room.won).toBe(true);
    expect(engine.won).toBe(true);
    expect(onWin).toHaveBeenCalledExactlyOnceWith(30);
  });

  it('also hands over when a load or undo replays the exit instantly', () => {
    const { room, engine, other } = nearExit(which);
    expect(engine.applyMoveInstant(which, Dir.left)).toBe(true);
    expect(room.venku[which]).toBe(true);
    expect(engine.active).toBe(other);
    expect(engine.phase).toBe('idle');
    expect(engine.srecord).toHaveLength(1);
  });
});
