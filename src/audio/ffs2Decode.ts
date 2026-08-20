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
 * ── What it costs ─────────────────────────────────────────────────────────────
 * A decoded buffer is float32 at the CONTEXT's rate (44100 or 48000, it varies by
 * machine), where the `.ffs` path builds int16-derived buffers at 22050. So a room holds
 * ~13 MB of decoded speech while it is open, against ~7 MB if every line in it had been
 * played on the old path. It does not accumulate: the buffers live on the package, and
 * `setRoom` / `clearRoom` drop the room's package.
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
 * A decode is never SHORTER than its `delka` — `--verify` asserts that over all 1 797
 * sounds, because trimming a short decode would splice silence into the end of a spoken
 * line — but this clamps anyway rather than reading past the end.
 */
export function trimToSamples(ctx: BaseAudioContext, buf: AudioBuffer, samples: number): AudioBuffer {
  const want = Math.min(buf.length, Math.round((samples * ctx.sampleRate) / FFS_SAMPLE_RATE));
  if (want === buf.length) return buf;
  const out = ctx.createBuffer(1, Math.max(1, want), ctx.sampleRate);
  out.copyToChannel(buf.getChannelData(0).subarray(0, want), 0);
  return out;
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
  // In parallel: each `decodeAudioData` is native and off the main thread, and a room
  // holds ~24 of them. Serial would be ~24 round trips through the event loop for no
  // gain, inside a room entry the player is waiting on.
  await Promise.all(
    [...entries.values()].map(async (e) => {
      const seg = index.segments.get(e.zvuk);
      if (!seg || e.delka <= 0) return;
      // `slice`, not `subarray`: `decodeAudioData` DETACHES the ArrayBuffer it is given,
      // which for a view onto the package would take every other segment with it.
      const ab = body.buffer.slice(
        body.byteOffset + seg.offset,
        body.byteOffset + seg.offset + seg.length,
      ) as ArrayBuffer;
      out.set(e.name, trimToSamples(ctx, await ctx.decodeAudioData(ab), e.delka));
    }),
  );
  return out;
}
