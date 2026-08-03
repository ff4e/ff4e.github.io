/**
 * Shift a folder of takes by a number of semitones, to sit in the same register as the
 * voice they are replacing.
 *
 *   node tools/pitch-match.mjs <srcDir> <dstDir> <semitones>
 *   node tools/pitch-match.mjs out/voice-src out/voice-src-matched -3
 *
 * Use tools/voice-pitch.py to get the number: it prints the gap between two sets of
 * clips and the transpose that closes it.
 *
 * This resamples rather than shifting pitch alone, so formants move with the pitch —
 * the effect of playing tape slower. For a couple of semitones downward that reads as a
 * slightly larger speaker, which suits the character being replaced here; it is not a
 * substitute for voice conversion if an exact timbre match is wanted. Duration is
 * restored afterwards so the take still matches the clip it stands in for.
 */
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const [src, dst, semis] = [process.argv[2], process.argv[3], Number(process.argv[4])];
if (!src || !dst || !Number.isFinite(semis)) {
  console.error('usage: node tools/pitch-match.mjs <srcDir> <dstDir> <semitones>');
  process.exit(2);
}

const RATE = 22050;
const ratio = Math.pow(2, semis / 12); // <1 lowers the voice
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });

/** atempo only accepts 0.5–2.0 per instance, so chain it for larger corrections. */
function atempoChain(factor) {
  const parts = [];
  let f = factor;
  while (f > 2.0) { parts.push('atempo=2.0'); f /= 2.0; }
  while (f < 0.5) { parts.push('atempo=0.5'); f /= 0.5; }
  parts.push(`atempo=${f.toFixed(6)}`);
  return parts.join(',');
}

for (const f of readdirSync(src).filter((n) => n.endsWith('.wav'))) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', join(src, f),
    // Reinterpret the sample rate to move pitch, undo the resulting speed change, then
    // return to the game's rate.
    '-af', `asetrate=${Math.round(RATE * ratio)},${atempoChain(1 / ratio)},aresample=${RATE}`,
    '-ar', String(RATE), '-ac', '1', '-sample_fmt', 's16', join(dst, f),
  ]);
  console.log(`  ${f}  ${semis > 0 ? '+' : ''}${semis} semitones`);
}
console.log(`\n-> ${dst}/`);
