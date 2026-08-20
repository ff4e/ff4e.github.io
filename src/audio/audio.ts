/**
 * Web Audio playback of decoded FFS sounds.
 *
 * Mirrors the original's model (RSound.pas Sound/Search): sounds live in a set
 * of loaded packages (the room's NNN package plus the global x00 effects), each
 * addressed by name via its FFT records.
 *
 * A package arrives in one of two forms, and the engine tells them apart by looking
 * (`isFfs2`) rather than by being told:
 *
 *   - a staged `.ffs2` of AAC segments (every speech package) — decoded ENTIRELY when the
 *     package is installed, into `Pkg.buffers`. See `decodeFfs2` (ffs2Decode.ts) for why
 *     all of it, up front, rather than on first play.
 *   - the 1998 `.ffs` (`x00`, the effects) — `decodeSound` on first use, into `cache`.
 *
 * Browsers gate audio behind a user gesture; the context is created lazily and
 * resumed on the first play triggered by input.
 */
import { indexFft, parseFft, type FftEntry } from '../data/fft.js';
import { requiredBytes } from '../render/assetFetch.js';
import { decodeSound, FFS_SAMPLE_RATE } from './ffs.js';
import { isFfs2 } from './ffs2.js';
import { decodeFfs2 } from './ffs2Decode.js';
import { musicByName, musicSeconds } from './music.js';
import type { VolumeBus } from '../core/settings.js';

/**
 * Talking() lead time (RSound.pas:933, `mez=10000`): the original reports a voice
 * as no-longer-"talking" once fewer than 10000 samples (@22050Hz) remain — ~0.4535s
 * before the sample truly ends. This is the lip-sync / dialogue-advance cutoff, so a
 * mouth stops (and the next line starts) a beat before the sample's trailing tail.
 */
export const TALKING_MEZ_SEC = 10000 / 22050;
const TALKING_MEZ_MS = TALKING_MEZ_SEC * 1000;
/** MusicCycle priority (URoom.pas): the looping room-music channel. `playing(-999)`
 *  reports whether the room track is sounding; `KSnd(-999)` stops it. */
export const MUSIC_PRIOR = -999;

interface Pkg {
  /** Package id, as the original names its files: '025', 'x01', 'restored'. */
  id: string;
  entries: Map<string, FftEntry>;
  /** The 1998 delta-coded bodies, for a package that still ships as `.ffs` (x00). */
  ffs: Uint8Array | null;
  /** Decoded segments by sound name, for a staged `.ffs2`. See `decodeFfs2`. */
  buffers: Map<string, AudioBuffer>;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Per-category output buses (effects / voices / music), each a GainNode the
   *  Options sliders adjust (NastavZvuk, Uovl.pas:280). Every sound routes through
   *  the bus matching its category, so a slider scales just that category live. */
  private buses: Record<VolumeBus, GainNode | null> = { effect: null, voice: null, music: null };
  /** The slider-driven gain multiplier per bus (1.0 = the category's default level). */
  private busGain: Record<VolumeBus, number> = { effect: 1, voice: 1, music: 1 };
  private globals: Pkg[] = [];
  /** The current room's own 0NN package. */
  private roomPkg: Pkg | null = null;
  /**
   * First-use decodes of the RAW `.ffs` path only (x00). A staged package holds its
   * decoded segments in `Pkg.buffers` and never comes through here — which is also what
   * lets `clearRoom` keep clearing this: the globals' buffers travel with their package
   * and survive a room change, where a shared cache would drop them for good (nothing
   * could decode them again synchronously).
   */
  private cache = new Map<string, AudioBuffer>();
  /** Active voices by priority, with the wall-clock time they finish. */
  private activeUntil = new Map<number, number>();
  /**
   * Starts whose sample is still being fetched/decoded, as a set of request ids per
   * priority — a priority with a non-empty set counts as sounding (see `reserve`).
   *
   * Kept OUT of `activeUntil`, which holds real end times: a placeholder written there
   * would both extend a sound already playing on the priority and, if the load then
   * failed, leave the priority sounding forever with nothing to end it.
   *
   * Ids rather than a count, because a stale start has to recognise itself. The
   * original claims its mixer channel synchronously (Sound, RSound.pas:674), so a
   * started sound is either playing or it never started; here the room can change — or
   * a script can call `KSnd(prior)` — while the bytes are in flight. A kill drops every
   * id on the priority, so a start whose id is gone when it lands installs nothing, and
   * it cannot mistake a LATER request's claim for its own.
   */
  private pending = new Map<number, Set<number>>();
  private nextReservation = 0;
  /** Every currently-playing one-shot source (for KillSnd). */
  private voices = new Set<AudioBufferSourceNode>();
  /** Sources tracked per priority, so a single priority can be stopped (KSnd). */
  private priorSources = new Map<number, Set<AudioBufferSourceNode>>();
  /** The looping room-music source (MusicCycle, prior -999) + its identity. */
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicName = '';
  /** Track downloads started OUTSIDE this engine (room entry), so starts can join them. */
  private musicLoads = new Map<string, Promise<void>>();
  /** Name of the track whose async decode/start is currently in flight, if any.
   *  Guards against a second concurrent start for the same track spawning a second
   *  overlapping loop that stopMusic() can't fully cancel (see playMusic). */
  private musicStarting: string | null = null;
  /** Bumped by every start and every stop, so an in-flight start can tell whether it
   *  is still the current intent by the time its decode resolves (see playMusic). */
  private musicGen = 0;
  /** True while a modal overlay has deliberately suspended the context (setModalPause). */
  private modalPaused = false;
  /** Wall-clock time the modal pause began, so `activeUntil` can be carried across it. */
  private modalPausedAt = 0;
  private musicBufs = new Map<string, AudioBuffer>();
  /** Debug: recent play names with a timestamp (ring buffer) + a console line so the
   *  source of any glitch can be identified live in the browser console. */
  soundLog: Array<{ name: string; vol: number; t: number }> = [];
  logToConsole = true;
  private logSound(name: string, vol: number): void {
    const t = Math.round(performance.now());
    this.soundLog.push({ name, vol, t });
    if (this.soundLog.length > 200) this.soundLog.shift();
    if (this.logToConsole) console.log(`🔊 [sound] ${name}  vol=${vol.toFixed(2)}  @${t}ms`);
  }

  /** A persistent global package (e.g. x00 effects). */
  async loadGlobal(id: string, fftBytes: Uint8Array, body: Uint8Array): Promise<void> {
    this.globals.push(await this.makePkg(id, fftBytes, body));
  }

  /** The current room's sound package; replaces the previous room's. */
  async setRoom(id: string, fftBytes: Uint8Array, body: Uint8Array): Promise<void> {
    // Decoded BEFORE the old package is dropped, so a failure leaves the room with the
    // sound it had rather than with none: `roomPkg` is only replaced once there is
    // something to replace it with.
    this.roomPkg = await this.makePkg(id, fftBytes, body);
    this.cache.clear();
  }

  /**
   * Build a package from its `.fft` index and its bodies, decoding a staged one in full.
   *
   * The two forms are told apart by the bytes (`isFfs2`), not by the caller. That keeps
   * the rule about which packages are staged in exactly one place — `isRawPkg` in
   * `ffs2.ts`, next to the URL builder that acts on it — so the engine cannot disagree
   * with what was fetched.
   */
  private async makePkg(id: string, fftBytes: Uint8Array, body: Uint8Array): Promise<Pkg> {
    const entries = indexFft(parseFft(fftBytes));
    if (!isFfs2(body)) return { id, entries, ffs: body, buffers: new Map() };
    return { id, entries, ffs: null, buffers: await decodeFfs2(this.ensureCtx(), entries, body) };
  }

  /**
   * The FFT record for a name, room packages first — the subtitle text and the
   * sample live in the same record, so nothing has to keep a second copy of the
   * index just to render a line.
   */
  entry(name: string): FftEntry | undefined {
    for (const pkg of this.pkgs) {
      const e = pkg.entries.get(name);
      if (e) return e;
    }
    return undefined;
  }

  /** How many sounds a loaded package holds (0 if it is not loaded). */
  entryCount(id: string): number {
    return this.pkgs.find((p) => p.id === id)?.entries.size ?? 0;
  }

  /**
   * Drop the current room's sound package (the global packages stay).
   *
   * Entering a room no longer waits for its sound bodies before the room is built —
   * the voice package is a non-visual asset (1.73 MB for KUFRIK, the largest) and nothing
   * that is drawn depends on it. Clearing here keeps the gap honest:
   * until the new package lands, a lookup misses and falls back to the globals
   * rather than playing the PREVIOUS room's sample under the new room.
   *
   * Dropping the package drops its decoded segments with it, which is how the ~13 MB a
   * staged room decodes to (the AudioBuffers are float32 at the context's rate, not
   * int16 at 22050) stays a per-room cost rather than an accumulating one.
   */
  clearRoom(): void {
    this.roomPkg = null;
    this.cache.clear();
  }

  /** True once the current room's own voice package has arrived (see clearRoom). */
  get roomLoaded(): boolean {
    return this.roomPkg !== null;
  }

  /** Every loaded package, the room's own first — the order `Search` resolves in. */
  private get pkgs(): Pkg[] {
    return this.roomPkg ? [this.roomPkg, ...this.globals] : this.globals;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
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
    if (this.ctx.state === 'suspended' && !this.modalPaused) void this.ctx.resume();
    return this.ctx;
  }

  /**
   * Pause or resume every sound at once, keeping each one's place.
   *
   * Suspending the AudioContext stops its clock, so a half-spoken line and the music
   * loop both continue from where they were rather than restarting or being lost —
   * which is what a frozen game should sound like. Killing the voices instead would
   * drop whatever a fish was in the middle of saying.
   *
   * Used by the help overlay (app/panel.ts), which is the only thing in the port that
   * covers the whole play area while the game is still notionally running.
   */
  setModalPause(on: boolean): void {
    if (this.modalPaused === on) return;
    this.modalPaused = on;
    const ctx = this.ctx;
    if (on) {
      this.modalPausedAt = performance.now();
      if (ctx) void ctx.suspend();
      return;
    }
    // Suspending stops the AUDIO clock; `activeUntil` is bookkeeping on the WALL clock
    // (startTracked writes performance.now() + duration), and that one kept running. So
    // without this the game comes back believing every line it paused mid-way has
    // finished: `talking()` goes false while the tail is audibly still playing, the
    // speaking fish's mouth closes over it, and a script waiting on `!playing(p)` starts
    // the next line on top of it — the exact overlap the priority bookkeeping exists to
    // prevent. Found by review, reproduced at a 4.5s line held under help for 5.3s.
    //
    // Only entries that were still sounding when we paused are moved, and Infinity
    // (looping effects, MusicCycle) is left alone. A one-shot STARTED during the pause
    // would be over-held by up to the pause length, which is the safe direction and is
    // unreachable anyway: the logic tick is frozen, so nothing is calling play().
    const delta = performance.now() - this.modalPausedAt;
    if (delta > 0) {
      for (const [prior, until] of this.activeUntil) {
        if (until !== Infinity && until > this.modalPausedAt) {
          this.activeUntil.set(prior, until + delta);
        }
      }
    }
    if (ctx) void ctx.resume();
  }

  /** Set a category bus gain multiplier (a slider index -> level, via settings). */
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

  /** Resume the AudioContext (browsers gate it behind a user gesture). */
  resume(): void {
    this.ensureCtx();
  }

  private buffer(name: string): AudioBuffer | null {
    const cached = this.cache.get(name);
    if (cached) return cached;
    for (const pkg of this.pkgs) {
      // A staged package decoded everything when it was installed, so this is a hit or
      // the name is not in it. Nothing here can decode one: `decodeAudioData` is async
      // and every caller of this is a synchronous voice start (see `decodeFfs2`).
      const ready = pkg.buffers.get(name);
      if (ready) return ready;
      if (!pkg.ffs) continue;
      const e = pkg.entries.get(name);
      if (e && e.delka > 0) {
        const pcm = decodeSound(pkg.ffs, e.zvuk, e.delka);
        const ctx = this.ensureCtx();
        const buf = ctx.createBuffer(1, pcm.length, FFS_SAMPLE_RATE);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 32768;
        this.cache.set(name, buf);
        return buf;
      }
    }
    return null;
  }

  /** True if a sound with this name exists in a loaded package. */
  has(name: string): boolean {
    return this.pkgs.some((p) => p.entries.has(name));
  }

  /** Duration of a sound in seconds (from its decompressed sample count). */
  duration(name: string): number {
    const pkgs = this.pkgs;
    for (const pkg of pkgs) {
      const e = pkg.entries.get(name);
      if (e) return e.delka / FFS_SAMPLE_RATE;
    }
    return 0;
  }

  /** Play a sound by name (no-op if unknown). `volume` is a 0..1 gain. `bus`
   *  selects the category output (effects by default; voices for dialogue).
   *
   *  With a `prior` the sound goes through the same priority-tracked path as `snd`
   *  (startTracked). The original has a single mixer and `KSnd(prior)` (RSound.pas:946)
   *  kills every channel of that priority regardless of how it was started, so a voice
   *  (Talk) must be as killable as an effect (Snd) — otherwise a scripted shush like
   *  MIKRO's `KSnd(101..104)` clears only the bookkeeping and the sample plays on. */
  play(name: string, volume = 1, prior?: number, bus: VolumeBus = 'effect'): void {
    const buf = this.buffer(name);
    if (!buf) return;
    this.logSound(name, volume);
    if (prior !== undefined) {
      this.startTracked(buf, prior, false, volume, bus);
      return;
    }
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.busNode(bus));
    src.start();
    // Track the source so KillSnd can stop it when leaving a room.
    this.voices.add(src);
    src.addEventListener('ended', () => this.voices.delete(src));
  }

  /**
   * Snd (RSound.pas): play an environmental effect tracked by priority so the game
   * logic can poll `playing(prior)` and later stop just this priority via `killVoice`.
   * With `loop` (SndCyc) the effect repeats and `playing(prior)` stays true until it
   * is explicitly killed (e.g. an alarm clock ringing until the player nudges it).
   */
  snd(name: string, prior: number, loop = false, volume = 1, bus: VolumeBus = 'effect'): void {
    const buf = this.buffer(name);
    if (!buf) return;
    this.logSound(name + (loop ? '(loop)' : ''), volume);
    this.startTracked(buf, prior, loop, volume, bus);
  }

  /** Start a buffer as a priority-tracked source (shared by snd / musicSnd). */
  private startTracked(
    buf: AudioBuffer,
    prior: number,
    loop: boolean,
    volume: number,
    bus: VolumeBus = 'effect',
  ): void {
    const ctx = this.ensureCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.busNode(bus));
    src.start();
    this.voices.add(src);
    let set = this.priorSources.get(prior);
    if (!set) {
      set = new Set();
      this.priorSources.set(prior, set);
    }
    set.add(src);
    src.addEventListener('ended', () => {
      this.voices.delete(src);
      this.priorSources.get(prior)?.delete(src);
    });
    this.activeUntil.set(prior, loop ? Infinity : performance.now() + buf.duration * 1000);
  }

  /**
   * Claim a priority for a start whose sample is not decoded yet, and return the
   * reservation id the caller must still hold when it lands.
   *
   * `Sound()` (RSound.pas:674) takes its mixer channel and writes `priority:=prior;
   * flen:=d` before it returns, so `Playing(prior)` (RSound.pas:924) is true on the
   * very next tick — for an in-memory sample AND for one streamed off disk. Reserving
   * here reproduces that: a script that guards on `playing(prior)` must not be able to
   * observe the gap between asking for a sound and the bytes arriving.
   */
  private reserve(prior: number): number {
    const id = ++this.nextReservation;
    let ids = this.pending.get(prior);
    if (!ids) {
      ids = new Set();
      this.pending.set(prior, ids);
    }
    ids.add(id);
    return id;
  }

  /** Is this reservation still the one that was made — i.e. has no kill dropped it? */
  private holds(prior: number, id: number): boolean {
    return this.pending.get(prior)?.has(id) ?? false;
  }

  /**
   * Drop one reservation — the load failed (`Sound()` likewise claims no channel for a
   * file it cannot open: it exits with `flen` still 0, RSound.pas:709/722, and
   * `Playing` only counts channels with `flen>0`), or the real source is about to take
   * over. A kill has already dropped every id on the priority, so a superseded start
   * deletes nothing here and cannot touch a later request's claim.
   */
  private release(prior: number, id: number): void {
    const ids = this.pending.get(prior);
    if (!ids?.delete(id)) return;
    if (ids.size === 0) this.pending.delete(prior);
  }

  /** Drop every reservation on a priority (a kill happened). */
  private clearReserved(prior: number): void {
    this.pending.delete(prior);
  }

  /** True if `name` resolves to an entry in the room/global sound packages. */
  hasPackaged(name: string): boolean {
    const pkgs = this.pkgs;
    for (const pkg of pkgs) {
      const e = pkg.entries.get(name);
      if (e && e.delka > 0) return true;
    }
    return false;
  }

  /**
   * Music (RSound.pas `Sound(...,-3)`): play a music-channel track once, tracked by
   * priority. Mirrors the original's resolution order — a packaged sound (e.g. the
   * band's `d1-z-*` tracks) plays from the room package; otherwise it falls back to a
   * `Music/<name>` track (e.g. the `rybky04` intro), which lives outside the package.
   *
   * Returns the download rather than voiding it. Nothing in the game awaits this — a
   * room script cues a track and carries on, which is the original's behaviour — so in
   * play the rejection of a track that did not arrive is unhandled ON PURPOSE, and the
   * trap in `loadingUi.ts` turns it into the failure screen. Handing the promise back
   * costs the callers a `void` and gives a test something to hold.
   */
  musicSnd(name: string, prior: number, url: string, volume = 0.45, loop = false): Promise<void> {
    if (this.hasPackaged(name)) {
      this.snd(name, prior, loop, volume, 'music');
      return Promise.resolve();
    }
    return this.playMusicFile(name, prior, url, volume, loop);
  }

  private async playMusicFile(
    name: string,
    prior: number,
    url: string,
    volume: number,
    loop: boolean,
  ): Promise<void> {
    // The context is opened here, before anything awaits, because `decodeMusic` needs one
    // and a start that reaches it only after a download would open it late.
    this.ensureCtx();
    // Claim the priority before the first await, so `playing(prior)` is true from the
    // tick that asked for the track — see reserve(). KORALY is the room that showed
    // why: it cues `music('rybky08', 10)` at score-step 19 (koraly.ts:373) and its own
    // faithful rule `if cinnost>20 and cinnost<80 and not playing(10) then cinnost:=80`
    // (koraly.ts:408 = URoom.pas:15576) reads that flag 160 ms later. `rybky08` is in no
    // sound package, so it comes down this path: a 740 KB fetch plus a decode inside two
    // logic ticks. Lose that race and the octopus jumps to the end of its animation
    // while the music, arriving afterwards, plays on over a still puppet.
    const claim = this.reserve(prior);
    let buf = this.musicBufs.get(name);
    if (!buf) {
      try {
        // Join a download that is already in flight for this track rather than opening a
        // second one — the same rule `playMusic` has followed since room entry took over
        // the room's own track, and this path did not. DRAKAR1 is the room that needs it:
        // its script cues `rybky04` (5.75 MB) from `init`, i.e. inside `buildRoom`, and
        // the room ENTRY now preloads that same track a moment later (see
        // `extraMusicOfRoom`). Two concurrent writes of one cache entry that size fail
        // with net::ERR_CACHE_WRITE_FAILURE — a transient error, so without this the
        // entry would end the session over a file the script was fetching successfully.
        const inflight = this.musicLoads.get(name);
        if (inflight) {
          await inflight;
          buf = this.musicBufs.get(name);
        }
      } catch {
        // `beginMusicLoad` swallows the outcome, so this cannot actually reject; the guard
        // is here so a future change to it cannot escape past the reservation below.
      }
    }
    if (!buf) {
      // Registered BEFORE the first await for the same reason, so the entry's preload
      // joins THIS load instead of starting its own.
      const load = (async () => {
        // Low request priority: a 5-7 MB music track is the largest single file the
        // game fetches. Room entry already avoids the contention that matters by
        // starting music only after the room's art (see loadRoom); this is the backstop
        // for every other caller — notably the menu music, which competes with the
        // world map's own assets.
        const bytes = await requiredBytes(url, 'the music', 'mustHave', { init: { priority: 'low' } as RequestInit });
        // Through `decodeMusic` rather than a bare `decodeAudioData`, because that is the
        // one entry point to the `musicBufs` cache: a track decoded here is one `playMusic`
        // can later start without a second fetch of the same file.
        await this.decodeMusic(name, bytes);
      })();
      this.beginMusicLoad(name, load);
      try {
        await load;
        buf = this.musicBufs.get(name);
      } catch (e) {
        // Is this start still the one that should sound? Asked BEFORE the release, which
        // is what makes the answer meaningful — `release` clears the claim either way.
        const current = this.holds(prior, claim);
        this.release(prior, claim);
        // A start the app itself cancelled — a room change, a script's own KSnd — does
        // not get to end the session when its abandoned download fails a minute later.
        // Nothing cancels the request itself, so a 5-7 MB track can outlive the room that
        // asked for it by the whole retry budget plus the 20 s headers deadline, and the
        // player would be told "the music didn't finish loading" over a room whose music
        // is playing fine. Every other loader in the codebase already draws this line —
        // `roomLoad`, `art.ts`'s `curNum === num`, `ensureAiWorldMap`'s `screen === 'map'`.
        if (!current) return;
        // Still wanted, so the failure LEAVES. This used to return ("stay silent"), which
        // is how a dropped track became a room playing in silence with nothing said.
        throw e;
      }
    }
    // Killed while it was loading (a room change, or the script's own KSnd(prior)):
    // the request is stale and must not install a source over the silence that was
    // asked for. The reservation went with the kill.
    if (!buf || !this.holds(prior, claim)) return;
    // Hand the reservation over to the real source. Nothing awaits in between, so
    // playing(prior) is never observably false across the handover.
    this.release(prior, claim);
    this.logSound(name + ' (music-file)', volume);
    this.startTracked(buf, prior, loop, volume, 'music');
  }

  /** KSnd (RSound.pas:946): stop every channel of a given priority — effect or voice.
   *  The original has one mixer, so anything sounding at `prior` dies here. */
  killVoice(prior: number): void {
    // KSnd(-999) targets the looping room music (a distinct source, not a voice) —
    // plus any tracked source that was started on that priority (a packaged band track).
    if (prior === MUSIC_PRIOR) this.stopMusic();
    this.clearReserved(prior); // cancel any start still fetching/decoding for it
    const set = this.priorSources.get(prior);
    if (set) {
      for (const src of set) {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        this.voices.delete(src);
      }
      this.priorSources.delete(prior);
    }
    this.activeUntil.delete(prior);
  }

  /** KillSnd (RSound.pas:954): stop every playing voice/effect (not the music). */
  killVoices(): void {
    for (const src of this.voices) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    // Cancel every start still fetching/decoding — otherwise a track requested a
    // moment before this KillSnd installs itself after it, under the next room. The
    // room-music channel is exempt because THIS port's killVoices() is not the
    // original's KillSnd (which does kill -999 too, RSound.pas:954): it is the
    // voices-only half, paired with stopMusic() in killAll(), and its lone caller that
    // keeps the music is the restart — TRoom.Restart's KillExcept(-999)
    // (URoom.pas:1588, RSound.pas:962). So an in-flight -999 start must survive here,
    // exactly as the sounding one does at the end of this method.
    for (const prior of [...this.pending.keys()]) {
      if (prior !== MUSIC_PRIOR) this.clearReserved(prior);
    }
    this.voices.clear();
    this.priorSources.clear();
    this.activeUntil.clear();
    // KillSnd leaves the room music untouched, so keep its playing(-999) flag.
    if (this.musicSrc) this.activeUntil.set(MUSIC_PRIOR, Infinity);
  }

  /** KillSnd + music: full audio silence, e.g. when leaving a room for the map. */
  killAll(): void {
    this.killVoices();
    this.stopMusic();
  }

  /** playing(prior) (RSound.pas): is a voice of this priority still sounding? */
  playing(prior: number): boolean {
    // A reserved priority counts as sounding: the original's channel is claimed by
    // Sound() before it returns, so there is no tick on which a requested sound reads
    // back as silent (see reserve).
    if (this.pending.has(prior)) return true;
    const until = this.activeUntil.get(prior);
    return until !== undefined && performance.now() < until;
  }

  /**
   * talking(prior) (RSound.pas:933): like playing(), but reports false ~0.4535s
   * (10000 samples) before the voice ends — the lip-sync / dialogue-advance cutoff.
   * A looping effect (SndCyc, activeUntil=Infinity) always counts as talking.
   */
  talking(prior: number): boolean {
    if (this.pending.has(prior)) return true;
    const until = this.activeUntil.get(prior);
    if (until === undefined) return false;
    if (until === Infinity) return true;
    return performance.now() < until - TALKING_MEZ_MS;
  }

  /** Play a random one of `names` (e.g. sp-zuch1 / sp-zuch2). */
  playRandom(names: readonly string[], volume = 1): void {
    const pick = names[Math.floor(Math.random() * names.length)];
    if (pick) this.play(pick, volume);
  }

  /**
   * Start looping room music (MusicCycle, URoom.pas:1568). `url` is a track in the
   * Music/ folder (`musicUrl`); `loopSample` is the sample offset the track loops back
   * to (MusCycle/2), counted in the 22050 Hz original's samples, so the intro plays once
   * and only the body repeats. No-op if the same track is already playing (so it
   * survives death-restarts within a room).
   */
  /** Is this track already decoded and cached? (Room entry asks before fetching.) */
  hasMusic(name: string): boolean {
    return this.musicBufs.has(name);
  }

  /**
   * Tell the engine a track is already on its way, so `playMusic` joins it rather than
   * starting a second download of the same file.
   *
   * Room entry owns its music download (see startRoomMusic — it has to, because only the
   * entry can fail on it), which puts that download outside everything `playMusic` uses to
   * deduplicate: `musicBufs` is empty until the decode finishes and `musicStarting` only
   * knows about starts `playMusic` itself began. KANKAN then re-cues its track on the
   * first tick it sees the channel idle (`if (!s.playing(MUSIC_PRIOR)) s.musiccyc(...)`,
   * kankan.ts:216) and the 1.24 MB file is fetched and decoded TWICE on a cold entry.
   */
  /** A download already in flight for this track (see beginMusicLoad), or undefined. */
  musicLoad(name: string): Promise<void> | undefined {
    return this.musicLoads.get(name);
  }

  beginMusicLoad(name: string, load: Promise<unknown>): void {
    const done = load.then(
      () => {},
      () => {},
    );
    this.musicLoads.set(name, done);
    void done.then(() => {
      if (this.musicLoads.get(name) === done) this.musicLoads.delete(name);
    });
  }

  /**
   * Decode a music track into the cache, so `playMusic` can start it without a fetch.
   *
   * Split out of `playMusic` so the room ENTRY can own the download, and fail on it: a
   * track that never arrives used to mean a room played through with no music and nothing
   * said. `playMusic` now fails too — silence is not an outcome any more — but it fails a
   * beat later and out of band, where the entry fails before the room is ever presented,
   * which is the difference the split is for.
   *
   * It used to read the WAV header (offset 24) here and stash the native rate on the
   * buffer for `playMusic` to compute `loopStart` from. The shipped tracks are AAC in MP4
   * and have no such header, and the rate was never variable anyway — it is `MUSIC_RATE`,
   * stated once in `music.ts` and checked against the originals by `test/musicStaging.test.ts`.
   */
  async decodeMusic(name: string, bytes: Uint8Array): Promise<void> {
    if (this.musicBufs.has(name)) return;
    const ctx = this.ensureCtx();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    this.musicBufs.set(name, await ctx.decodeAudioData(ab));
  }

  async playMusic(name: string, url: string, loopSample: number): Promise<void> {
    if (this.musicName === name && this.musicSrc) {
      this.activeUntil.set(MUSIC_PRIOR, Infinity); // ensure playing(-999) reflects it
      return; // already playing this track
    }
    // A start for this exact track is already mid-decode AND still the current intent:
    // a second concurrent call (e.g. the keyboard-skip that reaches the map fires BOTH
    // showMap()'s startMenuMusic and the once-per-session unlockAudio's in the same
    // keydown) would otherwise start a second overlapping loop that phases against the
    // first and survives stopMusic(). Bail — the in-flight start will produce the track.
    //
    // `musicName === name` is what makes that promise true. Without it the bail also
    // swallowed requests the in-flight start could no longer honour: a stopMusic()
    // during the decode clears musicName, the in-flight start then returns silently at
    // the check below, and the caller that bailed never retried — so the map ended up
    // with NO menu music (test-mapaudio).
    if (this.musicStarting === name && this.musicName === name) return;
    this.stopMusic();
    this.musicName = name;
    this.musicStarting = name;
    // Claim this start. Any later start — or any stopMusic() — bumps the counter, so
    // when this decode resolves it can tell whether it is still the current intent.
    const gen = ++this.musicGen;
    // Same reservation as playMusicFile, on the room-music channel: MusicCycle claims
    // its mixer channel synchronously, so `playing(-999)` must be true from the tick
    // that asked for the track. KANKAN re-cues on exactly that flag —
    // `if (!s.playing(MUSIC_PRIOR)) s.musiccyc(s.musName, MUSIC_PRIOR)` (kankan.ts:216)
    // — and would otherwise re-request the track on every tick of its first load.
    // stopMusic() above dropped any previous claim on this channel, so this start is
    // the only one holding it; `musicGen` is what tells it whether it still is.
    const claim = this.reserve(MUSIC_PRIOR);
    try {
      const ctx = this.ensureCtx();
      let buf = this.musicBufs.get(name);
      if (!buf) {
        // Join a download the room entry already started rather than opening a second one
        // for the same file (see beginMusicLoad).
        const inflight = this.musicLoads.get(name);
        if (inflight) {
          await inflight;
          buf = this.musicBufs.get(name);
        }
      }
      if (!buf) {
        const bytes = await requiredBytes(url, 'the music', 'mustHave', { init: { priority: 'low' } as RequestInit });
        buf = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
        this.musicBufs.set(name, buf);
      }
      // Superseded while decoding (room changed, music stopped, or a newer start for
      // this same track replaced this one). Checking the generation rather than the
      // name also covers "stopped, then asked for the same track again", where the
      // name matches but this start is no longer the one that should install itself.
      if (this.musicGen !== gen) return;
      this.release(MUSIC_PRIOR, claim); // handed over to the source started below
      this.logSound(name + ' (music-loop)', 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = loopSample > 0 ? musicSeconds(loopSample) : 0;
      // The END of the loop, in the original's samples — NOT `buf.duration`.
      //
      // A lossy codec does not decode to exactly the sample count it was given: AAC codes
      // in 1024-sample frames, so the shipped tracks decode ~600 samples (~27 ms) LONGER
      // than the 22050 Hz original, that tail being encoder padding rather than music.
      // Looping on `buf.duration` would play the padding every time round — a short gap
      // inserted into a track that is meant to be seamless, once per loop, forever.
      //
      // `frames` is the original's own sample count (music.ts, checked against the WAVs by
      // test/musicStaging.test.ts), so this ends the loop where the music ends. Falling
      // back to `buf.duration` keeps a name the table does not know playable.
      const frames = musicByName(name)?.frames;
      src.loopEnd = frames !== undefined ? Math.min(musicSeconds(frames), buf.duration) : buf.duration;
      const g = ctx.createGain();
      g.gain.value = 0.45; // music sits under the voices/effects
      src.connect(g);
      g.connect(this.busNode('music'));
      src.start();
      this.musicSrc = src;
      this.musicGain = g;
      this.activeUntil.set(MUSIC_PRIOR, Infinity); // MusicCycle(-999): playing(-999) true
    } catch (e) {
      // The track could not be fetched or decoded, so nothing will ever sound on this
      // channel — hand the reservation back rather than leaving playing(-999) stuck
      // true. `Sound()` does the same by never claiming a channel for a file it cannot
      // open: it exits with `flen` still 0 (RSound.pas:709/722). Only the start that is
      // still current may do this.
      //
      // ...and then it leaves. The menu music was the one track allowed to vanish
      // quietly; it is the game's first impression.
      //
      // A SUPERSEDED start returns instead. `stopMusic()` bumps the generation but cannot
      // cancel the request, so the menu track abandoned when the player entered a room can
      // still fail minutes later — and it must not raise a screen naming music nobody is
      // waiting for over a room that is playing perfectly.
      if (this.musicGen !== gen) return;
      this.musicName = '';
      this.release(MUSIC_PRIOR, claim);
      throw e;
    } finally {
      // Only the start that is still current may release the flag; a superseded one
      // must leave it to whoever replaced it.
      if (this.musicGen === gen) this.musicStarting = null;
    }
  }

  /** The currently-looping room-music track name (debug/verification), or '' if none. */
  get currentMusic(): string {
    return this.musicSrc ? this.musicName : '';
  }

  /** Stop the looping room music (on room change). */
  stopMusic(): void {
    if (this.musicSrc) {
      try {
        this.musicSrc.stop();
      } catch {
        /* already stopped */
      }
      this.musicSrc.disconnect();
      this.musicGain?.disconnect();
    }
    this.musicSrc = null;
    this.musicGain = null;
    this.musicName = '';
    this.clearReserved(MUSIC_PRIOR); // any in-flight start is cancelled below
    // Invalidate any in-flight start: without this, a decode that resolves after this
    // stop would install itself over the silence the caller just asked for.
    this.musicGen++;
    this.activeUntil.delete(MUSIC_PRIOR);
  }
}
