/**
 * setModalPause: silence everything at once, and stay silenced.
 *
 * The help overlay freezes the game (app/renderLoop.ts) and covers the whole play area,
 * so the sound has to stop with it. Suspending the AudioContext is what keeps each
 * sound's PLACE — a half-spoken line and the music loop both continue where they were
 * instead of restarting or being dropped, which killing the voices would not give.
 *
 * The trap this pins is `ensureCtx`: browsers start a context suspended until a gesture
 * unlocks it, so every call that is about to make a sound nudges it awake. That nudge
 * would silently undo a deliberate pause the moment anything touched the engine, and the
 * symptom — sound creeping back under the help pages — is one nobody would attribute to
 * a getter. So the pause is a state the nudge has to respect, not just a suspend() call.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio.js';

class FakeAudioContext {
  state = 'running';
  suspends = 0;
  resumes = 0;
  destination = { connect: () => {} };
  suspend(): void {
    this.suspends++;
    this.state = 'suspended';
  }
  resume(): void {
    this.resumes++;
    this.state = 'running';
  }
  createGain(): unknown {
    return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
  }
  createBufferSource(): unknown {
    return {
      buffer: null,
      loop: false,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      addEventListener: () => {},
    };
  }
}

const FAKE_BUF = { duration: 2 } as unknown as AudioBuffer;
let made: FakeAudioContext[] = [];
let prevCtx: unknown;

beforeEach(() => {
  made = [];
  prevCtx = (globalThis as { AudioContext?: unknown }).AudioContext;
  (globalThis as { AudioContext?: unknown }).AudioContext = class extends FakeAudioContext {
    constructor() {
      super();
      made.push(this);
    }
  };
});

afterEach(() => {
  (globalThis as { AudioContext?: unknown }).AudioContext = prevCtx;
});

function newEngine(): AudioEngine {
  const e = new AudioEngine();
  e.logToConsole = false;
  // Seed the decode cache so play() resolves a name without a real FFS package.
  (e as unknown as { cache: Map<string, AudioBuffer> }).cache.set('sp-smrt1', FAKE_BUF);
  return e;
}

describe('AudioEngine.setModalPause', () => {
  it('suspends the context, and resumes it again', () => {
    const e = newEngine();
    e.play('sp-smrt1', 1, 101, 'voice'); // creates the context
    const ctx = made[0]!;
    expect(ctx.state).toBe('running');

    e.setModalPause(true);
    expect(ctx.state).toBe('suspended');
    expect(ctx.suspends).toBe(1);

    e.setModalPause(false);
    expect(ctx.state).toBe('running');
  });

  it('stays suspended when something else asks the engine to make a sound', () => {
    // The regression this exists for: ensureCtx() auto-resumes a suspended context, so
    // any play()/setBusGain() from anywhere would have lifted the pause.
    const e = newEngine();
    e.play('sp-smrt1', 1, 101, 'voice');
    const ctx = made[0]!;
    e.setModalPause(true);
    const resumesAtPause = ctx.resumes;

    e.play('sp-smrt1', 1, 102, 'voice');
    e.resume();
    e.setBusGain('music', 0.5);

    expect(ctx.state).toBe('suspended');
    expect(ctx.resumes).toBe(resumesAtPause);
  });

  it('lets the gesture unlock work again once the pause is lifted', () => {
    const e = newEngine();
    e.play('sp-smrt1', 1, 101, 'voice');
    const ctx = made[0]!;
    e.setModalPause(true);
    e.setModalPause(false);
    ctx.state = 'suspended'; // as a browser does when the tab is backgrounded

    e.resume();

    expect(ctx.state).toBe('running');
  });

  it('is idempotent, and safe before anything has made a sound', () => {
    const e = newEngine();
    expect(() => e.setModalPause(true)).not.toThrow(); // no context yet
    expect(made).toHaveLength(0);

    e.play('sp-smrt1', 1, 101, 'voice');
    const ctx = made[0]!;
    // The engine already believes it is paused, so the redundant call must not
    // double-suspend — and the pause it is holding still has to be honoured.
    e.setModalPause(true);
    expect(ctx.suspends).toBe(0);

    e.setModalPause(false);
    e.setModalPause(true);
    e.setModalPause(true);
    expect(ctx.suspends).toBe(1);
  });
});
