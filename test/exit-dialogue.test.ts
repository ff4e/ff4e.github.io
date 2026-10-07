import { describe, expect, it, vi } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { Script } from '../src/core/script.js';
import { StepEngine, type Which } from '../src/core/stepEngine.js';
import { makeRoom } from './roomBuilder.js';

const prior = { little: 1, big: 2 } as const;

function setup(which: Which, secondExit = false, dir: Dir = Dir.left) {
  const other: Which = which === 'little' ? 'big' : 'little';
  const width = which === 'little' ? 3 : 4;
  const height = which === 'little' ? 1 : 2;
  const room = makeRoom({
    w: 16, h: 10,
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
  if (secondExit) room.exitFish(other);
  let count = 0;
  const voices = new Map<number, number>();
  const talk = vi.fn((_name: string, channel: number) => {
    voices.set(channel, count + 60);
    return 60;
  });
  const ksnd = vi.fn();
  // The sample's tail may still be playing after Talking() becomes false.
  const playing = vi.fn(() => true);
  const script = new Script(room, talk, playing, { ksnd }, p => (voices.get(p) ?? 0) > count);
  const random = vi.fn(() => 0);
  const onWin = vi.fn();
  const playSound = vi.fn((name: string, speaker?: Which) => {
    expect(room.venku[which], 'the farewell starts before the fish leaves').toBe(false);
    expect(speaker).toBeDefined();
    if (speaker) talk(name, prior[speaker]);
  });
  const engine = new StepEngine(room, script, null, { random, playSound, onWin });
  const tick = () => {
    script.dialogy(++count);
    engine.advance();
  };
  const start = (moving?: () => void) => {
    expect(engine.press(which, dir)).toBe('moving');
    moving?.();
    for (let i = 0; i < 20 && engine.phase !== 'exit'; i++) tick();
    expect(engine.phase).toBe('exit');
    expect(engine.animFrame).toBe(0);
  };
  const finish = () => {
    for (let i = 0; i < engine.exitFrames; i++) tick();
    expect(room.venku[which]).toBe(true);
    expect(engine.phase).toBe('idle');
  };
  return { room, script, engine, talk, ksnd, playing, random, onWin, playSound, other, start, finish, tick };
}

describe.each(['little', 'big'] as const)('%s exit dialogue (URoom.pas:24387-24414)', which => {
  it.each([Dir.left, Dir.right, Dir.up, Dir.down])('speaks once at exit START, direction %s', dir => {
    const h = setup(which, false, dir);
    h.start();
    expect(h.playSound).toHaveBeenCalledExactlyOnceWith(which === 'little' ? 'jo-m-0' : 'jo-v-0', which);
    expect(h.playing).not.toHaveBeenCalled();
    h.finish();
    expect(h.playSound).toHaveBeenCalledTimes(1);
    expect(h.onWin).not.toHaveBeenCalled();
  });

  it.each([false, true])('skips, rather than defers, a farewell while its speaker talks (final=%s)', final => {
    const h = setup(which, final);
    const prom = vi.fn();
    h.script.addd(0, 'current-sentence', prior[which], prom);
    h.script.dialogy(0);
    const current = h.script.cutLine();
    h.script.addm(100, 'pending-sentence');
    const pendingSet = vi.fn();
    h.script.addset(pendingSet, 7);
    h.start(() => {
      h.script.setBusy('little', 1);
      h.script.setBusy('big', 2);
    });

    expect(h.playSound).not.toHaveBeenCalled();
    expect(h.random).not.toHaveBeenCalled();
    expect(h.script.pendingDialogue(false)).toEqual([]);
    expect(h.room.busy).toEqual({ little: 0, big: 0 });
    expect(h.script.isDialog()).toBe(true);
    expect(h.script.cutLine()).toBe(current);
    expect(prom.mock.calls).toEqual([[prior[which]]]);
    expect(h.ksnd).not.toHaveBeenCalled();
    h.finish();
    expect(h.engine.won).toBe(final);
    expect(h.onWin.mock.calls).toEqual(final ? [[30]] : []);
    for (let i = 0; i < 100; i++) h.tick();
    expect(h.talk.mock.calls).toEqual([['current-sentence', prior[which]]]);
    expect(prom.mock.calls).toEqual([[prior[which]], [0]]);
    expect(pendingSet).not.toHaveBeenCalled();
    expect(h.script.isDialog()).toBe(false);
  });

  it('does not suppress a farewell merely because the OTHER fish is speaking', () => {
    const h = setup(which);
    h.script.addd(0, 'partner-sentence', prior[h.other]);
    h.script.dialogy(0);
    h.start();
    expect(h.playSound).toHaveBeenCalledExactlyOnceWith(which === 'little' ? 'jo-m-0' : 'jo-v-0', which);
    expect(h.ksnd).not.toHaveBeenCalled();
  });

  it('drops queued actions even when no line was playing and the farewell starts', () => {
    const h = setup(which);
    const set = vi.fn();
    h.script.addv(100, 'never-spoken');
    h.script.addset(set, 1);
    h.script.addd(0, 'ANIMa2', h.room.bigIdx);
    h.start();
    expect(h.script.pendingDialogue()).toEqual([]);
    h.finish();
    for (let i = 0; i < 150; i++) h.tick();
    expect(h.talk).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    expect(h.room.items[h.room.bigIdx]!.anim).toBe('');
  });

  it('keeps an active animation wait while discarding what followed it', () => {
    const h = setup(which);
    h.script.addd(0, 'ANIMWAITa2', h.room.bigIdx);
    h.script.dialogy(0);
    h.script.addv(0, 'after-animation');
    h.start();
    expect(h.script.isDialog()).toBe(true);
    expect(h.room.items[h.room.bigIdx]!.anim).toBe('a2');
    h.room.items[h.room.bigIdx]!.anim = '';
    h.tick();
    expect(h.script.isDialog()).toBe(false);
    expect(h.talk).toHaveBeenCalledTimes(1);
  });

  it('clears pending dialogue even when a dead partner suppresses the farewell', () => {
    const h = setup(which);
    h.room.killFish(h.other);
    h.script.addm(100, 'never-spoken');
    h.start();
    expect(h.script.pendingDialogue()).toEqual([]);
    expect(h.playSound).not.toHaveBeenCalled();
    expect(h.random).not.toHaveBeenCalled();
  });

  it('uses the little fish for the gum line and preserves its armed flag', () => {
    const h = setup(which, true);
    h.script.zvykacka = true;
    h.start();
    expect(h.playSound).toHaveBeenCalledExactlyOnceWith('ob-m-zvykacka', 'little');
    expect(h.script.zvykacka).toBe(true);
    h.finish();
    expect(h.engine.won).toBe(true);
    expect(h.playSound).toHaveBeenCalledTimes(1);
  });

  it('keeps instant undo/load re-simulation silent', () => {
    const h = setup(which);
    expect(h.engine.applyMoveInstant(which, Dir.left)).toBe(true);
    expect(h.room.venku[which]).toBe(true);
    expect(h.playSound).not.toHaveBeenCalled();
    expect(h.talk).not.toHaveBeenCalled();
    expect(h.random).not.toHaveBeenCalled();
  });
});
