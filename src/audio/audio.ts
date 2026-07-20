/**
 * Web Audio playback of decoded FFS sounds.
 *
 * Mirrors the original's model (RSound.pas Sound/Search): sounds live in a set
 * of loaded packages (the room's NNN.ffs plus the global x00 effects), each
 * addressed by name via its FFT records. A sound is decoded on first use
 * (decodeSound) into an AudioBuffer at 22050 Hz and cached.
 *
 * Browsers gate audio behind a user gesture; the context is created lazily and
 * resumed on the first play triggered by input.
 */
import { indexFft, parseFft, type FftEntry } from '../data/fft.js';
import { decodeSound, FFS_SAMPLE_RATE } from './ffs.js';
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
  entries: Map<string, FftEntry>;
  ffs: Uint8Array;
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
  private roomPkg: Pkg | null = null;
  private cache = new Map<string, AudioBuffer>();
  /** Active voices by priority, with the wall-clock time they finish. */
  private activeUntil = new Map<number, number>();
  /** Every currently-playing one-shot source (for KillSnd). */
  private voices = new Set<AudioBufferSourceNode>();
  /** Sources tracked per priority, so a single priority can be stopped (KSnd). */
  private priorSources = new Map<number, Set<AudioBufferSourceNode>>();
  /** The looping room-music source (MusicCycle, prior -999) + its identity. */
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicGain: GainNode | null = null;
  private musicName = '';
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
  loadGlobal(fftBytes: Uint8Array, ffsBytes: Uint8Array): void {
    this.globals.push({ entries: indexFft(parseFft(fftBytes)), ffs: ffsBytes });
  }

  /** The current room's sound package; replaces the previous room's. */
  setRoom(fftBytes: Uint8Array, ffsBytes: Uint8Array): void {
    this.roomPkg = { entries: indexFft(parseFft(fftBytes)), ffs: ffsBytes };
    this.cache.clear();
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
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
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
    const pkgs = this.roomPkg ? [this.roomPkg, ...this.globals] : this.globals;
    for (const pkg of pkgs) {
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
    if (this.roomPkg?.entries.has(name)) return true;
    return this.globals.some((p) => p.entries.has(name));
  }

  /** Duration of a sound in seconds (from its decompressed sample count). */
  duration(name: string): number {
    const pkgs = this.roomPkg ? [this.roomPkg, ...this.globals] : this.globals;
    for (const pkg of pkgs) {
      const e = pkg.entries.get(name);
      if (e) return e.delka / FFS_SAMPLE_RATE;
    }
    return 0;
  }

  /** Play a sound by name (no-op if unknown). `volume` is a 0..1 gain. `bus`
   *  selects the category output (effects by default; voices for dialogue). */
  play(name: string, volume = 1, prior?: number, bus: VolumeBus = 'effect'): void {
    const buf = this.buffer(name);
    if (!buf) return;
    this.logSound(name, volume);
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
    if (prior !== undefined) this.activeUntil.set(prior, performance.now() + buf.duration * 1000);
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

  /** True if `name` resolves to an entry in the room/global sound packages. */
  hasPackaged(name: string): boolean {
    const pkgs = this.roomPkg ? [this.roomPkg, ...this.globals] : this.globals;
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
   * `Music/<name>.wav` file (e.g. the `rybky04` intro), which lives outside the package.
   */
  musicSnd(name: string, prior: number, url: string, volume = 0.45, loop = false): void {
    if (this.hasPackaged(name)) {
      this.snd(name, prior, loop, volume, 'music');
      return;
    }
    void this.playMusicFile(name, prior, url, volume, loop);
  }

  private async playMusicFile(
    name: string,
    prior: number,
    url: string,
    volume: number,
    loop: boolean,
  ): Promise<void> {
    const ctx = this.ensureCtx();
    let buf = this.musicBufs.get(name);
    if (!buf) {
      try {
        const bytes = await fetch(url).then((r) => r.arrayBuffer());
        buf = await ctx.decodeAudioData(bytes.slice(0));
      } catch {
        return; // track not present / decode failed — stay silent
      }
      this.musicBufs.set(name, buf);
    }
    this.logSound(name + ' (music-file)', volume);
    this.startTracked(buf, prior, loop, volume, 'music');
  }

  /** KSnd (RSound.pas): stop only the effect(s) of a given priority. */
  killVoice(prior: number): void {
    // KSnd(-999) targets the looping room music (a distinct source, not a voice).
    if (prior === MUSIC_PRIOR) {
      this.stopMusic();
      return;
    }
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
    const until = this.activeUntil.get(prior);
    return until !== undefined && performance.now() < until;
  }

  /**
   * talking(prior) (RSound.pas:933): like playing(), but reports false ~0.4535s
   * (10000 samples) before the voice ends — the lip-sync / dialogue-advance cutoff.
   * A looping effect (SndCyc, activeUntil=Infinity) always counts as talking.
   */
  talking(prior: number): boolean {
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
   * Start looping room music (MusicCycle, URoom.pas:1568). `url` is a WAV in the
   * Music/ folder; `loopSample` is the sample offset the track loops back to
   * (MusCycle/2), so the intro plays once and only the body repeats. No-op if the
   * same track is already playing (so it survives death-restarts within a room).
   */
  async playMusic(name: string, url: string, loopSample: number): Promise<void> {
    if (this.musicName === name && this.musicSrc) {
      this.activeUntil.set(MUSIC_PRIOR, Infinity); // ensure playing(-999) reflects it
      return; // already playing this track
    }
    this.stopMusic();
    this.musicName = name;
    const ctx = this.ensureCtx();
    let buf = this.musicBufs.get(name);
    if (!buf) {
      const bytes = await fetch(url).then((r) => r.arrayBuffer());
      // WAV loop point is in samples at the file's native rate (header @ offset 24).
      const nativeRate = new DataView(bytes).getUint32(24, true) || 22050;
      buf = await ctx.decodeAudioData(bytes.slice(0));
      (buf as AudioBuffer & { _rate?: number })._rate = nativeRate;
      this.musicBufs.set(name, buf);
    }
    if (this.musicName !== name) return; // room changed while decoding
    this.logSound(name + ' (music-loop)', 1);
    const nativeRate = (buf as AudioBuffer & { _rate?: number })._rate ?? 22050;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = loopSample > 0 ? loopSample / nativeRate : 0;
    src.loopEnd = buf.duration;
    const g = ctx.createGain();
    g.gain.value = 0.45; // music sits under the voices/effects
    src.connect(g);
    g.connect(this.busNode('music'));
    src.start();
    this.musicSrc = src;
    this.musicGain = g;
    this.activeUntil.set(MUSIC_PRIOR, Infinity); // MusicCycle(-999): playing(-999) true
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
    this.activeUntil.delete(MUSIC_PRIOR);
  }
}
