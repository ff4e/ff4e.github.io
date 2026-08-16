/**
 * Silence the runaway tail of KUFRIK's `help1` inside `public/data/Sound/002.ffs`.
 *
 *   npx tsx tools/fix-help1-buzz.ts            # patch in place (idempotent)
 *   npx tsx tools/fix-help1-buzz.ts --check    # report only, exit 1 if unpatched
 *
 * ## What is wrong
 *
 * `help1` — "Teď na nic nesahej, jen se dívej…", the first line of the automatic
 * demonstration — decodes to a full-scale ~370 Hz square wave for its last 0.47 s
 * (from sample 137191 of 147456). It is not a decoding bug: `src/audio/ffs.ts` is
 * byte-exact against ALTAR's `Decompres` assembler (RSound.pas:258-333), whose
 * accumulators are 16-bit and WRAP. On this one sample the encoded deltas hand the
 * first-order accumulator `cdif` a DC offset it never sheds, so `clast` ramps into the
 * rail and wraps every few samples until the sound ends. The 1998 release plays the
 * buzz too. Of the game's 1705 room voices this is the only one that never recovers;
 * seven others clip for 4-67 ms mid-speech and are left alone.
 *
 * ## Why the data is patched rather than the decoder
 *
 * A deliberate, single-purpose exception to the rule stated in `public/restored/README.md`.
 * That rule is still the right default — corrections belong outside `public/data/` so
 * that what is original stays auditable — but here the alternative was a runtime rule
 * that inspects every decoded sample in the game to catch one known-bad block, which is
 * a worse trade: broader blast radius, and it can only ever be as good as its heuristic.
 * `KNOWN_ISSUES.md` records the deviation, and the test below pins it.
 *
 * ## How the patch is made
 *
 * The absolute minimum edit. Only the **delta bytes inside help1's own compressed
 * block** are rewritten; every control byte keeps its value, so:
 *
 *   - the compressed body is **the same length**, so `002.fft` needs no change and
 *     every other sound in the package stays at its original offset, bit-identical;
 *   - `delka` is untouched, so `Audio.duration()` and therefore `dialogy`'s
 *     `voiceEndCount` are unchanged — the tail is silent, not absent, and the
 *     demonstration's pacing (help.cap is paced against these voice lengths) does not
 *     move by a tick.
 *
 * So that "the 1998 file plus exactly this edit" stays checkable without excavating git
 * history, both digests of `public/data/Sound/002.ffs` are recorded here:
 *
 *   as ALTAR shipped it  sha256 5569e059dcf71255dbdac12725e46edea1ea4f478133673e187f7e5ee86ad26b
 *   after this patch     sha256 0ff5d925a62ec4c14b6a1d32139afd8d60b7c56f0d47674671e6ea4c7de07716
 *
 * Running this tool on the first reproduces the second byte for byte.
 *
 * The rewritten deltas drive the decoder's own state to rest: a short cosine ramp takes
 * `clast` from wherever the speech left it down to zero, after which `cdif = 0` and
 * every remaining delta byte is zero — the codec's natural encoding of silence.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseFft } from '../src/data/fft.js';
import { decodeSound, FFS_SAMPLE_RATE } from '../src/audio/ffs.js';

const ROOM = '002';
const NAME = 'help1';
/** First sample of the runaway, measured: 6.224 s into a 6.687 s sound. */
const CUT = 137191;
/** 18 ms of cosine ramp into silence — long enough that every delta fits in a byte. */
const RAMP = 400;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fftPath = join(root, 'public', 'data', 'Title', `${ROOM}.fft`);
const ffsPath = join(root, 'public', 'data', 'Sound', `${ROOM}.ffs`);

const i16 = (v: number): number => (v << 16) >> 16;
const clampByte = (v: number): number => (v < -128 ? -128 : v > 127 ? 127 : v);

/**
 * Rewrite help1's delta bytes so the tail decodes to silence.
 *
 * Walks the compressed block exactly as `Decompres` does, tracking `cdif`/`clast`, and
 * from `CUT` on chooses each delta so the emitted sample tracks a target that ramps to
 * zero and stays there. Choosing the delta from the *current* state each step (rather
 * than precomputing a stream) means clamping to a signed byte cannot accumulate error:
 * whatever the previous sample actually became, the next one aims at the target again.
 */
function patch(ffs: Uint8Array, zvuk: number, delka: number): boolean {
  let pos = zvuk;
  let cdif = 0;
  let clast = 0;
  let n = 0;
  let changed = false;
  /** Sample value the tail should have: a cosine ramp to zero, then zero. */
  let rampFrom = 0;
  const target = (k: number): number => {
    if (k >= RAMP) return 0;
    return Math.round((rampFrom * (1 + Math.cos((Math.PI * k) / RAMP))) / 2);
  };

  while (n < delka) {
    const control = ffs[pos++]!;
    if (control & 0x80) {
      let run = control & 0x7f;
      while (run > 0 && n < delka) {
        if (n < CUT) {
          const d = (ffs[pos]! << 24) >> 24;
          cdif = i16(cdif + i16(d << 2));
          clast = i16(clast + cdif);
        } else {
          if (n === CUT) rampFrom = clast; // whatever the speech left; the ramp starts here
          // The delta that would put `clast` exactly on target next sample.
          const wantCdif = target(n - CUT) - clast;
          const d = clampByte(Math.round((wantCdif - cdif) / 4));
          if (ffs[pos] !== (d & 0xff)) changed = true;
          ffs[pos] = d & 0xff;
          cdif = i16(cdif + i16(d << 2));
          clast = i16(clast + cdif);
        }
        pos++;
        n++;
        run--;
      }
    } else {
      // A literal is two bytes: the control byte itself (high bit clear) is the high
      // half of the sample, and the byte after it is the low half.
      const lo = ffs[pos]!;
      if (n < CUT) {
        const sample = i16(((control << 8) | lo) << 2);
        cdif = i16(sample - clast);
        clast = sample;
      } else {
        // A literal in the tail: write sample 0 into both of its bytes, which lands
        // `clast` on zero exactly and leaves `cdif` at -clast, i.e. zero once settled.
        //
        // help1's tail contains no literal (its 44421 literals are all before CUT, and the
        // token spanning CUT is a run of 127 starting exactly there), so this branch does not
        // run on the shipped data. It is still written to be correct, because CUT is a
        // hand-measured constant: `rampFrom` is captured here too, or a literal landing on the
        // cut would leave it 0 and turn the ramp into a hard click; and this is the one place a
        // CONTROL byte is rewritten, which is why the "no control byte changes" claim is stated
        // for the shipped bytes rather than for the algorithm.
        if (n === CUT) rampFrom = clast;
        if (ffs[pos - 1] !== 0 || ffs[pos] !== 0) changed = true;
        ffs[pos - 1] = 0;
        ffs[pos] = 0;
        cdif = i16(0 - clast);
        clast = 0;
      }
      pos += 1;
      n++;
    }
  }
  return changed;
}

function main(): void {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length) {
    // Silently ignoring a mistyped flag would WRITE the file when the caller meant not to.
    console.error(`unknown argument(s): ${unknown.join(' ')} — the only flag is --check`);
    process.exit(2);
  }
  const checkOnly = args.includes('--check');
  const fft = parseFft(new Uint8Array(readFileSync(fftPath)));
  const e = fft.find((x) => x.name === NAME);
  if (!e) throw new Error(`${NAME} is not in ${ROOM}.fft`);

  const onDisk = new Uint8Array(readFileSync(ffsPath));
  const onDiskSha = createHash('sha256').update(onDisk).digest('hex');
  const ffs = Uint8Array.from(onDisk);
  const changed = patch(ffs, e.zvuk, e.delka);

  // Verify against the real decoder, not against the patcher's own bookkeeping.
  const pcm = decodeSound(ffs, e.zvuk, e.delka);
  const tail = pcm.subarray(CUT + RAMP);
  if (!tail.every((v) => v === 0)) throw new Error('the tail did not decode to silence');
  let peak = 0;
  for (let i = 1; i < CUT; i++) peak = Math.max(peak, Math.abs(pcm[i]! - pcm[i - 1]!));
  if (peak > 40000) throw new Error('the speech before the cut was disturbed');

  console.log(`${NAME}: ${e.delka} samples (${(e.delka / FFS_SAMPLE_RATE).toFixed(2)} s)`);
  console.log(`  silence from sample ${CUT + RAMP} (${((CUT + RAMP) / FFS_SAMPLE_RATE).toFixed(2)} s)`);
  // Always the digest of what is ON DISK, so `--check` on an unpatched file cannot print a
  // hash the file does not have.
  console.log(`  ${ROOM}.ffs on disk: ${onDisk.length} bytes, sha256 ${onDiskSha}`);

  if (!changed) {
    console.log('  already patched — nothing to do');
    return;
  }
  if (checkOnly) {
    console.error('  NOT patched (run without --check)');
    process.exit(1);
  }
  writeFileSync(ffsPath, ffs);
  console.log(`  patched — sha256 ${createHash('sha256').update(ffs).digest('hex')}`);
}

main();
