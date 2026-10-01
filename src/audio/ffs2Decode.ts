/**
 * Decoding a staged `.ffs2` package into playable buffers.
 *
 * ── Why all of it, up front ───────────────────────────────────────────────────
 * `decodeAudioData` is ASYNCHRONOUS and a voice start is SYNCHRONOUS. The original's
 * `Sound()` claims its mixer channel and returns (RSound.pas:674), and the NEXT tick
 * reads `playing(prior)` / `talking(prior)` back — lip-sync (`updateLipSync`) and the
 * dialogue advance both run off `talking()`. Putting an `await` inside a voice start
 * would expose all 72 room scripts to the bug class the `reserve()` machinery in
 * `audio.ts` already exists for: KORALY reads `playing(10)` 160 ms after cueing
 * (koraly.ts:408 = URoom.pas:15576), and losing that race leaves the octopus frozen at
 * the end of its animation while the sound plays over a still puppet.
 *
 * Decoding is not the expensive part — measured in-browser on a 2.51 s dialogue line,
 * `decodeAudioData` of the AAC takes 3-8 ms against 0.2-0.9 ms for the slice-and-copy the
 * 1998 `.ffs` path does. It is the ASYNCHRONY that cannot be had at play time, so it is
 * paid where the package is installed — a room entry that already waits for the download.
 *
 * ── What it costs, at the peak rather than the median ─────────────────────────
 * A decoded buffer is float32 at the CONTEXT's rate (44100 or 48000, it varies by
 * machine), where the `.ffs` path builds int16-derived buffers at 22050. So the memory is
 * ~4x the samples — the identical audio in the old form is ~25 MiB, not ~100 — and the
 * honest numbers are the worst ones, not the typical. Measured from the committed `.fft`
 * `delka` sums at 48 kHz:
 *
 *   - a ROOM holds its whole package while it is open: **12.4 MiB** for the median room,
 *     but **52.4 MiB** for KUFRIK (49 sounds, 286 s), then 46.7 / 44.2 / 36.8 for
 *     019 / 017 / 021. This does not accumulate — the buffers live on the package, and
 *     `installRoom`/`clearRoom` drop the room's.
 *   - the GLOBAL packages never come back, and this is the part that is genuinely new:
 *
 *         x03  fish chatter (ob-*)        27.9 MiB   from boot
 *         x02  death commentary (smrt-*)  16.6 MiB   from boot
 *         restored (2 lines)               1.0 MiB   from boot
 *         x01  leg-final remarks (cil-*)   4.1 MiB   from the first depth-15 room
 *
 *     45.4 MiB once boot finishes, 49.5 MiB after a leg-final room, and never less again:
 *     `AudioEngine.globals` is only ever pushed to and has no removal path. Before this
 *     change they decoded lazily into a shared cache that `setRoom` CLEARED on every room
 *     change, so steady state was near zero and a line was re-decoded (~1 ms, from the
 *     delta codec, synchronously) the next time it played.
 *
 * Peak decoded speech is therefore **~102 MiB**, in KUFRIK, against a few MB transient
 * before — a 10x change in steady-state audio residency.
 *
 * ── The lever that was NOT pulled ─────────────────────────────────────────────
 * That cheap re-decode is exactly what AAC took away: `decodeAudioData` is async, so it
 * cannot happen at play time, so the buffers have to be kept. The 4x, though, is format
 * and not content — decoding the GLOBALS on a context pinned to 22050 Hz would take 49.5
 * to ~25 MiB and the peak to ~75, without touching the room path or the synchronous-start
 * guarantee.
 *
 * It is deliberately not done here. It buys memory nobody has reported wanting, at the
 * cost of a second AudioContext at a non-native rate and of trusting `decodeAudioData`'s
 * resampling — one more browser behaviour to verify, on the one path in this game that
 * has no fallback. The measurement above is written down so the trade can be re-opened
 * with numbers rather than re-derived; `tools/test-voices.mjs` is where it would be
 * proved.
 */
import { FFS_SAMPLE_RATE } from './ffs.js';
import { parseFfs2 } from './ffs2.js';
import type { FftEntry } from '../data/fft.js';

/**
 * A copy of `buf` holding exactly the audio of `samples` samples at `FFS_SAMPLE_RATE`.
 *
 * AAC codes in 1024-sample frames, so a decode runs up to 1023 samples long and that tail
 * is encoder padding, not speech (`tools/stage-voices.ts --verify` measures it).
 * `startTracked` writes `activeUntil` from `buf.duration`, so an untrimmed buffer would
 * hold `playing(prior)` true for up to two extra logic ticks on EVERY line. `delka` is the
 * length the 1998 data agrees on and what `duration()` already reports, so the buffer is
 * cut to exactly that. The music path made the same call for the same reason (`playMusic`
 * takes `loopEnd` from the table's `frames`, not from `buf.duration`).
 *
 * Measured, this is a no-op in Chromium: it honours the MP4 edit list and hands back
 * EXACTLY `delka` samples at lag 0 (`tools/test-voices.mjs` asserts both, in the browser,
 * against an independent port of `Decompres`). ffmpeg's decoder pads. So this is here for
 * the decoders that are not Chromium rather than for the one that is — which is the whole
 * reason the probe measures it rather than trusting it.
 *
 * The count is in the 1998 data's rate, the buffer is at the context's, hence the ratio.
 * The `Math.min` is not decoration: exactly one of the 1 797 shipped sounds decodes SHORT
 * through ffmpeg (`011/deu-m-bojovat`, by 10 samples of -51 dBFS silence, which `--verify`
 * gate 3 allows on purpose). Without the clamp that would be a read past the end; with it,
 * the buffer is simply as long as the decode really was.
 */
export function trimToSamples(ctx: BaseAudioContext, buf: AudioBuffer, samples: number): AudioBuffer {
  const want = Math.min(buf.length, Math.round((samples * ctx.sampleRate) / FFS_SAMPLE_RATE));
  if (want === buf.length) return buf;
  const out = ctx.createBuffer(1, Math.max(1, want), ctx.sampleRate);
  out.copyToChannel(buf.getChannelData(0).subarray(0, want), 0);
  return out;
}

/**
 * How many `decodeAudioData` calls `decodeFfs2` lets run at once.
 *
 * Found on an Xbox Series X: x03 (55 segments) decoded ENTIRELY in parallel threw
 * `EncodingError: Unable to decode audio data` on a segment that ffprobe reports as a
 * completely ordinary AAC-LC/22050 Hz MP4 (probe_score 100) — so the file is not the
 * problem. Console hardware media pipelines cap how many decoder sessions can be open at
 * once, far below a package's segment count or a room's ~24, and WebView2 reports hitting
 * that cap as the same generic error a corrupt file would give. A bound this small is
 * still plenty of parallelism over the 3-8 ms a decode actually costs (see the module
 * comment), and costs nothing measurable on a desktop/mobile browser, which has no such
 * cap to hit.
 */
const MAX_CONCURRENT_DECODES = 6;

/** Run `fn` over `items`, at most `limit` in flight at once. */
async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Decode every segment of a staged package, keyed by the sound name that asks for it. */
export async function decodeFfs2(
  ctx: BaseAudioContext,
  entries: ReadonlyMap<string, FftEntry>,
  body: Uint8Array,
): Promise<Map<string, AudioBuffer>> {
  const index = parseFfs2(body);
  // `delka` is a sample count and means nothing without the rate it counts in, so the
  // package states it and this refuses a mismatch rather than making every duration(),
  // every lip-sync and every TALKING_MEZ_SEC wrong by that ratio, silently.
  if (index.rate !== FFS_SAMPLE_RATE) throw new Error(`sound package is ${index.rate} Hz, expected ${FFS_SAMPLE_RATE}`);
  const out = new Map<string, AudioBuffer>();
  // In parallel, up to MAX_CONCURRENT_DECODES at once: each `decodeAudioData` is native
  // and off the main thread, and a room holds ~24 of them. Fully serial would be ~24
  // round trips through the event loop for no gain, inside a room entry the player is
  // waiting on — but fully unbounded can ask a console for more decoder sessions than it
  // has (see MAX_CONCURRENT_DECODES).
  await mapLimit([...entries.values()], MAX_CONCURRENT_DECODES, async (e) => {
    // An empty record is legitimate; a record with no segment is not. The two used to
    // share one `return`, which fails OPEN in the worst way this codebase knows: `has()`,
    // `hasPackaged()`, `entry()` and `duration()` all read `entries`, so the sound still
    // reports as present and the right length, and only `buffer()` comes back null — the
    // line plays silently, the subtitle shows, and the dialogue advances over it. That is
    // "a room played through mute with nothing said", which the asset tiers exist to make
    // impossible. `parseFfs2` throws on every other structural disagreement; so does this.
    if (e.delka <= 0) return;
    const seg = index.segments.get(e.zvuk);
    if (!seg) throw new Error(`sound package has no segment for ${e.name} (zvuk=${e.zvuk})`);
    // `slice`, not `subarray`: `decodeAudioData` DETACHES the ArrayBuffer it is given
    // (even on failure), which for a view onto the package would take every other
    // segment with it — and is also why a retry below needs a fresh slice, not the one
    // already handed to the failed call.
    const slice = (): ArrayBuffer =>
      body.buffer.slice(body.byteOffset + seg.offset, body.byteOffset + seg.offset + seg.length) as ArrayBuffer;
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(slice());
    } catch (err) {
      // Found on an Xbox Series X: the very FIRST `decodeAudioData` call of a session —
      // immediately after `ensureCtx()` creates the AudioContext — threw this on a
      // segment ffprobe reports as a completely ordinary AAC-LC/22050 Hz MP4
      // (probe_score 100), while every later call on the same console, same package,
      // same build succeeded. That is a cold decoder racing its own session setup, not a
      // bad file or too much concurrency — so one retry, which gives the underlying
      // media pipeline the extra tick it needed, is the fix rather than a guess.
      try {
        decoded = await ctx.decodeAudioData(slice());
      } catch {
        // Bare, this throws `EncodingError: Unable to decode audio data` with no way to
        // tell which of a package's ~dozens of segments it was — exactly the failure
        // mode `decodeAsset` (src/render/assetFetch.ts) exists to prevent for images.
        // Name it the same way.
        throw new Error(`segment ${e.name} (zvuk=${e.zvuk}, ${seg.length}B) failed to decode: ${String(err)}`);
      }
    }
    out.set(e.name, trimToSamples(ctx, decoded, e.delka));
  });
  return out;
}
