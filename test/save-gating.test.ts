/**
 * CanSave (URoom.pas:26900-26906): the original refuses to save unless the
 * position is recoverable — both fish alive, or one alive with the other already
 * out of the room. A dead fish blocks it, and a gspec=9 push-out room blocks it
 * once the last item has been shoved out.
 *
 * This matters more in the port than it looks: the death model deliberately keeps
 * a lone survivor playing, so a mid-death save is easy to trigger and would reload
 * into a position the original never allows.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';

const items: ItemSpec[] = [
  { kind: 'little', x: 2, y: 10 },
  { kind: 'big', x: 8, y: 10 },
];

const room = (): ReturnType<typeof makeRoom> => makeRoom({ w: 20, h: 15, items });

describe('Room.canSave', () => {
  it('allows saving with both fish alive', () => {
    expect(room().canSave).toBe(true);
  });

  it('allows saving when one fish is out and the other is alive', () => {
    const a = room();
    a.exitFish('little');
    expect(a.canSave).toBe(true);

    const b = room();
    b.exitFish('big');
    expect(b.canSave).toBe(true);
  });

  it('blocks saving while a fish is dead', () => {
    const a = room();
    a.killFish('little');
    expect(a.canSave).toBe(false);

    const b = room();
    b.killFish('big');
    expect(b.canSave).toBe(false);
  });

  it('blocks saving when a fish is dead and the other has already left', () => {
    const r = room();
    r.exitFish('big');
    r.killFish('little');
    expect(r.canSave).toBe(false);
  });

  it('blocks saving once both fish are out (the room is won)', () => {
    const r = room();
    r.exitFish('little');
    r.exitFish('big');
    expect(r.canSave).toBe(false);
  });

  it('blocks saving in a gspec=9 push-out room once vytlacit hits 0', () => {
    const r = room();
    r.gspec = 9;
    expect(r.vytlacit).toBe(1);
    expect(r.canSave).toBe(true);
    r.vytlacit = 0;
    expect(r.canSave).toBe(false);
  });
});
