/**
 * What the sound policy (`audio.ts`) needs from whatever actually makes the noise.
 *
 * `AudioEngine` decides WHAT plays and what the game is told about it: which package a
 * name resolves in, priorities and `KSnd`, `playing()` / `talking()`, the music channel
 * and its loop points, the per-sound and per-category levels. This is the rest — opening
 * an output, turning bytes into something playable, and starting and stopping it — and it
 * is deliberately no wider than the policy's actual calls. Two things implement it: the
 * browser's Web Audio (`webAudioBackend.ts`) and, later, the native host's SDL audio
 * stream with a small C mixer behind it.
 *
 * ── What the game's timing does NOT depend on ─────────────────────────────────
 * The length of a dialogue line is not asked of a backend at all. `duration(name)` is the
 * FFT record's `delka` over 22050 Hz, and the talk hook turns that into the ticks
 * `Script.dialogy` holds the line for (`voiceEndCount`). A backend can therefore not
 * lengthen or shorten a line, and must not be asked to.
 *
 * What a backend DOES feed is `playing(prior)` / `talking(prior)`: a started voice is
 * counted as sounding until `now() + buffer.duration`, read off this interface's clock.
 * The backend's own end-of-sample (`onEnded`) is bookkeeping only — it never decides
 * whether a priority is still playing. So a mixer that drops a voice a few samples early
 * changes nothing the game can see, and one whose `duration` is wrong changes lip-sync
 * and every script that waits on `!playing(p)`.
 *
 * ── Web Audio semantics an implementation has to match ────────────────────────
 *   - Starts are immediate. Nothing is scheduled ahead on the output's clock, so a mixer
 *     needs no start-time queue: `start` claims a channel that plays from the next block.
 *   - Gains are plain multipliers set at start (per voice) or on a bus at any time, with
 *     no ramps. Web Audio applies a `gain.value` write from the next render quantum
 *     (128 frames); a mixer applying it from the next block is the same thing.
 *   - `onEnded` is asynchronous, and also fires after `stop`. The policy tolerates it
 *     arriving late, after the priority has been killed and even re-used, so a mixer can
 *     post it from the audio thread and deliver it on the main thread's next poll — but it
 *     must never call it synchronously from inside `start` or `stop`.
 *   - A looping voice plays from the start to `loopEnd`, then repeats `[loopStart,
 *     loopEnd)` for ever. Both are seconds of the buffer; `loopEnd` 0 (or absent) means the
 *     end of the buffer.
 *   - `duration` is the buffer's length in seconds at the rate it was decoded for: exactly
 *     `samples / 22050` for an `.ffs` sound and for a staged segment (`decodeSegment`
 *     trims to that), whatever rate the output itself runs at.
 *   - `now()` is the clock `playing()` is measured on. The browser's is the wall clock
 *     (`performance.now()`), which keeps running while the output is paused; the policy
 *     corrects for that across a modal pause. A mixer clock that stops while paused is
 *     equally correct — the correction then measures a pause of zero.
 */
import type { VolumeBus } from '../core/settings.js';

/** A decoded sound, ready to start. Opaque except for its length. */
export interface SoundBuffer {
  /** Seconds — see the note on `duration` above. */
  readonly duration: number;
}

/** A started sound, as handed back by `start` — opaque to the policy. */
export type Voice = object;

export interface VoiceOptions {
  /** Per-sound gain, 0..1, applied before the category bus. */
  gain: number;
  /** The category bus the sound is mixed into (its level is `setBusGain`'s). */
  bus: VolumeBus;
  loop?: boolean;
  /** Seconds into the buffer that a loop returns to. */
  loopStart?: number;
  /** Seconds into the buffer at which a loop returns; 0 is the buffer's end. */
  loopEnd?: number;
}

/** What a backend tells the policy that only the backend can know. */
export interface AudioBackendEvents {
  /**
   * The output has been lost and is about to be replaced, so everything sounding is gone
   * (the browser's case is iOS taking the audio away, see `webAudioBackend.ts`). The policy
   * forgets what was playing and returns what to do once the replacement is open — in
   * practice, start the room music again.
   */
  outputLost(): () => void;
  /** A line for the audio diagnostics log, on the policy's logging switch. */
  log(msg: string): void;
}

export interface AudioBackend {
  /**
   * Open the output if it is not open, and ask it to run unless it is deliberately
   * paused. Called exactly where a sound is about to be needed; a refusal to run (a
   * browser outside a user gesture) is not an error.
   */
  wake(): void;
  /** The clock `playing()` / `talking()` are measured on, in milliseconds. */
  now(): number;

  /** A buffer from 16-bit mono PCM at `rate` (the 1998 `.ffs` path). */
  fromPcm16(pcm: Int16Array, rate: number): SoundBuffer;
  /** Decode an encoded file (a music track: AAC in MP4). Detaches `bytes`. */
  decode(bytes: ArrayBuffer): Promise<SoundBuffer>;
  /**
   * Decode one staged `.ffs2` segment (AAC in MP4) to exactly the audio of `samples`
   * samples at 22050 Hz, dropping the codec's padding. Detaches `bytes`.
   */
  decodeSegment(bytes: ArrayBuffer, samples: number): Promise<SoundBuffer>;

  /** Start a buffer now. `onEnded` follows the rules above. */
  start(buf: SoundBuffer, opts: VoiceOptions, onEnded?: () => void): Voice;
  /** Stop a voice. Stopping one that has already ended is not an error. */
  stop(voice: Voice): void;
  /** Take a stopped voice out of the mix for good (the music channel's stop does this). */
  detach(voice: Voice): void;
  /** A category bus's level, from the Options sliders (1.0 = the category's default). */
  setBusGain(bus: VolumeBus, gain: number): void;

  /** Whether the output is deliberately paused (`setPaused`). */
  readonly paused: boolean;
  /** Pause or resume everything at once, each sound keeping its place. */
  setPaused(on: boolean): void;
  /** A user gesture arrived — the one moment a browser lets an output start. */
  onGesture(): void;
  /** The app came back on screen. */
  onVisible(): void;
}

/** The mix's overall level, under the three category buses. */
export const MASTER_GAIN = 0.8;
