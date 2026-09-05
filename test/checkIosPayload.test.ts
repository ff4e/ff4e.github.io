import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertStagedDist, isPackagingCommand, whyNotStaged } from '../tools/check-ios-payload.js';

/**
 * The guard that stops `cap sync` packaging the wrong `dist/`.
 *
 * Worth a test rather than a careful reading, because the thing it protects against is
 * invisible when it happens: the build succeeds, the app runs, and the only symptom is
 * ~250 MB of masters in the bundle. Nothing downstream would fail.
 */

const roots: string[] = [];
const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ff-payload-'));
  roots.push(root);
  mkdirSync(join(root, 'dist'), { recursive: true });
  return root;
};

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe('whyNotStaged', () => {
  it('passes a staged dist', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'dist/data/Music'), { recursive: true });
    writeFileSync(join(root, 'dist/data/Music/menu.m4a'), 'x');
    writeFileSync(join(root, 'dist/index.html'), 'x');
    expect(whyNotStaged(root)).toBeNull();
  });

  it('says nothing when there is no dist at all', () => {
    // Capacitor reports a missing webDir itself, and better than we would.
    const root = mkdtempSync(join(tmpdir(), 'ff-payload-'));
    roots.push(root);
    expect(whyNotStaged(root)).toBeNull();
  });

  it('catches the symlink tree test:ui leaves behind', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'public'), { recursive: true });
    symlinkSync(join('..', 'public'), join(root, 'dist/data'));
    const why = whyNotStaged(root);
    expect(why).toContain('symlinks');
    expect(why).toContain('data');
  });

  it.each([
    ['data/Music/menu.wav', 'Music/*.wav'],
    ['data/Sound/x01.ffs', 'Sound/*.ffs'],
    ['data/Help/helpy.txt', 'Help/'],
    ['data/Menu/CredStat1.BMP', 'credits BMP'],
  ])('catches %s, an original staging drops', (rel, expected) => {
    const root = makeRoot();
    mkdirSync(join(root, 'dist', rel, '..'), { recursive: true });
    writeFileSync(join(root, 'dist', rel), 'x');
    expect(whyNotStaged(root)).toContain(expected);
  });

  it('catches the two directories that must never be published', () => {
    for (const dir of ['data/Program', 'data/Writes']) {
      const root = makeRoot();
      mkdirSync(join(root, 'dist', dir), { recursive: true });
      expect(whyNotStaged(root), dir).not.toBeNull();
    }
  });
});

/**
 * And which commands the guard is allowed to stop.
 *
 * The check runs at config load, and Capacitor loads the config for EVERYTHING — so
 * before this gate existed, `cap doctor` refused to run whenever `dist/` was the UI
 * suite's symlink tree. The tool you reach for when the build is broken cannot be the
 * first tool to break.
 */
describe('isPackagingCommand', () => {
  it('says yes to the commands that copy webDir', () => {
    for (const c of ['copy', 'sync', 'run', 'build']) {
      expect(isPackagingCommand(['node', 'cap', c]), c).toBe(true);
      expect(isPackagingCommand(['node', 'cap', c, 'ios']), c).toBe(true);
    }
  });

  it('says no to the commands that only look', () => {
    for (const c of ['doctor', 'ls', 'open', 'add', 'init', 'update', 'migrate']) {
      expect(isPackagingCommand(['node', 'cap', c, 'ios']), c).toBe(false);
    }
  });

  it('finds the command past a leading flag, and does not mistake a flag for one', () => {
    expect(isPackagingCommand(['node', 'cap', '--verbose', 'sync', 'ios'])).toBe(true);
    expect(isPackagingCommand(['node', 'cap', 'run', 'ios', '--target=abc'])).toBe(true);
    expect(isPackagingCommand(['node', 'cap', '--help'])).toBe(false);
  });

  it('says no when there is no command at all', () => {
    // Which is also how the module behaves when the test suite imports it.
    expect(isPackagingCommand(['node', 'cap'])).toBe(false);
  });

  it('is what assertStagedDist consults before it exits', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'public'), { recursive: true });
    symlinkSync(join('..', 'public'), join(root, 'dist/data'));
    expect(whyNotStaged(root)).not.toBeNull(); // the tree really is unshippable
    // …and `doctor` still runs on it. If this returned, it did not call process.exit.
    expect(() => assertStagedDist(root, ['node', 'cap', 'doctor', 'ios'])).not.toThrow();
  });
});
