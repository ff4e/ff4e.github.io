/**
 * Coming back from the app switcher with the sound still on.
 *
 * iOS has a third audio-context state the spec does not: backgrounding the app moves the
 * context to `'interrupted'`, which `AudioContextState` does not name. Returning moves it
 * to `'running'` again — and that is a lie. Measured on an iPhone 12 (iOS 26.6.1) across
 * an app switch away and back:
 *
 *     statechange -> interrupted  currentTime 38.42
 *     statechange -> running      currentTime 38.42     <- and it never moves again
 *
 * The context reports itself running for ever after while its clock stands still and it
 * plays nothing, so nothing it says about itself decides whether the game can be heard.
 * Two earlier fixes died on exactly that: `resume()` from 'interrupted' rejects with
 * "Failed to start the audio device", and a fix hung off the next touch arrives to find a
 * context claiming to be fine.
 *
 * What is reliable is that the interruption is ANNOUNCED, so these pin the fix that
 * follows from it:
 *
 *   - the interruption is remembered when it happens, not looked up later;
 *   - iOS saying it has finished replaces the context rather than trusting it;
 *   - the replacement is checked by its clock, the one thing a dead context cannot fake;
 *   - a touch is the fallback if that transition never comes;
 *   - an ordinary suspended context is still just resumed, which keeps every sound's place
 *     and is what happens on every platform that is not this one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audio.js';

class FakeAudioContext {
  /** As browsers hand it over: asleep until a gesture. */
  state = 'suspended';
  resumes = 0;
  closed = false;
  /** Set by a test to make resume() reject, as iOS does after an interruption. */
  resumeFails = false;
  /** Whether the caller attached a handler to the last rejected resume.
   *
   *  An unhandled rejection is the failure this pins, and there is no deterministic way to
   *  observe one from inside a test using fake timers — Node only decides a promise was
   *  unhandled a macrotask later, which is the thing the test has taken away. So the fake
   *  watches the promise instead and records whether anyone took responsibility for it. */
  resumeRejectionHandled = false;
  /** Whether the audio device is really running this context. A zombie has `live = false`:
   *  it answers 'running' like any other, and only its stopped clock gives it away. */
  live = true;
  born = Date.now();
  destination = { connect: () => {} };
  private listeners: (() => void)[] = [];

  get currentTime(): number {
    return this.live ? (Date.now() - this.born) / 1000 : 0;
  }

  addEventListener(_type: string, fn: () => void): void {
    this.listeners.push(fn);
  }

  /** What iOS does to the context from the outside, announcement and all. */
  announce(state: string): void {
    this.state = state;
    for (const fn of this.listeners) fn();
  }

  resume(): Promise<void> {
    this.resumes++;
    if (this.resumeFails) {
      const p = Promise.reject(new Error('Failed to start the audio device'));
      const then = p.then.bind(p);
      p.then = (ok, err) => {
        if (err) this.resumeRejectionHandled = true;
        return then(ok, err);
      };
      p.catch = (err) => p.then(undefined, err);
      return p;
    }
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): void {
    this.state = 'suspended';
  }
  close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain(): unknown {
    return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
  }
}

let made: FakeAudioContext[] = [];
let prevCtx: unknown;

/** Install a context class whose every instance comes up dead — 'running', clock stopped,
 *  silent. This is the case a delay alone cannot cover, because the right delay is not
 *  knowable from here. */
function makeZombiesFromNowOn(): void {
  (globalThis as { AudioContext?: unknown }).AudioContext = class extends FakeAudioContext {
    constructor() {
      super();
      this.live = false;
      made.push(this);
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
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

/** Away to another app and back, exactly as the device reported it: the clock stops, and
 *  the way back announces 'running' without meaning it. */
async function appSwitch(ctx: FakeAudioContext): Promise<void> {
  ctx.announce('interrupted');
  ctx.live = false;
  ctx.announce('running');
  await vi.advanceTimersByTimeAsync(450);
}

describe('an interrupted context', () => {
  it('is replaced when iOS says it has finished, without being asked to', async () => {
    const { ctx } = playingEngine();

    await appSwitch(ctx);

    // No touch anywhere in this test: the player should not have to poke a silent game.
    expect(ctx.closed).toBe(true);
    expect(made).toHaveLength(2);
    expect(made[1]!.state).toBe('running');
  });

  it('is not resumed, because resuming does not work', async () => {
    const { ctx } = playingEngine();

    await appSwitch(ctx);

    // Still just the one from playingEngine(): the dead context is never talked to again.
    expect(ctx.resumes).toBe(1);
  });

  it('brings the room music back with it', async () => {
    const { engine, ctx } = playingEngine();
    const play = vi.spyOn(engine, 'playMusic').mockResolvedValue(undefined);
    // What playMusic records for the track now looping.
    Object.assign(engine as unknown as Record<string, unknown>, {
      musicName: 'menu',
      musicUrl: 'music/menu.m4a',
      musicLoop: 1234,
    });

    await appSwitch(ctx);

    // Nothing survives a context, so silence is the alternative to asking again.
    expect(play).toHaveBeenCalledWith('menu', 'music/menu.m4a', 1234);
  });

  it('is replaced once per interruption, however loudly iOS announces it', async () => {
    const { ctx } = playingEngine();

    ctx.announce('interrupted');
    ctx.live = false;
    ctx.announce('running');
    ctx.announce('running');
    ctx.announce('running');
    await vi.advanceTimersByTimeAsync(450);

    expect(made).toHaveLength(2);
  });

  it('comes back to a help overlay still paused', async () => {
    const { engine, ctx } = playingEngine();
    engine.setModalPause(true);
    expect(ctx.state).toBe('suspended');
    // Backgrounding on top of a deliberate pause: the way back must not confuse one for
    // the other, and must certainly not rebuild its way out of a pause.
    await appSwitch(ctx);

    expect(made).toHaveLength(1);
  });

  it('is still owed when the help overlay closes, and is paid then', async () => {
    const { engine, ctx } = playingEngine();
    engine.setModalPause(true);
    await appSwitch(ctx);
    expect(made).toHaveLength(1); // deliberately silent, as above

    engine.setModalPause(false);
    await vi.advanceTimersByTimeAsync(600);

    // Resuming `ctx` is the obvious move here and the wrong one: it is the zombie from
    // the app switch, and it would have answered 'running' for the rest of the session
    // while playing nothing. Staying silent under the overlay is the feature; forgetting
    // WHY it was silent is the bug, and it is invisible until the overlay closes.
    expect(ctx.closed).toBe(true);
    expect(made).toHaveLength(2);
    expect(made[1]!.live).toBe(true);
  });

  it('is not lost to an overlay opened while the replacement is being checked', async () => {
    const { engine, ctx } = playingEngine();
    makeZombiesFromNowOn();
    await appSwitch(ctx); // rebuilt, but into a context that is dead too
    expect(made).toHaveLength(2);

    // The overlay goes up inside the 500 ms verify window, so the check that would have
    // caught the dead replacement never runs.
    engine.setModalPause(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(made).toHaveLength(2);

    engine.setModalPause(false);
    await vi.advanceTimersByTimeAsync(600);

    expect(made.length).toBeGreaterThan(2);
  });
});

describe('the replacement context', () => {
  it('is left alone once its clock is moving', async () => {
    const { ctx } = playingEngine();

    await appSwitch(ctx);
    await vi.advanceTimersByTimeAsync(600);

    // A moving clock is proof the audio device took it, so nothing more is owed.
    expect(made).toHaveLength(2);
  });

  it('is replaced again if it came up dead', async () => {
    const { ctx } = playingEngine();
    makeZombiesFromNowOn();

    await appSwitch(ctx);
    await vi.advanceTimersByTimeAsync(600);

    expect(made).toHaveLength(3);
  });

  it('stops retrying rather than rebuilding for ever', async () => {
    const { ctx } = playingEngine();
    makeZombiesFromNowOn();

    await appSwitch(ctx);
    await vi.advanceTimersByTimeAsync(5000);

    // A device that has not come back by the third try is not coming back, and a repair
    // that never gives up is a leak wearing a repair's clothes.
    expect(made).toHaveLength(4);
  });
});

describe('handleGesture', () => {
  it('repairs an interruption iOS never said it had finished', async () => {
    const { engine, ctx } = playingEngine();
    // Only half the exchange arrives: the interruption is announced, the way back is not.
    ctx.announce('interrupted');
    ctx.live = false;
    await vi.advanceTimersByTimeAsync(450);
    expect(made).toHaveLength(1);

    engine.handleGesture();
    await vi.advanceTimersByTimeAsync(0);

    expect(made).toHaveLength(2);
    expect(ctx.resumes).toBe(1);
  });

  it('replaces a context whose resume is accepted and then fails', async () => {
    const { engine, ctx } = playingEngine();
    // The other shape iOS produces: it comes back 'suspended', takes the resume call, and
    // only then admits the audio device will not start.
    ctx.state = 'suspended';
    ctx.resumeFails = true;

    engine.handleGesture();
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.resumes).toBe(2);
    expect(made).toHaveLength(2);
  });

  it('just resumes an ordinary suspended context', async () => {
    const { engine, ctx } = playingEngine();
    ctx.state = 'suspended';

    engine.handleGesture();
    await vi.advanceTimersByTimeAsync(0);

    // Resuming keeps every sound's place; rebuilding would drop them for nothing.
    expect(ctx.resumes).toBe(2);
    expect(ctx.state).toBe('running');
    expect(made).toHaveLength(1);
  });

  it('leaves a running context alone', () => {
    const { engine, ctx } = playingEngine();

    engine.handleGesture();

    expect(ctx.resumes).toBe(1);
    expect(made).toHaveLength(1);
  });

  it('does not build a context that was never needed', () => {
    const engine = newEngine();

    engine.handleGesture();

    expect(made).toHaveLength(0);
  });

  // The case the whole automatic repair used to miss, measured on an iPhone 12: six app
  // switches, six `-> interrupted` events, and only two announcements coming back. Four
  // times iOS said nothing at all between the interruption and the player's touch, so the
  // game came back silent. Coming back on screen is the trigger that is always there.
  it('is repaired when the app returns to the screen, with no announcement from iOS', async () => {
    const { engine, ctx } = playingEngine();

    // Away and back WITHOUT the transition out of 'interrupted' — the common device case.
    ctx.announce('interrupted');
    ctx.live = false;
    await vi.advanceTimersByTimeAsync(450);
    expect(made).toHaveLength(1); // nothing has run: there was nothing to run off

    engine.handleVisible();
    await vi.advanceTimersByTimeAsync(450);

    expect(made).toHaveLength(2);
    expect(made[1]!.state).toBe('running');
  });

  it('is not repaired twice when iOS does announce as well', async () => {
    const { engine, ctx } = playingEngine();
    ctx.announce('interrupted');
    ctx.live = false;

    // Both triggers inside one rebuild delay: the app is shown, and iOS speaks.
    engine.handleVisible();
    ctx.announce('running');
    await vi.advanceTimersByTimeAsync(450);

    expect(made).toHaveLength(2);
  });

  it('does nothing on a return that owes nothing', async () => {
    const { engine } = playingEngine();

    engine.handleVisible();
    await vi.advanceTimersByTimeAsync(450);

    expect(made).toHaveLength(1);
  });

  // Running out of attempts stops the rebuilding, not the debt. The context left behind is
  // dead and reports 'running'; `interrupted` is the only record of that, and a later
  // trigger has to be able to find it.
  it('is still owed after the rebuilds run out, and a later return pays it', async () => {
    const { engine, ctx } = playingEngine();
    ctx.announce('interrupted');
    ctx.live = false;
    makeZombiesFromNowOn(); // every replacement comes up dead, so the attempts run out

    engine.handleVisible();
    await vi.advanceTimersByTimeAsync(400 + 3 * 500 + 50);
    const spent = made.length;
    expect(spent).toBe(4); // the original, plus three attempts

    // The app comes back on screen a second time. The debt is still there to find.
    engine.handleVisible();
    await vi.advanceTimersByTimeAsync(450);

    expect(made.length).toBeGreaterThan(spent);
  });

  // Found on a device, not here. iOS refuses a resume that is not inside a user gesture,
  // and ensureCtx nudges a suspended context awake from anything about to make a sound —
  // including the boot music, before the player has touched the screen. The refusal was
  // uncaught, so it reached the window's `unhandledrejection` handler, which during boot
  // means fatal: the game came up healthy, played its menu music, and wore a full-screen
  // "something went wrong" over the top of it. The only visible evidence was a log line
  // reading `boot failed: {}`, a DOMException with no enumerable properties.
  it('does not let iOS refusing a speculative resume escape as a boot failure', async () => {
    const { engine, ctx } = playingEngine();
    ctx.state = 'suspended';
    ctx.resumeFails = true;

    engine.resume();
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.resumes).toBe(2);
    expect(ctx.resumeRejectionHandled).toBe(true);
  });
});
