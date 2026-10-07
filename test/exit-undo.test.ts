/**
 * Exercise real undoMove -> restore -> dialogue transfer, including intermediate
 * undos that leave the first fish outside. Only browser/rendering services are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { Script, type RoomScript } from '../src/core/script.js';
import { StepEngine, type Which } from '../src/core/stepEngine.js';
import * as game from '../src/app/gameState.js';
import { initMovement } from '../src/app/movement.js';
import { ui } from '../src/app/screenState.js';
import { sampleUndoPoint, undoMove } from '../src/app/undo.js';
import { makeRoom } from './roomBuilder.js';

vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));
vi.mock('../src/app/framePacing.js', () => ({ roomLoading: false }));
vi.mock('../src/app/phoneViewport.js', () => ({ continuePhoneRoom: vi.fn() }));
vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => false }));
vi.mock('../src/app/solveMode.js', () => ({ inSolvemode: () => false }));
vi.mock('../src/platform/haptics.js', () => ({ hapticBlocked: vi.fn() }));

beforeEach(() => {
  game.clearUndoHistory();
  game.setRoom(null);
  game.setEngine(null);
  game.setActiveScript(null);
  game.setLoadmode(null);
  game.setShowmode(null);
  game.setReplaymode(null);
  game.setCutscene(null);
  ui.screen = 'room';
});

function scenario(which: Which, origin: 'init' | 'prog', triggerX = 2, openingDelay = 0) {
  const other: Which = which === 'little' ? 'big' : 'little';
  const spoken: string[] = [];
  const voices = new Map<number, number>();
  let now = 0;
  const queue = (s: Script) => {
    const v = s.vars(0, 2);
    v[1] = 1;
    s.addd(openingDelay, 'opening', which === 'little' ? 1 : 2);
    s.addd(120, 'remainder', other === 'little' ? 1 : 2);
    s.addset(x => { v[2] = x; }, 7);
    s.addset(x => { s.roompole[3] = x; }, 9);
  };
  const def: RoomScript = {
    name: 'EXIT-UNDO',
    init: s => {
      s.vars(0, 2);
      if (origin === 'init') queue(s);
    },
    prog: s => {
      const idx = which === 'little' ? s.room.littleIdx : s.room.bigIdx;
      if (origin === 'prog' && s.vars(0)[1] === 0 && s.item(idx).x <= triggerX) queue(s);
    },
  };
  const buildRoom = () => {
    now = 0;
    voices.clear();
    const room = makeRoom({
      w: 20, h: 12,
      items: [{ kind: which, x: 3, y: 2 }, { kind: other, x: 9, y: 5 }],
      facing: { small: false, big: false },
    });
    const s = new Script(room, (name, channel) => {
      spoken.push(name);
      voices.set(channel, now + 80);
      return 80;
    }, () => false, {}, p => (voices.get(p) ?? 0) > now);
    const engine = new StepEngine(room, s, def, { random: () => 0 });
    def.init(s);
    game.setRoom(room);
    game.setEngine(engine);
    game.setActiveScript({ def, s });
  };
  initMovement({ buildRoom, endShowmode: () => {}, hracNespi: () => {}, setInfo: () => {} });
  buildRoom();
  const script = () => game.activeScript!.s;
  const tick = () => {
    script().progTag = game.undoHistory.length;
    game.engine!.runScript(++now, 0);
    script().dialogy(now);
    game.engine!.advance();
    sampleUndoPoint();
  };
  const ticks = (n: number) => { for (let i = 0; i < n; i++) tick(); };
  tick(); // bank the initial point, as the host does
  const move = (fish: Which, dir: Dir) => {
    expect(game.engine!.phase).toBe('idle');
    expect(game.engine!.press(fish, dir)).toBe('moving');
    for (let i = 0; i < 30 && game.engine!.phase !== 'idle'; i++) tick();
    expect(game.engine!.phase).toBe('idle');
  };
  const approach = () => {
    move(which, Dir.left); // x = 2
    move(which, Dir.left); // x = 1, a banked point before exit
  };
  const exit = () => {
    move(which, Dir.left);
    expect(game.room!.venku[which]).toBe(true);
    expect(game.room!.won).toBe(false);
    expect(script().pendingDialogue(false)).toEqual([]);
  };
  const undo = () => { expect(undoMove()).toBe(true); };
  return { other, spoken, script, ticks, move, approach, exit, undo, buildRoom };
}

describe.each(['little', 'big'] as const)('undo after %s exits', which => {
  it.each(['init', 'prog'] as const)('recovers an unheard %s tail and its callbacks only when the exit is reversed', origin => {
    const h = scenario(which, origin);
    h.approach();
    expect(game.undoHistory.at(-1)!.snapshot!.vars[0]![1]).toBe(1);
    h.exit();
    h.ticks(250);
    expect(h.spoken).toEqual(['opening']);
    expect(h.script().vars(0)[2]).toBe(0);
    expect(h.script().isDialog()).toBe(false);

    h.undo();
    expect(game.room!.venku[which]).toBe(false);
    expect(h.script().pendingDialogue().map(d => d.zvuk)).toEqual(['remainder', 'set', 'set']);
    h.ticks(250);
    expect(h.spoken).toEqual(['opening', 'remainder']);
    expect(h.script().vars(0)[2]).toBe(7); // callback captured an item array
    expect(h.script().roompole[3]).toBe(9); // callback captured the old Script
    expect(h.script().isDialog()).toBe(false);
  });

  it('keeps the discarded tail silent through intermediate undos, even with no live queue to carry', () => {
    const h = scenario(which, 'init');
    h.approach();
    h.exit();
    h.ticks(250);
    h.move(h.other, Dir.up);
    h.move(h.other, Dir.up);

    for (let i = 0; i < 2; i++) {
      h.undo();
      expect(game.room!.venku[which]).toBe(true);
      expect(h.script().pendingDialogue()).toEqual([]);
      h.ticks(250);
      expect(h.spoken).toEqual(['opening']);
      expect(h.script().vars(0)[2]).toBe(0);
    }
    h.undo();
    expect(game.room!.venku[which]).toBe(false);
    h.ticks(250);
    expect(h.spoken).toEqual(['opening', 'remainder']);
    expect(h.script().vars(0)[2]).toBe(7);
    expect(h.script().roompole[3]).toBe(9);
  });

  it('replays a cut current line before the recovered tail, once, after a burst of undos', () => {
    const h = scenario(which, 'init');
    h.approach();
    h.exit();
    expect(h.script().cutLine()?.name).toBe('opening');
    h.undo();
    expect(h.script().pendingDialogue().map(d => d.zvuk)).toEqual(['opening', 'remainder', 'set', 'set']);
    h.ticks(5); // shorter than the cut-line replay delay
    h.undo();
    h.ticks(350);
    expect(h.spoken).toEqual(['opening', 'opening', 'remainder']);
    expect(h.script().vars(0)[2]).toBe(7);
    expect(h.script().roompole[3]).toBe(9);
  });

  it('discards the restored tail again on re-exit without duplicating it on the next undo', () => {
    const h = scenario(which, 'prog');
    h.approach();
    h.exit();
    h.ticks(250);
    h.undo();
    h.exit();
    h.ticks(250);
    expect(h.spoken).toEqual(['opening']);
    h.undo();
    h.ticks(250);
    expect(h.spoken).toEqual(['opening', 'remainder']);
    expect(h.script().roompole[3]).toBe(9);
  });

  it('does not carry a tail whose trigger the undo target predates; prog queues it afresh', () => {
    const h = scenario(which, 'prog', 1, 100);
    h.approach();
    expect(game.undoHistory.at(-1)!.snapshot!.vars[0]![1]).toBe(0);
    h.exit();
    expect(h.spoken).toEqual([]);
    h.undo();
    expect(h.script().pendingDialogue()).toEqual([]);
    h.ticks(500);
    expect(h.spoken).toEqual(['opening', 'remainder']);
    expect(h.script().vars(0)[2]).toBe(7);
  });

  it('does not duplicate a recovered prog tail when the target snapshot has expired', () => {
    const h = scenario(which, 'prog');
    h.approach();
    game.undoHistory.at(-1)!.snapshot = null;
    h.exit();
    h.ticks(250);
    h.undo();
    h.ticks(250);
    expect(h.spoken).toEqual(['opening', 'remainder']);
    expect(h.script().vars(0)[2]).toBe(7);
    expect(h.script().roompole[3]).toBe(9);
  });

  it('does not resurrect untagged chatter or dialogue queued after the exit', () => {
    const h = scenario(which, 'init');
    h.approach();
    h.script().addm(100, 'ambient'); // outside prog/init: deliberately untagged
    h.exit();
    h.ticks(250);
    h.script().beginProg();
    h.script().addv(0, 'post-exit');
    h.script().endProg();
    h.ticks(1);
    expect(h.spoken).toEqual(['opening', 'post-exit']);
    h.undo();
    expect(h.script().pendingDialogue().map(d => d.zvuk)).toEqual(['remainder', 'set', 'set']);
    h.ticks(250);
    expect(h.spoken).toEqual(['opening', 'post-exit', 'remainder']);
  });

  it('does not carry discarded closures into a fresh attempt or into snapshots', () => {
    const h = scenario(which, 'init');
    h.approach();
    h.exit();
    expect(h.script().discardedOnExit).toHaveLength(1);
    expect(h.script().snapshot()).not.toHaveProperty('discardedOnExit');
    game.clearUndoHistory();
    h.buildRoom();
    expect(h.script().discardedOnExit).toEqual([]);
    h.ticks(350);
    expect(h.spoken).toEqual(['opening', 'opening', 'remainder']);
    expect(h.script().vars(0)[2]).toBe(7);
  });
});
