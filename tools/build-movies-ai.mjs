/**
 * Build the AI-upscaled, motion-interpolated intro/logo movies for the `ai` graphics level.
 *
 * The `ai` graphics tier is purely additive: it uses these upscaled encodes when
 * present and otherwise falls back to the faithful/clean encodes (see
 * logoMovie()/introMovie() in src/app/introOverlay.ts). The two lower tiers (classic,
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
 * original audio into a TEMPORARY spatial-only encode -> interpolate-movie.py
 * recovers the intro's held motion / uniformly interpolates the logo -> final
 * H.264 with unchanged audio and duration. Never feed a smoothed output back in.
 * The default model is realesr-animevideov3
 * (Real-ESRGAN's VIDEO model — temporally stable, no hallucinated texture on the
 * smooth 1998 CGI), which is a better fit for footage than the photo x4plus model.
 *
 * The upscaler binary + models are NOT in the repo (exactly like build-cover.py):
 *   https://github.com/xinntao/Real-ESRGAN/releases (realesrgan-ncnn-vulkan-*-macos)
 *   export REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan   # its dir must hold ./models
 * The committed *_ai.mp4 are the outputs, so a normal site build needs neither
 * this tool nor the upscaler. See tools/MOVIES.md for both stages and prerequisites.
 *
 * Usage: `node tools/build-movies-ai.mjs [logo|intro]`   (default: both)
 *   REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan   (required)
 *   AI_MODEL=realesr-animevideov3-x4   (override the model; default per SCALE)
 *   AI_SCALE=4                         (upscale factor: 2|3|4; default 4)
 *   RIFE_NCNN=/path/to/rife-ncnn-vulkan (rife-v4.6 must be beside it)
 *   AI_PYTHON=/path/to/venv/bin/python (movie_pipeline/requirements.txt)
 *   --spatial-dir /path/to/cache       (intro_spatial.mp4 / logo_spatial.mp4; skip Real-ESRGAN)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const movieDir = join(dirname(toolsDir), 'public', 'data', 'Movie');

const SCALE = String(process.env.AI_SCALE || '4');
const MODEL = process.env.AI_MODEL || `realesr-animevideov3-x${SCALE}`;
// Final encode width. The frames are AI-upscaled x4 (2560 wide) then supersampled
// DOWN to this width — this both keeps the committed file a reasonable size and
// yields a cleaner result than upscaling straight to the target. 0 = keep native x4.
const OUT_WIDTH = Number(process.env.AI_OUT_WIDTH ?? 1920);
const CRF = String(process.env.AI_CRF || '23'); // spatial intermediate and final delivery quality
const PYTHON = process.env.AI_PYTHON || 'python3';
const RIFE = process.env.RIFE_NCNN;
const GPU = process.env.RIFE_GPU || '0';

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
  if (r.error || r.status !== 0 || !/^[1-9]\d*\/[1-9]\d*$/.test(rate))
    throw new Error(`could not read frame rate of ${src}`);
  return rate; // e.g. "1000000/33333" (ffmpeg accepts the rational directly)
}

function run(label, cmd, args, opts = {}) {
  console.log(`${label} ...`);
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  if (r.error || r.status !== 0)
    throw new Error(`FAILED ${label}: ${r.error?.message || `${cmd} exited ${r.status ?? r.signal}`}`);
}

function upscaleDir(inDir, outDir) {
  const binp = process.env.REALESRGAN_NCNN;
  if (!binp || !existsSync(binp)) {
    throw new Error(
      'Real-ESRGAN binary not found. Set REALESRGAN_NCNN to the realesrgan-ncnn-vulkan ' +
      'executable (its folder must contain ./models). Download: ' +
      'https://github.com/xinntao/Real-ESRGAN/releases',
    );
  }
  const binDir = dirname(binp);
  run(`AI-upscaling frames (${MODEL}, x${SCALE})`, binp,
    ['-i', inDir, '-o', outDir, '-n', MODEL, '-s', SCALE, '-f', 'png', '-m', join(binDir, 'models')],
    { cwd: binDir });
}

function interpolate(name, src, spatial, dst) {
  run(`Interpolating ${name} at full resolution`, PYTHON,
    [join(toolsDir, 'interpolate-movie.py'), '--kind', name, '--input', spatial,
      '--base', src, '--output', dst, '--report', join(toolsDir, 'movie-builds', `${name}.json`),
      '--rife', resolve(RIFE), '--gpu', GPU, '--crf', CRF],
    { stdio: ['ignore', 'inherit', 'inherit'] });
}

function buildOne(name, spatialDir) {
  const { src: srcName, out: outName } = MOVIES[name];
  const src = join(movieDir, srcName);
  const dst = join(movieDir, outName);
  if (!existsSync(src)) {
    throw new Error(`Source not found: ${src}; run tools/build-movies.mjs first`);
  }
  if (spatialDir) {
    const spatial = join(spatialDir, `${name}_spatial.mp4`);
    if (!existsSync(spatial)) throw new Error(`Spatial cache not found: ${spatial}`);
    interpolate(name, src, spatial, dst);
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
    const spatial = join(work, `${name}_spatial.mp4`);
    run(`Encoding temporary ${name} spatial stage`, 'ffmpeg',
      ['-y', '-v', 'error', '-framerate', rate, '-i', join(outDir, '%06d.png'),
        '-i', src, ...vf, '-map', '0:v:0', '-map', '1:a:0', ...enc,
        '-enc_time_base', rate.split('/').reverse().join(':'),
        '-video_track_timescale', rate.split('/')[0], spatial]);
    // The PNG folders are no longer needed; free their space before temporal interpolation.
    rmSync(inDir, { recursive: true });
    rmSync(outDir, { recursive: true });
    interpolate(name, src, spatial, dst);
    console.log(`  wrote ${outName} (${(statSync(dst).size / 1e6).toFixed(1)} MB)`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const { values, positionals } = parseArgs({
    options: { help: { type: 'boolean' }, 'spatial-dir': { type: 'string' } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log('Usage: node tools/build-movies-ai.mjs [logo|intro] [--spatial-dir DIR]\n' +
      'Requires ffmpeg, ffprobe, RIFE_NCNN, and AI_PYTHON with movie_pipeline/requirements.txt.\n' +
      'Without --spatial-dir, also requires REALESRGAN_NCNN. See tools/MOVIES.md.');
    return;
  }
  if (positionals.length > 1 || (positionals.length === 1 && !Object.hasOwn(MOVIES, positionals[0])))
    throw new Error('Expected one movie: logo or intro (omit for both)');
  if (Object.hasOwn(values, 'spatial-dir') && !values['spatial-dir'].trim())
    throw new Error('--spatial-dir must not be empty');
  if (!['2', '3', '4'].includes(SCALE) || !Number.isInteger(OUT_WIDTH) || OUT_WIDTH < 0 || OUT_WIDTH % 2)
    throw new Error('AI_SCALE must be 2, 3 or 4; AI_OUT_WIDTH must be zero or a positive even integer');
  if (!/^\d+$/.test(CRF) || Number(CRF) > 51 || !/^(?:-1|\d+)$/.test(GPU))
    throw new Error('AI_CRF must be an integer in 0..51; RIFE_GPU must be -1 or a nonnegative integer');
  if (!RIFE || !existsSync(RIFE) || !statSync(RIFE).isFile())
    throw new Error('Set RIFE_NCNN to the rife-ncnn-vulkan executable');
  for (const file of ['flownet.bin', 'flownet.param'])
    if (!existsSync(join(dirname(resolve(RIFE)), 'rife-v4.6', file)))
      throw new Error(`Missing RIFE v4.6 model file: ${file}`);
  if (!values['spatial-dir'] && (!process.env.REALESRGAN_NCNN || !existsSync(process.env.REALESRGAN_NCNN)))
    throw new Error('Set REALESRGAN_NCNN or provide --spatial-dir');
  run('Checking Python movie dependencies', PYTHON, ['-c', 'import cv2, numpy']);
  run('Checking ffmpeg', 'ffmpeg', ['-version']);
  run('Checking ffprobe', 'ffprobe', ['-version']);
  const names = positionals.length ? positionals : ['logo', 'intro'];
  for (const name of names) buildOne(name, values['spatial-dir'] && resolve(values['spatial-dir']));
  console.log('Done.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
