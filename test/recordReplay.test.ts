/**
 * A replayed record has to reproduce ITSELF, not just the room it describes.
 *
 * `restore` (the F3 load, and anything else that rebuilds a room from its move log)
 * throws `srecord` away and lets the replay write a new one. That is fine for moves,
 * which are re-run through the same physics — but a `gspec=9` push-out is not a move.
 * It is a consequence the engine logs as `'q'+index` (URoom.pas:24044-24047) precisely
 * because a move-only replay cannot re-derive it: `prog()`, which marks the item spec=9,
 * never runs on that path.
 *
 * So the replay has to both RE-APPLY the removal and RE-LOG its marker. Re-applying
 * alone gets the room right and the record wrong, and the record is what the next save —
 * or the next replay of it — is built from: one round-trip drops the marker, and the
 * pushed-out item quietly comes back.
 *
 * Asserted in the shared engine on a synthetic room, in milliseconds. `gral-pushout.test.ts`
 * covers what a push-out does to the physics; this covers what it does to the log.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Dir } from '../src/core/dir.js';
import { stepsOf } from '../src/core/record.js';
import { StepEngine } from '../src/core/stepEngine.js';
import type { Room } from '../src/core/room.js';

/** A room whose one light block can be shoved out (`gspec=9`), with a fish to shove it. */
function pushOutRoom(): Room {
  const room = makeRoom({
    w: 12,
    h: 8,
    items: [
      { kind: 'big', x: 2, y: 5 },
      { kind: 'light', x: 6, y: 6 },
    ],
  });
  room.gspec = 9;
  room.vytlacit = 1;
  return room;
}

const engineFor = (room: Room): StepEngine =>
  new StepEngine(room, null, null, { random: () => 0 });

/** Every item's position and spec — the thing to compare two room states by. */
const positions = (room: Room): string =>
  room.items.map((it) => `${it.x},${it.y},${it.spec}`).join('|');

/** Replay a record into a fresh room the way `restore` does. */
function replay(rec: string): { room: Room; engine: StepEngine } {
  const room = pushOutRoom();
  const engine = engineFor(room);
  room.clearAllDirs();
  room.fallToRest();
  room.clearAllDirs();
  for (const st of stepsOf(rec)) engine.applyRecordStep(st);
  return { room, engine };
}

describe('replaying a record with a push-out', () => {
  it('re-applies the removal AND re-logs its marker, so the record round-trips', () => {
    const live = pushOutRoom();
    const engine = engineFor(live);
    engine.applyMoveInstant('big', Dir.right); // a real move, so the record is not only a marker
    // What `prog()`/kontroluj_vytlaceni does when the block reaches the edge: mark it
    // spec=9. The engine's cork phase then slides it out and logs the marker itself.
    live.items[2]!.spec = 9;
    for (let i = 0; i < 20 && !engine.won; i++) engine.advance();
    const rec = engine.srecord;
    expect(rec, 'the push-out logged its marker').toMatch(/q\d{3}/);
    const gone = positions(live);

    const first = replay(rec);
    expect(positions(first.room), 'the pushed-out item stays out').toBe(gone);
    expect(first.engine.srecord, 'and the replay reproduces the record it replayed').toBe(rec);
    // The round-trip is the point. Without the re-log the second pass replays a record
    // that is one marker short, and the item is back in the room.
    const second = replay(first.engine.srecord);
    expect(positions(second.room)).toBe(gone);
  });
});
