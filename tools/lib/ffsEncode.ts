/**
 * FFS encoder — the inverse of `decodeSound` (src/audio/ffs.ts), used only at build
 * time by tools/build-restored-sounds.ts.
 *
 * Ported from ALTAR's own compressor, `PrZvuku/Uprevod.pas` `zpracuj_wave`
 * (`~/.cache/ffng-orig/delphi-src/Fillets/`). Note that the file to read is the one
 * under `PrZvuku/` — the `UPREVOD.PAS` beside it in the root is the unrelated image
 * packer. With its `ztrata=2` quality setting the two agree exactly: quantize to
 * multiples of 4 (:293), emit a delta byte while the second difference fits in
 * [-mindif, maxdif] = [-512, 511] (:299), cap a run at 127 (:302), otherwise emit a
 * 14-bit literal (:316).
 *
 * The codec (RSound.pas:258-333 `Decompres`) is a second-order delta PCM over 16-bit
 * wrapping arithmetic, with two token kinds:
 *
 *   literal  [0hhhhhhh][llllllll]   sample = ((hi<<8)|lo) << 2
 *   run      [1nnnnnnn][d]*n        cdif += d<<2 ; clast += cdif ; emit clast
 *
 * Both forms carry their payload pre-shifted by 2, so the format can only represent
 * samples that are multiples of 4 — it is a 14-bit codec. `quantize` applies that
 * once, up front, so the encoder's output round-trips through `decodeSound` EXACTLY
 * rather than approximately (test/restored-lines.test.ts).
 */

const toI16 = (v: number): number => (v << 16) >> 16;

/**
 * Drop the two bits the codec cannot carry — `hodn := hodn and andconst[ztrata]`,
 * i.e. `and $FFFC`, on a `smallint` (`PrZvuku/Uprevod.pas:21,293`). That is a
 * TRUNCATION toward negative infinity, not a round-to-nearest: masking is what the
 * original does, and it also needs no clamping, since the result of masking an int16
 * is always back in range (32767 -> 32764, -32768 -> -32768).
 */
export function quantize(pcm: Int16Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i]! & ~3;
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
  // Not merely a precondition: on an unquantized sample the literal branch stores
  // `t >> 2` but tracks `clast = t`, so encoder and decoder desynchronise and every
  // LATER sample decodes wrong. Fail loudly instead of emitting a plausible-looking
  // stream — a corrupt .ffs is not something a listener would localise to this line.
  for (let i = 0; i < pcm.length; i++) {
    if ((pcm[i]! & 3) !== 0) {
      throw new Error(`encodeSound: sample ${i} (${pcm[i]}) is not quantized; call quantize() first`);
    }
  }
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
