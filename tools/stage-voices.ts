/**
 * Stage the game's VOICES: the delta-coded 1998 `.ffs` packages in, AAC-in-MP4 `.ffs2` out.
 *
 * ── What this is for ──────────────────────────────────────────────────────────
 * The music half of this shipped first (`tools/stage-music.ts`): 63.8 MB of genuinely
 * uncompressed PCM became 12.3 MB of AAC. The voices are the larger half and the harder
 * claim, because — unlike the music — they were NEVER uncompressed. A `.ffs` body is
 * `Decompres` output (RSound.pas:258-333, ported in `src/audio/ffs.ts`), the original's
 * second-order delta codec, so the 183.9 MB that ships is already 1.39x smaller than the
 * 254.8 MB of raw PCM it decodes to.
 *
 * It is still the single biggest thing the site serves, and it is speech: 1 818 sounds,
 * 101.0 minutes, median line 2.75 s, only 3 % under a second. That is the material a
 * perceptual coder handles best. At 48 kbps the 76 speech packages are **37.4 MB** against
 * the 183.2 MB they replace — 4.9x, and ~146 MB off what the site publishes (measured:
 * `dist/` goes from ~621 MB to 452 MB). A mean room's voices go 2.43 MB -> 0.50 MB, and
 * the worst (KUFRIK) 8.94 MB -> 1.73 MB.
 *
 * ── 48 kbps, and the one package that is not touched ──────────────────────────
 * 48 kbps on a source band-limited to 11 kHz (22050 Hz sampling means nothing above that
 * exists), for mono speech. The music went out at 64 because music at 48 was where the
 * busier tracks started to show it; speech is a far easier signal and does not need it.
 *
 * `x00` is NOT staged. It is the only package of effects rather than speech — short
 * transients like the falling-steel clang, which is precisely what lossy coding smears —
 * and it is 0.87 MB of the 183.9. Compressing it would save ~0.7 MB and carry the whole
 * of the change's artefact risk. See `RAW_PKGS` in `src/audio/ffs2.ts`.
 *
 * ── What is proved, and what is not ───────────────────────────────────────────
 * `--verify` decodes every shipped segment and measures it against the `Decompres` output
 * of the same FFT record. Three gates, and it is worth being exact about what each one
 * can and cannot see, because the obvious measurement is the weakest of them:
 *
 *   1. **Alignment** — no shift in +/-64 samples makes the decode fit its original better
 *      than lag 0 does. That is what "lag 0" means, and it is stated as a comparison
 *      rather than as an argmax on purpose: a low-frequency thud (`044/bar-x-tup`) has an
 *      almost flat autocorrelation, so its best lag lands on -1 or -2 by a hundredth of a
 *      dB, and failing it for that would be reporting noise as a bug.
 *   2. **Shape** — the short-time RMS envelope of the decode correlates with the
 *      original's at better than 0.97. This is the gate that catches a segment decoded
 *      from the WRONG offset, and it works on material where a waveform measure cannot:
 *      measured over the shipped set, the weakest correct encode scores 0.9821, the same
 *      sound shifted by one AAC frame scores 0.859, and a different sound entirely 0.69.
 *   3. **Length** — the decode must be at least `delka` samples long, because the runtime
 *      TRIMS to `delka` (`src/audio/ffs2Decode.ts`) and a short decode would be trimming
 *      silence into the end of a spoken line. AAC codes in 1024-sample frames, so a decode
 *      usually runs 0-1023 samples LONG, and that tail is encoder padding. One sound in
 *      1 797 comes out SHORT (`011/deu-m-bojovat`, by 10 samples = 0.45 ms), so a
 *      shortfall is allowed only if it is under a frame AND the samples it drops are
 *      silence — measured, that tail peaks at 92 of 32768, which is -51 dBFS.
 *
 * It also prints an **SNR**, and that one is NOT a gate. A waveform SNR is not a
 * transparency proof: AAC is not a waveform coder, a perceptually identical encode scores
 * poorly by it, and on broadband noise it is meaningless — `038/poc-v-pssst` is a shush,
 * it scores 0.94 dB, and it is fine. It is printed as a regression tripwire, so that a
 * change which quietly drops every number by 10 dB is visible, and for no stronger claim
 * than that. Whether the encode is inaudible is a listening question, and the reason the
 * `.ffs` originals are still in the repo.
 *
 * ── Reproducibility ───────────────────────────────────────────────────────────
 * `--check` re-encodes to a temp dir and byte-compares, the same contract as
 * `tools/stage-music.ts` and `tools/stage-score.ts`. Encoding is deterministic run to run
 * and `-fflags +bitexact` keeps the ffmpeg version string out of the container, but the
 * bytes are still those of THIS ffmpeg's AAC encoder — a different build will differ, and
 * `--check` says so rather than claiming the shipped files are wrong. `--verify` is the
 * version-independent question: does what we ship decode to the right samples?
 *
 *   npx tsx tools/stage-voices.ts            # writes public/**\/*.ffs2
 *   npx tsx tools/stage-voices.ts --check    # re-encode to temp and byte-compare
 *   npx tsx tools/stage-voices.ts --verify   # decode every shipped segment and measure
 *   npx tsx tools/stage-voices.ts --verify --only 002,x03
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFft, type FftEntry } from '../src/data/fft.js';
import { decodeSound, FFS_SAMPLE_RATE } from '../src/audio/ffs.js';
import { buildFfs2, FFS2_EXT, isRawPkg, parseFfs2 } from '../src/audio/ffs2.js';

/** The one encoder setting. See the header for why 48k, and why AAC. */
const BITRATE = '48k';
/**
 * Envelope-similarity floor — gate 2, and the one that catches a mis-indexed segment.
 * Measured over the shipped set: the weakest correct encode scores 0.9821, the same sound
 * shifted by half an AAC frame scores 0.9221, by a whole one 0.8592, and a different sound
 * 0.69-0.76. The gap is not huge because a 512-sample envelope cannot see a small shift —
 * that is gate 1's job, and it is sharp exactly where this one is blunt (a one-sample shift
 * on speech costs ~10 dB of SNR). The two are complementary on purpose.
 */
const ENV_SIM_FLOOR = 0.97;
/** RMS window of that envelope, in samples. ~23 ms at 22050 Hz. */
const ENV_FRAME = 512;
/**
 * How much of a decode may be missing, and how loud those samples may be — gate 3.
 * One sound in 1 797 ends 10 samples early; a shortfall is only acceptable while it is
 * inaudible, so it is bounded by BOTH.
 */
const SHORT_BY_MAX = 1024;
const SHORT_TAIL_PEAK = 328; // 1 % of full scale
/**
 * Lag search span. The encoder delay is a whole number of 1024-sample frames and the MP4
 * edit list removes it, so a real drift would be far larger than this; +/-64 is enough to
 * see one and cheap enough to run on all 1 797 sounds.
 */
const LAG_SPAN = 64;
/**
 * How much better than lag 0 another lag may fit before it counts as a drift — gate 1.
 * Measured, the flattest sound in the set (`044/bar-x-tup`, a low thud) prefers lag -1 by
 * 0.18 dB; a real one-sample shift on speech costs ~10 dB (see the diagnostics in the
 * PR), so half a dB sits in a gap two orders of magnitude wide.
 */
const ALIGN_SLACK_DB = 0.5;

/** One sound package: its subtitle index, its 1998 bodies, and its staged bodies. */
export interface VoicePkg {
  /** As the original names its files: '025', 'x01', 'restored'. */
  readonly id: string;
  /** The `.fft` — the subtitle index. NEVER regenerated; see `src/audio/ffs2.ts`. */
  readonly fft: string;
  /** The committed 1998 `.ffs`. */
  readonly ffs: string;
  /** The staged `.ffs2` this tool writes. */
  readonly ffs2: string;
}

const SOUND_DIR = join('public', 'data', 'Sound');
const TITLE_DIR = join('public', 'data', 'Title');
const RESTORED_DIR = join('public', 'restored');

/**
 * Every package that gets staged, in a stable order.
 *
 * Derived from what is on disk rather than from a list in a file: the 72 room packages
 * plus x01/x02/x03 are exactly the `.ffs` files beside them, and a hand-kept list would
 * be one more thing to forget to grow. `x00` is filtered out by `isRawPkg`, so the rule
 * about which packages are speech lives in ONE place — beside the loader that has to
 * agree with it.
 *
 * Exported because `test/voiceStaging.test.ts` enumerates the same set.
 */
export function voicePackages(): VoicePkg[] {
  const ids = readdirSync(SOUND_DIR)
    .filter((f) => f.endsWith('.ffs'))
    .map((f) => f.slice(0, -4))
    .sort();
  const pkgs: VoicePkg[] = ids
    .filter((id) => !isRawPkg(id))
    .map((id) => ({
      id,
      fft: join(TITLE_DIR, `${id}.fft`),
      ffs: join(SOUND_DIR, `${id}.ffs`),
      ffs2: join(SOUND_DIR, `${id}.${FFS2_EXT}`),
    }));
  // The two lines the 1998 release referenced but shipped without (tools/build-restored-sounds.ts).
  // A package like any other, and it lives outside `public/data` because the committed
  // 1998 data stays byte-for-byte what ALTAR released.
  pkgs.push({
    id: 'restored',
    fft: join(RESTORED_DIR, 'restored.fft'),
    ffs: join(RESTORED_DIR, 'restored.ffs'),
    ffs2: join(RESTORED_DIR, `restored.${FFS2_EXT}`),
  });
  return pkgs;
}

/** The sounds of a package, in FFT record order — the order the index is written in. */
export function soundsOf(pkg: VoicePkg): { entries: FftEntry[]; ffs: Uint8Array } {
  const ffs = new Uint8Array(readFileSync(pkg.ffs));
  const entries = parseFft(new Uint8Array(readFileSync(pkg.fft))).filter((e) => e.delka > 0);
  return { entries, ffs };
}

/** Encode one sound's PCM to a self-contained AAC-in-MP4, and return its bytes. */
function encode(pcm: Int16Array, tmp: string): Uint8Array {
  const raw = join(tmp, 'in.raw');
  const out = join(tmp, `out.m4a`);
  writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2));
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 's16le', '-ar', String(FFS_SAMPLE_RATE), '-ac', '1', '-i', raw,
    '-c:a', 'aac',
    '-b:a', BITRATE,
    '-ac', '1',
    // Nothing of the source is wanted as metadata, and `+bitexact` keeps the muxer from
    // stamping its own version into every one of 1 820 segments — without it an ffmpeg
    // upgrade rewrites all 76 packages and `--check` fails for a reason that has nothing
    // to do with the audio.
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    '-flags:a', '+bitexact',
    // moov first. The game hands `decodeAudioData` a fully-downloaded slice so this
    // changes nothing for the player, but a segment whose index sits after its payload is
    // not independently decodable by anything that streams, and that is the one property
    // the container is built around.
    '-movflags', '+faststart',
    out,
  ]);
  const bytes = new Uint8Array(readFileSync(out));
  rmSync(out, { force: true });
  return bytes;
}

/** Decode one staged segment back to the original's format, for `--verify`. */
function decodeToPcm(body: Uint8Array, tmp: string): Int16Array {
  const src = join(tmp, 'seg.m4a');
  const raw = join(tmp, 'seg.raw');
  writeFileSync(src, body);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ar', String(FFS_SAMPLE_RATE), '-ac', '1', '-f', 's16le', raw]);
  const b = readFileSync(raw);
  const pcm = new Int16Array(b.length >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(i * 2);
  return pcm;
}

/**
 * The sample lag that best correlates `dec` with `orig`, searched over +/-`span`.
 *
 * Exported for the same reason `bestLag` in `stage-music.ts` is: this is the measurement
 * the whole index rests on, and it is worth being able to test on synthetic input rather
 * than only on 37 MB of real speech.
 */
export function bestLag(orig: Int16Array, dec: Int16Array, span = LAG_SPAN): number {
  // Skip the first samples — a line that fades in correlates with everything there and
  // would flatten the peak — and cap the window, because this runs 1 820 times.
  const from = Math.min(200, Math.max(0, orig.length - 1));
  const to = Math.min(from + 60_000, orig.length - span, dec.length - span);
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
  // Only over the original's own length: the AAC tail past it is encoder padding, and
  // scoring the padding against silence would drag every number down for no reason.
  const n = Math.min(dec.length, orig.length);
  for (let i = 0; i < n; i++) {
    const oi = i + lag;
    const o = oi >= 0 && oi < orig.length ? orig[oi]! : 0;
    const e = dec[i]! - o;
    se += e * e;
    so += o * o;
  }
  return 10 * Math.log10(so / Math.max(se, 1));
}

/**
 * Short-time RMS envelope over the first `n` samples — the shape of the sound, with its
 * waveform thrown away.
 *
 * Exported with `envSimilarity` because together they are gate 2, the one measurement here that
 * works on every kind of material the game holds. A perceptual coder is free to rebuild
 * broadband noise with different sample values; it is not free to move it, drop it, or
 * put a different sound there, and that is exactly what this sees.
 */
export function rmsEnvelope(x: Int16Array, n: number, frame = ENV_FRAME): Float64Array {
  const out = new Float64Array(Math.floor(n / frame));
  for (let f = 0; f < out.length; f++) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) {
      const v = i < x.length ? x[i]! : 0;
      s += v * v;
    }
    out[f] = Math.sqrt(s / frame);
  }
  return out;
}

/** Cosine similarity of two envelopes. 1 is identical shape.
 *
 * NOT Pearson: subtracting the mean throws away the level and measures only the ripple
 * around it, which is unstable for a sound whose envelope is nearly flat — `x03/ob-m-nedeje`
 * scores 0.963 by Pearson and 0.987 by this, at an SNR of 13 dB, i.e. the waveform matches
 * fine and only the metric wobbled. Envelopes are non-negative, so the angle between them
 * is a direct measure of shape and needs no centring.
 */
export function envSimilarity(a: Float64Array, b: Float64Array): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += a[i]! * b[i]!;
    da += a[i]! * a[i]!;
    db += b[i]! * b[i]!;
  }
  return num / Math.sqrt(Math.max(da * db, 1e-9));
}

/** Loudest sample of `x` from `from` on — how audible the tail a short decode dropped is. */
function peakFrom(x: Int16Array, from: number): number {
  let p = 0;
  for (let i = Math.max(0, from); i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
  return p;
}

const isCli = process.argv[1]?.endsWith('stage-voices.ts') === true;
if (isCli) main();

function main(): void {
  const check = process.argv.includes('--check');
  const verify = process.argv.includes('--verify');
  const onlyAt = process.argv.indexOf('--only');
  const only = onlyAt >= 0 ? new Set(process.argv[onlyAt + 1]?.split(',') ?? []) : null;
  const pkgs = voicePackages().filter((p) => !only || only.has(p.id));
  if (pkgs.length === 0) throw new Error('no packages selected');
  const tmp = mkdtempSync(join(tmpdir(), 'ff4e-voices-'));
  try {
    if (verify) return runVerify(pkgs, tmp);
    runStage(pkgs, tmp, check);
  } finally {
    // `process.exitCode` and `return` everywhere below, never `process.exit()`: exiting
    // skips this and leaves the temp dir behind on every run (stage-music paid for that).
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Encode every package, either into `public/` or into a temp dir to compare against. */
function runStage(pkgs: readonly VoicePkg[], tmp: string, check: boolean): void {
  let bad = 0;
  let inBytes = 0;
  let outBytes = 0;
  let sounds = 0;
  for (const pkg of pkgs) {
    if (!existsSync(pkg.ffs)) throw new Error(`missing original: ${pkg.ffs}`);
    const { entries, ffs } = soundsOf(pkg);
    const segments = entries.map((e) => ({ zvuk: e.zvuk, body: encode(decodeSound(ffs, e.zvuk, e.delka), tmp) }));
    const packed = buildFfs2(FFS_SAMPLE_RATE, segments);
    inBytes += ffs.length;
    outBytes += packed.length;
    sounds += segments.length;
    if (!check) {
      writeFileSync(pkg.ffs2, packed);
      continue;
    }
    if (!existsSync(pkg.ffs2)) {
      console.log(`  MISSING ${pkg.id}.${FFS2_EXT}`);
      bad++;
      continue;
    }
    const same = Buffer.compare(readFileSync(pkg.ffs2), Buffer.from(packed)) === 0;
    console.log(`  ${same ? 'ok     ' : 'DIFFERS'} ${pkg.id}.${FFS2_EXT}`);
    if (!same) bad++;
  }
  console.log(
    `${pkgs.length} packages, ${sounds} sounds: ${mb(inBytes)} MB of .ffs -> ${mb(outBytes)} MB (${(inBytes / outBytes).toFixed(1)}x) at ${BITRATE}`,
  );
  if (!check) {
    console.log(`wrote ${pkgs.length} packages`);
    return;
  }
  if (bad === 0) console.log(`all ${pkgs.length} packages match this tool`);
  else console.log(`${bad} package(s) differ — check your ffmpeg version before assuming the shipped bytes are wrong, then run --verify`);
  process.exitCode = bad === 0 ? 0 : 1;
}

/** Decode every shipped segment and measure it against its `Decompres` original. */
function runVerify(pkgs: readonly VoicePkg[], tmp: string): void {
  let bad = 0;
  let sounds = 0;
  let worstSnr = Infinity;
  let worstName = '';
  let worstShape = Infinity;
  let worstShapeName = '';
  let padMax = 0;
  for (const pkg of pkgs) {
    if (!existsSync(pkg.ffs2)) {
      console.log(`  MISSING ${pkg.id}.${FFS2_EXT} — run the tool without --verify first`);
      bad++;
      continue;
    }
    const { entries, ffs } = soundsOf(pkg);
    const staged = new Uint8Array(readFileSync(pkg.ffs2));
    const index = parseFfs2(staged);
    let pkgBad = 0;
    let pkgWorst = Infinity;
    let pkgShape = Infinity;
    // The index must describe the package's sounds and nothing else: a segment with no
    // FFT record is dead weight nothing can ever ask for, and a record with no segment is
    // a line that went silent. Both are staging bugs, and neither shows up per-sound.
    if (index.segments.size !== entries.length) {
      console.log(`  BAD     ${pkg.id}: ${index.segments.size} segments for ${entries.length} sounds`);
      pkgBad++;
    }
    if (index.rate !== FFS_SAMPLE_RATE) {
      console.log(`  BAD     ${pkg.id}: index says ${index.rate} Hz, delka counts in ${FFS_SAMPLE_RATE}`);
      pkgBad++;
    }
    for (const e of entries) {
      sounds++;
      const seg = index.segments.get(e.zvuk);
      if (!seg) {
        console.log(`  BAD     ${pkg.id}/${e.name}: no segment for zvuk=${e.zvuk}`);
        pkgBad++;
        continue;
      }
      const orig = decodeSound(ffs, e.zvuk, e.delka);
      const dec = decodeToPcm(staged.subarray(seg.offset, seg.offset + seg.length), tmp);
      const snr = snrDb(orig, dec, 0);

      // Gate 1: no shift fits better than none. A comparison, not an argmax — see the
      // header for the thud whose autocorrelation is flat enough to peak at lag -1.
      const lag = bestLag(orig, dec);
      const aligned = lag === 0 || snr >= snrDb(orig, dec, lag) - ALIGN_SLACK_DB;
      // Gate 2: the right sound, in the right place, whatever the coder did to the waveform.
      const shared = Math.min(orig.length, dec.length);
      const shape = envSimilarity(rmsEnvelope(orig, shared), rmsEnvelope(dec, shared));
      // Gate 3: nothing audible is missing from the end (the runtime trims to `delka`).
      const short = e.delka - dec.length;
      const lostPeak = short > 0 ? peakFrom(orig, dec.length) : 0;
      const longEnough = short <= 0 || (short < SHORT_BY_MAX && lostPeak <= SHORT_TAIL_PEAK);

      padMax = Math.max(padMax, dec.length - e.delka);
      if (snr < pkgWorst) {
        pkgWorst = snr;
        if (snr < worstSnr) {
          worstSnr = snr;
          worstName = `${pkg.id}/${e.name}`;
        }
      }
      pkgShape = Math.min(pkgShape, shape);
      if (shape < worstShape) {
        worstShape = shape;
        worstShapeName = `${pkg.id}/${e.name}`;
      }
      if (aligned && longEnough && shape >= ENV_SIM_FLOOR) continue;
      pkgBad++;
      console.log(
        `  BAD     ${pkg.id}/${e.name}: delka=${e.delka} dec=${dec.length}` +
          ` lag=${lag} shape=${shape.toFixed(4)} SNR=${snr.toFixed(1)} dB` +
          (short > 0 ? ` short by ${short} (dropped tail peaks at ${lostPeak})` : ''),
      );
    }
    bad += pkgBad;
    console.log(
      `  ${pkgBad === 0 ? 'ok     ' : 'BAD    '} ${pkg.id.padEnd(9)} ${String(entries.length).padStart(3)} sounds  weakest shape ${pkgShape.toFixed(4)}  lowest SNR ${pkgWorst.toFixed(1)} dB`,
    );
  }
  console.log(
    bad === 0
      ? `all ${sounds} sounds decode in alignment with their .ffs original — weakest shape ${worstShape.toFixed(4)} at ${worstShapeName} (floor ${ENV_SIM_FLOOR}), max padding ${padMax} samples.\n` +
        `SNR is a tripwire, not a transparency proof: the lowest is ${worstSnr.toFixed(1)} dB at ${worstName}, which is broadband noise and is fine — see the header.`
      : `${bad} problem(s) across ${sounds} sounds`,
  );
  process.exitCode = bad === 0 ? 0 : 1;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}
