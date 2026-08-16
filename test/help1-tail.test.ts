/**
 * KUFRIK `help1`: the one sound in `public/data/` that is not the 1998 bytes.
 *
 * Its last 0.47 s decoded to a full-scale ~370 Hz square wave. That is not a decoding
 * bug — `src/audio/ffs.ts` is byte-exact against ALTAR's `Decompres` assembler
 * (RSound.pas:258-333), whose accumulators are 16-bit and wrap, and the encoded deltas
 * hand `cdif` a DC offset it never sheds. The 1998 release plays the buzz too. The
 * package was patched instead of the decoder (`tools/fix-help1-buzz.ts`), so this file
 * is what stops that patch from silently rotting or spreading.
 *
 * Three properties matter, and each is asserted below:
 *   - the tail is silent, and the speech in front of it still plays;
 *   - the sound keeps its LENGTH — `Audio.duration()` reads `delka`, so `dialogy`'s
 *     `voiceEndCount` is unchanged and the demonstration's pacing does not move;
 *   - nothing else in the package moved. The patch rewrites bytes inside help1's own
 *     compressed block only, so every other sound is still at its 1998 offset.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseFft } from '../src/data/fft.js';
import { decodeSound, FFS_SAMPLE_RATE } from '../src/audio/ffs.js';

const dataDir = join(__dirname, '..', 'public', 'data');
const ffs = new Uint8Array(readFileSync(join(dataDir, 'Sound', '002.ffs')));
const fft = parseFft(new Uint8Array(readFileSync(join(dataDir, 'Title', '002.fft'))));
const help1 = fft.find((e) => e.name === 'help1')!;
const pcm = decodeSound(ffs, help1.zvuk, help1.delka);

/** A one-sample step no 22 kHz speech can take: 61% of the full 16-bit range. */
const WRAP = 40000;

describe('KUFRIK help1 (patched package)', () => {
  it('keeps its full length, so the demonstration is paced as before', () => {
    // 6.687 s. help.cap is a recorded input stream paced against these voice lengths:
    // shorten one line and every line after it moves.
    expect(help1.delka).toBe(147456);
    expect(pcm.length).toBe(147456);
  });

  it('no longer wraps anywhere', () => {
    let wraps = 0;
    for (let i = 1; i < pcm.length; i++) {
      if (Math.abs(pcm[i]! - pcm[i - 1]!) > WRAP) wraps++;
    }
    expect(wraps).toBe(0);
  });

  it('is silent from 6.25s, and still speaking before 6.2s', () => {
    const silentFrom = Math.round(6.25 * FFS_SAMPLE_RATE);
    expect(pcm.subarray(silentFrom).every((v) => v === 0)).toBe(true);
    // The line itself is untouched: real speech right up to the runaway at 6.222 s.
    const speech = pcm.subarray(Math.round(6.0 * FFS_SAMPLE_RATE), Math.round(6.2 * FFS_SAMPLE_RATE));
    expect(speech.some((v) => Math.abs(v) > 500)).toBe(true);
  });

  it('fades rather than cutting, so removing the buzz does not add a click', () => {
    // The ramp runs from 6.222 s to ~6.24 s; the last audible sample is small.
    const last = pcm.findLastIndex((v) => v !== 0);
    expect(last / FFS_SAMPLE_RATE).toBeGreaterThan(6.22);
    expect(last / FFS_SAMPLE_RATE).toBeLessThan(6.25);
    expect(Math.abs(pcm[last]!)).toBeLessThan(600);
  });

  it('left every other sound in the package alone', () => {
    // The patch is confined to help1's compressed block, so the package is the same
    // length and every other entry decodes from its original offset. A regression that
    // re-encoded the package would move these and fail here.
    expect(ffs.length).toBe(9370022);
    const others = fft.filter((e) => e.delka > 0 && e.name !== 'help1');
    expect(others.length).toBe(48);
    for (const e of others) {
      const s = decodeSound(ffs, e.zvuk, e.delka);
      expect(s.length, e.name).toBe(e.delka);
      // Every 1998 sample ends on a sane value; a shifted offset decodes to noise.
      let wraps = 0;
      for (let i = 1; i < s.length; i++) if (Math.abs(s[i]! - s[i - 1]!) > WRAP) wraps++;
      expect(wraps, e.name).toBeLessThan(40);
    }
  });

  it('pins the patched package, so a rebuild that drifts is a failure', () => {
    // Regenerate with `npx tsx tools/fix-help1-buzz.ts` (idempotent; --check reports).
    expect(createHash('sha256').update(ffs).digest('hex')).toBe(
      '0ff5d925a62ec4c14b6a1d32139afd8d60b7c56f0d47674671e6ea4c7de07716',
    );
  });
});
