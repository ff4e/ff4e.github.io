/**
 * stav_kuk (URoom.pas:24459 akce_switch / 24712 akce_set): after a switch/select the
 * newly-active fish briefly turns to face the player (tl_otocka[1], fazi_kuk = 2 ticks),
 * then returns to rest. It only starts from rest and defers the next command while it
 * plays. The host suppresses it during recording/showmode/load.
 */
import { describe, it, expect } from 'vitest';
import { StepEngine, KUK_FRAMES } from '../src/core/stepEngine.js';
import { makeRoom } from './roomBuilder.js';

function twoFishRoom() {
  return makeRoom({
    w: 12,
    h: 6,
    items: [
      { kind: 'little', x: 2, y: 2 },
      { kind: 'big', x: 6, y: 2 },
    ],
  });
}

function newEngine() {
  const engine = new StepEngine(twoFishRoom(), null, null, { random: () => 0 });
  engine.phase = 'idle';
  engine.active = 'little';
  return engine;
}

describe('stav_kuk peek-at-player (switch/select)', () => {
  it('enters the kuk phase on the newly-active fish and returns to rest after fazi_kuk ticks', () => {
    const engine = newEngine();
    engine.startKuk('big');

    expect(engine.phase).toBe('kuk');
    expect(engine.active).toBe('big');
    expect(engine.activeAnimFish).toBe('big');

    for (let i = 1; i < KUK_FRAMES; i++) {
      engine.advance();
      expect(engine.phase).toBe('kuk'); // still peeking
    }
    engine.advance(); // final tick -> stav_nic -> idle
    expect(engine.phase).toBe('idle');
  });

  it('defers input while peeking (not idle), so a move waits out the 2 ticks', () => {
    const engine = newEngine();
    engine.startKuk('big');
    // The engine is non-idle during kuk; the host's idle() gate keeps commands out.
    expect(engine.phase).not.toBe('idle');
  });

  it('does not clobber an in-flight animation (only starts from rest)', () => {
    const engine = newEngine();
    engine.phase = 'move'; // mid-slide
    engine.startKuk('big');
    expect(engine.phase).toBe('move'); // animation untouched
    expect(engine.active).toBe('big'); // active still switches
  });
});
