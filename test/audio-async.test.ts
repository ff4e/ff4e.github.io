/**
 * A sound must be observable the moment it is REQUESTED, and must not arrive after
 * it has been killed.
 *
 * The original's `Sound()` (RSound.pas:674) claims a mixer channel and writes
 * `priority:=prior; flen:=d` before it returns — for an in-memory sample and for one
 * streamed off disk alike — so `Playing(prior)` (RSound.pas:924) is true on the very
 * next tick, and `KSnd`/`KillSnd` (RSound.pas:946/954) are the only things that can
 * make it false again. There is no window between asking for a sound and the sound
 * existing.
 *
 * The port has one: a track with no packaged sample is fetched over the network and
 * decoded before anything is registered. KORALY is where a player sees it. The room
 * cues its octopus's tune at score-step 19 (`music('rybky08', 10)`, koraly.ts:373) and
 * two ticks later its own faithful rule reads the flag back:
 *
 *     if cinnost>20 and cinnost<80 and not playing(10) then cinnost:=80
 *     (koraly.ts:408 = URoom.pas:15576 — the animation is slaved to the music)
 *
 * `rybky08` is in no sound package, so it is a 740 KB fetch plus a decode against a
 * 160 ms deadline (LOGIC_MS=80). Lose the race and the octopus jumps to the end of its
 * animation while the music, landing afterwards, plays on over a puppet that stopped.
 * Intermittent in play only because the decoded buffer and the HTTP response are both
 * cached, so it is the FIRST performance of a session that breaks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioEngine, MUSIC_PRIOR } from '../src/audio/audio.js';
import { Script } from '../src/core/script.js';
import { KORALY } from '../src/rooms/koraly.js';
import { makeRoom, type ItemSpec } from './roomBuilder.js';

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  stopped: number;
  connect(): void;
  disconnect(): void;
  start(): void;
  stop(): void;
  addEventListener(type: string, fn: () => void): void;
}

const sources: FakeSource[] = [];

class FakeAudioContext {
  state = 'running';
  destination = { connect: () => {} };
  resume(): void {}
  createGain(): unknown {
    return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
  }
  createBufferSource(): FakeSource {
    const src: FakeSource = {
      buffer: null,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      stopped: 0,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop() {
        this.stopped++;
      },
      addEventListener: () => {},
    };
    sources.push(src);
    return src;
  }
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 34 } as unknown as AudioBuffer);
  }
}

/** The downloads in flight; the test decides when (and whether) each one lands. */
interface Gate {
  /** Deliver the nth request's bytes (default: the most recent). */
  settle: (n?: number) => Promise<void>;
  /** Fail the nth request (default: the most recent). */
  fail: (n?: number) => Promise<void>;
  readonly calls: number;
}

/** Let every queued microtask (the fetch chain, the decode, the install) run. */
const drain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let gate: Gate;
let prevCtx: unknown;
let prevFetch: unknown;

beforeEach(() => {
  sources.length = 0;
  const pending: Array<{ res: (v: unknown) => void; rej: (e: unknown) => void }> = [];
  const at = (n?: number): { res: (v: unknown) => void; rej: (e: unknown) => void } | undefined =>
    pending[n ?? pending.length - 1];
  gate = {
    get calls() {
      return pending.length;
    },
    async settle(n) {
      at(n)?.res({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)) });
      await drain();
    },
    async fail(n) {
      at(n)?.rej(new Error('offline'));
      await drain();
    },
  };
  prevCtx = (globalThis as { AudioContext?: unknown }).AudioContext;
  prevFetch = globalThis.fetch;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  (globalThis as { fetch?: unknown }).fetch = () =>
    new Promise((res, rej) => {
      pending.push({ res, rej });
    });
});

afterEach(() => {
  (globalThis as { AudioContext?: unknown }).AudioContext = prevCtx;
  (globalThis as { fetch?: unknown }).fetch = prevFetch;
});

function newEngine(): AudioEngine {
  const engine = new AudioEngine();
  engine.logToConsole = false;
  return engine;
}

/** Seed the decode cache so snd()/play() resolve a name without a real FFS package. */
function seed(engine: AudioEngine, name: string, duration: number): void {
  (engine as unknown as { cache: Map<string, AudioBuffer> }).cache.set(name, {
    duration,
  } as unknown as AudioBuffer);
}

const MUSIC_URL = (name: string): string => `/data/Music/${name}.wav`;

describe('a requested track is playing() from the tick that asked for it', () => {
  it('reserves the priority before the fetch resolves (Sound, RSound.pas:674)', () => {
    const engine = newEngine();
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08'));
    // The bug: false here, because activeUntil[10] was only written after the decode.
    expect(engine.playing(10)).toBe(true);
    expect(sources).toHaveLength(0); // nothing is sounding YET — but the channel is claimed
  });

  it('is still playing() once the track actually starts', async () => {
    const engine = newEngine();
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08'));
    await gate.settle();
    expect(sources).toHaveLength(1);
    expect(engine.playing(10)).toBe(true);
  });

  it('hands the reservation back when the track cannot be loaded', async () => {
    const engine = newEngine();
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08'));
    await gate.fail();
    // `Sound()` claims no channel for a file it cannot open, so playing() must not be
    // left stuck true for a track that will never sound.
    expect(engine.playing(10)).toBe(false);
    expect(sources).toHaveLength(0);
  });

  it('does the same on the room-music channel (MusicCycle, -999)', () => {
    const engine = newEngine();
    void engine.playMusic('rybky05', MUSIC_URL('rybky05'), 1000);
    // KANKAN re-cues on `!playing(MUSIC_PRIOR)` (kankan.ts:216) — it must not see a gap.
    expect(engine.playing(MUSIC_PRIOR)).toBe(true);
  });

  it('releases the room-music channel when the track cannot be loaded', async () => {
    const engine = newEngine();
    void engine.playMusic('rybky05', MUSIC_URL('rybky05'), 1000);
    await gate.fail();
    expect(engine.playing(MUSIC_PRIOR)).toBe(false);
    expect(engine.currentMusic).toBe('');
  });
});

describe('a track killed while it is loading never arrives', () => {
  it('KSnd(prior) cancels an in-flight start (RSound.pas:946)', async () => {
    const engine = newEngine();
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08'));
    engine.killVoice(10);
    expect(engine.playing(10)).toBe(false);

    await gate.settle(); // the download lands after the kill

    expect(sources).toHaveLength(0);
    expect(engine.playing(10)).toBe(false);
  });

  it('KillSnd cancels it too — the sound must not follow the player out of the room', async () => {
    const engine = newEngine();
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08'));
    engine.killAll(); // showMap(): KillSnd + stop the music

    await gate.settle();

    expect(sources).toHaveLength(0);
    expect(engine.playing(10)).toBe(false);
  });

  it('a fresh request after the kill is honoured (the cancel is not sticky)', async () => {
    const engine = newEngine();
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08'));
    engine.killVoice(10);
    await gate.settle();

    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08'));
    await gate.settle();

    expect(sources).toHaveLength(1);
    expect(engine.playing(10)).toBe(true);
  });
});

describe('a reservation owns only itself', () => {
  it('does not extend a sound already playing on the same priority', async () => {
    const engine = newEngine();
    seed(engine, 'sm-x-tiktak', 0.001); // a 1ms effect, so its end is observable
    engine.snd('sm-x-tiktak', 10);
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08')); // a second claim on prior 10
    await gate.fail();

    await new Promise((r) => setTimeout(r, 20)); // the effect's 1ms is long past

    // The reservation must never have been written into the effect's own end time —
    // that would have left the priority sounding forever with nothing to end it.
    expect(engine.playing(10)).toBe(false);
  });

  it('one failed request does not cancel another still loading on the same priority', async () => {
    const engine = newEngine();
    engine.musicSnd('rybky08', 10, MUSIC_URL('rybky08')); // request #0
    engine.musicSnd('rybky04', 10, MUSIC_URL('rybky04')); // request #1
    expect(gate.calls).toBe(2);

    await gate.fail(0);

    expect(engine.playing(10)).toBe(true); // #1 is still on its way

    await gate.settle(1);

    expect(sources).toHaveLength(1);
    expect(engine.playing(10)).toBe(true);
  });
});

// ── KORALY: the room that shows it ────────────────────────────────────────────

const R = { krab1: 1, balalajka: 2, velkar: 18, sepie: 21 } as const;
const BAL_CINNOST = 1;

/** A KORALY-shaped room whose `playing`/`music` hooks are the REAL audio engine. */
function koralyOnEngine(engine: AudioEngine): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 21; i++) {
    if (i === R.velkar) items.push({ kind: 'big', x: 34, y: 2 });
    else if (i === 17) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.balalajka) items.push({ kind: 'static', x: 15, y: 20 });
    else items.push({ kind: 'static', x: (i % 12) * 2 + 1, y: 25 });
  }
  const s = new Script(
    makeRoom({ w: 40, h: 30, items }),
    () => 0,
    (prior) => engine.playing(prior),
    {
      ksnd: (prior) => engine.killVoice(prior),
      // main.ts's wiring for `s.music` (buildRoom).
      music: (name, prior) => engine.musicSnd(name, prior, MUSIC_URL(name)),
    },
  );
  KORALY.init(s);
  s.room.alive.little = false; // close the room dialogue gate
  return s;
}

describe('KORALY octopus (koraly.ts:408 = URoom.pas:15576)', () => {
  it('keeps animating while its tune is still downloading', () => {
    const engine = newEngine();
    const s = koralyOnEngine(engine);
    s.vars(R.balalajka)[BAL_CINNOST] = 19;

    KORALY.prog(s); // cinnost 19: music('rybky08', 10) is requested
    KORALY.prog(s); // 20
    KORALY.prog(s); // 21 — the first tick the "no music -> jump to the end" rule applies

    expect(gate.calls).toBe(1); // it really did take the Music/ file path
    // The bug: cinnost === 80, the octopus frozen at the end of its animation while
    // `rybky08` was still in flight.
    expect(s.vars(R.balalajka)[BAL_CINNOST]).toBeLessThan(80);
  });

  it('still ends the animation when the tune genuinely is not sounding', async () => {
    const engine = newEngine();
    const s = koralyOnEngine(engine);
    s.vars(R.balalajka)[BAL_CINNOST] = 19;

    KORALY.prog(s);
    await gate.fail(); // the track cannot be loaded: nothing will ever play on prior 10
    KORALY.prog(s);
    KORALY.prog(s);

    // The rule is faithful and must keep working — the fix reserves the channel, it
    // does not pin playing(10) true.
    expect(s.vars(R.balalajka)[BAL_CINNOST]).toBe(80);
  });
});
