/**
 * Extract spoken lines from the game's sound banks as WAV, for reference/analysis.
 *
 *   node tools/extract-voice.mjs <room-number> [name-filter] [outDir]
 *   node tools/extract-voice.mjs 2 help out/voice
 *
 * The banks are 16-bit mono 22050 Hz behind a delta-PCM codec (src/audio/ffs.ts);
 * this writes plain RIFF/WAV so the clips can be listened to or used as a reference
 * for a voice model. Read-only: the game data is never modified.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeSound, FFS_SAMPLE_RATE } from '../src/audio/ffs.ts';
import { parseFft } from '../src/data/fft.ts';

const room = String(process.argv[2] ?? '2').padStart(3, '0');
const filter = process.argv[3] ?? '';
const outDir = process.argv[4] ?? 'out/voice';
mkdirSync(outDir, { recursive: true });

const fft = parseFft(new Uint8Array(readFileSync(`public/data/Title/${room}.fft`)));
const ffs = new Uint8Array(readFileSync(`public/data/Sound/${room}.ffs`));

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

let n = 0;
for (const e of fft) {
  if (filter && !e.name.toLowerCase().includes(filter.toLowerCase())) continue;
  if (!e.delka) continue;
  const pcm = decodeSound(ffs, e.zvuk, e.delka);
  const secs = (e.delka / FFS_SAMPLE_RATE).toFixed(2);
  writeFileSync(join(outDir, `${e.name}.wav`), wav(pcm, FFS_SAMPLE_RATE));
  console.log(`  ${e.name.padEnd(12)} ${secs}s  ${e.en.text.slice(0, 60)}`);
  n++;
}
console.log(`\n${n} clip(s) -> ${outDir}/`);
