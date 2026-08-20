/**
 * The staged voice packages, checked against the 1998 data they were made from.
 *
 * `tools/stage-voices.ts --verify` is the strong check — it decodes all 1 820 sounds and
 * measures each against its `Decompres` original — but it costs an ffmpeg process per
 * sound and takes minutes. This is the cheap one that runs in the unit suite on every
 * change, and it guards the part that is structural rather than acoustic: does every
 * sound the `.fft` promises still have somewhere to come from?
 *
 * The oracle is the COMMITTED 1998 data (`public/data/Title/*.fft`), not anything the
 * staging tool produced, so a bug in the tool cannot make this pass. That distinction is
 * the whole point: a test that reads its expectation from the code under test proves
 * nothing.
 *
 * What each assertion is actually guarding:
 *
 *   - **a `.ffs2` exists per package** — the room entry fetches it as `mustHave`, so a
 *     package that was never staged is a 404 that ends the session, and one the room-entry
 *     probes would only catch for the rooms they happen to visit.
 *   - **one segment per FFT record, keyed by `zvuk`** — that key is the whole index (see
 *     `src/audio/ffs2.ts`). A record with no segment is a line that went silent; a segment
 *     with no record is dead weight nothing can ask for. Neither is visible in play.
 *   - **the index's rate is `FFS_SAMPLE_RATE`** — `delka` is a SAMPLE count and the engine
 *     divides by this rate for `duration()`, `TALKING_MEZ_SEC` and the lip-sync. A wrong
 *     rate does not throw; it makes every mouth and every dialogue advance wrong by that
 *     ratio.
 *   - **each body is an MP4** — a truncated or half-written stage would otherwise surface
 *     as a `decodeAudioData` failure inside a room entry.
 *   - **the payload is exactly covered** — segments in order, no gaps, no overlaps, ending
 *     at the last byte. Gaps are bytes the player downloads and never hears.
 *   - **`x00` is NOT staged** — it is the effects package and the one deliberate exception
 *     (see `isRawPkg`); a future run of the tool that quietly swept it in would compress
 *     the short transients the exception exists to protect.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFfs2, FFS2_EXT, isFfs2, isRawPkg, parseFfs2, voiceUrl } from '../src/audio/ffs2.js';
import { FFS_SAMPLE_RATE } from '../src/audio/ffs.js';
import { parseFft, type FftSubtitle } from '../src/data/fft.js';
import { decodeFfs2 } from '../src/audio/ffs2Decode.js';
import { soundsOf, voicePackages } from '../tools/stage-voices.js';

/** A record with no subtitle, for the synthetic entries below. */
const EMPTY_SUB: FftSubtitle = { color: '', text: '', raw: '' };

/** 'ftyp' at offset 4 — every MP4 opens with the file-type box. */
function isMp4(bytes: Uint8Array): boolean {
  return bytes.length > 8 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp';
}

describe('the staged voice packages vs the 1998 originals', () => {
  const pkgs = voicePackages();

  it('stages the 72 room packages, x01/x02/x03 and the restored lines — 76 in all', () => {
    // An empty list would pass every test below, and the list is derived from a directory
    // listing, so it is worth stating the number the rest of this file is about.
    expect(pkgs.length).toBe(76);
    expect(pkgs.some((p) => p.id === 'restored')).toBe(true);
  });

  it('leaves x00 — the effects — as the 1998 .ffs, and asks for it by that name', () => {
    expect(isRawPkg('x00')).toBe(true);
    expect(pkgs.some((p) => p.id === 'x00')).toBe(false);
    expect(existsSync(join('public', 'data', 'Sound', 'x00.ffs'))).toBe(true);
    expect(existsSync(join('public', 'data', 'Sound', `x00.${FFS2_EXT}`))).toBe(false);
    expect(voiceUrl('x00')).toBe('/data/Sound/x00.ffs');
    expect(voiceUrl('025')).toBe(`/data/Sound/025.${FFS2_EXT}`);
    expect(voiceUrl('restored', '/restored')).toBe(`/restored/restored.${FFS2_EXT}`);
  });

  it('round-trips an index through build and parse', () => {
    // Synthetic, so the layout is checked without 37 MB of real audio in the way — and
    // the writer used here is the one the staging tool uses.
    const built = buildFfs2(FFS_SAMPLE_RATE, [
      { zvuk: 0, body: new Uint8Array([1, 2, 3]) },
      { zvuk: 9999, body: new Uint8Array([4, 5]) },
    ]);
    expect(isFfs2(built)).toBe(true);
    const idx = parseFfs2(built);
    expect(idx.rate).toBe(FFS_SAMPLE_RATE);
    expect([...idx.segments.keys()]).toEqual([0, 9999]);
    const second = idx.segments.get(9999)!;
    expect([...built.subarray(second.offset, second.offset + second.length)]).toEqual([4, 5]);
  });

  it('refuses a package whose index does not cover its .fft', async () => {
    // The runtime's one fail-open risk, closed. A record with no segment used to be
    // skipped silently, and everything that reports whether a sound EXISTS reads the
    // `.fft` — `has()`, `hasPackaged()`, `entry()`, `duration()` — so the line would have
    // played as silence with its subtitle showing and the dialogue advancing over it.
    // Throwing puts it on the room-entry failure path, where every other missing asset is.
    const entry = { name: 'ghost', cz: EMPTY_SUB, en: EMPTY_SUB, zvuk: 1234, kompr: 0, delka: 22050 };
    const empty = buildFfs2(FFS_SAMPLE_RATE, []);
    // No `decodeAudioData` is reached, so the context is never touched.
    const ctx = {} as unknown as BaseAudioContext;
    await expect(decodeFfs2(ctx, new Map([[entry.name, entry]]), empty)).rejects.toThrow(/no segment for ghost/);
  });

  it('skips a record with no samples rather than refusing the package', async () => {
    // The other half of the same branch: `delka <= 0` is legitimate (`hasPackaged` already
    // requires `delka > 0`), so it must NOT be treated as a malformed package.
    const entry = { name: 'silent', cz: EMPTY_SUB, en: EMPTY_SUB, zvuk: 7, kompr: 0, delka: 0 };
    const ctx = {} as unknown as BaseAudioContext;
    const out = await decodeFfs2(ctx, new Map([[entry.name, entry]]), buildFfs2(FFS_SAMPLE_RATE, []));
    expect(out.size).toBe(0);
  });

  for (const pkg of pkgs) {
    it(`${pkg.id}: every sound in the .fft has a segment, and nothing else is in there`, () => {
      expect(existsSync(pkg.ffs2)).toBe(true);
      const staged = new Uint8Array(readFileSync(pkg.ffs2));
      const index = parseFfs2(staged);
      expect(index.rate).toBe(FFS_SAMPLE_RATE);

      // The oracle: the committed .fft, read independently of anything the tool wrote.
      const entries = parseFft(new Uint8Array(readFileSync(pkg.fft))).filter((e) => e.delka > 0);
      expect(entries.length).toBeGreaterThan(0);
      expect(index.segments.size).toBe(entries.length);
      for (const e of entries) {
        const seg = index.segments.get(e.zvuk);
        expect(seg, `${e.name} (zvuk=${e.zvuk}) has no segment`).toBeDefined();
        expect(isMp4(staged.subarray(seg!.offset, seg!.offset + seg!.length))).toBe(true);
      }

      // Contiguous and complete: the bodies start where the index ends and run to the
      // last byte of the file, in index order.
      const segs = [...index.segments.values()].sort((a, b) => a.offset - b.offset);
      const first = segs[0]!;
      expect(first.offset).toBe(16 + segs.length * 12);
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i]!.offset).toBe(segs[i - 1]!.offset + segs[i - 1]!.length);
      }
      const last = segs[segs.length - 1]!;
      expect(last.offset + last.length).toBe(staged.length);
    });

    it(`${pkg.id}: is smaller than the .ffs it replaces`, () => {
      // Not a compression-ratio bar — the point of the change is that the site shrinks,
      // and a package that came out LARGER would mean the encode silently fell back to
      // something (a raw copy, a wrong sample rate) that this file's other assertions
      // would happily accept.
      const { entries } = soundsOf(pkg);
      expect(entries.length).toBeGreaterThan(0);
      expect(readFileSync(pkg.ffs2).length).toBeLessThan(readFileSync(pkg.ffs).length);
    });
  }
});
