/**
 * Generate source takes for the tutorial re-recording using macOS's built-in Czech
 * voice, as material for voice conversion.
 *
 *   node tools/make-voice-takes.mjs [outDir]
 *
 * Voice conversion (RVC and friends) replaces timbre but keeps the delivery of whatever
 * it is given, so this only has to produce correct Czech words at a sane pace — the
 * fish's voice comes from the conversion step. `say` is the zero-install option; a human
 * reading the same lines will almost always convert better, because the flat prosody of
 * a system voice survives conversion intact.
 *
 * Output is matched to the shipped recordings (22.05 kHz mono 16-bit) so the conversion
 * and the game see the same format the original clips use.
 */
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseFft } from '../src/data/fft.ts';

const OUT = process.argv[2] ?? 'out/voice-src';
const VOICE = process.env.FF_TTS_VOICE ?? 'Zuzana'; // macOS cs_CZ
const RATE = process.env.FF_TTS_RATE ?? '170'; // words/min; the fish speak unhurriedly

/** The rewritten Czech lines, keyed by caption id (see src/platform/padCaptions.ts). */
const LINES = {
  help2: 'Než vstoupíme do dílny, uložíme si pozici - dělá se to tlačítkem LB.',
  help7: 'Nyní začínáme znovu - můžeme však nahrát uloženou pozici tlačítkem RB.',
  help11: 'Znovu nahrajeme pozici tlačítkem RB.',
  help22:
    'Tak, to by asi bylo z pravidel všechno. Chceš-li vědět více, stiskni tlačítko Menu a vyber Nápovědu.',
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** How long the shipped recording of each line runs — the pace to aim for. */
const target = new Map();
for (const e of parseFft(new Uint8Array(readFileSync('public/data/Title/002.fft')))) {
  if (LINES[e.name]) target.set(e.name, e.delka / 22050);
}

function speak(id, text, rate) {
  const aiff = join(OUT, `${id}.aiff`);
  const wav = join(OUT, `${id}.wav`);
  // Plain AIFF: `say` rejects some data-format/extension combinations, and ffmpeg is
  // doing the resampling anyway.
  execFileSync('say', ['-v', VOICE, '-r', String(Math.round(rate)), '-o', aiff, text]);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', aiff,
    '-ar', '22050', '-ac', '1', '-sample_fmt', 's16', wav,
  ]);
  rmSync(aiff, { force: true });
  return Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav])
      .toString()
      .trim(),
  );
}

for (const [id, text] of Object.entries(LINES)) {
  const want = target.get(id);
  let rate = Number(RATE);
  let got = speak(id, text, rate);
  // Match the pace of the line being replaced: the game derives how long the fish's
  // mouth moves from the clip's length, so a noticeably shorter take reads as clipped
  // against the scene it plays over. One correction lands within a few percent.
  if (want) {
    rate = Math.max(90, Math.min(300, rate * (got / want)));
    got = speak(id, text, rate);
  }
  const delta = want ? `${got >= want ? '+' : ''}${(got - want).toFixed(2)}s vs original ${want.toFixed(2)}s` : '';
  console.log(`  ${id.padEnd(8)} ${got.toFixed(2)}s @${Math.round(rate)}wpm  ${delta}`);
}
console.log(`\nvoice '${VOICE}' -> ${OUT}/`);
