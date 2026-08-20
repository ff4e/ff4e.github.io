/**
 * UI test: what the BROWSER does with a compressed voice package.
 *
 * `tools/stage-voices.ts --verify` proves what ffmpeg gets back out of the shipped
 * `.ffs2` files. That is most of the question and none of the risk, because ffmpeg is not
 * what plays them. The part only a browser can answer is whether ITS `decodeAudioData`
 * honours the MP4 edit list that carries the AAC encoder's priming delay. If it does not,
 * every spoken line starts ~1024-2048 samples (46-93 ms) late, `src/audio/ffs2Decode.ts`
 * trims that much off the END while it is at it, and the result is a game where every fish
 * speaks a beat behind its own mouth. Nothing else in the suite would see it: the room
 * would enter, the line would play, the subtitle would show.
 *
 * ── The oracle is not the code under test ─────────────────────────────────────
 * Both checks here compare against the 1998 data, read and decoded by this file:
 *
 *   - `decompres` below is an INDEPENDENT reimplementation of the original's delta codec
 *     (RSound.pas:258-333). It is not `src/audio/ffs.ts` — nothing here imports from the
 *     app — so if the port and this disagree, that is a finding too.
 *   - `delka` is read straight out of the `.fft` by `fftDelka` below, with its own record
 *     walk. The engine's `duration()` reads the same field, but a test that asked the
 *     engine would be asking the code under test what it thinks it did.
 *
 * The `.ffs` and `.fft` originals are fetchable here because the preview server links
 * `public/` in whole. They are NOT published to Pages (tools/stage-pages-assets.mjs drops
 * them), so this probe reads something a player never can — which is fine, and is the same
 * arrangement `test/musicStaging.test.ts` has with the `.wav` originals.
 */
import { withApp } from './ui-lib.mjs';

/**
 * x01, the eight leg-final remarks: 8 sounds, 0.71 MB of `.ffs` and 0.14 MB staged.
 *
 * Chosen for the byte-level half so that this probe does not have to be in a depth-15 room
 * — it fetches the files itself, whatever the game has loaded — and because it is the
 * smallest speech package there is. A room package would be up to 8.94 MB of `.ffs` to
 * download for the same answer.
 */
const PKG = 'x01';
const RATE = 22050;

/**
 * Fetch a package's `.fft`, `.ffs` and `.ffs2`, decode ONE sound both ways in the page,
 * and return the measurements. Everything here runs in the browser.
 */
const MEASURE = async ({ pkg, rate }) => {
  const bytes = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const [fft, ffs, ffs2] = await Promise.all([
    bytes(`/data/Title/${pkg}.fft`),
    bytes(`/data/Sound/${pkg}.ffs`),
    bytes(`/data/Sound/${pkg}.ffs2`),
  ]);

  // --- the 1998 side, reimplemented here on purpose (see the header) ---------
  const dv = new DataView(fft.buffer, fft.byteOffset, fft.byteLength);
  const count = dv.getInt32(0, true);
  const records = [];
  for (let k = 0; k < count; k++) {
    const base = 4 + k * 48;
    let name = '';
    for (let i = 0; i < fft[base]; i++) name += String.fromCharCode(fft[base + 1 + i]);
    records.push({ name, zvuk: dv.getInt32(base + 36, true), delka: dv.getInt32(base + 44, true) });
  }
  const i16 = (v) => (v << 16) >> 16;
  const decompres = (src, zvuk, n) => {
    const out = new Int16Array(n);
    let pos = zvuk;
    let cdif = 0;
    let clast = 0;
    let at = 0;
    while (at < n) {
      const c = src[pos++];
      if (c & 0x80) {
        let run = c & 0x7f;
        while (run-- > 0 && at < n) {
          cdif = i16(cdif + i16(((src[pos++] << 24) >> 24) << 2));
          clast = i16(clast + cdif);
          out[at++] = clast;
        }
      } else {
        const s = i16(((c << 8) | src[pos++]) << 2);
        out[at++] = s;
        cdif = i16(s - clast);
        clast = s;
      }
    }
    return out;
  };

  // --- the shipped side: this browser's own decoder --------------------------
  const h = new DataView(ffs2.buffer, ffs2.byteOffset, ffs2.byteLength);
  const magic = String.fromCharCode(ffs2[0], ffs2[1], ffs2[2], ffs2[3]);
  const segCount = h.getUint32(8, true);
  const segs = new Map();
  for (let i = 0; i < segCount; i++) {
    const b = 16 + i * 12;
    segs.set(h.getUint32(b, true), { offset: h.getUint32(b + 4, true), length: h.getUint32(b + 8, true) });
  }
  // A context at the ORIGINAL's rate, so the comparison is sample for sample and no
  // resampler sits between the decoder and the assertion. The priming-delay question this
  // probe exists for is rate-independent: a skipped edit list is ~1024 samples at any rate.
  const ctx = new AudioContext({ sampleRate: rate });
  const e = records.find((r) => r.delka > 0);
  const seg = segs.get(e.zvuk);
  const buf = await ctx.decodeAudioData(
    ffs2.buffer.slice(ffs2.byteOffset + seg.offset, ffs2.byteOffset + seg.offset + seg.length),
  );
  const dec = buf.getChannelData(0);
  const orig = decompres(ffs, e.zvuk, e.delka);

  // SNR of the browser's decode against the 1998 samples, at a given shift.
  const snr = (lag) => {
    const n = Math.min(dec.length, orig.length, 40000);
    let se = 0;
    let so = 0;
    for (let i = 200; i < n; i++) {
      const oi = i + lag;
      const o = oi >= 0 && oi < orig.length ? orig[oi] / 32768 : 0;
      const d = dec[i];
      se += (d - o) * (d - o);
      so += o * o;
    }
    return 10 * Math.log10(so / Math.max(se, 1e-12));
  };
  // Coarse whole-frame shifts plus a fine sweep. A browser that dropped the edit list
  // would peak at +1024 or +2048; one that drifted would peak in the fine range.
  const lags = [-2048, -1024, -512, -256, -64, -16, -8, -4, -2, -1, 0, 1, 2, 4, 8, 16, 64, 256, 512, 1024, 2048];
  const scored = lags.map((lag) => ({ lag, snr: snr(lag) }));
  const best = scored.reduce((a, b) => (b.snr > a.snr ? b : a));

  return {
    magic,
    segCount,
    records: records.length,
    name: e.name,
    delka: e.delka,
    ctxRate: ctx.sampleRate,
    decoded: buf.length,
    snr0: snr(0),
    bestLag: best.lag,
    bestSnr: best.snr,
    // Every name in the .fft, with its length in seconds — the oracle for the runtime half.
    seconds: Object.fromEntries(records.map((r) => [r.name, r.delka / rate])),
  };
};

/**
 * Record what every non-looping source was started with.
 *
 * The same prototype patch `test-mapaudio.mjs` uses, and installed the same way — in the
 * page the probe is already on, never through an init script, because that needs a reload
 * and would boot the app (and re-fetch the world map) twice.
 *
 * Named from the LAST sound-log entry rather than the newest matching one: `play`/`snd`
 * log immediately before `createBufferSource()` with nothing logging in between, so the
 * newest entry is always the sound being started. Searching backwards for a name would
 * file a later sound under an earlier one.
 */
const VOICE_SPY = () => {
  window.__voices = [];
  const proto = AudioBufferSourceNode.prototype;
  const start = proto.start;
  proto.start = function (...args) {
    if (!this.loop && this.buffer) {
      const log = window.__ff?.soundLog?.() ?? [];
      const last = log[log.length - 1];
      if (last) window.__voices.push({ name: last.name, duration: this.buffer.duration });
    }
    return start.apply(this, args);
  };
};

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  await p.evaluate(VOICE_SPY);
  await p.mouse.click(450, 600); // a gesture to unlock the AudioContext

  const m = await p.evaluate(MEASURE, { pkg: PKG, rate: RATE });

  expect(m.magic === 'FFS2', `${PKG} ships as an FFS2 package (magic ${JSON.stringify(m.magic)})`);
  expect(
    m.segCount === m.records,
    `${PKG} has a segment for each of its ${m.records} sounds (got ${m.segCount})`,
  );
  expect(m.ctxRate === RATE, `the measuring context runs at ${RATE} Hz (got ${m.ctxRate})`);

  // THE assertion this probe exists for. Not "lag 0 is good" — "no shift is better", which
  // is the same claim without assuming the peak is sharp, and it fails loudly for the one
  // failure mode that is invisible everywhere else.
  expect(
    m.bestLag === 0,
    `${m.name}: this browser's decode aligns with the 1998 samples at lag 0 — no shift fits ` +
      `better (best was ${m.bestLag}, ${m.bestSnr.toFixed(1)} dB, against ${m.snr0.toFixed(1)} dB at 0). ` +
      `A best lag near +1024 or +2048 means decodeAudioData ignored the MP4 edit list and every ` +
      `voice starts that late.`,
  );
  // A sanity floor on the match itself: the alignment test above is a comparison, so it
  // would also be satisfied by a decode that matched nothing at any lag.
  expect(m.snr0 > 5, `${m.name}: the decode is the same sound (${m.snr0.toFixed(1)} dB at lag 0)`);
  // The runtime trims to `delka`, so a SHORT decode is silence spliced onto the end of a
  // line. ffmpeg's decode of these runs 0-1023 samples long; a browser's may differ, but
  // it must not be short.
  expect(
    m.decoded >= m.delka,
    `${m.name}: decodes to at least its delka (${m.delka} samples, got ${m.decoded})`,
  );

  // ── The runtime half: what the ENGINE handed to the mixer ──────────────────
  // PRVNI opens with a conversation, so entering it starts real voices through the real
  // path — package fetched, decoded, trimmed, cached, played.
  await p.evaluate(() => window.__ff.enterRoom(1));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.roomAudioReady());
  await p.waitForFunction(() => (window.__voices ?? []).some((v) => v.name.startsWith('1st-'))).catch(() => {});

  const voices = (await p.evaluate(() => window.__voices)).filter((v) => v.name.startsWith('1st-'));
  expect(voices.length > 0, 'entering PRVNI starts at least one of its own voices');

  const want = await p.evaluate(async (pkg) => {
    const fft = new Uint8Array(await (await fetch(`/data/Title/${pkg}.fft`)).arrayBuffer());
    const dv = new DataView(fft.buffer, fft.byteOffset, fft.byteLength);
    const out = {};
    for (let k = 0; k < dv.getInt32(0, true); k++) {
      const base = 4 + k * 48;
      let name = '';
      for (let i = 0; i < fft[base]; i++) name += String.fromCharCode(fft[base + 1 + i]);
      out[name] = dv.getInt32(base + 44, true) / 22050;
    }
    return out;
  }, '001');

  for (const v of voices.slice(0, 4)) {
    const wanted = want[v.name];
    expect(wanted !== undefined, `${v.name} is a sound of the 001 package`);
    if (wanted === undefined) continue;
    // 32 samples (1.5 ms), for the reason test-mapaudio gives: the window has to sit above
    // the resampler's rounding (the game's context is 44100 or 48000 and varies by machine,
    // so `trimToSamples` rounds by at most a frame) and well below the padding it is there
    // to catch, which is up to 1023 samples = 46 ms.
    expect(
      Math.abs(v.duration - wanted) < 32 / RATE,
      `${v.name}: the buffer the engine played is delka long, within 32 samples ` +
        `(want ${wanted.toFixed(6)}s, got ${v.duration.toFixed(6)}s). A longer one is AAC ` +
        `encoder padding that was not trimmed, and it holds playing(prior) true past the line.`,
    );
  }
});
