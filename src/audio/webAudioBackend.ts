/**
 * The browser's `AudioBackend`: Web Audio, and everything it takes to keep it audible.
 *
 * Most of this file is not playback — that part is a buffer source into a gain into a
 * category bus. It is surviving iOS: an `AudioContext` that the system takes away when the
 * app is backgrounded, then reports as running for ever after while it plays nothing (see
 * `onStateChange`). The repair has to replace the context, which loses everything that was
 * sounding, so it asks the policy (`AudioBackendEvents.outputLost`) to forget what was
 * playing and to start the room music again on the new one.
 *
 * Browsers gate audio behind a user gesture; the context is created lazily and
 * resumed on the first play triggered by input.
 */
import { FFS_SAMPLE_RATE } from './ffs.js';
import { MASTER_GAIN, type AudioBackend, type AudioBackendEvents, type SoundBuffer, type Voice, type VoiceOptions } from './audioBackend.js';
import type { VolumeBus } from '../core/settings.js';
import { decodeAudioData } from '../platform/audioDecode.js';

/** How long to let iOS finish restoring the audio session before opening a new context
 *  over the interrupted one (see `scheduleRebuild`). Long enough that the device is ready,
 *  short enough that the gap is heard as the app animating back rather than as a fault. */
const REBUILD_DELAY_MS = 400;
/** How long to give a rebuilt context to prove its clock is moving (`verifyAudible`).
 *  A working context advances within a frame or two; this is generous on purpose. */
const VERIFY_DELAY_MS = 500;
/** Rebuild attempts per interruption. A device that has not come back by the third try is
 *  not coming back, and retrying for ever would be a leak dressed up as a repair. */
const REBUILD_ATTEMPTS = 3;

/** Whether the page is on screen, for the audio log. The suspicion these lines exist to
 *  settle is that iOS announces the end of an interruption before the app is actually
 *  back, so a repair can spend its whole budget while nothing can play yet — which is
 *  only readable if each attempt says where it stood. `document` is not a given: the
 *  engine is also exercised under the test runner's node environment. */
function pageVisibility(): string {
  const d = (globalThis as { document?: Document }).document;
  return d ? (d.hidden ? 'hidden' : 'visible') : 'n/a';
}

/**
 * A copy of `buf` holding exactly the audio of `samples` samples at `FFS_SAMPLE_RATE`.
 *
 * AAC codes in 1024-sample frames, so a decode runs up to 1023 samples long and that tail
 * is encoder padding, not speech (`tools/stage-voices.ts --verify` measures it).
 * `startTracked` writes `activeUntil` from `buf.duration`, so an untrimmed buffer would
 * hold `playing(prior)` true for up to two extra logic ticks on EVERY line. `delka` is the
 * length the 1998 data agrees on and what `duration()` already reports, so the buffer is
 * cut to exactly that. The music path made the same call for the same reason (`playMusic`
 * takes `loopEnd` from the table's `frames`, not from `buf.duration`).
 *
 * Measured, this is a no-op in Chromium: it honours the MP4 edit list and hands back
 * EXACTLY `delka` samples at lag 0 (`tools/test-voices.mjs` asserts both, in the browser,
 * against an independent port of `Decompres`). ffmpeg's decoder pads. So this is here for
 * the decoders that are not Chromium rather than for the one that is — which is the whole
 * reason the probe measures it rather than trusting it.
 *
 * The count is in the 1998 data's rate, the buffer is at the context's, hence the ratio.
 * The `Math.min` is not decoration: exactly one of the 1 797 shipped sounds decodes SHORT
 * through ffmpeg (`011/deu-m-bojovat`, by 10 samples of -51 dBFS silence, which `--verify`
 * gate 3 allows on purpose). Without the clamp that would be a read past the end; with it,
 * the buffer is simply as long as the decode really was.
 */
export function trimToSamples(ctx: BaseAudioContext, buf: AudioBuffer, samples: number): AudioBuffer {
  const want = Math.min(buf.length, Math.round((samples * ctx.sampleRate) / FFS_SAMPLE_RATE));
  if (want === buf.length) return buf;
  const out = ctx.createBuffer(1, Math.max(1, want), ctx.sampleRate);
  out.copyToChannel(buf.getChannelData(0).subarray(0, want), 0);
  return out;
}

/** A started source and the gain node it plays through. */
interface WebVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export class WebAudioBackend implements AudioBackend {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Per-category output buses (effects / voices / music), each a GainNode the
   *  Options sliders adjust (NastavZvuk, Uovl.pas:280). Every sound routes through
   *  the bus matching its category, so a slider scales just that category live. */
  private buses: Record<VolumeBus, GainNode | null> = { effect: null, voice: null, music: null };
  /** The slider-driven gain multiplier per bus (1.0 = the category's default level). */
  private busGain: Record<VolumeBus, number> = { effect: 1, voice: 1, music: 1 };
  /** True while a modal overlay has deliberately suspended the context (setModalPause). */
  private modalPaused = false;
  /** Set when this context has been interrupted and is therefore no longer to be trusted,
   *  whatever it says about itself afterwards. See `onStateChange`. */
  private interrupted = false;
  /** Guards against queueing two rebuilds for one interruption. */
  private rebuildQueued = false;

  constructor(private readonly events: AudioBackendEvents) {}

  now(): number {
    return performance.now();
  }

  wake(): void {
    this.ensureCtx();
  }

  /** The open context, for a call the policy has already `wake()`d for. */
  private get live(): AudioContext {
    return this.ctx ?? this.ensureCtx();
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      // The one warning iOS gives that the audio has been taken away. See onStateChange.
      // The context is passed in because a rebuild leaves the old one's listener alive
      // until it is collected, and by then `this.ctx` names its replacement.
      const ctx = this.ctx;
      ctx.addEventListener('statechange', () => this.onStateChange(ctx));
      // The three category buses sit between the per-sound gains and the master,
      // so a slider change scales a whole category at once (NastavZvuk).
      for (const bus of ['effect', 'voice', 'music'] as const) {
        const g = this.ctx.createGain();
        g.gain.value = this.busGain[bus];
        g.connect(this.master);
        this.buses[bus] = g;
      }
    }
    // Browsers start the context suspended until a gesture unlocks it, so any call
    // that is about to make a sound nudges it awake. `modalPaused` is the one state
    // where a suspended context is DELIBERATE (see setModalPause): without this guard
    // the next play()/busNode() from anywhere would silently un-pause the whole game.
    //
    // Only `'suspended'`. iOS has a third state — backgrounding moves the context to
    // `'interrupted'`, a WebKit extension absent from `AudioContextState` — and resuming
    // one of those rejects with "Failed to start the audio device". That state belongs to
    // the rebuild path (onStateChange), which replaces the context instead of arguing with
    // it; nudging it from here would only add an unhandled rejection to the ~400 ms before
    // the replacement lands. `'closed'` never happens outside rebuildCtx.
    //
    // The rejection is caught because this nudge is speculative. iOS refuses a resume that
    // is not inside a user gesture, and this runs from anything about to make a sound —
    // including the boot music, before the player has touched anything. Unhandled, that
    // refusal reaches the boot error handler and puts the fatal overlay over a game that
    // is fine. There is nothing to do about it here: `handleGesture` unlocks the context
    // on the first touch, which is the browser's own bargain.
    if (this.ctx.state === 'suspended' && !this.modalPaused) {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  /**
   * Notice that iOS has taken the audio away, and put it back when it is willing.
   *
   * Backgrounding the app moves the context to `'interrupted'` — a WebKit state the spec
   * does not have, so `AudioContextState` does not name it — and coming back moves it to
   * `'running'` again. That second transition is a lie, and it is the whole bug. Measured
   * on an iPhone 12 (iOS 26.6.1), across an app-switch away and back:
   *
   *     statechange -> interrupted  currentTime 38.42
   *     statechange -> running      currentTime 38.42     <- and it never moves again
   *
   * The context reports itself running for ever after while its clock stands still and it
   * plays nothing. So NOTHING the context says about itself can be used to decide whether
   * the game can be heard, which is why two earlier attempts at this failed: resuming an
   * interrupted context rejects with "Failed to start the audio device", and by the time
   * a finger arrives the state reads 'running' and looks fine.
   *
   * What is reliable is that the interruption itself is announced. So remember it, and
   * when iOS says it has finished, replace the context rather than believe it.
   */
  private onStateChange(ctx: AudioContext): void {
    // A dead context's last statechange must not be answered with its replacement's
    // state — rebuildCtx closes the old one, and that close is itself a statechange.
    if (ctx !== this.ctx) return;
    const state: string = ctx.state;
    this.events.log(`statechange -> ${state}  clock=${ctx.currentTime.toFixed(2)}`);
    if (state === 'interrupted') {
      this.interrupted = true;
      return;
    }
    // Out the other side. `'closed'` is us, in rebuildCtx, and must not re-trigger.
    if (this.interrupted && state !== 'closed') this.scheduleRebuild();
  }

  /**
   * Replace the context shortly after iOS hands it back.
   *
   * Not immediately: the transition out of `'interrupted'` is the moment iOS starts
   * putting the audio session back, not the moment it has, and a context opened into the
   * middle of that can fail to start — which would trade one silence for another. The
   * delay is a guess, so `verifyAudible` checks the guess rather than trusting it.
   */
  private scheduleRebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    setTimeout(() => {
      this.rebuildQueued = false;
      // Came back to a help overlay: stay silent on purpose, but stay OWED. Clearing
      // `interrupted` here would leave setModalPause resuming the dead context when the
      // overlay closes, and nothing afterwards could tell it was dead — it reports
      // `'running'` for ever. That is the original bug, on the path that fixes it.
      if (this.modalPaused) {
        this.events.log('rebuild deferred: modal pause, interruption still owed');
        return;
      }
      this.events.log(`rebuild 1/${REBUILD_ATTEMPTS}  page=${pageVisibility()}`);
      this.rebuildCtx(); // clears `interrupted`
      this.verifyAudible(1);
    }, REBUILD_DELAY_MS);
  }

  /**
   * Check that the new context is really playing, and try again if it is not.
   *
   * A context that cannot reach the audio device still says `'running'`, so the only
   * honest test is whether its clock moves: `currentTime` is driven by the device, and
   * stands still exactly when nothing can be heard. Bounded, because a device that will
   * not come back must not be retried for the rest of the session.
   */
  private verifyAudible(attempt: number): void {
    const started = this.ctx?.currentTime ?? 0;
    setTimeout(() => {
      const ctx = this.ctx;
      if (!ctx) return;
      // A modal opened mid-verify. Hand the unfinished repair back rather than dropping
      // it: `interrupted` is what setModalPause and handleGesture both read.
      if (this.modalPaused) {
        this.interrupted = true;
        return;
      }
      if (ctx.currentTime > started) {
        this.events.log(`audible after ${attempt} rebuild(s)  state=${ctx.state as string}`);
        return; // the clock is moving: it can be heard
      }
      if (attempt >= REBUILD_ATTEMPTS) {
        // Out of attempts, so stop rebuilding — but stay OWED. The context that is left is
        // dead and says `'running'`, and `interrupted` is the only record of that; dropping
        // it here would tell every later repair that there is nothing to repair. Kept, the
        // next trigger of any kind — a touch, a late announcement from iOS, the app coming
        // back on screen again — finds the debt and pays it.
        this.interrupted = true;
        this.events.log(
          `SILENT after ${attempt} rebuild(s), still owed  ` +
            `state=${ctx.state as string}  page=${pageVisibility()}`,
        );
        return;
      }
      this.events.log(`silent, rebuild ${attempt + 1}/${REBUILD_ATTEMPTS}  page=${pageVisibility()}`);
      this.rebuildCtx();
      this.verifyAudible(attempt + 1);
    }, VERIFY_DELAY_MS);
  }

  /**
   * The app is back on screen. Repair the audio if it is owed one. Wired to
   * `visibilitychange` in boot.
   *
   * This is the trigger that is always there, and it had to be measured to be believed.
   * iOS announces the START of an interruption every single time; it announces the END
   * only sometimes. Six app switches on an iPhone 12 produced six `-> interrupted`
   * events and two announcements back (a `'suspended'`, 10.3 s and 3.2 s later). The
   * other four produced NO statechange at all between the interruption and the player
   * touching the screen — so the automatic repair, which hangs off that announcement,
   * simply never ran. The player came back to a silent game four times out of six and
   * had to touch it to wake it up.
   *
   * The reason this was passed over the first time is real, but it is an argument about
   * ACTING, not about LISTENING: `visibilitychange` fires while the app is still animating
   * back, when a fresh context can still fail to start. That is why this goes through
   * `scheduleRebuild` like every other trigger — 400 ms before opening anything, then
   * `verifyAudible` checking the guess against the clock and trying again. Being early is
   * what that machinery is for. Being absent is what nothing can fix.
   *
   * The announcement path stays. It is faster when it comes, `rebuildQueued` collapses the
   * two into one rebuild when both come, and a phone call ending while the app is already
   * on screen never changes visibility at all.
   */
  onVisible(): void {
    if (!this.interrupted) return;
    this.events.log('back on screen with an interruption owed');
    this.scheduleRebuild();
  }

  /**
   * Repair the audio from inside a user gesture. Wired to pointerdown/keydown in boot.
   *
   * The belt to `onStateChange`'s brace: if the transition out of `'interrupted'` never
   * arrives, the interruption stays remembered and the next touch acts on it. A gesture is
   * also the one context in which iOS will honour a `resume()`, which is what the ordinary
   * non-iOS case below needs.
   */
  onGesture(): void {
    const ctx = this.ctx;
    if (!ctx || this.modalPaused) return;
    this.events.log(`gesture  state=${ctx.state as string}  interrupted=${this.interrupted}`);
    if (this.interrupted) {
      this.interrupted = false;
      this.rebuildCtx();
      this.verifyAudible(1);
      return;
    }
    // The ordinary suspended context — a gesture unlock, or a browser that parked it.
    // Resuming keeps every sound's place, so prefer it while it still works.
    if ((ctx.state as string) !== 'running') {
      void ctx.resume().catch(() => {
        // It refused, so it is the iOS case after all and only a new context will do.
        this.rebuildCtx();
        this.verifyAudible(1);
      });
    }
  }

  /**
   * Throw the context away and build another one, then put the room music back.
   *
   * Everything sounding is lost — there is no way to move a playing source to another
   * context — so this is the expensive repair and `handleGesture` is careful about when
   * it is worth it. The decoded buffers are NOT thrown away: an `AudioBuffer` is data
   * rather than a piece of the graph, so the ~13 MB of speech a room decoded on the way
   * in stays valid, which is the difference between a rebuild costing a moment and
   * costing a reload.
   */
  private rebuildCtx(): void {
    const old = this.ctx;
    const restore = this.events.outputLost();
    this.ctx = null;
    this.master = null;
    this.buses = { effect: null, voice: null, music: null };
    this.interrupted = false;
    if (old) void old.close().catch(() => undefined);
    this.ensureCtx();
    restore();
  }

  get paused(): boolean {
    return this.modalPaused;
  }

  setPaused(on: boolean): void {
    this.modalPaused = on;
    const ctx = this.ctx;
    if (on) {
      if (ctx) void ctx.suspend();
      return;
    }
    // An interruption that landed while the overlay was up was deliberately left owed
    // (scheduleRebuild, verifyAudible). Resuming would hand back a context that says
    // `'running'` and plays nothing, so pay the debt instead.
    if (this.interrupted) {
      this.rebuildCtx();
      this.verifyAudible(1);
      return;
    }
    if (ctx) void ctx.resume();
  }

  setBusGain(bus: VolumeBus, gain: number): void {
    this.busGain[bus] = gain;
    const g = this.buses[bus];
    if (g) g.gain.value = gain;
  }

  /** The output node a sound of the given category should connect to. */
  private busNode(bus: VolumeBus): GainNode {
    this.ensureCtx();
    return this.buses[bus] ?? this.master!;
  }

  fromPcm16(pcm: Int16Array, rate: number): SoundBuffer {
    const buf = this.live.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 32768;
    return buf;
  }

  decode(bytes: ArrayBuffer): Promise<SoundBuffer> {
    return decodeAudioData(this.live, bytes);
  }

  async decodeSegment(bytes: ArrayBuffer, samples: number): Promise<SoundBuffer> {
    const ctx = this.live;
    return trimToSamples(ctx, await decodeAudioData(ctx, bytes), samples);
  }

  /** The source is routed through `busNode`, which nudges the context awake — the second
   *  of the two nudges every start has always made (the policy's `wake()` is the first). */
  start(buf: SoundBuffer, opts: VoiceOptions, onEnded?: () => void): Voice {
    const ctx = this.live;
    const src = ctx.createBufferSource();
    src.buffer = buf as AudioBuffer;
    if (opts.loop !== undefined) src.loop = opts.loop;
    if (opts.loopStart !== undefined) src.loopStart = opts.loopStart;
    if (opts.loopEnd !== undefined) src.loopEnd = opts.loopEnd;
    const g = ctx.createGain();
    g.gain.value = opts.gain;
    src.connect(g);
    g.connect(this.busNode(opts.bus));
    src.start();
    if (onEnded) src.addEventListener('ended', onEnded);
    const voice: WebVoice = { src, gain: g };
    return voice;
  }

  stop(voice: Voice): void {
    try {
      (voice as WebVoice).src.stop();
    } catch {
      /* already stopped */
    }
  }

  detach(voice: Voice): void {
    const { src, gain } = voice as WebVoice;
    src.disconnect();
    gain.disconnect();
  }
}
