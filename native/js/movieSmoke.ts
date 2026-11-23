/**
 * The movie smoke gate: the intro, its start splash and the credits roll driven the way a
 * player drives them — keys through the routers the gamepad also feeds, frames through
 * `introFrame` and `mapFrame` — over the real flow, headless, against a store it wipes.
 *
 *   ff4e-native <bundle.js> --root public --headless --smoke-movie --store F
 *
 * Headless, the movie's sound moves only when this says so (`movieAdvance`), so each frame is
 * a known instant of the movie. That is what lets it check what no screenshot can: that the
 * frame on screen is the one the sound has reached — no later frame is due, and this one is
 * — and that the sound played is the movie's own track from its first sample. Exits non-zero
 * on the first check that fails.
 */
import { ui } from '../../src/app/screenState.js';
import { initGame } from './game.js';
import { ensureMapArt, mapFrame, mapPresented } from './mapScreen.js';
import { intro, introFrame, loadIntroArt, openSession, playIntroMovies } from './introScreen.js';
import { routeEvent } from './keyRoute.js';
import { pinRandom } from './scene.js';
import { soundPoll } from './sound.js';

class MovieSmokeFailure extends Error {}

const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A key press and release, routed as the interactive loop routes them (`keyRoute.ts`). */
async function tap(code: string): Promise<void> {
  routeEvent(`+${code}`);
  routeEvent(`-${code}`);
  await settle();
}

/** One frame, as the interactive loop takes it. */
async function frame(): Promise<number> {
  let tex = 0;
  soundPoll();
  if (ui.screen === 'intro') {
    const shown = introFrame(performance.now());
    if (shown) {
      __native.presentTexture(shown.tex, shown.overlay);
      tex = shown.tex;
    }
  } else if (ui.screen !== 'room') {
    const shown = mapFrame(performance.now());
    if (shown) {
      __native.presentTexture(shown.id);
      tex = shown.id;
    }
    mapPresented();
  }
  await settle(2);
  return tex;
}

export async function runMovieSmoke(): Promise<number> {
  if (!__native.args().includes('--store')) {
    console.error('--smoke-movie needs --store <file>: it wipes the store, so it must never be the player\'s');
    return 2;
  }
  localStorage.clear();
  pinRandom(1);
  initGame({ verbose: false, demo: false });
  let n = 0;
  const check = (ok: boolean, what: string): void => {
    n++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) throw new MovieSmokeFailure(what);
  };
  const t0 = __native.now();
  try {
    await ensureMapArt();
    await loadIntroArt();
    openSession();
    check(ui.screen === 'intro' && intro.playing && intro.gated, 'a first run opens on the intro\'s start splash');
    check((await frame()) !== 0, '...which is drawn');
    for (const k of ['Escape', 'KeyI', 'ArrowDown', 'Backspace']) await tap(k);
    await frame();
    check(intro.gated && !intro.movie, 'nothing but Ⓐ leaves the splash (Ⓑ, a stick, a d-pad, Ⓧ are ignored)');
    await tap('Space');
    check(!intro.gated && intro.movie?.url === '/data/Movie/logo_ai.mp4', 'Ⓐ starts the AI logo movie');
    check(__native.audioVoices() === 0, '...with the game\'s sound killed (the movie carries its own)');

    // The logo for 4 s at 60 frames a second, on the headless clock.
    const logo = intro.movie!;
    const period = 1 / logo.info.frameRate;
    const played: Float32Array[] = [];
    const shown = new Set<number>();
    let lag = 0;
    let early = 0;
    for (let i = 0; i < 240; i++) {
      played.push(new Float32Array(__native.movieAdvance(1000 / 60, true)!));
      await frame();
      const clock = __native.movieClock()!;
      if (logo.pts > clock + 1e-6) early++;
      lag = Math.max(lag, clock - logo.pts);
      shown.add(logo.pts);
    }
    check(early === 0 && lag < period + 1e-6,
      `each frame shown is the one the sound has reached (${early} shown early; worst ${(lag * 1000).toFixed(2)} ms behind, period ${(period * 1000).toFixed(2)} ms)`);
    check(shown.size >= 238, `at 60 Hz every frame of a ~60 fps movie is shown (${shown.size} distinct in 240 refreshes)`);
    // Against a second decode of the track: Apple's AAC decoder is not bit-for-bit repeatable
    // (an ulp now and then), so within 1e-5 — a one-sample shift of this track differs by more
    // than 1e-2 somewhere in any 4 s of it.
    const [pcm, ch] = __native.movieAudioPcm(logo.url)!;
    const ref = new Float32Array(pcm);
    let at = 0;
    let worst = 0;
    for (const p of played) {
      for (let i = 0; i < p.length; i++) worst = Math.max(worst, Math.abs(p[i]! - ref[at + i]!));
      at += p.length;
    }
    check(worst <= 1e-5 && at === Math.round(4 * 22050) * ch,
      `the sound played is the movie's own track from its first sample: ${at / ch} frames in 4 s, max |Δ| ${worst.toExponential(1)}`);

    await tap('KeyB');
    check(intro.movie?.url === '/data/Movie/intro_ai.mp4' && __native.movieClock() === 0, 'any button skips the logo to the intro, from its start');
    __native.movieAdvance(500);
    await frame();
    check(intro.movie!.pts >= 0 && intro.movie!.pts <= 0.5, `the intro shows its own frames (${intro.movie!.pts.toFixed(3)} s at 0.5 s)`);
    await tap('ShiftLeft');
    check(intro.movie?.url === '/data/Movie/intro_ai.mp4', 'a bare modifier does not skip');
    await tap('Enter');
    await settle();
    const opts = JSON.parse(localStorage.getItem('ff.options') ?? '{}') as { introSeen?: boolean };
    check(ui.screen === 'map' && !intro.playing && opts.introSeen === true, 'skipping the intro reaches the map, with introSeen saved');
    await settle(200);
    check(__native.movieClock() === null && __native.audioVoices() > 0, 'the movie\'s sound is gone and the menu music is back');

    openSession();
    check(ui.screen === 'map' && !intro.playing, 'later sessions open on the map');
    await frame();

    // The corners: move the selection until it is on one.
    const reach = async (action: 'intro' | 'credits', keys: string[]): Promise<boolean> => {
      for (let i = 0; i < 40 && ui.mapHoverCorner !== action; i++) {
        await tap(keys[Math.floor(i / 6) % keys.length]!); // runs of six presses each way
        await frame();
      }
      console.log(`    (selection: corner ${ui.mapHoverCorner}, room ${ui.mapHoverRoom})`);
      return ui.mapHoverCorner === action;
    };
    check(await reach('intro', ['ArrowUp', 'ArrowLeft']), 'the Intro corner can be selected');
    // A direction held while Ⓐ starts the intro (up: nothing that way from the top-left
    // corner, so the selection stays on it), and let go during the movie.
    routeEvent('+ArrowUp');
    await frame();
    check(ui.mapHoverCorner === 'intro', '...and a direction with nothing that way leaves it there');
    await tap('Space');
    check(ui.screen === 'intro' && !intro.gated && intro.movie?.url === '/data/Movie/intro_ai.mp4',
      'Ⓐ on it plays the intro at once, with no splash');
    __native.movieAdvance(1000);
    await frame();
    routeEvent('-ArrowUp');
    const movie = intro.movie!;
    let lastPts = -1;
    let clock = 0;
    for (let i = 0; i < 2000 && ui.screen === 'intro'; i++) {
      __native.movieAdvance(250);
      clock = __native.movieClock() ?? clock;
      await frame();
      lastPts = movie.pts; // the frame that update put up, even on the update that ended it
    }
    check(ui.screen === 'map' && clock >= movie.info.duration && clock < movie.info.duration + 0.25,
      `played to its end, the intro returns to the map (${movie.info.duration.toFixed(3)} s long; ended at ${clock.toFixed(3)} s)`);
    check(lastPts >= movie.info.duration - 2 / movie.info.frameRate, `...having shown its last frame (${lastPts.toFixed(3)} s)`);
    // A direction let go during the movie is not still steering the map: well past the
    // 340 ms repeat delay, the selection has not moved.
    await frame();
    const before = `${ui.mapHoverCorner}|${ui.mapHoverRoom}`;
    const until = performance.now() + 700;
    while (performance.now() < until) {
      await new Promise((r) => setTimeout(r, 20));
      await frame();
    }
    check(`${ui.mapHoverCorner}|${ui.mapHoverRoom}` === before,
      `a direction released during the intro does not steer the map after it (${before} → ${ui.mapHoverCorner}|${ui.mapHoverRoom})`);

    await frame();
    check(await reach('credits', ['ArrowRight', 'ArrowUp', 'ArrowDown']), 'the Credits corner can be selected');
    await tap('Space');
    await settle(50);
    const roll = await frame();
    check(ui.mapOverlay === 'credits' && roll !== 0, 'Ⓐ on it opens the credits roll over the map');
    await tap('KeyK');
    check(ui.mapOverlay === 'none' && ui.screen === 'map', 'any button closes it');
    await tap('Space');
    await settle(50);
    await frame();
    ui.creditsStart = performance.now() - 1e6; // far past closeAt
    await frame();
    check(ui.mapOverlay === 'none' && ui.creditMode === -1, 'the roll closes itself once it has settled and held');

    let done = false;
    playIntroMovies([() => '/data/Movie/no-such-movie.mp4'], false, () => {
      done = true;
    });
    check(done && !intro.playing, 'a movie that cannot be read counts as ended, as the browser\'s load error does');
  } catch (e) {
    console.log(`movie smoke FAILED: ${e instanceof MovieSmokeFailure ? e.message : e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)}`);
    return 1;
  }
  console.log(`movie smoke: ${n} checks passed in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}
