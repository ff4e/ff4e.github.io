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
          if (n === CUT) rampFrom = clast;
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
  const checkOnly = process.argv.includes('--check');
  const fft = parseFft(new Uint8Array(readFileSync(fftPath)));
  const e = fft.find((x) => x.name === NAME);
  if (!e) throw new Error(`${NAME} is not in ${ROOM}.fft`);

  const ffs = new Uint8Array(readFileSync(ffsPath));
  const before = ffs.length;
  const changed = patch(ffs, e.zvuk, e.delka);
  if (ffs.length !== before) throw new Error('the package changed length — that must never happen');

  // Verify against the real decoder, not against the patcher's own bookkeeping.
  const pcm = decodeSound(ffs, e.zvuk, e.delka);
  const tail = pcm.subarray(CUT + RAMP);
  if (!tail.every((v) => v === 0)) throw new Error('the tail did not decode to silence');
  let peak = 0;
  for (let i = 1; i < CUT; i++) peak = Math.max(peak, Math.abs(pcm[i]! - pcm[i - 1]!));
  if (peak > 40000) throw new Error('the speech before the cut was disturbed');

  const sha = createHash('sha256').update(ffs).digest('hex');
  console.log(`${NAME}: ${e.delka} samples (${(e.delka / FFS_SAMPLE_RATE).toFixed(2)} s)`);
  console.log(`  silence from sample ${CUT + RAMP} (${((CUT + RAMP) / FFS_SAMPLE_RATE).toFixed(2)} s)`);
  console.log(`  ${ROOM}.ffs: ${ffs.length} bytes, sha256 ${sha}`);

  if (!changed) {
    console.log('  already patched — nothing to do');
    return;
  }
  if (checkOnly) {
    console.error('  NOT patched (run without --check)');
    process.exit(1);
  }
  writeFileSync(ffsPath, ffs);
  console.log('  patched');
}

main();
