/**
 * Build a single-speaker voice dataset from the game's sound banks.
 *
 *   node tools/build-voice-dataset.mjs [V|M] [outDir]
 *   node tools/build-voice-dataset.mjs V out/voice-dataset/big
 *
 * The two fish are voiced by one actor each across all 76 rooms, and every clip already
 * carries its transcript in the FFT, so this produces an *aligned* corpus rather than
 * loose samples: enough for voice conversion (audio only) or a TTS fine-tune (needs the
 * transcripts). Speakers are selected by the subtitle colour code the game itself uses to
 * decide who is talking — 'V' the big fish, 'M' the small one — which also excludes
 * narration and system sounds without having to special-case their names.
 *
 * Output is LJSpeech-shaped, which is what most training tools expect:
 *   <outDir>/wavs/<id>.wav        22.05 kHz mono 16-bit, silence-trimmed, level-matched
 *   <outDir>/metadata.csv         id|transcript|transcript
 *   <outDir>/dataset.json         per-clip detail, and what was rejected and why
 *
 * The transcripts are Czech: the recordings are Czech only, English exists as subtitles
 * over the same audio. Read-only — the shipped game data is never modified.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { decodeSound, FFS_SAMPLE_RATE } from '../src/audio/ffs.ts';
import { parseFft } from '../src/data/fft.ts';

const SPEAKER = (process.argv[2] ?? 'V').toUpperCase();
const OUT = process.argv[3] ?? `out/voice-dataset/${SPEAKER === 'V' ? 'big' : 'small'}`;

// Clips shorter than this are usually a grunt or a clipped word: too little signal to
// help a model and they drag the average down. Very long ones are almost always several
// sentences, which train worse than single utterances.
const MIN_SEC = 0.6;
const MAX_SEC = 15;

const wavDir = join(OUT, 'wavs');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(wavDir, { recursive: true });

/** Minimal 16-bit mono RIFF/WAV. */
function wav(pcm, rate) {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  return b;
}

/** Strip the "@" splice marker and tidy the quoting the 1997 text uses. */
function cleanText(s) {
  return s.replace(/@/g, '').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

const kept = [];
const rejected = [];
let rawSeconds = 0;

for (let r = 1; r <= 76; r++) {
  const n = String(r).padStart(3, '0');
  const fftPath = `public/data/Title/${n}.fft`;
  const ffsPath = `public/data/Sound/${n}.ffs`;
  if (!existsSync(fftPath) || !existsSync(ffsPath)) continue;
  const entries = parseFft(new Uint8Array(readFileSync(fftPath)));
  const ffs = new Uint8Array(readFileSync(ffsPath));

  for (const e of entries) {
    if (!e.delka) continue;
    if (e.cz.color !== SPEAKER) continue; // the game's own "who is speaking" flag
    const secs = e.delka / FFS_SAMPLE_RATE;
    rawSeconds += secs;
    const text = cleanText(e.cz.text);
    if (secs < MIN_SEC) { rejected.push({ id: `${n}-${e.name}`, why: `too short (${secs.toFixed(2)}s)` }); continue; }
    if (secs > MAX_SEC) { rejected.push({ id: `${n}-${e.name}`, why: `too long (${secs.toFixed(2)}s)` }); continue; }
    if (text.length < 2) { rejected.push({ id: `${n}-${e.name}`, why: 'no transcript' }); continue; }

    const id = `${n}-${e.name}`.replace(/[^\w.-]/g, '_');
    const rawPath = join(wavDir, `${id}.raw.wav`);
    const outPath = join(wavDir, `${id}.wav`);
    writeFileSync(rawPath, wav(decodeSound(ffs, e.zvuk, e.delka), FFS_SAMPLE_RATE));

    // Trim leading/trailing silence and bring every clip to a common loudness. Training
    // on wildly varying levels teaches the model the level rather than the voice.
    try {
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath,
        '-af', 'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB:' +
               'stop_periods=-1:stop_silence=0.15:stop_threshold=-50dB,' +
               'loudnorm=I=-23:TP=-2:LRA=7',
        '-ar', String(FFS_SAMPLE_RATE), '-ac', '1', '-sample_fmt', 's16', outPath,
      ], { stdio: 'pipe' });
      rmSync(rawPath, { force: true });
    } catch (err) {
      rmSync(rawPath, { force: true });
      rejected.push({ id, why: 'ffmpeg failed' });
      continue;
    }
    kept.push({ id, room: r, name: e.name, seconds: Number(secs.toFixed(2)), text });
  }
}

kept.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(OUT, 'metadata.csv'), kept.map((k) => `${k.id}|${k.text}|${k.text}`).join('\n') + '\n');
writeFileSync(join(OUT, 'dataset.json'), JSON.stringify({ speaker: SPEAKER, kept, rejected }, null, 2));

const total = kept.reduce((s, k) => s + k.seconds, 0);
const words = kept.reduce((s, k) => s + k.text.split(/\s+/).length, 0);
console.log(`speaker '${SPEAKER}'  (${SPEAKER === 'V' ? 'big fish' : 'small fish'})`);
console.log(`  kept      ${kept.length} clips, ${(total / 60).toFixed(1)} min, ${words} words`);
console.log(`  rejected  ${rejected.length} (${(rawSeconds / 60 - total / 60).toFixed(1)} min)`);
console.log(`  median    ${kept.length ? kept.map((k) => k.seconds).sort((a, b) => a - b)[kept.length >> 1] : 0}s per clip`);
console.log(`  -> ${OUT}/`);
