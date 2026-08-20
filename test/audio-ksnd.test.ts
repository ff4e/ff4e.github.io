/**
 * KSnd(prior) must actually stop the *sound*, voices included.
 *
 * The original's KSnd (RSound.pas:946-951) walks every mixer channel and kills each
 * one whose priority matches — it does not care whether the channel was started by
 * Snd (an effect) or Talk (a voice), because there is only one mixer:
 *
 *     for i:=1 to maxmix do with Sounds[i] do
 *      if (flen>0)and(priority=prior) then begin flen:=0; ... end;
 *
 * The port used to have two playback paths and only `snd()` registered its source per
 * priority, so `killVoice()` on a voice cleared the bookkeeping (`talking()`/`playing()`
 * went false and the game logic proceeded as if silenced) while the sample kept playing
 * to the end. MIKRO showed it: the crabs' `mik-x-stebet*` chatter (4.3-11.0s) ran on
 * after the big fish shouted "Ticho!" and the room ran `KSnd(101..104)`.
 *
 * These tests assert the *source was stopped*, not merely that `talking()` went false —
 * the latter already passed with the bug in place.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioEngine, MUSIC_PRIOR } from '../src/audio/audio.js';
import { musicUrl } from '../src/audio/music.js';

interface FakeSource {
  buffer: unknown;
  loop: boolean;
  started: boolean;
  stopped: number;
  connect(): void;
  disconnect(): void;
  start(): void;
  stop(): void;
  addEventListener(type: string, fn: () => void): void;
  /** Fire the 'ended' listeners, as the browser does when a source finishes/stops. */
  end(): void;
}

const sources: FakeSource[] = [];

function makeSource(): FakeSource {
  const ended: Array<() => void> = [];
  const src: FakeSource = {
    buffer: null,
    loop: false,
    started: false,
    stopped: 0,
    connect: () => {},
    disconnect: () => {},
    start() {
      this.started = true;
    },
    stop() {
      this.stopped++;
    },
    addEventListener(type, fn) {
      if (type === 'ended') ended.push(fn);
    },
    end() {
      for (const fn of ended) fn();
    },
  };
  sources.push(src);
  return src;
}

class FakeAudioContext {
  state = 'running';
  destination = { connect: () => {} };
  resume(): void {}
  createGain(): unknown {
    return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
  }
  createBufferSource(): FakeSource {
    return makeSource();
  }
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 60 } as unknown as AudioBuffer);
  }
}

/** A stand-in AudioBuffer; only `duration` is read by the engine. */
const FAKE_BUF = { duration: 11.05 } as unknown as AudioBuffer;

/** Seed the decode cache so play()/snd() resolve a name without a real FFS package. */
function seed(engine: AudioEngine, ...names: string[]): void {
  const cache = (engine as unknown as { cache: Map<string, AudioBuffer> }).cache;
  for (const n of names) cache.set(n, FAKE_BUF);
}

function priorSources(engine: AudioEngine): Map<number, Set<unknown>> {
  return (engine as unknown as { priorSources: Map<number, Set<unknown>> }).priorSources;
}

let prevCtx: unknown;
let prevFetch: unknown;

beforeEach(() => {
  sources.length = 0;
  prevCtx = (globalThis as { AudioContext?: unknown }).AudioContext;
  prevFetch = globalThis.fetch;
  (globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  // playMusic fetches the Music/ track and hands the bytes to decodeAudioData; the
  // sample rate is no longer read out of a header (it is MUSIC_RATE — see music.ts), so
  // any buffer will do. A real Response, because the fetch goes through `requiredAsset`,
  // which reads the status before the body.
  (globalThis as { fetch?: unknown }).fetch = () =>
    Promise.resolve(new Response(new ArrayBuffer(64), { status: 200 }));
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

describe('KSnd(prior) on a voice (RSound.pas:946)', () => {
  it('stops the actual source of a talkNow-started voice, not just the bookkeeping', () => {
    const engine = newEngine();
    seed(engine, 'mik-x-stebet2');
    // scriptTalk's call shape: audio.play(name, 1, prior, 'voice').
    engine.play('mik-x-stebet2', 1, 104, 'voice');
    expect(sources).toHaveLength(1);
    expect(engine.talking(104)).toBe(true);

    engine.killVoice(104); // s.ksnd(104) — MIKRO's "Ticho!"

    expect(sources[0]!.stopped).toBe(1); // the bug: this was 0
    expect(engine.talking(104)).toBe(false);
    expect(engine.playing(104)).toBe(false);
  });

  it('stops every source sharing the priority (fish voices all use prior 1 / 2)', () => {
    const engine = newEngine();
    seed(engine, 'sl-m-jedna', 'sl-m-dva');
    engine.play('sl-m-jedna', 1, 1, 'voice');
    engine.play('sl-m-dva', 1, 1, 'voice');

    engine.killVoice(1); // sloupy.ts:252 — cut the little fish off

    expect(sources.map((s) => s.stopped)).toEqual([1, 1]);
  });

  it('leaves other priorities sounding (only the matching channels die)', () => {
    const engine = newEngine();
    seed(engine, 'mik-x-stebet0', 'mik-x-stebet1');
    engine.play('mik-x-stebet0', 1, 101, 'voice');
    engine.play('mik-x-stebet1', 1, 102, 'voice');

    engine.killVoice(101);

    expect(sources[0]!.stopped).toBe(1);
    expect(sources[1]!.stopped).toBe(0);
    expect(engine.talking(102)).toBe(true);
  });

  it('keeps mixing voices and effects on one priority, as the original mixer does', () => {
    const engine = newEngine();
    seed(engine, 'voice', 'effect');
    engine.play('voice', 1, 7, 'voice');
    engine.snd('effect', 7);

    engine.killVoice(7);

    expect(sources.map((s) => s.stopped)).toEqual([1, 1]);
  });
});

describe('bookkeeping stays clean', () => {
  it('drops a finished voice from the per-priority map (no leak)', () => {
    const engine = newEngine();
    seed(engine, 'mik-x-stebet3');
    engine.play('mik-x-stebet3', 1, 103, 'voice');
    expect(priorSources(engine).get(103)?.size).toBe(1);

    sources[0]!.end(); // sample finished on its own

    expect(priorSources(engine).get(103)?.size).toBe(0);
  });

  it('still stops play()-started voices via killVoices() (KillSnd / room exit)', () => {
    const engine = newEngine();
    seed(engine, 'a', 'b');
    engine.play('a', 1, 2, 'voice');
    engine.play('b'); // untracked one-shot (no priority)

    engine.killVoices();

    expect(sources.map((s) => s.stopped)).toEqual([1, 1]);
    expect(priorSources(engine).size).toBe(0);
    expect(engine.playing(2)).toBe(false);
  });

  it('does not track a priority-less one-shot (KSnd cannot target it)', () => {
    const engine = newEngine();
    seed(engine, 'sp-bublina');
    engine.play('sp-bublina');
    expect(priorSources(engine).size).toBe(0);
  });

  it('KSnd(-999) stops the room music and any source tracked on that priority', () => {
    const engine = newEngine();
    seed(engine, 'x');
    engine.play('x', 1, MUSIC_PRIOR, 'music');
    engine.killVoice(MUSIC_PRIOR);
    expect(sources[0]!.stopped).toBe(1);
    expect(engine.playing(MUSIC_PRIOR)).toBe(false);
  });

  // KANKAN (kankan.ts:204) shushes the band with ksnd(-999) and re-cues the track
  // afterwards, so the looping MusicCycle source itself must stop — it lives outside
  // priorSources, so only the stopMusic() branch of killVoice can reach it.
  it('KSnd(-999) stops the looping MusicCycle source (KANKAN)', async () => {
    const engine = newEngine();
    await engine.playMusic('rybky05', musicUrl('rybky05'), 1000);
    expect(engine.currentMusic).toBe('rybky05');
    expect(engine.playing(MUSIC_PRIOR)).toBe(true);
    const music = sources[0]!;
    expect(music.loop).toBe(true);

    engine.killVoice(MUSIC_PRIOR);

    expect(music.stopped).toBe(1);
    expect(engine.currentMusic).toBe('');
    expect(engine.playing(MUSIC_PRIOR)).toBe(false);
  });
});
