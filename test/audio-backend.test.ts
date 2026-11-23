/**
 * The sound policy against a backend that is not Web Audio.
 *
 * `AudioEngine` decides what the game is told — `playing()`, `talking()`, a line's length —
 * and an `AudioBackend` only plays. These tests pin which side of that line each timing
 * lives on, with a fake backend whose clock is a number this file moves, so that the
 * native host's mixer can implement the interface without changing what the game sees:
 *
 *   - a voice sounds for its buffer's `duration` on the BACKEND's clock, and talks until
 *     10000 samples before that (RSound.pas:933) — not on `performance.now()`;
 *   - the backend's end-of-sample is bookkeeping, never the end of `playing()`;
 *   - a dialogue line's length is the package's `delka`, whatever the buffer says;
 *   - KSnd, a fish's death, an undo's carried sounds and a lost output all reach the
 *     backend as stops of exactly the right voices.
 *
 * Everything goes through the engine's public surface and real 1998 packages; the only
 * stand-in is the backend.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { AudioEngine, MUSIC_PRIOR, TALKING_MEZ_SEC } from '../src/audio/audio.js';
import type { AudioBackend, AudioBackendEvents, SoundBuffer, Voice, VoiceOptions } from '../src/audio/audioBackend.js';
import { FFS_SAMPLE_RATE } from '../src/audio/ffs.js';
import { musicByName, musicSeconds } from '../src/audio/music.js';
import { parseFft } from '../src/data/fft.js';
import { Script, MLUVI_MALA, MLUVI_VELKA } from '../src/core/script.js';
import { makeRoom } from './roomBuilder.js';

interface Started {
  buf: SoundBuffer;
  opts: VoiceOptions;
  onEnded?: () => void;
  stopped: number;
  detached: boolean;
}

class FakeBackend implements AudioBackend {
  /** The clock, in ms. Only this file moves it. */
  t = 1000;
  paused = false;
  /** Extra samples a decode hands back — a codec's padding, if a backend did not trim. */
  padSamples = 0;
  readonly voices = new Map<Voice, Started>();
  constructor(readonly events: AudioBackendEvents) {}
  wake(): void {}
  now(): number {
    return this.t;
  }
  fromPcm16(pcm: Int16Array, rate: number): SoundBuffer {
    return { duration: (pcm.length + this.padSamples) / rate };
  }
  decode(): Promise<SoundBuffer> {
    return Promise.resolve({ duration: 60 });
  }
  decodeSegment(_bytes: ArrayBuffer, samples: number): Promise<SoundBuffer> {
    return Promise.resolve({ duration: samples / FFS_SAMPLE_RATE });
  }
  start(buf: SoundBuffer, opts: VoiceOptions, onEnded?: () => void): Voice {
    const voice = {};
    this.voices.set(voice, { buf, opts, onEnded, stopped: 0, detached: false });
    return voice;
  }
  stop(voice: Voice): void {
    this.voices.get(voice)!.stopped++;
  }
  detach(voice: Voice): void {
    this.voices.get(voice)!.detached = true;
  }
  setBusGain(): void {}
  setPaused(on: boolean): void {
    this.paused = on;
  }
  onGesture(): void {}
  onVisible(): void {}
  /** Every start, oldest first. */
  get started(): Started[] {
    return [...this.voices.values()];
  }
}

const FFT = readFileSync('public/data/Title/025.fft');
const FFS = readFileSync('public/data/Sound/025.ffs');
/** Two real lines of the 025 package, and their lengths in samples. */
const [A, B] = parseFft(FFT).filter((e) => e.delka > 0);
const MEZ_MS = TALKING_MEZ_SEC * 1000;

let backend: FakeBackend;
let engine: AudioEngine;

beforeEach(async () => {
  engine = new AudioEngine((events) => (backend = new FakeBackend(events)));
  engine.logToConsole = false;
  await engine.setRoom('025', FFT, FFS);
});

describe('playing() and talking() run on the backend clock', () => {
  it('a voice sounds for its buffer, and talks until 10000 samples before its end', () => {
    const t0 = backend.t;
    engine.play(A!.name, 1, MLUVI_MALA, 'voice');
    const endMs = t0 + (A!.delka / FFS_SAMPLE_RATE) * 1000;

    backend.t = endMs - MEZ_MS - 1;
    expect(engine.talking(MLUVI_MALA)).toBe(true);
    backend.t = endMs - MEZ_MS + 1;
    expect(engine.talking(MLUVI_MALA)).toBe(false);
    expect(engine.playing(MLUVI_MALA)).toBe(true);
    backend.t = endMs - 1;
    expect(engine.playing(MLUVI_MALA)).toBe(true);
    backend.t = endMs;
    expect(engine.playing(MLUVI_MALA)).toBe(false);
  });

  it('is not ended by the backend saying the sample ended', () => {
    // A mixer may free a channel a block early, or report it late. Lip-sync and every
    // `!playing(p)` wait run off the clock, so neither can move them.
    engine.play(A!.name, 1, MLUVI_MALA, 'voice');
    backend.started[0]!.onEnded!();
    expect(engine.playing(MLUVI_MALA)).toBe(true);
    expect(engine.talking(MLUVI_MALA)).toBe(true);
  });

  it("carries a line across a modal pause, whether or not the backend's clock stops", () => {
    // The browser's clock is the wall clock and runs on under the help overlay; a mixer's
    // may stop with the output. Either way the line has its remaining length afterwards.
    for (const clockStops of [false, true]) {
      engine.play(A!.name, 1, MLUVI_MALA, 'voice');
      const lengthMs = (A!.delka / FFS_SAMPLE_RATE) * 1000;
      backend.t += lengthMs / 2;
      engine.setModalPause(true);
      expect(backend.paused).toBe(true);
      if (!clockStops) backend.t += 60_000;
      engine.setModalPause(false);
      expect(backend.paused).toBe(false);
      const resumedAt = backend.t;
      backend.t = resumedAt + lengthMs / 2 - 1;
      expect(engine.playing(MLUVI_MALA), `clock stops: ${clockStops}`).toBe(true);
      backend.t = resumedAt + lengthMs / 2 + 1;
      expect(engine.playing(MLUVI_MALA), `clock stops: ${clockStops}`).toBe(false);
    }
  });
});

describe("a line's length is the package's, not the backend's", () => {
  it('duration() is delka at 22050 Hz, even from a backend that pads its buffers', () => {
    // `duration()` is what the talk hook turns into `voiceEndCount`, so this is the
    // dialogue's pacing. A backend handing back a longer buffer may hold `playing()` past
    // the line (why the browser's trims, `trimToSamples`) — but it cannot pace the dialogue.
    backend.padSamples = 1023;
    expect(engine.duration(A!.name)).toBe(A!.delka / FFS_SAMPLE_RATE);
    const t0 = backend.t;
    engine.play(A!.name, 1, MLUVI_MALA, 'voice');
    backend.t = t0 + engine.duration(A!.name) * 1000;
    expect(engine.playing(MLUVI_MALA)).toBe(true);
  });
});

describe('what reaches the backend', () => {
  it('KSnd stops the voices of that priority, and the priority is silent at once', () => {
    engine.play(A!.name, 1, MLUVI_MALA, 'voice');
    engine.play(B!.name, 1, MLUVI_VELKA, 'voice');
    engine.killVoice(MLUVI_MALA);
    expect(backend.started.map((v) => v.stopped)).toEqual([1, 0]);
    expect(engine.playing(MLUVI_MALA)).toBe(false);
    expect(engine.talking(MLUVI_VELKA)).toBe(true);
  });

  it('a looping effect sounds and talks for ever, until it is killed', () => {
    engine.snd(A!.name, 7, true);
    expect(backend.started[0]!.opts.loop).toBe(true);
    backend.t += 3_600_000;
    expect(engine.playing(7)).toBe(true);
    expect(engine.talking(7)).toBe(true);
    engine.killVoice(7);
    expect(backend.started[0]!.stopped).toBe(1);
    expect(engine.playing(7)).toBe(false);
  });

  it("an undo's KillSnd leaves the carried sounds playing, with their own end", () => {
    const t0 = backend.t;
    engine.play(A!.name, 1, 300, 'voice'); // a room's carried performance
    engine.play(B!.name, 1, MLUVI_MALA, 'voice');
    engine.killVoices([300]);
    expect(backend.started.map((v) => v.stopped)).toEqual([0, 1]);
    backend.t = t0 + (A!.delka / FFS_SAMPLE_RATE) * 1000 - 1;
    expect(engine.playing(300)).toBe(true);
    engine.killVoice(300); // and it is still the engine's to stop
    expect(backend.started[0]!.stopped).toBe(1);
  });

  it("a fish's death stops its line at the backend, and the dialogue moves on", () => {
    const room = makeRoom({
      w: 16,
      h: 10,
      items: [
        { kind: 'little', x: 1, y: 2 },
        { kind: 'big', x: 7, y: 4 },
      ],
    });
    const talk = (name: string, prior: number): number => {
      engine.play(name, 1, prior, 'voice');
      return 60;
    };
    const s = new Script(
      room,
      talk,
      (p) => engine.playing(p),
      { ksnd: (p) => engine.killVoice(p) },
      (p) => engine.talking(p),
    );
    s.addv(0, A!.name);
    s.dialogy(1);
    expect(engine.talking(MLUVI_VELKA)).toBe(true);

    s.fishDied([MLUVI_VELKA]);
    expect(backend.started[0]!.stopped).toBe(1);
    expect(engine.talking(MLUVI_VELKA)).toBe(false);
    s.dialogy(2);
    expect(s.isDialog()).toBe(false); // not at count 61: the line ended with its voice
  });

  it('starts the room music with the loop points of the original, under the voices', async () => {
    const name = 'rybky05';
    const track = musicByName(name)!;
    await engine.decodeMusic(name, new Uint8Array(8));
    await engine.playMusic(name, 'unused.m4a', 1234);
    const [music] = backend.started;
    expect(music!.opts).toEqual({
      gain: 0.45,
      bus: 'music',
      loop: true,
      loopStart: musicSeconds(1234),
      loopEnd: Math.min(musicSeconds(track.frames), 60),
    });
    expect(engine.playing(MUSIC_PRIOR)).toBe(true);
    engine.stopMusic();
    expect(music).toMatchObject({ stopped: 1, detached: true });
  });

  it('a lost output stops everything and brings the room music back on the new one', async () => {
    await engine.decodeMusic('rybky05', new Uint8Array(8));
    await engine.playMusic('rybky05', 'unused.m4a', 0);
    engine.play(A!.name, 1, MLUVI_MALA, 'voice');

    const restore = backend.events.outputLost();
    expect(backend.started.map((v) => v.stopped)).toEqual([1, 1]);
    expect(engine.playing(MLUVI_MALA)).toBe(false);
    restore();

    expect(backend.started).toHaveLength(3);
    expect(engine.currentMusic).toBe('rybky05');
  });
});
