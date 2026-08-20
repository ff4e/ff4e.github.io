/**
 * Stage the 17 `Music/` tracks the game ships: 22050 Hz mono PCM in, AAC in MP4 out.
 *
 * ── What this is for ──────────────────────────────────────────────────────────
 * The 17 music tracks shipped as uncompressed 22050 Hz mono 16-bit PCM — 352.8 kbps,
 * **63.8 MB** across 17 `.wav` files (mean 3.75 MB, max 6.75 MB for `rybky06`) — and since a
 * room does not appear until its audio is in, that PCM is time the player spends looking at
 * a loading screen. Measured on a 1.5 Mbps link, a room's music was up to 36 s of the wait
 * on its own.
 *
 * Music was the UNCOMPRESSED half. The voices are not raw: the `.ffs` bodies go through the
 * original's `Decompres` delta codec (`src/audio/ffs.ts`, RSound.pas:258-333), which already
 * buys ~1.39x — 183.9 MB shipped for 254.8 MB of PCM. They are a separate job, and a smaller
 * multiple than this one.
 *
 * At 64 kbps the same 17 tracks are **12.7 MB** — 5.0x smaller, and the whole music
 * download of a room entry drops from up to 6.75 MB to under 1.4 MB.
 *
 * ── Why AAC in MP4, and not Opus ──────────────────────────────────────────────
 * Opus is the better codec and measured slightly better here too (13.0 MB at the same
 * 64 kbps, and it decodes to EXACTLY the original sample count where AAC does not — see
 * below). It is not used, for one reason: Safari's `decodeAudioData` still does not
 * reliably decode Ogg Opus. Opus in Ogg only reached Safari's `<audio>` element in 18.4,
 * and Web Audio — which is the only path this game uses, because it needs sample-accurate
 * loop points and a mixer — is reported broken there still.
 *
 * This repo has already made this exact call once, for the intro movies, and the reasoning
 * transfers verbatim: H.264 was chosen because it is "the one codec that plays in *every*
 * browser (Safari included)" (README, "Intro movies"). AAC is that codec's audio half.
 * Shipping both and choosing by `canPlayType` was the other option and was rejected as
 * 12.7 MB of second copy in the repo to gain a codec difference nobody can hear at this
 * bitrate on an 11 kHz-band source.
 *
 * ── 64 kbps, on a source band-limited to 11 kHz ───────────────────────────────
 * 22050 Hz sampling means nothing above ~11 kHz exists in these files at all, so the
 * encoder spends its whole budget on the half of the spectrum that is there. 48 kbps was
 * measured too (9.3 MB, 6.9x) and is where the busier tracks start to show it.
 *
 * ── What is proved, and what is not ───────────────────────────────────────────
 * This is a LOSSY re-encode of a faithful port, so be exact about the claim. `--verify`
 * decodes the shipped track back to 22050 Hz mono and reports three things:
 *
 *   1. **Start alignment** — the lag, in samples, that best correlates the decode with the
 *      original. This is EXACT and it is **0** for all 17. AAC in MP4 carries its encoder
 *      delay in the edit list and ffmpeg honours it; a non-zero lag here would mean every
 *      loop point in `music.ts` was off by that much.
 *   2. **Length** — the decoded sample count against the original's. AAC codes in
 *      1024-sample frames, so a decode runs ~600 samples (~27 ms) LONG, and that tail is
 *      encoder padding, not music. This is why `playMusic` sets `loopEnd` from the
 *      table's `frames` and not from `buf.duration`: looping on the decoded duration would
 *      splice that padding into the track once per loop, forever.
 *   3. **SNR** against the original samples, ~18-27 dB here.
 *
 * Be honest about (3): a waveform SNR is NOT a transparency proof. Opus and AAC are not
 * waveform coders and a perceptually identical encode scores poorly by it, so the number
 * is a regression tripwire — a track that suddenly drops 10 dB was mis-encoded — and not
 * evidence the encode is inaudible. Nothing here can prove that; it is a listening
 * question, and the reason the originals are still in the repo to listen against.
 *
 * (1) and (2) are the parts that ARE exact, and they are the parts the game depends on:
 * a loop point is `loopSample / 22050` seconds into the buffer, so a shifted start or an
 * unaccounted tail is audible as the track repeating its intro or gapping once a loop.
 *
 * ── Reproducibility ───────────────────────────────────────────────────────────
 * `--check` re-encodes to a temp dir and byte-compares, the same contract as
 * `tools/stage-score.ts`. Encoding is deterministic run to run, and `-fflags +bitexact`
 * keeps the ffmpeg version string out of the container — but the bytes are still those of
 * *this* ffmpeg's AAC encoder, so a different ffmpeg build will differ. `--check` says so
 * when it fails rather than claiming the shipped files are wrong. Use `--verify` for the
 * question that is version-independent: does what we ship decode to the right samples?
 *
 *   npx tsx tools/stage-music.ts            # writes public/data/Music/*.m4a
 *   npx tsx tools/stage-music.ts --check    # re-encode to temp and byte-compare
 *   npx tsx tools/stage-music.ts --verify   # decode the shipped files and measure
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MUSIC_EXT, MUSIC_RATE, musicNames } from '../src/audio/music.js';

const DIR = join(process.cwd(), 'public/data/Music');
/** The one encoder setting. See the header for why 64k, and why AAC. */
const BITRATE = '64k';

/** The PCM body of a RIFF/WAVE file, plus the header fields the staging depends on. */
export function readWav(path: string): { rate: number; channels: number; bits: number; pcm: Int16Array } {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`);
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let format = 0;
  // Chunk walk rather than fixed offsets: a WAV may carry LIST/fact chunks before `data`,
  // and the whole point of this tool is that the header is about to stop existing.
  for (let o = 12; o + 8 <= b.length; ) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      format = b.readUInt16LE(o + 8);
      channels = b.readUInt16LE(o + 10);
      rate = b.readUInt32LE(o + 12);
      bits = b.readUInt16LE(o + 22);
    } else if (id === 'data') {
      if (format !== 1 || bits !== 16) throw new Error(`${path}: not 16-bit PCM (fmt=${format}, bits=${bits})`);
      const pcm = new Int16Array(size >> 1);
      for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(o + 8 + i * 2);
      return { rate, channels, bits, pcm };
    }
    o += 8 + size + (size & 1); // chunks are word-aligned
  }
  throw new Error(`${path}: no data chunk`);
}

/** Encode one 22050 Hz mono WAV to AAC in MP4. */
function encode(src: string, dst: string): void {
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-i', src,
    '-c:a', 'aac',
    '-b:a', BITRATE,
    '-ac', '1',
    // Nothing of the source's metadata is wanted, and `+bitexact` keeps the muxer from
    // stamping its own version into the file — without it every ffmpeg upgrade rewrites
    // all 17 files and `--check` fails for a reason that has nothing to do with the audio.
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    '-flags:a', '+bitexact',
    // The moov atom first: the game decodes these through `decodeAudioData` on a fully
    // downloaded buffer, so this changes nothing for the player — it costs nothing and
    // keeps the files usable by anything that does stream them.
    '-movflags', '+faststart',
    dst,
  ]);
}

/** Decode a shipped track back to the original's format, for `--verify`. */
function decodeToPcm(path: string, tmp: string): Int16Array {
  const raw = join(tmp, 'dec.raw');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path, '-ar', String(MUSIC_RATE), '-ac', '1', '-f', 's16le', raw]);
  const b = readFileSync(raw);
  const pcm = new Int16Array(b.length >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(i * 2);
  return pcm;
}

/**
 * The sample lag that best correlates `dec` with `orig`, searched over +/-`span`.
 *
 * Exported because this is the measurement the loop points depend on, and it is worth
 * being able to test it on synthetic input rather than only on 60 MB of real music.
 */
export function bestLag(orig: Int16Array, dec: Int16Array, span = 80): number {
  // Skip the first samples: a fade-in correlates with everything and would flatten the peak.
  const from = 100;
  const to = Math.min(from + 400_000, orig.length - span, dec.length - span);
  let best = 0;
  let bestC = -Infinity;
  for (let lag = -span; lag <= span; lag++) {
    let c = 0;
    for (let i = from; i < to; i++) {
      const oi = i + lag;
      if (oi >= 0 && oi < orig.length) c += orig[oi]! * dec[i]!;
    }
    if (c > bestC) {
      bestC = c;
      best = lag;
    }
  }
  return best;
}

/** Signal-to-noise of `dec` against `orig`, in dB, at the given lag. See the header. */
export function snrDb(orig: Int16Array, dec: Int16Array, lag: number): number {
  let se = 0;
  let so = 0;
  for (let i = 0; i < dec.length; i++) {
    const oi = i + lag;
    const o = oi >= 0 && oi < orig.length ? orig[oi]! : 0;
    const e = dec[i]! - o;
    se += e * e;
    so += o * o;
  }
  return 10 * Math.log10(so / Math.max(se, 1));
}

const isCli = process.argv[1]?.endsWith('stage-music.ts') === true;
if (isCli) main();

function main(): void {
  const check = process.argv.includes('--check');
  const verify = process.argv.includes('--verify');
  const names = musicNames();
  const tmp = mkdtempSync(join(tmpdir(), 'ff4e-music-'));
  try {
    if (verify) return runVerify(names, tmp);
    const dest = check ? tmp : DIR;
    mkdirSync(dest, { recursive: true });
    let bad = 0;
    let wav = 0;
    let out = 0;
    for (const name of names) {
      const src = join(DIR, `${name}.wav`);
      if (!existsSync(src)) throw new Error(`missing original: ${src}`);
      const dst = join(dest, `${name}.${MUSIC_EXT}`);
      encode(src, dst);
      wav += statSync(src).size;
      out += statSync(dst).size;
      if (!check) continue;
      const shipped = join(DIR, `${name}.${MUSIC_EXT}`);
      if (!existsSync(shipped)) {
        console.error(`  MISSING ${name}.${MUSIC_EXT}`);
        bad++;
        continue;
      }
      const same = Buffer.compare(readFileSync(shipped), readFileSync(dst)) === 0;
      console.log(`  ${same ? 'ok     ' : 'DIFFERS'} ${name}.${MUSIC_EXT}`);
      if (!same) bad++;
    }
    console.log(`${mb(wav)} MB of PCM -> ${mb(out)} MB (${(wav / out).toFixed(1)}x) at ${BITRATE}`);
    if (check) {
      if (bad === 0) console.log(`all ${names.length} tracks match this tool`);
      else console.log(`${bad} file(s) differ — check your ffmpeg version before assuming the shipped bytes are wrong, then run --verify`);
      // `exitCode` and return, NOT `process.exit()`: exiting here skips the `finally` below
      // and leaves 12 MB of freshly encoded temp files behind on every run.
      process.exitCode = bad === 0 ? 0 : 1;
      return;
    }
    console.log(`wrote ${names.length} tracks to ${DIR}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Decode every shipped track and measure it against its original. */
function runVerify(names: readonly string[], tmp: string): void {
  let bad = 0;
  for (const name of names) {
    const { rate, channels, pcm } = readWav(join(DIR, `${name}.wav`));
    const dec = decodeToPcm(join(DIR, `${name}.${MUSIC_EXT}`), tmp);
    const lag = bestLag(pcm, dec);
    const snr = snrDb(pcm, dec, lag);
    // The lag is the one that can silently move a loop point, so it is the one that fails.
    const ok = lag === 0 && rate === MUSIC_RATE && channels === 1;
    if (!ok) bad++;
    console.log(
      `  ${ok ? 'ok     ' : 'BAD    '} ${name.padEnd(8)} ${rate} Hz x${channels}  orig=${pcm.length}  dec=${dec.length}  (${dec.length - pcm.length >= 0 ? '+' : ''}${dec.length - pcm.length})  lag=${lag}  SNR=${snr.toFixed(1)} dB`,
    );
  }
  console.log(bad === 0 ? `all ${names.length} tracks decode in sample-alignment with their original` : `${bad} track(s) misaligned`);
  process.exitCode = bad === 0 ? 0 : 1; // not process.exit() — see the --check path
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}
