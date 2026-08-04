/**
 * FFS encoder — the inverse of `decodeSound` (src/audio/ffs.ts), used only at build
 * time by tools/build-restored-sounds.ts.
 *
 * The codec (RSound.pas:258-333 `Decompres`) is a second-order delta PCM over 16-bit
 * wrapping arithmetic, with two token kinds:
 *
 *   literal  [0hhhhhhh][llllllll]   sample = ((hi<<8)|lo) << 2
 *   run      [1nnnnnnn][d]*n        cdif += d<<2 ; clast += cdif ; emit clast
 *
 * Both forms carry their payload pre-shifted by 2, so the format can only represent
 * samples that are multiples of 4 — it is a 14-bit codec. `quantize` does that
 * rounding once, up front, so the encoder's output round-trips through `decodeSound`
 * EXACTLY (tested in test/ffsCodec.test.ts) rather than approximately.
 */

const toI16 = (v: number): number => (v << 16) >> 16;

/** Round PCM to the multiples of 4 the codec can represent. The negative rail
 *  -32768 IS representable (a literal payload of 0x6000 wraps to it); the positive
 *  one is not, so the ceiling is 32764. */
export function quantize(pcm: Int16Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const q = Math.round(pcm[i]! / 4) * 4;
    out[i] = q > 32764 ? 32764 : q < -32768 ? -32768 : q;
  }
  return out;
}

/** The longest run a control byte can express (`control & 0x7F`). */
const MAX_RUN = 0x7f;

/**
 * Encode already-quantized PCM. Greedy: extend the current delta run whenever the
 * needed second difference fits in a signed byte, otherwise close the run and emit a
 * literal. That is what the original encoder (UPREVOD.PAS) does and it is what makes
 * a literal appear at every sharp transient.
 */
export function encodeSound(pcm: Int16Array): Uint8Array {
  const out: number[] = [];
  let cdif = 0;
  let clast = 0;
  let runAt = -1; // index in `out` of the open run's control byte, or -1

  for (let i = 0; i < pcm.length; i++) {
    const t = pcm[i]!;
    const need = toI16(t - clast - cdif); // must equal d<<2
    const d = need / 4;
    const canRun =
      Number.isInteger(d) && d >= -128 && d <= 127 && runAt >= 0 && (out[runAt]! & 0x7f) < MAX_RUN;

    if (canRun) {
      out.push(d & 0xff);
      out[runAt] = out[runAt]! + 1;
      cdif = toI16(cdif + toI16(d * 4));
      clast = toI16(clast + cdif);
      continue;
    }
    if (Number.isInteger(d) && d >= -128 && d <= 127) {
      // A run is possible but none is open (or the open one is full): start one.
      runAt = out.length;
      out.push(0x80 | 1);
      out.push(d & 0xff);
      cdif = toI16(cdif + toI16(d * 4));
      clast = toI16(clast + cdif);
      continue;
    }
    // Literal. `u` is the 15-bit payload whose <<2 wraps to t.
    const u = ((t & 0xffff) >> 2) & 0x7fff;
    out.push((u >> 8) & 0x7f, u & 0xff);
    cdif = toI16(t - clast);
    clast = t;
    runAt = -1;
  }
  return Uint8Array.from(out);
}
