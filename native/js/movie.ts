/**
 * One movie playing natively: the host's decoder and its sound track (native/host/movie.c)
 * behind the three things the intro needs — start it, the frame to show now, and whether it
 * has ended.
 *
 * The clock is the movie's own sound, as a <video> element's is: the frame shown is the one
 * the sound has reached, so the picture can neither run ahead of the sound nor fall behind it,
 * however the frames are paced. A movie with no sound runs on the wall clock instead. The
 * movie has ended — the browser's `ended` — once the clock passes its duration, which is the
 * longer of its two tracks; until then the last frame stays up.
 */
import type { MovieInfo } from './nativeApi.js';

export class NativeMovie {
  private sound = false;
  private startedAt = 0;
  /** The texture the current frame is in (0 before the first is due), and its time. */
  tex = 0;
  pts = -1;

  private constructor(readonly url: string, readonly info: MovieInfo) {}

  /** Open `url` (under the asset root). Throws when it cannot be read: the browser's `error`. */
  static open(url: string): NativeMovie {
    return new NativeMovie(url, __native.movieOpen(url));
  }

  /** Start the sound (the clock) now. */
  play(now: number): void {
    this.sound = __native.moviePlay(this.info.id);
    this.startedAt = now;
  }

  /** Seconds into the movie at wall time `now`. */
  clock(now: number): number {
    return (this.sound ? __native.movieClock() : null) ?? (now - this.startedAt) / 1000;
  }

  /** Bring the picture to the clock; true once the movie has ended. */
  update(now: number): boolean {
    const t = this.clock(now);
    const [tex, pts] = __native.movieFrame(this.info.id, t);
    this.tex = tex;
    this.pts = pts;
    return t >= this.info.duration;
  }

  close(): void {
    __native.movieClose(this.info.id);
    this.tex = 0;
  }
}
