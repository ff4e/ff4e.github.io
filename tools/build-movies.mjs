/**
 * Transcode the original game movies (Cinepak AVI, 640x480) to web-friendly
 * H.264 MP4 for the intro/logo playback (UMain.pas daLogo/daIntro).
 *
 * Produces two variants per movie under public/data/Movie/ (gitignored, local):
 *  - `<name>.mp4`       FAITHFUL straight transcode (keeps the original Cinepak
 *    vector-quantization "block" artifacts — looks like the real 1998 game).
 *  - `<name>_clean.mp4` The intro's worst artifact is a ~2s "burst": from ~12.03s
 *    the Cinepak encoder coarsely quantizes the brightening/rotating globe into
 *    hard blocks (until the dissolve to the seabed ~14s). That sub-block detail
 *    is destroyed in the source and exists in no copy, so it can't be restored by
 *    filtering — only smoothed (blurry) or replaced. The Fish Fillets NG movie
 *    (`intro.mpg`) has a clean rendering of the SAME footage for that window, so
 *    the clean intro SPLICES FFNG's frames over just the burst window (time-
 *    aligned + crossfaded at the seams); everything else stays our faithful
 *    transcode. logo has no burst, so logo_clean is a plain copy of logo.mp4.
 *
 * Usage: `node tools/build-movies.mjs` (needs ffmpeg on PATH).
 *   FFNG_MOVIE=/path/to/intro.mpg to override the FFNG source location.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const movieDir = join(dirname(toolsDir), 'public', 'data', 'Movie');

const CRF = '17'; // near-lossless for this low-detail 1998 CGI (SSIM ~0.99)

// The FFNG intro movie (a clean rendering of the same footage), used to patch the
// intro globe "burst". Default = the installed Fish Fillets NG app data.
const FFNG_SRC =
  process.env.FFNG_MOVIE ||
  '/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng/images/menu/intro.mpg';

// Burst-splice windows. The intro has more than one spot where the Cinepak
// encoder coarsely quantizes a smooth globe scene into blocks (a "burst"); for
// each, FFNG's clean rendering of the same footage is overlaid, crossfaded at
// the seams so the rest of our video shows through untouched. FFNG drifts
// NON-LINEARLY vs ours (offset ~0.11s at 12s but ~0.0s at 23s), so each window
// carries its own measured FFNG time offset (offset = our_time − matching_FFNG_time,
// found by PSNR-matching frames). Each window uses its own FFNG input instance.
//   fadeIn/fadeOut = alpha crossfade start times (s); d = crossfade duration (s).
const SPLICES = [
  // The big globe burst: hard-posterizes ~12.03s until the dissolve to seabed ~14s.
  { offset: 0.11, fadeIn: 11.8167, fadeOut: 13.9, d: 0.15 },
  // NOTE: a shorter, milder burst also occurs ~23.03s (globe + descending UFO). It
  // was deemed acceptable to leave as-is, so it's intentionally NOT spliced. To fix
  // it too, re-add: { offset: 0.0, fadeIn: 22.87, fadeOut: 23.6, d: 0.12 }.
];

const enc = ['-c:v', 'libx264', '-crf', CRF, '-pix_fmt', 'yuv420p', '-preset', 'slow',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];

function run(label, args) {
  console.log(`${label} ...`);
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) {
    console.error(`FAILED ${label} (ffmpeg exit ${r.status})`);
    process.exit(1);
  }
}

function report(dst) {
  console.log(`  wrote ${dst.split('/').pop()} (${(statSync(dst).size / 1e6).toFixed(1)} MB)`);
}

/** Faithful straight transcode. */
function faithful(src, dst) {
  run(`Transcoding ${src.split('/').pop()} -> ${dst.split('/').pop()} (faithful)`,
    ['-y', '-i', src, ...enc, dst]);
  report(dst);
}

/**
 * Intro clean = faithful base with FFNG's clean frames overlaid over each burst
 * window (SPLICES). Each window uses its own FFNG input (its own -itsoffset), is
 * scaled to 640x480, and has its alpha faded in/out at the seams so outside the
 * windows our video shows through untouched. The overlays are chained in order.
 */
function spliceIntro(src, dst) {
  // Inputs: [0]=our AVI, then one FFNG input per splice window (each -itsoffset).
  const inputs = ['-y', '-i', src];
  SPLICES.forEach((s) => inputs.push('-itsoffset', String(s.offset), '-i', FFNG_SRC));

  // Build the FFNG overlay chain: [0:v] base, then overlay each faded FFNG window.
  const parts = [];
  SPLICES.forEach((s, i) => {
    parts.push(
      `[${i + 1}:v]scale=640:480,setsar=1,fps=30,format=yuva420p,` +
      `fade=t=in:st=${s.fadeIn}:d=${s.d}:alpha=1,` +
      `fade=t=out:st=${s.fadeOut}:d=${s.d}:alpha=1[ff${i}]`,
    );
  });
  parts.push('[0:v]format=yuv420p[b0]');
  SPLICES.forEach((s, i) => {
    const out = i === SPLICES.length - 1 ? 'v' : `b${i + 1}`;
    parts.push(`[b${i}][ff${i}]overlay=eof_action=pass[${out}]`);
  });
  const filter = parts.join(';');

  run(`Splicing FFNG into ${dst.split('/').pop()} (${SPLICES.length} burst windows)`,
    [...inputs, '-filter_complex', filter, '-map', '[v]', '-map', '0:a', ...enc, dst]);
  report(dst);
}

for (const name of ['logo', 'intro']) {
  const src = join(movieDir, `${name}.avi`);
  if (!existsSync(src)) {
    console.error(`SKIP ${name}: source not found at ${src}`);
    continue;
  }
  const faithfulDst = join(movieDir, `${name}.mp4`);
  const cleanDst = join(movieDir, `${name}_clean.mp4`);
  faithful(src, faithfulDst);

  if (name === 'intro') {
    if (existsSync(FFNG_SRC)) {
      spliceIntro(src, cleanDst);
    } else {
      console.warn(`  FFNG source not found (${FFNG_SRC}); intro_clean = faithful copy.`);
      copyFileSync(faithfulDst, cleanDst);
      report(cleanDst);
    }
  } else {
    // logo has no burst — clean is just a copy of the faithful transcode.
    copyFileSync(faithfulDst, cleanDst);
    report(cleanDst);
  }
}
console.log('Done.');
