/**
 * Intro-movie playback (UMain.pas daLogo/daIntro). The original played the
 * ALTAR logo + intro AVIs full-screen via an MCI `TMediaPlayer`; here they are
 * H.264 transcodes played through an HTML5 `<video>` overlay layered over the
 * canvas (see tools/MOVIES.md for how the movies are built). A mouse-down / Esc
 * skips the current movie (the original's `MediaPlayer1.Stop`, UMain.pas:1603),
 * advancing logo→intro→caller.
 *
 * Browsers gate audio behind a user gesture, so a first-run auto-play (before
 * any interaction) shows a "click to start" splash first — the click both
 * unlocks audio and begins playback, guaranteeing the intro has sound.
 */
export interface IntroElements {
  /** Full-screen overlay container (shown during playback, hidden otherwise). */
  layer: HTMLElement;
  video: HTMLVideoElement;
  /** "Click to start" splash button (first-run audio gate). */
  startBtn: HTMLElement;
  /** Title cover shown behind the splash; hidden once a movie starts. */
  cover: HTMLElement;
  /** "click / Esc to skip" hint, shown once playback begins. */
  hint: HTMLElement;
}

export class IntroPlayer {
  private queue: string[] = [];
  private onDone: (() => void) | null = null;
  private active = false;

  constructor(private readonly els: IntroElements) {
    // End of a movie → next in the queue. A load error (missing transcode)
    // shouldn't wedge the boot, so treat it the same as a finished movie.
    els.video.addEventListener('ended', () => this.next());
    els.video.addEventListener('error', () => this.next());
    // A click anywhere on the overlay (except the start button) skips.
    els.layer.addEventListener('pointerdown', () => this.skip());
    els.startBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    els.startBtn.addEventListener('click', () => this.beginPlayback());
  }

  /** Whether a movie sequence is currently active (overlay visible). */
  get playing(): boolean {
    return this.active;
  }

  /** Whether the "click to start" splash is up, waiting for the first gesture. */
  private get gated(): boolean {
    return !this.els.startBtn.hidden;
  }

  /**
   * Play a list of movie URLs in order, then call `onDone`. When `gated`, show
   * the "click to start" splash before the first movie (first-run auto-play,
   * no prior user gesture); otherwise start immediately (a replay from the map,
   * where the click itself is the gesture).
   */
  start(urls: string[], onDone: () => void, gated: boolean): void {
    this.queue = urls.slice();
    this.onDone = onDone;
    this.active = true;
    this.els.layer.hidden = false;
    if (gated) {
      this.els.startBtn.hidden = false;
      this.els.cover.hidden = false; // show the title cover behind the splash
      this.els.hint.hidden = true;
    } else {
      this.els.startBtn.hidden = true;
      this.els.cover.hidden = true;
      this.els.hint.hidden = false;
      this.playCurrent();
    }
  }

  /** Dismiss the splash and begin the first movie. */
  private beginPlayback(): void {
    if (!this.gated) return;
    this.els.startBtn.hidden = true;
    this.els.cover.hidden = true; // the movie takes over from the cover
    this.els.hint.hidden = false;
    this.playCurrent();
  }

  private playCurrent(): void {
    const url = this.queue[0];
    if (url === undefined) {
      this.finish();
      return;
    }
    this.els.video.src = url;
    this.els.video.currentTime = 0;
    void this.els.video.play().catch(() => this.next());
  }

  private next(): void {
    if (!this.active || this.gated) return;
    this.queue.shift();
    if (this.queue.length === 0) this.finish();
    else this.playCurrent();
  }

  /**
   * Skip: at the splash, Esc/click abandons the whole intro (straight to the
   * caller); during playback, it stops the current movie and advances.
   */
  skip(): void {
    if (!this.active) return;
    if (this.gated) {
      this.finish();
      return;
    }
    this.next();
  }

  private finish(): void {
    this.active = false;
    this.els.video.pause();
    this.els.video.removeAttribute('src');
    this.els.video.load();
    this.els.layer.hidden = true;
    this.els.startBtn.hidden = true;
    this.els.cover.hidden = true;
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }
}
