/**
 * The sound across leaving and coming back (`--headless --audio-output --smoke-audio-lifecycle
 * --store F`): what an Apple TV does to the output — the app sent to the background and back,
 * the audio session interrupted, the output dying with or without a word, a route change,
 * media services reset, a device removed — played through the host's real paths by
 * `__native.audioLifecycle` (main.c), with a real output open (the Mac's device, or SDL's
 * dummy driver where there is none). TestFlight tvOS build 3: "on reopen the sound goes
 * completely off. I have to kill the game" (native/README.md, "When the sound does not come
 * back").
 *
 * Asserted each time: the output asks for sound again and the mixer clock runs at the wall's
 * pace, the music voice is still there, nothing was mixed while away (the clock held), an
 * output that was alive is not reopened, one that was not is — at once when the session said
 * it was taken, within the watchdog's 750 ms when nothing did — and a line of speech spoken
 * across the trip ends on the mixer clock exactly `delka` after it started, as `playing()`
 * says, the time away not counted.
 *
 * It runs on the wall's time (an output consumes in real time), ~40 s.
 */
import { audio, mixer } from './seams/audioEngine.js';
import { initGame } from './game.js';
import { MIX_RATE, type MixBuffer } from './sdlAudioBackend.js';
import { indexFft, parseFft } from '../../src/data/fft.js';
import { readBytes } from './shims.js';

class LifecycleFailure extends Error {}

let passed = 0;
function ok(cond: boolean, what: string): void {
  if (!cond) throw new LifecycleFailure(what);
  passed++;
  console.log(`  ok   ${what}`);
}

/** The largest step a device's pull can take past a state change it raced: one mixer chunk. */
const CHUNK = 1024;
const LINE_PRIOR = 7;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const st = (): ReturnType<typeof __native.audioStatus> => __native.audioStatus();
const life = (steps: string): void => __native.audioLifecycle!(steps);

/** Poll (delivering onEnded, as a frame does) until `cond`, for at most `ms`. */
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  const end = __native.now() + ms;
  while (__native.now() < end) {
    mixer.poll();
    if (cond()) return true;
    await sleep(5);
  }
  mixer.poll();
  return cond();
}

/** The output is asking for sound and the mixer clock runs in real time. */
async function runs(what: string): Promise<void> {
  const a = st();
  const t0 = __native.now();
  await sleep(400);
  const b = st();
  const rate = ((b.clock - a.clock) * 1000) / MIX_RATE / (__native.now() - t0);
  ok(b.fed > a.fed && !b.stalled && !b.suspended && b.output, `${what}: the output asks for sound again`);
  ok(rate > 0.6 && rate < 1.6, `${what}: the mixer clock runs (×${rate.toFixed(2)} of the wall)`);
}

/** A sequence of steps away; the clock may not have moved while they ran. */
function away(steps: string, what: string): void {
  const c = st().clock;
  life(steps);
  const held = st().clock - c;
  ok(held <= CHUNK, `${what}: nothing is mixed while away (${held} frames)`);
}

async function reopened(from: number, ms: number, what: string): Promise<number> {
  const t0 = __native.now();
  const done = await until(() => st().opens > from, ms);
  const took = __native.now() - t0;
  ok(done, `${what}: the output is reopened (${done ? `${took.toFixed(0)} ms` : `not within ${ms} ms`})`);
  return took;
}

async function checks(): Promise<void> {
  ok(mixer.mode === 'device' || mixer.mode === 'dummy', `an output drives the mixer (${mixer.mode})`);
  ok(st().opens === 1, 'opened once');
  await runs('at the start');
  // The music, as playMusic leaves it: a looping voice on the music bus, silent here.
  const loop = mixer.fromPcm16(Int16Array.from({ length: MIX_RATE }, (_, i) => (i % 64) * 64), MIX_RATE) as MixBuffer;
  mixer.start(loop, { gain: 0, bus: 'music', loop: true });
  const music = __native.audioVoices();
  const musicOn = (): boolean => __native.audioVoices() >= music;

  let o = st().opens;
  let s = st().suspends;
  away('will-background did-background sleep:1500 will-foreground did-foreground', 'home and back');
  ok(st().suspends === s + 1 && !st().suspended, 'home and back: held once, released once');
  await runs('home and back');
  ok(st().opens === o && musicOn(), 'home and back: a live output is kept, the music voice with it');

  s = st().suspends;
  away('will-background sleep:300 did-foreground', 'Control Center over the game');
  await runs('Control Center over the game');
  s = st().suspends;
  away('will-background will-background sleep:200 did-foreground did-foreground', 'every event twice');
  ok(st().suspends === s + 1 && !st().suspended, 'every event twice: held once, released once');
  life('did-foreground');
  ok(st().suspends === s + 1 && !st().suspended, 'a foreground without a background changes nothing');
  await runs('every event twice');

  // A line of speech across a trip away: it must end exactly delka after it started, on the
  // mixer clock `playing()` measures — the time away not counted, nothing cut, nothing doubled.
  const x03 = indexFft(parseFft(await readBytes('/data/Title/x03.fft')));
  const line = [...x03.values()].find((e) => e.delka >= 1.5 * MIX_RATE && e.delka <= 5 * MIX_RATE)!;
  ok(!!line && audio.has(line.name), `a line to speak: ${line.name}, ${(line.delka / MIX_RATE).toFixed(2)} s`);
  const voices = __native.audioVoices();
  const c0 = st().clock;
  const t0 = __native.now();
  audio.snd(line.name, LINE_PRIOR, false, 0, 'voice');
  ok(audio.playing(LINE_PRIOR) && __native.audioVoices() === voices + 1, 'the line is playing');
  await sleep(500);
  away('will-background did-background sleep:2000 will-foreground did-foreground', 'away mid-line');
  ok(audio.playing(LINE_PRIOR), 'back mid-line: the line is still playing');
  ok(await until(() => !audio.playing(LINE_PRIOR), line.delka / MIX_RATE * 1000 + 3000), 'the line ends');
  const c1 = st().clock;
  const wall = (__native.now() - t0) / 1000;
  const span = (c1 - c0) / MIX_RATE;
  // `wall` may run a device buffer short of it: an output pulls ahead of what it plays.
  ok(span >= line.delka / MIX_RATE && span <= line.delka / MIX_RATE + 0.15,
    `playing() ends ${span.toFixed(3)} s of mixer clock after the start (delka ${(line.delka / MIX_RATE).toFixed(3)} s)`);
  ok(wall >= line.delka / MIX_RATE + 2 - 0.1, `the time away is not counted (${wall.toFixed(2)} s of wall)`);
  ok(await until(() => __native.audioVoices() === voices, 300), 'the mixer ends the voice with it');

  // The output dies while away and nothing says so (SDL's AudioQueue left paused): the watchdog.
  o = st().opens;
  away('will-background did-background sleep:3000 kill will-foreground did-foreground', 'a dead output, no word');
  await reopened(o, 2000, 'a dead output, no word');
  await runs('a dead output, no word');
  ok(musicOn(), 'a dead output, no word: the music voice survives the reopen');

  // The session interrupted while away, and given back: reopened at once, not after a stall.
  o = st().opens;
  away('will-background interrupt-begin sleep:1000 interrupt-end did-foreground', 'an interruption while away');
  ok((await reopened(o, 300, 'an interruption while away')) < 300, 'an interruption while away: no stall to wait for');
  await runs('an interruption while away');
  // ...and with no end ever said (SDL does not promise one): the foreground is enough.
  o = st().opens;
  away('will-background interrupt-begin sleep:500 did-foreground', 'an interruption with no end');
  await reopened(o, 300, 'an interruption with no end');
  await runs('an interruption with no end');

  // The pause menu a room takes for the background: the output stays alive under it, the
  // clock stands still, and it is released once, by the game.
  audio.setModalPause(true);
  o = st().opens;
  away('will-background sleep:500 did-foreground', 'paused across a trip');
  const p = st();
  await sleep(400);
  ok(st().clock === p.clock && st().fed > p.fed && !st().stalled && st().paused, 'paused across a trip: the output pulls silence, the clock stands');
  audio.setModalPause(false);
  ok(!st().paused && st().opens === o, 'paused across a trip: the pause is released, the output kept');
  await runs('paused across a trip');

  // The output dies in the foreground (a route change SDL does not follow): reopened after a
  // stall, then after 1 s and 2 s while it stays dead, the clock driven by the wall meanwhile.
  o = st().opens;
  life('kill');
  const first = await reopened(o, 2000, 'dead in the foreground');
  ok(first >= 600, `dead in the foreground: noticed by the watchdog (${first.toFixed(0)} ms)`);
  life('kill');
  const second = await reopened(o + 1, 2500, 'still dead');
  life('kill');
  const before = st().clock;
  const tb = __native.now();
  const third = await reopened(o + 2, 3500, 'still dead again');
  const drift = ((st().clock - before) * 1000) / MIX_RATE / (__native.now() - tb);
  ok(second >= 900 && third >= 1900, `still dead: retried after 1 s, then 2 s (${second.toFixed(0)}, ${third.toFixed(0)} ms)`);
  ok(drift > 0.5, `still dead: the clock keeps the wall's time without an output (×${drift.toFixed(2)})`);
  await runs('dead in the foreground');
  ok(musicOn(), 'dead in the foreground: the music voice survives');

  // Still dead when the player leaves (the watchdog between retries), back 2 s later: the time
  // away must not be driven through the mixer on return — that would skip every voice and the
  // music forward by it, and end a line that was mid-way.
  await sleep(2000); // the retry schedule starts over once an output has kept pulling for 2 s
  o = st().opens;
  life('kill');
  await reopened(o, 2000, 'dead when leaving');
  life('kill');
  ok(await until(() => st().stalled, 1500), 'dead when leaving: the watchdog is between retries');
  const cl = st().clock;
  life('will-background did-background sleep:2000 will-foreground did-foreground');
  await sleep(100);
  const jumped = (st().clock - cl) / MIX_RATE;
  ok(jumped < 0.5, `dead when leaving: the time away is not driven on return (${jumped.toFixed(2)} s of clock for 2 s away)`);
  await reopened(o + 1, 3000, 'dead when leaving');
  await runs('dead when leaving');

  // The far end of the retry schedule: however many reopens have failed, the next is due within 8 s.
  // (the output dead and the watchdog between retries, then N failures behind it, the last 7.5 s ago)
  for (const n of [32, 41]) {
    await sleep(2000); // the schedule starts over
    o = st().opens;
    life('kill');
    await reopened(o, 2000, `${n} failed reopens`);
    life('kill');
    ok(await until(() => st().stalled, 1500), `${n} failed reopens: the watchdog is between retries`);
    life(`failed:${n}`);
    await reopened(o + 1, 2000, `${n} failed reopens`);
    await runs(`${n} failed reopens`);
  }

  o = st().opens;
  life('route');
  await sleep(300);
  ok(st().opens === o, 'a route change with a live output: the output is kept');
  await runs('a route change');

  // Media services reset with a movie playing: both streams reopened, the movie's clock on.
  const movie = __native.movieOpen('/data/Movie/intro_ai.mp4');
  ok(__native.moviePlay(movie.id) && st().movieOutput, 'a movie is playing');
  await sleep(300);
  const m0 = __native.movieClock()!;
  o = st().opens;
  life('reset');
  await reopened(o, 300, 'media services reset');
  ok(st().movieOutput, 'media services reset: the movie\'s stream is reopened too');
  await sleep(400);
  const m1 = __native.movieClock()!;
  ok(m1 > m0 + 0.2, `media services reset: the movie's clock runs on (${m0.toFixed(2)} -> ${m1.toFixed(2)} s)`);
  __native.movieClose(movie.id);
  await runs('media services reset');

  o = st().opens;
  life('removed');
  await reopened(o, 300, 'the device removed');
  await runs('the device removed');
  ok(musicOn(), 'at the end, the music voice is still there');
}

export async function runAudioLifecycleSmoke(): Promise<number> {
  if (!__native.args().includes('--store')) {
    console.error('--smoke-audio-lifecycle needs --store <file>: it wipes the store, so it must never be the player\'s');
    return 2;
  }
  if (!__native.audioLifecycle) {
    console.error('--smoke-audio-lifecycle: the host has no audioLifecycle hook');
    return 2;
  }
  localStorage.clear();
  initGame({ verbose: false, demo: false, onLeave: () => {} });
  const t0 = __native.now();
  try {
    if (!(await until(() => audio.entryCount('x03') > 0, 30000))) throw new LifecycleFailure('the global sounds did not load');
    await checks();
  } catch (e) {
    console.log(`  FAIL ${e instanceof LifecycleFailure ? e.message : e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)}`);
    console.log(`audio lifecycle smoke: FAILED after ${passed} checks`);
    return 1;
  }
  console.log(`audio lifecycle smoke: ${passed} checks passed in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}
