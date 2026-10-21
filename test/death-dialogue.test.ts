/**
 * A fish's death and the dialogue (URoom.pas:26763-26777): KSnd(mluvi_*) cuts the dead
 * fish's voice and Zrus_dialogy drops the pending queue. An undo of the death takes the
 * dropped entries back, so a room that carries its conversation is not stranded.
 */
import { describe, expect, it, vi } from 'vitest';
import { Script } from '../src/core/script.js';
import { makeRoom } from './roomBuilder.js';

const LITTLE = 1;
const BIG = 2;

function setup() {
  const room = makeRoom({
    w: 16,
    h: 10,
    items: [
      { kind: 'little', x: 1, y: 2 },
      { kind: 'big', x: 7, y: 4 },
    ],
  });
  let count = 0;
  const talk = vi.fn((_name: string, _prior: number) => 60);
  const ksnd = vi.fn();
  const script = new Script(room, talk, () => true, { ksnd });
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) script.dialogy(++count);
  };
  const said = () => talk.mock.calls.map(([name]) => name);
  return { room, script, talk, ksnd, tick, said };
}

describe('a fish dies while the dialogue runs', () => {
  it('cuts the dead fish off mid-line and drops what was still to be said', () => {
    const { script, ksnd, tick, said } = setup();
    script.addv(0, 'big-line');
    script.addm(5, 'little-line');
    tick();
    expect(said()).toEqual(['big-line']);
    expect(script.isDialog()).toBe(true);

    script.fishDied([BIG]);
    expect(ksnd).toHaveBeenCalledWith(BIG);
    tick();
    // The original's Dialogy sees the voice stop and moves on at once.
    expect(script.isDialog()).toBe(false);
    tick(100);
    expect(said()).toEqual(['big-line']);
  });

  it("lets the survivor's line in progress play out", () => {
    const { script, ksnd, tick } = setup();
    script.addm(0, 'little-line');
    tick();
    script.fishDied([BIG]);
    expect(ksnd).not.toHaveBeenCalledWith(LITTLE);
    tick();
    expect(script.isDialog()).toBe(true);
  });

  it('speaks what the room queues in reaction to the death', () => {
    const { script, tick, said } = setup();
    script.addv(10, 'before');
    script.fishDied([LITTLE]);
    script.addv(3, 'zr-v-vzdyt');
    tick(10);
    expect(said()).toEqual(['zr-v-vzdyt']);
  });

  it('gives an undo of the death back what the death dropped', () => {
    const { room, script, talk, tick, said } = setup();
    const set = vi.fn();
    script.addm(20, 'little-line');
    script.addd(0, 'npc-line', 300);
    script.addset(set, 7);
    script.fishDied([BIG]);
    room.killFish('big');
    script.addv(3, 'death-comment');

    const restored = new Script(room, talk, () => true, {});
    restored.adoptDialogue(script, [LITTLE, BIG]); // a dead fish: no fish lines carry
    for (let c = 1; c <= 70; c++) restored.dialogy(c); // the set waits out the 60-tick line
    expect(said()).toEqual(['npc-line']);
    expect(set).toHaveBeenCalledWith(7, restored);
    tick(30);
    expect(said()).toEqual(['npc-line', 'death-comment']);
  });
});
