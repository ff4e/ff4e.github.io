/**
 * The native host's `AudioBackend` (src/audio/audioBackend.ts): the C mixer in
 * native/host/audio.c behind an SDL audio stream, and Apple's AAC decoder
 * (native/host/audio_decode_apple.c). The policy above it — `AudioEngine`, src/audio/audio.ts
 * — is the browser's, unchanged; `seams/audioEngine.ts` hands it this backend.
 *
 * What it has to match, and how (audioBackend.ts states the contract):
 *   - `duration` is `frames / 22050` exactly, because the mixer runs at 22050 Hz and keeps
 *     every buffer at that rate: an `.ffs` sound is its samples, a speech segment is trimmed
 *     to exactly `delka` (`decodeSegment`), and nothing is resampled before the device.
 *   - `now()` is the mixer's clock: frames mixed, in milliseconds. A voice started at `now()`
 *     plays its last sample as the clock reaches `now() + duration`, which is exactly what
 *     `playing()` / `talking()` measure against.
 *   - `onEnded` is queued by the mixer and delivered by `poll()`, never inside `start`/`stop`.
 *
 * Headless, the mixer has no output and its clock is driven by `advance(ms)`: the game
 * calls it once per 80 ms step, so a smoke run hears the same timeline a player does.
 */
import { MASTER_GAIN, type AudioBackend, type AudioBackendEvents, type SoundBuffer, type Voice, type VoiceOptions } from '../../src/audio/audioBackend.js';
import { FFS_SAMPLE_RATE } from '../../src/audio/ffs.js';
import { nativeAudioTiming } from '../../src/platform/nativeAudioTiming.js';
import type { VolumeBus } from '../../src/core/settings.js';

/** The mixer's rate — `AUDIO_RATE` in native/host/audio.h — and every shipped sound's. */
export const MIX_RATE = FFS_SAMPLE_RATE;

const BUS: Record<VolumeBus, number> = { effect: 0, voice: 1, music: 2 };

/** A buffer in the mixer, by id. Its PCM is freed when this object is collected. */
export class MixBuffer implements SoundBuffer {
  constructor(readonly id: number, readonly frames: number) {}
  get duration(): number {
    return this.frames / MIX_RATE;
  }
}

interface MixVoice {
  readonly id: number;
}

const released = new FinalizationRegistry<number>((id) => __native.audioRelease(id));
function adopt(id: number, frames: number): MixBuffer {
  const b = new MixBuffer(id, frames);
  released.register(b, id);
  return b;
}

export class SdlAudioBackend implements AudioBackend {
  /** What drives the mixer: an output (`device`, or SDL's silent `dummy`), or `advance` (`manual`). */
  readonly mode: string;
  private readonly ended = new Map<number, () => void>();
  private owed = 0;
  private pausedNow = false;

  /**
   * Opened at once: nothing native needs a user gesture before it may make a sound. The
   * events are unused: a native output is not taken away the way iOS takes a page's, and
   * the policy cannot be logged to from here before it has finished constructing this.
   */
  constructor(_events: AudioBackendEvents) {
    this.mode = __native.audioOpen(MASTER_GAIN);
  }

  wake(): void {}

  now(): number {
    return (__native.audioClock() * 1000) / MIX_RATE;
  }

  fromPcm16(pcm: Int16Array, rate: number): SoundBuffer {
    if (rate !== MIX_RATE) throw new Error(`the mixer runs at ${MIX_RATE} Hz, not ${rate}`);
    const bytes = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    return adopt(__native.audioFromPcm16(bytes), pcm.length);
  }

  decode(bytes: ArrayBuffer): Promise<SoundBuffer> {
    return this.decoded(bytes, 0);
  }

  /** `samples` is in 22050 Hz samples, which is what the mixer counts in: the trim is exact. */
  decodeSegment(bytes: ArrayBuffer, samples: number): Promise<SoundBuffer> {
    return this.decoded(bytes, samples);
  }

  /**
   * The MP4 goes to the decoder with its edit restated in the media timescale
   * (`nativeAudioTiming`): Core Audio would otherwise cut up to a millisecond off the end of
   * every file — off a line of speech, or off a music track's loop, which `playMusic` ends
   * at the original's own sample count.
   */
  private decoded(bytes: ArrayBuffer, max: number): Promise<SoundBuffer> {
    try {
      const [id, frames] = __native.audioDecode(nativeAudioTiming(bytes), max);
      return Promise.resolve(adopt(id, frames));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  start(buf: SoundBuffer, opts: VoiceOptions, onEnded?: () => void): Voice {
    const b = buf as MixBuffer;
    const frames = (s: number | undefined): number => Math.round((s ?? 0) * MIX_RATE);
    const id = __native.audioStart(b.id, opts.gain, BUS[opts.bus], opts.loop === true, frames(opts.loopStart), frames(opts.loopEnd));
    if (onEnded) this.ended.set(id, onEnded);
    const voice: MixVoice = { id };
    return voice;
  }

  stop(voice: Voice): void {
    __native.audioStop((voice as MixVoice).id);
  }

  /** The mixer forgets a stopped voice at once; there is no graph to disconnect. */
  detach(voice: Voice): void {
    __native.audioStop((voice as MixVoice).id);
  }

  /**
   * The UI's focus cue (`focusSound.ts`): not a voice of the policy's — no id, no end, no
   * clock — on the effects bus, restarting one still sounding, heard while paused (audio.c).
   */
  cue(buf: SoundBuffer, gain: number): void {
    __native.audioCue((buf as MixBuffer).id, gain);
  }

  setBusGain(bus: VolumeBus, gain: number): void {
    __native.audioBusGain(BUS[bus], gain);
  }

  get paused(): boolean {
    return this.pausedNow;
  }

  setPaused(on: boolean): void {
    this.pausedNow = on;
    __native.audioPause(on);
  }

  onGesture(): void {}
  onVisible(): void {}

  /** Deliver the `onEnded` of every voice the mixer has finished or stopped since the last poll. */
  poll(): void {
    for (const id of __native.audioEnded()) {
      const fn = this.ended.get(id);
      this.ended.delete(id);
      fn?.();
    }
  }

  /**
   * Move the headless mixer's clock on by `ms` of game time, mixing as it goes, and deliver
   * what ended. With `capture`, the mixed samples come back (float32, at 22050 Hz).
   */
  advance(ms: number, capture = false): Float32Array | null {
    this.owed += (ms * MIX_RATE) / 1000;
    const frames = Math.floor(this.owed);
    this.owed -= frames;
    const out = __native.audioAdvance(frames, capture);
    this.poll();
    return out ? new Float32Array(out) : null;
  }
}
