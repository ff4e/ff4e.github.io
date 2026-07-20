/**
 * ZRC ("Drowned Submarine") + the `xicht` engine primitive.
 *
 * `xicht` (per-fish facial-expression head-frame) is a new engine primitive that
 * ZRC needs for the fish pulling faces at the mirror (URoom.pas:9925-9953). Only
 * the deterministic branches are asserted: the "not facing the mirror" path
 * forces `xicht:=0` regardless of RNG, and the cannon-charge announcement fires
 * deterministically when the charge is seated at (12,8).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { ZRC } from '../src/rooms/zrc.js';

const noTalk = () => 0;

/** Records talkNow/addd usage so tests can assert immediate-Talk vs queued dialog. */
interface SpyScript {
  s: Script;
  talkNowCalls: Array<{ name: string; prior: number }>;
}

/**
 * A ZRC-shaped room matching the r_ZRC_* item indices: 1 peri, 2 zrcadlo (mirror),
 * 4 lahev, 5 naboj (cannon charge), 7 malar (little fish), 8 velkar (big fish).
 * Fillers park at 3 and 6. Fish face left (away from the mirror) by default so the
 * face logic takes its deterministic `xicht:=0` branch.
 */
function zrcRoom(opts: { nabojAt?: [number, number]; facingRight?: boolean } = {}): Script {
  return zrcRoomSpy(opts).s;
}

function zrcRoomSpy(opts: { nabojAt?: [number, number]; facingRight?: boolean } = {}): SpyScript {
  const [nx, ny] = opts.nabojAt ?? [2, 2];
  const room = makeRoom({
    w: 24,
    h: 20,
    facing: { small: opts.facingRight ?? false, big: opts.facingRight ?? false },
    items: [
      { kind: 'static', x: 10, y: 3 }, // 1: peri
      { kind: 'static', x: 12, y: 3 }, // 2: zrcadlo (mirror)
      { kind: 'static', x: 1, y: 1 }, // 3: filler
      { kind: 'static', x: 14, y: 3 }, // 4: lahev
      { kind: 'static', x: nx, y: ny }, // 5: naboj (cannon charge)
      { kind: 'static', x: 1, y: 18 }, // 6: filler
      { kind: 'little', x: 4, y: 10 }, // 7: malar (little fish)
      { kind: 'big', x: 4, y: 15 }, // 8: velkar (big fish)
    ],
  });
  const talkNowCalls: Array<{ name: string; prior: number }> = [];
  const s = new Script(room, noTalk, () => false, {
    talkNow: (name, prior) => {
      talkNowCalls.push({ name, prior });
      return 0;
    },
  });
  ZRC.init(s);
  return { s, talkNowCalls };
}

describe('xicht (facial-expression) primitive', () => {
  it('round-trips setXicht/xicht per fish', () => {
    const s = zrcRoom();
    expect(s.xicht('little')).toBe(0);
    expect(s.xicht('big')).toBe(0);
    s.setXicht('little', 5);
    s.setXicht('big', 3);
    expect(s.xicht('little')).toBe(5);
    expect(s.xicht('big')).toBe(3);
  });

  it('forces xicht:=0 when a fish is not facing the mirror', () => {
    const s = zrcRoom({ facingRight: false });
    // Pretend a previous tick had set a face; the not-facing branch must clear it.
    s.setXicht('little', 7);
    s.setXicht('big', 4);
    ZRC.prog!(s);
    expect(s.xicht('little')).toBe(0);
    expect(s.xicht('big')).toBe(0);
  });
});

describe('ZRC cannon charge (naboj)', () => {
  it('announces itself once, immediately (Talk, not a queued addd), when seated at (12,8)', () => {
    const { s, talkNowCalls } = zrcRoomSpy({ nabojAt: [12, 8] });
    expect(s.vars(5, 1)[1]).toBe(0); // r_ZRC_naboj_nabita
    ZRC.prog!(s);
    expect(s.vars(5)[1]).toBe(1); // charged
    // The original uses Talk(...) which fires immediately with a subtitle — NOT the
    // dialog queue (addd), which would flip no_dialog false and defer the line.
    expect(talkNowCalls).toEqual([{ name: 'zr-x-nabito', prior: 201 }]);
    expect(s.noDialog()).toBe(true); // nothing left queued in the dialog scheduler
  });

  it('stays silent while the charge is elsewhere', () => {
    const { s, talkNowCalls } = zrcRoomSpy({ nabojAt: [2, 2] });
    ZRC.prog!(s);
    expect(s.vars(5)[1]).toBe(0);
    expect(talkNowCalls).toEqual([]);
  });
});
