/**
 * Build the AI-UPSCALED intro/logo movies for the `ai` graphics level (Phase A).
 *
 * The `ai` graphics tier is purely additive: it uses these upscaled encodes when
 * present and otherwise falls back to the faithful/clean encodes (see
 * logoMovie()/introMovie() in src/app/main.ts). The two lower tiers (classic,
 * enhanced) are untouched.
 *
 * Source = this port's own faithful encodes under public/data/Movie/ (themselves
 * derived from the GPL-released Fish Fillets data), so the AI outputs stay
 * GPL-clean. Only the finished encodes are committed:
 *   logo.mp4        -> logo_ai.mp4
 *   intro_clean.mp4 -> intro_ai.mp4
 *
 * Pipeline (per movie): extract every frame (frame-exact, no resample) -> AI
 * upscale the frame folder with Real-ESRGAN ncnn-vulkan (the same upscaler as
 * tools/build-cover.py) -> re-encode H.264 at the source frame rate and copy the
 * original audio (so a/v stay in sync). The default model is realesr-animevideov3
 * (Real-ESRGAN's VIDEO model — temporally stable, no hallucinated texture on the
 * smooth 1998 CGI), which is a better fit for footage than the photo x4plus model.
 *
 * The upscaler binary + models are NOT in the repo (exactly like build-cover.py):
 *   https://github.com/xinntao/Real-ESRGAN/releases (realesrgan-ncnn-vulkan-*-macos)
 *   export REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan   # its dir must hold ./models
 * The committed *_ai.mp4 are the outputs, so a normal site build needs neither
 * this tool nor the upscaler.
 *
 * Usage: `node tools/build-movies-ai.mjs [logo|intro]`   (default: both)
 *   REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan   (required)
 *   AI_MODEL=realesr-animevideov3-x4   (override the model; default per SCALE)
 *   AI_SCALE=4                         (upscale factor: 2|3|4; default 4)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const movieDir = join(dirname(toolsDir), 'public', 'data', 'Movie');

const SCALE = String(process.env.AI_SCALE || '4');
const MODEL = process.env.AI_MODEL || `realesr-animevideov3-x${SCALE}`;
// Final encode width. The frames are AI-upscaled x4 (2560 wide) then supersampled
// DOWN to this width — this both keeps the committed file a reasonable size and
// yields a cleaner result than upscaling straight to the target. 0 = keep native x4.
const OUT_WIDTH = Number(process.env.AI_OUT_WIDTH ?? 1920);
const CRF = String(process.env.AI_CRF || '23'); // delivery quality for the upscaled encode (source frames are AI-reconstructed, so high CRF stays clean)

const enc = ['-c:v', 'libx264', '-crf', CRF, '-pix_fmt', 'yuv420p', '-preset', 'slow',
  '-c:a', 'copy', '-movflags', '+faststart'];

// The source (faithful/clean) encode and the AI output name, per movie.
const MOVIES = {
  logo: { src: 'logo.mp4', out: 'logo_ai.mp4' },
  intro: { src: 'intro_clean.mp4', out: 'intro_ai.mp4' },
};

function ffprobeRate(src) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=r_frame_rate', '-of', 'default=nk=1:nw=1', src], { encoding: 'utf8' });
  const rate = (r.stdout || '').trim();
  if (!rate || rate === '0/0') throw new Error(`could not read frame rate of ${src}`);
  return rate; // e.g. "1000000/33333" (ffmpeg accepts the rational directly)
}

function run(label, cmd, args, opts = {}) {
  console.log(`${label} ...`);
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  if (r.status !== 0) {
    console.error(`FAILED ${label} (${cmd} exit ${r.status})`);
    process.exit(1);
  }
}

function upscaleDir(inDir, outDir) {
  const binp = process.env.REALESRGAN_NCNN;
  if (!binp || !existsSync(binp)) {
    console.error(
      'Real-ESRGAN binary not found. Set REALESRGAN_NCNN to the realesrgan-ncnn-vulkan ' +
      'executable (its folder must contain ./models). Download: ' +
      'https://github.com/xinntao/Real-ESRGAN/releases',
    );
    process.exit(1);
  }
  const binDir = dirname(binp);
  run(`AI-upscaling frames (${MODEL}, x${SCALE})`, binp,
    ['-i', inDir, '-o', outDir, '-n', MODEL, '-s', SCALE, '-f', 'png', '-m', join(binDir, 'models')],
    { cwd: binDir });
}

function buildOne(name) {
  const { src: srcName, out: outName } = MOVIES[name];
  const src = join(movieDir, srcName);
  const dst = join(movieDir, outName);
  if (!existsSync(src)) {
    console.error(`SKIP ${name}: source not found at ${src}`);
    return;
  }
  const rate = ffprobeRate(src);
  const work = mkdtempSync(join(tmpdir(), `ffai-${name}-`));
  const inDir = join(work, 'in');
  const outDir = join(work, 'out');
  mkdirSync(inDir);
  mkdirSync(outDir);
  try {
    // 1. Extract every frame, frame-exact (no resample) so timing is preserved.
    run(`Extracting frames from ${srcName}`, 'ffmpeg',
      ['-y', '-v', 'error', '-i', src, '-fps_mode', 'passthrough', join(inDir, '%06d.png')]);
    const nFrames = readdirSync(inDir).filter((f) => f.endsWith('.png')).length;
    console.log(`  ${nFrames} frames @ ${rate} fps`);

    // 2. AI-upscale the whole frame folder (Real-ESRGAN preserves the filenames).
    upscaleDir(inDir, outDir);

    // 3. Re-encode at the source rate, copying the original audio (a/v in sync).
    //    Optionally supersample-down to OUT_WIDTH (even height) with lanczos.
    const vf = OUT_WIDTH > 0 ? ['-vf', `scale=${OUT_WIDTH}:-2:flags=lanczos`] : [];
    run(`Encoding ${outName}`, 'ffmpeg',
      ['-y', '-v', 'error', '-framerate', rate, '-i', join(outDir, '%06d.png'),
        '-i', src, ...vf, '-map', '0:v:0', '-map', '1:a:0', ...enc, dst]);
    console.log(`  wrote ${outName} (${(statSync(dst).size / 1e6).toFixed(1)} MB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const which = process.argv[2];
const names = which ? [which] : ['logo', 'intro'];
for (const name of names) {
  if (!MOVIES[name]) {
    console.error(`unknown movie "${name}" (expected: ${Object.keys(MOVIES).join(', ')})`);
    process.exit(1);
  }
  buildOne(name);
}
console.log('Done.');
