/**
 * The native sound gate (`--headless --smoke-audio --store F`): the C mixer, Apple's decoder
 * and the browser's sound policy on top of them, checked against what the browser does.
 *
 *   1. The mixer, on synthetic buffers, sample for sample: gains, the loop region, `stop`,
 *      `onEnded` delivered after the mix and never from inside `start`/`stop`, bus gains
 *      live, pause, and the clock (80 ms of game time is 1764 frames).
 *   2. Every staged speech package (the 72 rooms', x01-x03, the restored lines) decoded the
 *      way the policy decodes it (`decodeFfs2`): every sound exactly `delka` samples long.
 *   3. Every music track: it decodes to at least the original's sample count, so the loop
 *      ends where `playMusic` says (the table's `frames`, not the codec's padding); and the
 *      looping voice plays exactly [loopEnd - K, loopEnd) then [loopStart, loopStart + K) of
 *      the track, compared against the same track played straight through.
 *   4. PRVNI's opening through the real flow, as `tools/test-voices.mjs` measures it in the
 *      browser: the second line starts exactly the first line's talk ticks + 6 after it, each
 *      voice is `delka` long, `playing()` turns false on the tick the mixer plays the last
 *      sample, the room is audible, and the speaking fish's mouth moves.
 */
import { MASTER_GAIN } from '../../src/audio/audioBackend.js';
import { decodeFfs2 } from '../../src/audio/ffs2Decode.js';
import { voiceUrl } from '../../src/audio/ffs2.js';
import { musicByName, musicNames, musicSeconds, musicUrl } from '../../src/audio/music.js';
import { indexFft, parseFft } from '../../src/data/fft.js';
import { count, poslMluv } from '../../src/app/gameState.js';
import { MLUVI_PRIOR } from '../../src/app/keyTables.js';
import { step } from '../../src/app/logicTick.js';
import { enterRoom, initGame, roomReady } from './game.js';
import { audio, mixer } from './seams/audioEngine.js';
import { LOGIC_MS } from './seams/stageGeometry.js';
import { MIX_RATE, type MixBuffer } from './sdlAudioBackend.js';
import { readBytes } from './shims.js';
import { pinRandom } from './scene.js';

class AudioSmokeFailure extends Error {}

let passed = 0;
function ok(cond: boolean, what: string): void {
  if (!cond) throw new AudioSmokeFailure(what);
  passed++;
  console.log(`  ok   ${what}`);
}

const f = Math.fround;
/** The mixer's gain, as audio.c computes it in float: voice × bus × master. */
const gainOf = (gain: number, bus: number): number => f(f(f(gain) * f(bus)) * f(MASTER_GAIN));
/** 16-bit PCM whose sample i is `at(i)`. */
const pcm = (n: number, at: (i: number) => number): Int16Array => Int16Array.from({ length: n }, (_, i) => at(i));
const sample = (v: number): number => f(v / 32768);

/** Mix `frames` more, return them, and deliver what ended (the backend's `advance` without the ms). */
function mixed(frames: number): Float32Array {
  const out = new Float32Array(__native.audioAdvance(frames, true)!);
  mixer.poll();
  return out;
}
function skip(frames: number): void {
  if (frames > 0) __native.audioAdvance(frames, false);
  mixer.poll();
}
const equal = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);

function mixerMechanics(): void {
  ok(mixer.mode === 'manual', 'headless, nothing but the game moves the mixer');
  ok(__native.audioVoices() === 0, 'nothing is sounding before anything is started');

  const ramp = mixer.fromPcm16(pcm(100, (i) => (i + 1) * 100), MIX_RATE) as MixBuffer;
  ok(ramp.duration === 100 / MIX_RATE, 'a buffer lasts its samples / 22050 s');
  const t0 = mixer.now();
  let ended = 0;
  const one = mixer.start(ramp, { gain: 0.5, bus: 'effect' }, () => ended++);
  ok(ended === 0, 'start never calls onEnded');
  let out = mixed(150);
  const g = gainOf(0.5, 1);
  ok(equal(out, Array.from({ length: 150 }, (_, i) => (i < 100 ? f(sample((i + 1) * 100) * g) : 0))),
    'a voice plays from the next block, sample for sample, at its gain × bus × MASTER_GAIN, then stops');
  ok(ended === 1, 'its end is delivered once, by the poll after the mix');
  ok(mixer.now() - t0 === (150 * 1000) / MIX_RATE, 'the clock is the frames mixed');
  mixer.stop(one);
  mixer.poll();
  ok(ended === 1, 'stopping a voice that has ended is not an error, and ends nothing twice');

  // The effect and voice buses start at 1 (their default levels are the original's); music does not.
  const loop = mixer.start(ramp, { gain: 1, bus: 'effect', loop: true, loopStart: 30 / MIX_RATE, loopEnd: 80 / MIX_RATE }, () => ended++);
  out = mixed(300);
  const gl = gainOf(1, 1);
  ok(equal(out, Array.from({ length: 300 }, (_, k) => f(sample(((k < 80 ? k : 30 + ((k - 80) % 50)) + 1) * 100) * gl))),
    'a loop plays [0, loopEnd) once, then [loopStart, loopEnd) for ever');
  mixer.stop(loop);
  ok(ended === 1, 'stop never calls onEnded');
  mixer.poll();
  ok(ended === 2 && __native.audioVoices() === 0, '...the next poll does, and the voice is gone');

  const whole = mixer.start(ramp, { gain: 1, bus: 'voice', loop: true, loopStart: 200 / MIX_RATE, loopEnd: 0 });
  out = mixed(250);
  ok(equal(out, Array.from({ length: 250 }, (_, k) => f(sample(((k % 100) + 1) * 100) * gl))),
    'loopEnd 0 is the buffer\'s end, and a loopStart past it is the start (Web Audio\'s rule)');
  mixer.setBusGain('voice', 0.25);
  out = mixed(10);
  ok(equal(out, Array.from({ length: 10 }, (_, k) => f(sample((((250 + k) % 100) + 1) * 100) * gainOf(1, 0.25)))),
    'a bus gain applies from the next block, to the voices already sounding');
  mixer.setBusGain('voice', 1);
  const held = mixer.now();
  mixer.setPaused(true);
  out = mixed(500);
  ok(out.every((v) => v === 0) && mixer.now() === held, 'paused, the mix is silent and the clock stands still');
  mixer.setPaused(false);
  out = mixed(1);
  ok(out[0] === f(sample(((260 % 100) + 1) * 100) * gl), '...and resumes where it was');
  mixer.stop(whole);
  mixer.poll();

  const before = __native.audioClock();
  mixer.advance(LOGIC_MS);
  ok(__native.audioClock() - before === 1764, 'one 80 ms game step is 1764 frames at 22050 Hz');
  ok(__native.audioVoices() === 0, 'every voice of the checks is gone');
}

async function speechPackages(): Promise<void> {
  const pkgs: Array<[string, string, string]> = [
    ...Array.from({ length: 72 }, (_, i): [string, string, string] => {
      const id = String(i + 1).padStart(3, '0');
      return [id, `/data/Title/${id}.fft`, voiceUrl(id)];
    }),
    ['x01', '/data/Title/x01.fft', voiceUrl('x01')],
    ['x02', '/data/Title/x02.fft', voiceUrl('x02')],
    ['x03', '/data/Title/x03.fft', voiceUrl('x03')],
    ['restored', '/restored/restored.fft', voiceUrl('restored', '/restored')],
  ];
  const t0 = __native.now();
  let sounds = 0;
  let seconds = 0;
  const wrong: string[] = [];
  for (const [id, fft, body] of pkgs) {
    const entries = indexFft(parseFft(await readBytes(fft)));
    const bufs = await decodeFfs2(mixer, entries, await readBytes(body));
    for (const e of entries.values()) {
      if (e.delka <= 0) continue;
      const b = bufs.get(e.name) as MixBuffer | undefined;
      sounds++;
      seconds += e.delka / MIX_RATE;
      if (b?.frames !== e.delka) wrong.push(`${id}/${e.name}: ${b?.frames ?? 'none'} of ${e.delka}`);
    }
  }
  console.log(`       ${sounds} sounds, ${(seconds / 60).toFixed(1)} min of speech, decoded in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  ok(wrong.length === 0 && sounds > 1700,
    `every staged sound decodes to exactly its delka (${sounds} in ${pkgs.length} packages)${wrong.length ? `: ${wrong.slice(0, 5).join(', ')}` : ''}`);
}

async function musicLoops(): Promise<void> {
  const K = 4096;
  const t0 = __native.now();
  const lengths: string[] = [];
  for (const name of musicNames()) {
    const desc = musicByName(name)!;
    const bytes = await readBytes(musicUrl(name));
    const buf = (await mixer.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)) as MixBuffer;
    lengths.push(`${name} +${buf.frames - desc.frames}`);
    ok(buf.frames >= desc.frames, `${name} decodes to at least the original's ${desc.frames} samples (${buf.frames}), so its loop ends at the original's end`);
    // The policy's own arithmetic (`playMusic`): loopStart from the table, loopEnd the table's frames.
    const loopStart = desc.loopSample > 0 ? musicSeconds(desc.loopSample) : 0;
    const loopEnd = Math.min(musicSeconds(desc.frames), buf.duration);
    const straight = mixer.start(buf, { gain: 1, bus: 'music' });
    skip(desc.loopSample);
    const head = mixed(K);
    skip(desc.frames - K - desc.loopSample - K);
    const tail = mixed(K);
    mixer.stop(straight);
    const looping = mixer.start(buf, { gain: 1, bus: 'music', loop: true, loopStart, loopEnd });
    skip(desc.frames - K);
    const seam = mixed(2 * K);
    mixer.stop(looping);
    mixer.poll();
    ok(equal(seam.subarray(0, K), tail) && equal(seam.subarray(K), head),
      `${name} loops from sample ${desc.frames} back to ${desc.loopSample}, sample for sample`);
  }
  console.log(`       decoded and looped in ${((__native.now() - t0) / 1000).toFixed(1)} s; frames past the original: ${lengths.join(', ')}`);
}

interface Started {
  name: string;
  count: number;
  frames: number;
  clock: number;
  endedAt: number;
}

async function prvniTimeline(): Promise<void> {
  pinRandom(1);
  await enterRoom(1);
  for (let i = 0; i < 10_000 && !roomReady(); i++) await new Promise((r) => setTimeout(r, 0));
  ok(roomReady() && audio.roomLoaded, 'PRVNI is entered with its voice package installed');

  const starts: Started[] = [];
  let naming: string | null = null;
  const play = audio.play.bind(audio);
  audio.play = (name, volume, prior, bus) => {
    naming = name;
    try {
      play(name, volume, prior, bus);
    } finally {
      naming = null;
    }
  };
  const start = mixer.start.bind(mixer);
  mixer.start = (buf, opts, onEnded) => {
    const rec = naming !== null && opts.bus === 'voice'
      ? { name: naming, count, frames: (buf as MixBuffer).frames, clock: __native.audioClock(), endedAt: -1 }
      : null;
    if (rec) starts.push(rec);
    return start(buf, opts, () => {
      if (rec) rec.endedAt = __native.audioClock();
      onEnded?.();
    });
  };

  let peak = 0;
  let mouth = false;
  let agreed = true;
  let disagreement = '';
  for (let t = 0; t < 1000; t++) {
    const out = mixer.advance(LOGIC_MS, true)!;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    const first = starts.find((s) => s.name === '1st-m-cotobylo');
    if (first) {
      // The policy's playing() against the mixer: sounding exactly until its last sample is mixed.
      const sounding = __native.audioClock() - first.clock < first.frames;
      if (audio.playing(MLUVI_PRIOR.little) !== sounding || (first.endedAt >= 0) === sounding) {
        agreed = false;
        disagreement ||= `at clock ${__native.audioClock()}: playing ${audio.playing(MLUVI_PRIOR.little)}, mixer ${sounding ? 'sounding' : 'done'}, ended ${first.endedAt}`;
      }
    }
    step();
    if (first && poslMluv.little !== -1) mouth = true;
    const second = starts.find((s) => s.name === '1st-v-netusim');
    if (first && second && first.endedAt >= 0) break;
  }
  audio.play = play;
  mixer.start = start;

  const delka = (name: string): number => audio.entry(name)?.delka ?? -1;
  const first = starts.find((s) => s.name === '1st-m-cotobylo');
  const second = starts.find((s) => s.name === '1st-v-netusim');
  ok(first !== undefined && second !== undefined, `PRVNI speaks its first two lines (saw ${starts.map((s) => s.name).join(', ')})`);
  for (const s of starts) ok(s.frames === delka(s.name), `${s.name}: the buffer the mixer played is its delka, ${delka(s.name)} samples`);
  const talkTicks = Math.max(1, Math.round((delka(first!.name) / MIX_RATE - 10000 / MIX_RATE) / 0.08));
  ok(second!.count - first!.count === talkTicks + 6,
    `${second!.name} starts ${talkTicks} + 6 ticks after ${first!.name} (at ${first!.count} and ${second!.count}), as the browser's`);
  ok(agreed, `playing() turns false on the tick the mixer plays ${first!.name}'s last sample${disagreement ? `: ${disagreement}` : ''}`);
  ok(peak > 0.05, `the room is audible (peak ${peak.toFixed(3)})`);
  ok(mouth, `the little fish's mouth moves while ${first!.name} plays (lip sync)`);
}

/** Returns the process exit code. */
export async function runAudioSmoke(): Promise<number> {
  if (!__native.args().includes('--store')) {
    console.error('--smoke-audio needs --store <file>: it wipes the store, so it must never be the player\'s');
    return 2;
  }
  localStorage.clear();
  initGame({ verbose: false, demo: false, onLeave: () => {} });
  const t0 = __native.now();
  try {
    mixerMechanics();
    await speechPackages();
    await musicLoops();
    await prvniTimeline();
  } catch (e) {
    console.log(`  FAIL ${e instanceof AudioSmokeFailure ? e.message : e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ''}` : String(e)}`);
    console.log(`audio smoke: FAILED after ${passed} checks`);
    return 1;
  }
  console.log(`audio smoke: ${passed} checks passed in ${((__native.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}
