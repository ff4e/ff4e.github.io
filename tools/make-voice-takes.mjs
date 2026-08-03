/**
 * Generate Czech source takes for the tutorial lines that were rewritten for the
 * controller (see src/platform/padCaptions.ts).
 *
 *   node tools/make-voice-takes.mjs [outDir]
 *   FF_TTS_ENGINE=say node tools/make-voice-takes.mjs
 *
 * Two engines:
 *   piper (default) — a local male Czech voice, 22.05 kHz, the sample rate the game
 *                     itself uses. Needs the model; see xbox/VOICE.md.
 *   say             — macOS's built-in Czech voice. No install, but the only Czech voice
 *                     the system ships is female, which is a long way from the big fish.
 *
 * These are *source* takes. Voice conversion replaces timbre while keeping delivery, so
 * a take only has to be right about words and pacing; the fish's own voice comes from
 * the conversion step. Measured pitch: the big fish is ~134 Hz, Piper's `jirka` ~160 Hz
 * (3 semitones away), macOS `Zuzana` ~214 Hz (8 semitones) — hence the default.
 *
 * Each take is matched to the length of the clip it replaces, because the game derives
 * how long a fish's mouth moves from the clip's duration: a noticeably shorter take
 * reads as clipped against the scene it plays over.
 */
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFft } from '../src/data/fft.ts';

const OUT = process.argv[2] ?? 'out/voice-src';
const ENGINE = process.env.FF_TTS_ENGINE ?? 'piper';
const PIPER = process.env.FF_PIPER ?? '/tmp/ffvoice/bin/piper';
const MODEL = process.env.FF_PIPER_MODEL ?? join(homedir(), '.cache/ff4e-piper/cs_CZ-jirka-medium.onnx');
const SAY_VOICE = process.env.FF_SAY_VOICE ?? 'Zuzana';

/** The rewritten Czech lines, keyed by caption id. Keep in step with padCaptions.ts. */
const LINES = {
  help2: 'Než vstoupíme do dílny, uložíme si pozici - dělá se to tlačítkem LB.',
  help7: 'Nyní začínáme znovu - můžeme však nahrát uloženou pozici tlačítkem RB.',
  help11: 'Znovu nahrajeme pozici tlačítkem RB.',
  help22:
    'Tak, to by asi bylo z pravidel všechno. Chceš-li vědět více, stiskni tlačítko Menu a vyber Nápovědu.',
};

if (ENGINE === 'piper' && !existsSync(MODEL)) {
  console.error(`Piper model not found: ${MODEL}\nSee xbox/VOICE.md, or run with FF_TTS_ENGINE=say.`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** How long the shipped recording of each line runs — the pace to aim for. */
const target = new Map();
for (const e of parseFft(new Uint8Array(readFileSync('public/data/Title/002.fft')))) {
  if (LINES[e.name]) target.set(e.name, e.delka / 22050);
}

const duration = (f) =>
  Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])
      .toString()
      .trim(),
  );

/** Force mono 22.05 kHz 16-bit, matching the shipped clips. */
function conform(src, dst) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-ar', '22050', '-ac', '1', '-sample_fmt', 's16', dst,
  ]);
}

/** `pace` is a speed knob: larger = slower, for both engines. */
function speak(id, text, pace) {
  const wav = join(OUT, `${id}.wav`);
  if (ENGINE === 'piper') {
    const raw = join(OUT, `${id}.raw.wav`);
    execFileSync(PIPER, ['-m', MODEL, '-f', raw, '--length-scale', pace.toFixed(3)], { input: text });
    conform(raw, wav);
    rmSync(raw, { force: true });
  } else {
    // `say` takes words per minute, and rejects some data-format/extension combinations,
    // so write plain AIFF and let ffmpeg do the resampling.
    const aiff = join(OUT, `${id}.aiff`);
    execFileSync('say', ['-v', SAY_VOICE, '-r', String(Math.round(170 / pace)), '-o', aiff, text]);
    conform(aiff, wav);
    rmSync(aiff, { force: true });
  }
  return duration(wav);
}

for (const [id, text] of Object.entries(LINES)) {
  const want = target.get(id);
  let pace = 1;
  let got = speak(id, text, pace);
  // One correction lands within a few percent; a second helps when the first overshoots.
  for (let i = 0; want && i < 2 && Math.abs(got - want) > 0.15; i++) {
    pace = Math.max(0.5, Math.min(2.5, pace * (want / got)));
    got = speak(id, text, pace);
  }
  const delta = want ? `${got >= want ? '+' : ''}${(got - want).toFixed(2)}s vs ${want.toFixed(2)}s` : '';
  console.log(`  ${id.padEnd(8)} ${got.toFixed(2)}s  pace ${pace.toFixed(2)}  ${delta}`);
}
console.log(`\nengine '${ENGINE}' -> ${OUT}/`);
