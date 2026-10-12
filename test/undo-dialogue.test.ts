/**
 * Undo rebuilds dialogue from the room and snapshot, without carrying or muting lines.
 * Exercise the real undoMove/restore path; only browser/rendering services are mocked.
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

function scenario(which: Which, origin: 'init' | 'prog') {
  const other: Which = which === 'little' ? 'big' : 'little';
  const spoken: string[] = [];
  let now = 0;
  const queue = (s: Script) => {
    const v = s.vars(0, 2);
    v[1] = 1;
    s.addd(0, 'opening', which === 'little' ? 1 : 2);
    s.addd(120, 'remainder', other === 'little' ? 1 : 2);
    s.addset(x => { v[2] = x; }, 7);
    s.addset(x => { s.roompole[3] = x; }, 9);
  };
  const def: RoomScript = {
    name: 'UNDO-DIALOGUE',
    init: s => {
      s.vars(0, 2);
      if (origin === 'init') queue(s);
    },
    prog: s => {
      const idx = which === 'little' ? s.room.littleIdx : s.room.bigIdx;
      if (origin === 'prog' && s.vars(0)[1] === 0 && s.item(idx).x <= 2) queue(s);
    },
  };
  const buildRoom = () => {
    now = 0;
    const room = makeRoom({
      w: 20, h: 12,
      items: [{ kind: which, x: 3, y: 2 }, { kind: other, x: 9, y: 5 }],
      facing: { small: false, big: false },
    });
    const s = new Script(room, name => { spoken.push(name); return 80; }, () => false);
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
    game.engine!.runScript(++now, 0);
    script().dialogy(now);
    game.engine!.advance();
    sampleUndoPoint();
  };
  const ticks = (n: number) => { for (let i = 0; i < n; i++) tick(); };
  tick();
  const move = (fish = which, dir = Dir.left) => {
    expect(game.engine!.phase).toBe('idle');
    expect(game.engine!.press(fish, dir)).toBe('moving');
    for (let i = 0; i < 30 && game.engine!.phase !== 'idle'; i++) tick();
    expect(game.engine!.phase).toBe('idle');
  };
  const undo = () => { expect(undoMove()).toBe(true); };
  return { other, spoken, script, ticks, move, undo };
}

describe.each(['little', 'big'] as const)('%s undo dialogue without preservation', which => {
  it('allows a heard conversation to repeat after undo rewinds its trigger', () => {
    const h = scenario(which, 'prog');
    h.move();
    h.ticks(350);
    expect(h.spoken).toEqual(['opening', 'remainder']);
    h.undo();
    expect(h.script().vars(0)[1]).toBe(0);
    expect(h.script().roompole[3]).toBe(0);
    h.move();
    h.ticks(350);
    expect(h.spoken).toEqual(['opening', 'remainder', 'opening', 'remainder']);
    expect(h.script().vars(0)[2]).toBe(7);
    expect(h.script().roompole[3]).toBe(9);
  });

  it('does not transfer an unheard tail whose trigger is already in the snapshot', () => {
    const h = scenario(which, 'prog');
    h.move();
    h.move();
    h.move(h.other, Dir.up);
    h.ticks(100);
    expect(h.spoken).toEqual(['opening']);
    expect(h.script().isDialog()).toBe(true);
    h.undo();
    expect(h.script().vars(0)[1]).toBe(1);
    expect(h.script().isDialog()).toBe(false);
    h.ticks(350);
    expect(h.spoken).toEqual(['opening']);
    expect(h.script().vars(0)[2]).toBe(0);
    expect(h.script().roompole[3]).toBe(0);
  });

  it('restarts an init opening on every undo without a replay delay or cut limit', () => {
    const h = scenario(which, 'init');
    h.move();
    h.move();
    expect(h.spoken).toEqual(['opening']);
    for (let i = 0; i < 2; i++) {
      h.undo();
      h.ticks(1);
      expect(h.spoken).toEqual(Array(i + 2).fill('opening'));
    }
    h.ticks(350);
    expect(h.spoken).toEqual(['opening', 'opening', 'opening', 'remainder']);
  });

  it.each([false, true])('does not recover exit-discarded dialogue (intermediate undos: %s)', intermediate => {
    const h = scenario(which, 'prog');
    h.move();
    h.move();
    h.move();
    expect(game.room!.venku[which]).toBe(true);
    h.ticks(350);
    expect(h.spoken).toEqual(['opening']);
    expect(h.script().isDialog()).toBe(false);
    if (intermediate) {
      h.move(h.other, Dir.up);
      h.move(h.other, Dir.up);
      for (let i = 0; i < 2; i++) {
        h.undo();
        expect(game.room!.venku[which]).toBe(true);
        h.ticks(350);
        expect(h.spoken).toEqual(['opening']);
      }
    }
    h.undo();
    expect(game.room!.venku[which]).toBe(false);
    h.ticks(350);
    expect(h.spoken).toEqual(['opening']);
    expect(h.script().vars(0)[2]).toBe(0);
    expect(h.script().roompole[3]).toBe(0);
  });
});
