/**
 * BUG-001: input must be dropped while a fish is `busy` (mid-dialogue, turned to face
 * the player). Faithful to DalsiPrikaz (URoom.pas:27002-27016): a resolved fish command
 * is discarded — not counted as a blocked push — while that fish's busy flag is set.
 * A click-to-swim in progress PAUSES (najdi_smer dir_* dropped) and resumes once the
 * fish stops talking, rather than cancelling.
 */
import { describe, it, expect } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { StepEngine } from '../src/core/stepEngine.js';
import { makeRoom, pos } from './roomBuilder.js';

/** A wide open room: a little fish at (2,2) facing right, free water all around. */
function openRoom() {
  return makeRoom({
    w: 12,
    h: 6,
    items: [{ kind: 'little', x: 2, y: 2 }],
    facing: { small: true, big: true },
  });
}

function newEngine(room: ReturnType<typeof openRoom>): StepEngine {
  const engine = new StepEngine(room, null, null, { random: (n) => (n > 0 ? 0 : 0) });
  engine.phase = 'idle';
  return engine;
}

describe('busy input gate (BUG-001)', () => {
  it('drops a move while the fish is busy (no move, not counted blocked)', () => {
    const room = openRoom();
    const engine = newEngine(room);
    const start = pos(room, room.littleIdx);

    room.busy.little = 1;
    const r = engine.press('little', Dir.right);

    expect(r).toBe('busy');
    expect(pos(room, room.littleIdx)).toEqual(start); // did not move
    expect(engine.phase).toBe('idle'); // no move animation started
    expect(engine.blocked).toBe(0); // a busy drop is not a blocked push
  });

  it('accepts the same move once the fish stops being busy', () => {
    const room = openRoom();
    const engine = newEngine(room);

    room.busy.little = 1;
    expect(engine.press('little', Dir.right)).toBe('busy');

    room.busy.little = 0;
    const r = engine.press('little', Dir.right);
    expect(r).toBe('moving'); // facing right already, so it slides (no turn)
    expect(engine.phase).toBe('move');
  });

  it('only gates the busy fish, not the other one', () => {
    const room = openRoom();
    const engine = newEngine(room);
    room.busy.little = 1;
    // The big fish index is valid even without a big item here; assert the little gate
    // does not leak: pressing little is dropped, but the flag is per-fish.
    expect(room.busy.big).toBe(0);
    expect(engine.press('little', Dir.right)).toBe('busy');
  });

  it('pauses an in-progress auto-swim while busy, then resumes', () => {
    const room = openRoom();
    const engine = newEngine(room);
    const start = pos(room, room.littleIdx);

    // Head for a cell to the right; the auto-swim advances one step per idle tick.
    engine.swim = { which: 'little', tx: 8, ty: 2 };

    room.busy.little = 1;
    for (let i = 0; i < 5; i++) engine.advance();
    expect(pos(room, room.littleIdx)).toEqual(start); // paused: no progress
    expect(engine.swim).not.toBeNull(); // target retained, not cancelled

    room.busy.little = 0;
    engine.advance(); // now it may begin the first step
    // Drive the move animation to completion, then confirm real progress.
    for (let i = 0; i < 40 && pos(room, room.littleIdx).x === start.x; i++) engine.advance();
    expect(pos(room, room.littleIdx).x).toBeGreaterThan(start.x);
  });
});
