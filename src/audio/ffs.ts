/**
 * FFS (per-room sounds) decoder.
 *
 * The FFS is a blob of compressed 16-bit-mono @ 22050 Hz samples; each sound is
 * addressed by the matching FFT record's `zvuk` (byte offset) and `delka`
 * (decompressed sample count). This is a faithful port of the `Decompres`
 * assembler codec (RSound.pas:258-333) — a second-order delta PCM:
 *
 *   read a control byte:
 *     high bit set  -> a run of (control & 0x7F) signed delta bytes; for each,
 *                      cdif += delta<<2; clast += cdif; emit clast
 *     high bit clear-> a 16-bit literal: sample = ((control<<8) | nextByte) << 2;
 *                      cdif = sample - clast; clast = sample; emit sample
 *
 * All arithmetic is 16-bit wrapping signed, exactly as the original DX/CX/AX.
 */

const toI16 = (v: number): number => (v << 16) >> 16;

/** Decode `sampleCount` samples starting at byte offset `zvuk` in the FFS. */
export function decodeSound(ffs: Uint8Array, zvuk: number, sampleCount: number): Int16Array {
  const out = new Int16Array(sampleCount);
  let pos = zvuk;
  let cdif = 0; // DX — first-order accumulator (velocity)
  let clast = 0; // CX — last emitted sample (position)
  let n = 0;

  while (n < sampleCount) {
    const control = ffs[pos++]!;
    if (control & 0x80) {
      // Delta run: (control & 0x7F) samples.
      let run = control & 0x7f;
      while (run > 0 && n < sampleCount) {
        const delta = (ffs[pos++]! << 24) >> 24; // signed byte
        cdif = toI16(cdif + toI16(delta << 2));
        clast = toI16(clast + cdif);
        out[n++] = clast;
        run--;
      }
    } else {
      // Literal 16-bit sample.
      const lo = ffs[pos++]!;
      const sample = toI16(((control << 8) | lo) << 2);
      out[n++] = sample;
      cdif = toI16(sample - clast);
      clast = sample;
    }
  }
  return out;
}

/** Sample rate of all FFS audio (RSound.pas). */
export const FFS_SAMPLE_RATE = 22050;
