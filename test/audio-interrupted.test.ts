/**
 * Coming back from the app switcher with the sound still on.
 *
 * iOS has a third audio-context state that the spec does not: backgrounding the app moves
 * the context to `'interrupted'`, and bringing the app back does NOT move it out again.
 * `AudioContextState` has no such member, so the obvious test for a context that needs
 * waking — `state === 'suspended'` — is blind to exactly the case iOS produces. That was
 * the bug: the game came back from the app switcher permanently silent, because every
 * call that would have nudged the context awake looked at it, saw something that was not
 * 'suspended', and left it alone.
 *
 * Two things fix it and both are pinned here. `ensureCtx` asks whether the context is
 * RUNNING rather than whether it is suspended, so any sound repairs it; and
 * `handleForeground` repairs it without waiting for a sound, because there may not be one
 * — room music that is already playing needs no further call to keep going, so a player
 * who switches away mid-room has nothing left to trigger the recovery.
 *
 * The 'closed' cases are not hypothetical politeness: resume() on a closed context
 * rejects, and an unhandled rejection is what a `state !== 'running'` test buys you if it
 * is written carelessly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio.js';

class FakeAudioContext {
  /** As browsers hand it over: asleep until a gesture. */
  state = 'suspended';
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
}

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
  vi.restoreAllMocks();
  (globalThis as { AudioContext?: unknown }).AudioContext = prevCtx;
});

function newEngine(): AudioEngine {
  const e = new AudioEngine();
  e.logToConsole = false;
  return e;
}

/** An engine holding a context that is awake, as it is during play. */
function playingEngine(): { engine: AudioEngine; ctx: FakeAudioContext } {
  const engine = newEngine();
  engine.resume();
  const ctx = made[0]!;
  expect(ctx.state).toBe('running');
  return { engine, ctx };
}

describe('an interrupted context', () => {
  it('is woken by anything that wants a sound', () => {
    const { engine, ctx } = playingEngine();
    ctx.state = 'interrupted';

    engine.resume();

    expect(ctx.state).toBe('running');
    expect(ctx.resumes).toBe(2);
  });

  it('is woken by the app coming back, with no sound needed', () => {
    const { engine, ctx } = playingEngine();
    ctx.state = 'interrupted';

    engine.handleForeground();

    expect(ctx.state).toBe('running');
    expect(ctx.resumes).toBe(2);
  });
});

describe('handleForeground', () => {
  it('leaves a running context alone', () => {
    const { engine, ctx } = playingEngine();

    engine.handleForeground();

    expect(ctx.resumes).toBe(1);
  });

  it('does not build a context that was never needed', () => {
    const engine = newEngine();

    engine.handleForeground();

    expect(made).toHaveLength(0);
  });

  it('does not resume a closed context', () => {
    const { engine, ctx } = playingEngine();
    ctx.state = 'closed';

    engine.handleForeground();

    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe('closed');
  });

  it('comes back to a help overlay still paused', () => {
    const { engine, ctx } = playingEngine();
    engine.setModalPause(true);
    expect(ctx.state).toBe('suspended');
    // Backgrounding on top of a deliberate pause: iOS interrupts what was already
    // suspended, and the way back must not confuse one for the other.
    ctx.state = 'interrupted';

    engine.handleForeground();

    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe('interrupted');
  });
});
