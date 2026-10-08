import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const rate = (value: string): number => {
  const [numerator, denominator] = value.split('/').map(Number);
  return numerator! / denominator!;
};

describe('AI movie delivery', () => {
  for (const [name, sourceFrames, multiplier] of [['intro', 2201, 2], ['logo', 457, 4]] as const) {
    it(`${name}: shipped bytes agree with the validated build report`, () => {
      const report = JSON.parse(readFileSync(join(root, 'tools', 'movie-builds', `${name}.json`), 'utf8'));
      const movie = join(root, 'public', 'data', 'Movie', `${name}_ai.mp4`);
      const base = join(root, 'public', 'data', 'Movie', name === 'intro' ? 'intro_clean.mp4' : 'logo.mp4');
      expect(report.movie).toBe(name);
      expect(report.base.sha256).toBe(hash(base));
      expect(report.spatial_input.frames).toBe(sourceFrames);
      expect(report.output.frames).toBe(sourceFrames * multiplier);
      expect(report.output.width).toBe(1920);
      expect(report.output.height).toBe(1440);
      expect(rate(report.output.rate)).toBeCloseTo(rate(report.spatial_input.rate) * multiplier, 8);
      expect(rate(report.output.rate)).toBeGreaterThan(59.99);
      expect(rate(report.output.rate)).toBeLessThan(60.01);
      expect(report.output.duration).toBeCloseTo(report.spatial_input.duration, 6);
      expect(report.output.audio_sha256).toBe(report.spatial_input.audio_sha256);
      expect(report.output.sha256).toBe(hash(movie));
      expect(report.output.bytes).toBe(statSync(movie).size);
      expect(report.output.bytes).toBeLessThan(100 * 1024 * 1024);
      expect(report.cadence.multiplier).toBe(multiplier);
      expect(report.cadence.algorithm).toBe(name === 'intro' ? 'motion-progress-v1' : 'uniform-rife-v1');
      expect(report.cadence.retained_frames).toBeGreaterThan(0);
      expect(report.cadence.retained_frames).toBeLessThanOrEqual(sourceFrames);
      if (name === 'logo') expect(report.cadence.retained_frames).toBe(sourceFrames);
      expect(report.rife.model).toBe('rife-v4.6');
      for (const stage of [report.base, report.spatial_input, report.output])
        expect(stage.file).toBe(basename(stage.file));
      expect(JSON.stringify(report)).not.toContain(JSON.stringify(homedir()).slice(1, -1));
      expect(JSON.stringify(report)).not.toMatch(/\b\S+@\S+\b/);
    });
  }

  it('exposes builder help without requiring GPU tools, and rejects unknown movies', () => {
    const script = join(root, 'tools', 'build-movies-ai.mjs');
    expect(execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' })).toContain('--spatial-dir');
    for (const name of ['not-a-movie', '', '__proto__']) {
      const invalid = spawnSync(process.execPath, [script, name], { encoding: 'utf8' });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toContain('Expected one movie');
    }
    const emptyCache = spawnSync(process.execPath, [script, '--spatial-dir', ''], { encoding: 'utf8' });
    expect(emptyCache.status).toBe(1);
    expect(emptyCache.stderr).toContain('--spatial-dir must not be empty');
  });

  it('packages only runtime movies, not source AVIs or obsolete upscaled intermediates', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'ff-movie-stage-'));
    const movies = ['logo.mp4', 'intro_clean.mp4', 'logo_ai.mp4', 'intro_ai.mp4'];
    const buildOnly = ['intro.avi', 'logo.avi', 'intro.mp4', 'logo_clean.mp4',
      'intro_spatial.mp4', 'logo_spatial.mp4', 'intro_old_ai.mp4', '.movie-incomplete.mp4'];
    try {
      const source = join(fixture, 'public', 'data', 'Movie');
      mkdirSync(source, { recursive: true });
      mkdirSync(join(fixture, 'dist'));
      for (const name of [...movies, ...buildOnly]) writeFileSync(join(source, name), name);
      mkdirSync(join(fixture, 'public', 'data', 'Graphic'));
      writeFileSync(join(fixture, 'public', 'data', 'Graphic', 'room.ffr'), 'unchanged');
      execFileSync(process.execPath, [join(root, 'tools', 'stage-pages-assets.mjs')], { cwd: fixture });
      expect(readdirSync(join(fixture, 'dist', 'data', 'Movie')).sort()).toEqual([...movies].sort());
      expect(existsSync(join(fixture, 'dist', 'data', 'Graphic', 'room.ffr'))).toBe(true);
      expect(existsSync(join(fixture, 'dist', '.nojekyll'))).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
