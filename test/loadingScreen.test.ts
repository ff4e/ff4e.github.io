/**
 * Contract tests for the boot splash that index.html paints on its own.
 *
 * The splash runs BEFORE the module bundle exists, so it cannot import anything: the
 * fish's lines and the language pick both live in an inline script, duplicating what
 * `subLang()` (src/app/main.ts) resolves out of `src/core/settings.ts`. Duplication
 * that nothing checks is duplication that drifts — so the checks are here, against the
 * shipped HTML, and they fail if either side moves.
 *
 * The UI probe (tools/test-loading.mjs) covers what the player sees. This covers what
 * cannot be seen from a running page: that the two frames the crab dances are the two
 * the game's own lead crab dances, that the lines exist in both languages, and that
 * the falling-back CSS is still wired the way the inline script assumes.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { defaultSettings } from '../src/core/settings.js';

const root = process.cwd();
const html = readFileSync(join(root, 'index.html'), 'utf8');

/** The `LINES` array literal out of the inline script, parsed as the browser will. */
function fishLines(): ReadonlyArray<{ cz: string; en: string }> {
  const literal = html.match(/var LINES = (\[[\s\S]*?\]);/);
  expect(literal, 'index.html no longer declares a LINES array').not.toBeNull();
  return runInNewContext(literal![1]!) as ReadonlyArray<{ cz: string; en: string }>;
}

/** Every `src` the splash's crab element points at. */
function crabFrames(): string[] {
  const block = html.match(/<div id="loading-crab"[\s\S]*?<\/div>/);
  expect(block, 'index.html no longer has a #loading-crab element').not.toBeNull();
  return [...block![0].matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
}

/** A declaration's value out of the splash's stylesheet, e.g. font for #loading-fun. */
function decl(selector: string, prop: string): string {
  const rule = html.match(new RegExp(`\\n\\s*${selector.replace(/[#.]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  expect(rule, `index.html has no CSS rule for ${selector}`).not.toBeNull();
  const found = rule![1]!.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`));
  expect(found, `${selector} declares no ${prop}`).not.toBeNull();
  return found![1]!.trim();
}

describe('boot splash — the fish’s lines', () => {
  const lines = fishLines();

  it('is a handful of lines, not one', () => {
    // Rotating over a long boot only works if there is enough to rotate through; a
    // player on a cold first visit sits here for a while.
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });

  it('gives every line both languages, and they are actually different text', () => {
    for (const l of lines) {
      expect(typeof l.cz, `cz missing on ${JSON.stringify(l)}`).toBe('string');
      expect(typeof l.en, `en missing on ${JSON.stringify(l)}`).toBe('string');
      expect(l.cz.trim().length, `empty cz on ${JSON.stringify(l)}`).toBeGreaterThan(0);
      expect(l.en.trim().length, `empty en on ${JSON.stringify(l)}`).toBeGreaterThan(0);
      // An untranslated line is the failure mode this catches: the pair shipping with
      // the Czech copied into the English slot reads as a bug to every English player.
      expect(l.cz, `${l.cz} is the same in both languages`).not.toBe(l.en);
    }
  });

  it('repeats no line in either language', () => {
    expect(new Set(lines.map((l) => l.cz)).size, 'duplicate Czech line').toBe(lines.length);
    expect(new Set(lines.map((l) => l.en)).size, 'duplicate English line').toBe(lines.length);
  });

  it('keeps every line short enough to be read at a glance', () => {
    // The line is set at 24px in a 20em box: past ~70 characters it wraps to a third
    // line, which the reserved min-height does not cover and the layout jumps.
    for (const l of lines) {
      expect(l.cz.length, `too long: ${l.cz}`).toBeLessThanOrEqual(70);
      expect(l.en.length, `too long: ${l.en}`).toBeLessThanOrEqual(70);
    }
  });
});

describe('boot splash — the language pick', () => {
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

  it('reads the same persisted settings subLang() does', () => {
    // The inline copy of subLang(): 'ff.options' is settings.ts's STORAGE_KEY, and the
    // fallback chain is subtitles -> titDef, exactly as subLang() resolves it.
    expect(inline).toContain("localStorage.getItem('ff.options')");
    expect(inline).toContain('opts.subtitles');
    expect(inline).toContain('opts.titDef');
  });

  it('defaults to the language the game itself defaults to', () => {
    const fallback = inline.match(/var lang = '(\w+)';/)?.[1];
    expect(fallback, 'the inline script no longer declares a default language').toBeDefined();
    expect(fallback).toBe(defaultSettings().subtitles);
  });
});

describe('boot splash — the dancing crab', () => {
  const frames = crabFrames();

  it('dances the two poses KORALY’s lead crab dances', () => {
    // Not an aesthetic pick: crabDance keys every crab in the room off crab 1, and
    // crab 1 alternates afaze 7 and 9 for as long as the balalaika plays
    // (src/rooms/koraly.ts <- URoom.pas:15498+). Those two frames ARE the dance; 0 is
    // standing still and 1 is the blink it does when the music stops.
    expect(frames).toEqual([
      '/enhanced-ai/KORALY/obj/krab_07.webp',
      '/enhanced-ai/KORALY/obj/krab_09.webp',
    ]);
    const koraly = readFileSync(join(root, 'src/rooms/koraly.ts'), 'utf8');
    expect(koraly, 'koraly.ts no longer drives the lead crab to frame 7').toMatch(/krab1_krabfaze\]\s*=\s*7/);
    expect(koraly, 'koraly.ts no longer drives the lead crab to frame 9').toMatch(/krab1_krabfaze\]\s*=\s*9/);
  });

  it('ships the art it points at, and it is cheap enough for the critical path', () => {
    // The splash is on the critical path by construction — it is painted before the
    // bundle — so its own art has a budget. Two frames of the ×4 AI upscale is ~7 kB
    // against the ~48 MB boot already fetches.
    let bytes = 0;
    for (const src of frames) {
      const file = join(root, 'public', src.replace(/^\//, ''));
      expect(existsSync(file), `${src} is not in public/`).toBe(true);
      bytes += readFileSync(file).length;
    }
    expect(bytes).toBeLessThan(32 * 1024);
  });

  it('shows nothing new until the art has decoded, so a failure costs the old screen', () => {
    // The fallback is CSS, not JS: the crab is display:none and the spinner visible
    // until the inline load handler adds `hascrab`. If these ever invert, a 404 takes
    // the loading screen's only sign of life with it.
    expect(decl('#loading-crab', 'display')).toBe('none');
    expect(html).toContain('#loading.hascrab #loading-crab { display: block; }');
    expect(html).toContain('#loading.hascrab .spinner { display: none; }');
  });
});

describe('boot splash — type and the reduced room-entry mode', () => {
  it('sets the fish’s line larger than the technical phase, and both above the old sizes', () => {
    // Before this screen was reworked: 13px status, 11px credit, no large line at all.
    const px = (v: string) => Number(v.match(/(\d+)px/)![1]);
    const fun = px(decl('#loading-fun', 'font'));
    const msg = px(decl('#loading-msg', 'font'));
    const credit = px(decl('#loading-credit', 'font'));
    expect(fun).toBeGreaterThanOrEqual(22);
    expect(msg).toBeGreaterThan(13);
    expect(credit).toBeGreaterThan(11);
    expect(fun).toBeGreaterThan(msg);
  });

  it('drops the joke, the title and the credit on a room entry — but not the crab', () => {
    // #loading is re-used for room entry (main.ts adds `inroom`), which is a couple of
    // seconds long: enough to want a sign of life, not enough to read a joke off.
    const stripped = html.match(/#loading\.inroom[^{]*\{\s*display:\s*none/)?.[0] ?? '';
    for (const part of ['h1', '#loading-fun', '#loading-credit']) {
      expect(stripped, `${part} is not hidden in the room-entry mode`).toContain(part);
    }
    expect(stripped, 'the crab must survive into the room-entry mode').not.toContain('#loading-crab');
  });
});
