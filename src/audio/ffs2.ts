/**
 * FFS2 — the shipped form of a 1998 sound package: the same sounds, as AAC.
 *
 * ── What the 1998 `.ffs` is, and what it is not ───────────────────────────────
 * A `.ffs` is NOT raw PCM. Its bodies go through `Decompres` (RSound.pas:258-333, ported
 * in `ffs.ts`), the original's second-order delta codec, so the voices are the one part
 * of this game's audio that was never uncompressed. Measured across all 76 packages:
 * 1 818 sounds, 133.6 M samples = 101.0 minutes, which would be 254.8 MB of raw PCM and
 * ships as 183.9 MB — the delta codec already buys 1.39x.
 *
 * It is still 183.9 MB of a 621 MB site, and it is speech: the median line is 2.75 s and
 * only 3 % are under a second, which is exactly what a perceptual coder is good at. At
 * 48 kbps the same 1 818 sounds are ~36 MB.
 *
 * ── Why one file per package, and not one per line ────────────────────────────
 * A room speaks ~24 lines. Per-line files would be ~24 extra requests at every room
 * entry, for a game that today fetches its voices in ONE. So a `.ffs2` is a package, like
 * the `.ffs` it replaces: a header carrying the index, then the segment bodies.
 *
 * Each segment is a complete, independently decodable MP4 — `decodeAudioData` is handed a
 * slice of the package and needs no state from any other segment. That costs ~500 bytes
 * of container per sound (measured), i.e. ~0.9 MB over 1 818 sounds, and buys the one
 * property that matters: every browser can decode it. AAC-in-MP4 is the same call the
 * repo already made for the music (`tools/stage-music.ts`) and the intro movies, and for
 * the same reason — Safari's Web Audio still does not reliably decode Ogg Opus.
 *
 * ── Why the index keys on `zvuk` ──────────────────────────────────────────────
 * The `.fft` beside the package already carries, per sound: its name, its subtitles,
 * `zvuk` (byte offset into the `.ffs`) and `delka` (the DECOMPRESSED SAMPLE COUNT). Two
 * consequences, and they are why this format is as small as it is:
 *
 *   - `delka` is a sample count, not a byte length, so it stays true for encoded audio.
 *     `duration()` is `delka / 22050`, and `TALKING_MEZ_SEC` and the lip-sync run off
 *     that — none of it has to change, and none of it has to travel here.
 *   - `zvuk` is unique within a package (checked over all 77 packages, 1 820 sounds: no
 *     duplicates, no zero-`delka` entries), so it is already a per-sound key. Keying on
 *     it means the `.fft` is NOT regenerated — which matters, because the `.fft` is where
 *     the subtitles live.
 *
 * So the only thing that changes about a sound is WHERE ITS BYTES ARE, and the only thing
 * this header carries is that: `zvuk` -> (offset, length).
 *
 * ── Layout (all little-endian, the format the 1998 data is in) ────────────────
 *
 *   0   4  magic 'FFS2'
 *   4   2  version = 1
 *   6   2  reserved (0)
 *   8   4  segment count
 *   12  4  sample rate the `.fft`'s `delka` is counted in (22050) — see `rate` below
 *   16  count x 12: [u32 zvuk][u32 offset][u32 length]
 *   ..     the segment bodies, in index order
 *
 * The rate is stated rather than assumed because `delka` is meaningless without it and
 * the encoded segments no longer carry it anywhere the game reads. A package whose rate
 * is not `FFS_SAMPLE_RATE` would make every `duration()` wrong by that ratio, silently,
 * so the loader refuses it instead.
 */

/** The extension of a staged package. See `tools/stage-voices.ts`. */
export const FFS2_EXT = 'ffs2';

/** Bytes 'F','F','S','2'. */
const MAGIC = [0x46, 0x46, 0x53, 0x32] as const;
const VERSION = 1;
const HEADER = 16;
const ENTRY = 12;

/**
 * Packages that still ship as the 1998 `.ffs`.
 *
 * `x00` is the only package of EFFECTS rather than speech — the falling-steel clang, the
 * switch clicks, the short transients a perceptual coder smears worst — and it is 0.87 MB
 * of the 183.9 MB. Compressing it would buy ~0.7 MB and is the only real artefact risk in
 * the change, so it does not get compressed. `x01`/`x02`/`x03` are speech (the border
 * remarks, the death commentary, the idle chatter) and are staged like any room package.
 */
const RAW_PKGS: ReadonlySet<string> = new Set(['x00']);

/** Does this package still ship as the 1998 `.ffs`? See `RAW_PKGS`. */
export function isRawPkg(id: string): boolean {
  return RAW_PKGS.has(id);
}

/**
 * The URL a package's sound BODIES are fetched from — `.ffs2` for the staged ones,
 * `.ffs` for `x00`.
 *
 * One function rather than a `.ffs` template literal at each of the five call sites (room
 * entry, the ZAVER warm, the three boot globals, x01, the restored lines), which is what
 * this was — the music went through exactly the same tidy-up for exactly the same reason
 * (`musicUrl`), and a future change of container should have one place to edit.
 *
 * `dir` because the restored package does not live under `/data/Sound`.
 */
export function voiceUrl(id: string, dir = '/data/Sound'): string {
  return `${dir}/${id}.${isRawPkg(id) ? 'ffs' : FFS2_EXT}`;
}

/** One sound's encoded body inside a package. */
export interface Ffs2Segment {
  /** The `zvuk` of the FFT record this segment holds — the key, see the header. */
  readonly zvuk: number;
  /** Byte offset of the MP4 within the package. */
  readonly offset: number;
  readonly length: number;
}

export interface Ffs2Package {
  /** Sample rate the `.fft`'s `delka` counts in (22050). */
  readonly rate: number;
  /** Segments by `zvuk`, the FFT record's own offset. */
  readonly segments: ReadonlyMap<number, Ffs2Segment>;
}

/** Is this a staged package rather than a 1998 `.ffs`? (Cheap enough to just look.) */
export function isFfs2(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER && MAGIC.every((b, i) => bytes[i] === b);
}

/** Read a package's index. Throws on anything it does not recognise. */
export function parseFfs2(bytes: Uint8Array): Ffs2Package {
  if (!isFfs2(bytes)) throw new Error('not an FFS2 package');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint16(4, true);
  if (version !== VERSION) throw new Error(`FFS2 version ${version} is not supported`);
  const count = dv.getUint32(8, true);
  const rate = dv.getUint32(12, true);
  if (bytes.length < HEADER + count * ENTRY) throw new Error('FFS2 index is truncated');
  const segments = new Map<number, Ffs2Segment>();
  for (let i = 0; i < count; i++) {
    const base = HEADER + i * ENTRY;
    const zvuk = dv.getUint32(base, true);
    const offset = dv.getUint32(base + 4, true);
    const length = dv.getUint32(base + 8, true);
    // A segment that runs off the end would surface as a `decodeAudioData` failure deep
    // inside a room entry, which is a bad place to learn the package is malformed.
    if (offset + length > bytes.length) throw new Error(`FFS2 segment ${zvuk} runs past the end`);
    segments.set(zvuk, { zvuk, offset, length });
  }
  return { rate, segments };
}

/**
 * Assemble a package from its encoded segments. Used by `tools/stage-voices.ts`, and by
 * the tests that need a package without 36 MB of ffmpeg — the writer and the reader
 * belong together, so neither can drift from the layout the header documents.
 */
export function buildFfs2(rate: number, segments: ReadonlyArray<{ zvuk: number; body: Uint8Array }>): Uint8Array {
  const total = HEADER + segments.length * ENTRY + segments.reduce((a, s) => a + s.body.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint16(4, VERSION, true);
  dv.setUint32(8, segments.length, true);
  dv.setUint32(12, rate, true);
  let at = HEADER + segments.length * ENTRY;
  segments.forEach((s, i) => {
    const base = HEADER + i * ENTRY;
    dv.setUint32(base, s.zvuk, true);
    dv.setUint32(base + 4, at, true);
    dv.setUint32(base + 8, s.body.length, true);
    out.set(s.body, at);
    at += s.body.length;
  });
  return out;
}
