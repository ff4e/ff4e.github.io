/**
 * Undo's muting of room-script lines (`Script.endProg`, `takeUnsaid`): an undo rewinds the
 * item Vars, and with them the "already said" flags rooms keep there, so the rewound script
 * queues lines the player has just heard. The state must stay exactly as the script writes
 * it — the same Vars hold puzzle state — so only what is HEARD is held back.
 *
 * The last test walks the whole loop the browser runs (`logicTick` tags, `undo.ts` banks
 * and mutes, a rebuilt Script re-triggers) without a browser, against a synthetic room.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script, type RoomScript } from '../src/core/script.js';
import { forgetHeard, takeUnsaid, type UndoPoint } from '../src/core/undoStack.js';

function script(talked: string[] = []): Script {
  const room = makeRoom({ w: 20, h: 12, items: [{ kind: 'little', x: 2, y: 2 }] });
  return new Script(room, (name) => {
    talked.push(name);
    return 3;
  });
}

/** One host tick's worth of script: tag, prog, then the speech queue. */
function tick(s: Script, def: RoomScript, tag: number, count: number): void {
  s.progTag = tag;
  s.beginProg();
  def.prog(s);
  s.endProg();
  s.dialogy(count);
}

describe('Script muting (endProg)', () => {
  it('drops a whole conversation containing a muted line, once, and still applies its sets', () => {
    const talked: string[] = [];
    const s = script(talked);
    const writes: number[] = [];
    s.mutedLines = new Set(['a']);
    s.progTag = 4;
    s.beginProg();
    s.addv(5, 'a');
    s.addset((v) => writes.push(v), 1);
    s.addm(5, 'b');
    s.addset((v) => writes.push(v), 0);
    s.endProg();
    expect(s.isDialog(), 'nothing left to say').toBe(false);
    expect(writes, 'the sets ran, in order').toEqual([1, 0]);
    expect(s.mutedLines.size, 'the mute is spent').toBe(0);
    expect(s.takeHeard(), 'and the dropped lines count as heard').toEqual([
      { name: 'a', tag: 4 },
      { name: 'b', tag: 4 },
    ]);
    for (let c = 1; c < 30; c++) s.dialogy(c);
    expect(talked).toEqual([]);
  });

  it('leaves a conversation alone when none of it is muted, and logs what is heard', () => {
    const talked: string[] = [];
    const s = script(talked);
    s.mutedLines = new Set(['x']);
    s.progTag = 2;
    s.beginProg();
    s.addv(0, 'a');
    s.endProg();
    for (let c = 1; c < 10; c++) s.dialogy(c);
    expect(talked).toEqual(['a']);
    expect(s.takeHeard()).toEqual([{ name: 'a', tag: 2 }]);
    expect(s.mutedLines.has('x')).toBe(true);
  });

  it('never mutes or logs lines queued outside prog (chatter, death lines)', () => {
    const talked: string[] = [];
    const s = script(talked);
    s.mutedLines = new Set(['a']);
    s.addv(0, 'a');
    for (let c = 1; c < 10; c++) s.dialogy(c);
    expect(talked).toEqual(['a']);
    expect(s.takeHeard()).toEqual([]);
  });

  it('only drops the run that queued the muted line, not one already waiting', () => {
    const talked: string[] = [];
    const s = script(talked);
    s.beginProg();
    s.addv(0, 'earlier');
    s.endProg();
    s.mutedLines = new Set(['a']);
    s.beginProg();
    s.addm(0, 'a');
    s.endProg();
    for (let c = 1; c < 20; c++) s.dialogy(c);
    expect(talked).toEqual(['earlier']);
  });
});

describe('a line the undo cuts off', () => {
  it('is reported as playing only while it is being spoken', () => {
    const s = script();
    s.beginProg();
    s.addv(0, 'a');
    s.endProg();
    s.dialogy(1); // starts: 3 ticks long
    expect(s.cutLine()?.name).toBe('a');
    s.dialogy(2);
    expect(s.cutLine()?.name).toBe('a');
    s.dialogy(4); // over
    expect(s.cutLine()).toBe(null);
  });

  it('is taken back out of the history, so the undo does not mute it', () => {
    const s = script();
    s.beginProg();
    s.addv(0, 'a');
    s.endProg();
    s.progTag = 1;
    s.dialogy(1);
    const h: UndoPoint[] = [{ rec: '', snapshot: null, said: s.takeHeard() }];
    forgetHeard(h, s.cutLine());
    expect(takeUnsaid(h, 0)).toEqual([]);
  });

  it('leaves a line that finished in the history', () => {
    const line = { name: 'a', tag: 1 };
    const h: UndoPoint[] = [{ rec: '', snapshot: null, said: [line] }];
    forgetHeard(h, { name: 'a', tag: 1 }); // equal, not the same object: a different line
    expect(takeUnsaid(h, 0)).toEqual(['a']);
  });
});

describe('takeUnsaid', () => {
  const pt = (said?: { name: string; tag: number }[]): UndoPoint => ({ rec: '', snapshot: null, said });

  it('returns what was queued after the target point existed, and nothing older', () => {
    // Point 1 banked at length 2: a line tagged 1 was queued before it (in its snapshot),
    // one tagged 2 after it.
    const h = [pt(), pt([{ name: 'old', tag: 1 }, { name: 'new', tag: 2 }]), pt([{ name: 'later', tag: 3 }])];
    expect(takeUnsaid(h, 1)).toEqual(['new', 'later']);
    expect(h[1]!.said, 'what stays true at the target stays on it').toEqual([{ name: 'old', tag: 1 }]);
  });

  it('is empty when nothing was heard', () => {
    expect(takeUnsaid([pt(), pt()], 0)).toEqual([]);
  });
});

describe('undo, end to end', () => {
  // A room that says hello ONCE, the first time the fish is at x >= 7, latched in a Var —
  // the shape most rooms use, and the one undo used to break.
  const def: RoomScript = {
    name: 'TEST',
    init: (s) => {
      s.vars(0, 1)[1] = 0;
    },
    prog: (s) => {
      const v = s.vars(0);
      if (v[1] === 0 && s.item(s.room.littleIdx).x >= 7) {
        v[1] = 1;
        s.addm(0, 'hello');
      }
    },
  };

  it('does not say a Var-latched line again after an undo to before it, and keeps the latch', () => {
    const talked: string[] = [];
    const history: UndoPoint[] = [];
    const bank = (s: Script): void => {
      const heard = s.takeHeard();
      const top = history[history.length - 1];
      if (heard.length && top) (top.said ??= []).push(...heard);
    };

    let s = script(talked);
    def.init(s);
    tick(s, def, history.length, 1);
    history.push({ rec: '', snapshot: s.snapshot() }); // point 0, flag clear

    s.item(s.room.littleIdx).x = 7; // the move
    for (let c = 2; c < 8; c++) {
      tick(s, def, history.length, c);
      bank(s);
    }
    history.push({ rec: 'r', snapshot: s.snapshot() }); // point 1
    expect(talked).toEqual(['hello']);

    // Undo to point 0: rebuild, restore its (older) snapshot, replay the move.
    const muted = new Set(takeUnsaid(history, 0));
    history.length = 1;
    s = script(talked);
    def.init(s);
    s.applySnapshot(history[0]!.snapshot!);
    s.item(s.room.littleIdx).x = 7;
    s.mutedLines = muted;
    for (let c = 1; c < 8; c++) {
      tick(s, def, history.length, c);
      bank(s);
    }
    expect(talked, 'heard once, not twice').toEqual(['hello']);
    expect(s.vars(0)[1], 'the latch is set exactly as the script set it').toBe(1);

    // And a deeper undo still knows it was heard.
    history.push({ rec: 'r', snapshot: s.snapshot() });
    expect(takeUnsaid(history, 0)).toEqual(['hello']);
  });
});
