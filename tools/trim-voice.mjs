/**
 * Trim the tutorial lines so the fish stops before naming a PC key.
 *
 *   node tools/trim-voice.mjs [outDir]
 *
 * An alternative to synthesising replacements: cut each clip at the point where it turns
 * into an instruction about F2/F3/F1, keeping the actor's real voice and leaving a
 * sentence that is still grammatical Czech. The subtitle, already rewritten for the
 * controller, carries the button name — so the audio never states anything wrong, it
 * just says less than the caption.
 *
 * Cut points come from the pauses in the recordings (ffmpeg silencedetect); three of the
 * four fall on a sentence or clause boundary. help11 has no internal pause at all — it is
 * one continuous clause — so its cut lands mid-phrase and needs a fade to sound
 * deliberate rather than truncated.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = process.argv[2] ?? 'out/voice-trimmed';
const SRC = 'out/voice';

/** Where to stop, and what the fish is left saying. */
const CUTS = {
  //                     cut    fade  what remains
  help2: [3.42, 0.12, 'Než vstoupíme do dílny, uložíme si pozici.'],
  help7: [2.05, 0.12, 'Nyní začínáme znovu.'],
  help11: [2.25, 0.18, 'Znovu nahrajeme pozici. (mid-phrase cut — no pause to use)'],
  help22: [3.20, 0.12, 'Tak, to by asi bylo z pravidel všechno.'],
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [id, [cut, fade, left]] of Object.entries(CUTS)) {
  const dst = join(OUT, `${id}.wav`);
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', join(SRC, `${id}.wav`),
    '-t', String(cut),
    // Fade the tail so the stop reads as an ending rather than a dropout, and keep a
    // little silence after it so the line does not run straight into the next.
    '-af', `afade=t=out:st=${(cut - fade).toFixed(3)}:d=${fade},apad=pad_dur=0.25`,
    '-ar', '22050', '-ac', '1', '-sample_fmt', 's16', dst,
  ]);
  console.log(`  ${id.padEnd(8)} cut @${cut.toFixed(2)}s  ->  "${left}"`);
}
console.log(`\n-> ${OUT}/`);
