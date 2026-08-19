/**
 * The rule that the all-or-nothing version of this code got wrong.
 *
 *   **No interaction-driven fetch may be `mustHave`.**
 *
 * PR #103 made every asset failure end the session. That was right for a room's FFR and
 * wrong for a large class of assets nobody had separated out: the ones fetched IN
 * RESPONSE TO A GESTURE. The world map fetches a room's name plaque WHEN YOU HOVER IT
 * (140 of them at ×4 would be ~30 MB to hold, so they are deliberately fetched and
 * evicted on demand), and the briefcase cutscene fetches its upscaled frames from the
 * DRAW path. Under all-or-nothing, moving the mouse across the world map could end the
 * session.
 *
 * The fix is the three tiers in `src/render/assetFetch.ts`. This file is what stops the
 * mistake being made again, because "remember not to mark the hover loader must-have" is
 * not a thing anyone remembers eighteen months from now.
 *
 * ── Why it is shaped like this ────────────────────────────────────────────────
 * The obvious test — walk the call graph from every pointer handler and every draw
 * function, and check what it reaches — is a static analysis this repo would then own and
 * maintain, and a name-based approximation of it produces confident nonsense in both
 * directions. So the check is split into two much duller ones that between them are hard
 * to slip past:
 *
 *  1. **The must-have surface is pinned, per file.** Adding a `mustHave` anywhere in
 *     `src/` fails this test until the author edits the census below — which is the
 *     moment they are asked whether the thing they just made fatal can be reached from a
 *     hover. It is a census and not a line-number list so that ordinary edits inside a
 *     file do not churn it.
 *  2. **The known interaction-driven loaders are pinned by name.** These are the five
 *     functions the bug was actually about. Each is looked up in its source file — a
 *     rename or a deletion FAILS rather than quietly passing — and must not contain a
 *     `mustHave`.
 *
 * Neither is clever. The first catches "a new fatal asset appeared"; the second catches
 * "someone re-tiered the hover path". The bug that shipped needed both to be absent.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = 'src';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).sort();

/** Tier literals in a file, counted. The module that DEFINES them is not a call site. */
function tiersIn(file: string): Record<string, number> {
  if (file === join('src', 'render', 'assetFetch.ts')) return {};
  // `case 'mustHave':` in the router is the tier being READ, not an asset being
  // classified. Dropped rather than special-casing the file, so a second reader of the
  // tier does not silently start inflating the census.
  const text = readFileSync(file, 'utf8').replace(/case\s+'(?:mustHave|shouldHave|niceToHave)'\s*:/g, '');
  const counts: Record<string, number> = {};
  for (const tier of ['mustHave', 'shouldHave', 'niceToHave']) {
    const n = text.split(`'${tier}'`).length - 1;
    if (n > 0) counts[tier] = n;
  }
  return counts;
}

/**
 * The must-have census: how many assets each file declares the game cannot run without.
 *
 * Every one of these is on a path the player deliberately took — boot, or entering a
 * room, or starting a cutscene — and everything a room will use is fetched up front on
 * the deliberate act of entering it. That is the property this number is protecting.
 *
 * If this test failed because you added a fetch: good. Answer the question in the header
 * before you change the number. Can the thing you just made fatal be requested because
 * the pointer moved, or because a frame was drawn? If so it is `shouldHave` at most.
 */
const MUST_HAVE_CENSUS: Record<string, number> = {
  // ── Boot: nothing is playable until these land ──────────────────────────────
  'src/app/boot.ts': 4, // world-map bitmaps, the subtitle faces (fetch + decode), panel.ffp
  'src/render/font.ts': 1, // the 1998 bitmap font
  'src/app/mapDraw.ts': 2, // the CLASSIC name plaques (popdesk + atlas) — awaited by boot
  'src/app/main.ts': 3, // the enhanced fish sprites: manifest, sprite, decode
  // ── A room, fetched up front on the deliberate act of entering it ───────────
  'src/app/roomLoad.ts': 11, // FFR, FFT, the sound packages, the voices, the music
  'src/audio/audio.ts': 2, // music, both the room's and the menu's
  'src/app/enhancedLoad.ts': 9, // the room's enhanced art and its animation frames
  'src/render/enhancedObjects.ts': 3, // the room's object sprites
  'src/render/roomAi.ts': 5, // the room's AI art, its manifest and the AI fish
  // ── Always on screen, or the thing the player is looking at ─────────────────
  'src/render/panelAi.ts': 2, // the AI control panel
  'src/render/worldMapAi.ts': 2, // the AI world map itself
  // ── A cutscene the player started ───────────────────────────────────────────
  'src/app/cutscene.ts': 3, // the briefcase demonstration and the KUFRIK demonstration
};

/**
 * The loaders a GESTURE can start, and the tier each is allowed.
 *
 * `fn` is looked up in the file, so a rename fails this test rather than disarming it.
 */
const INTERACTION_DRIVEN = [
  {
    file: 'src/app/mapDraw.ts',
    fn: 'loadAiPlaque',
    why: 'kicked from aiPlaqueFor, which runs from the map DRAW: hovering a room node starts a fetch',
  },
  {
    file: 'src/app/mapDraw.ts',
    fn: 'ensureAiDeskyGeom',
    why: 'same path — the first plaque a hover needs asks for the geometry',
  },
  {
    file: 'src/app/cutscene.ts',
    fn: 'loadAiKufrFrame',
    why: 'the cutscene DRAW prefetches the next four frames on every frame it shows',
  },
  {
    file: 'src/app/cutscene.ts',
    fn: 'ensureAiKufr',
    why: 'kicked from the cutscene draw path when the tier is `ai`',
  },
  {
    file: 'src/app/introOverlay.ts',
    fn: 'probeAiMovies',
    why: 'an existence probe whose answer IS the fallback; nothing to tell anyone either way',
  },
] as const;

/**
 * The body of a named function, or null.
 *
 * Brace-matched with the string and comment states tracked, because a naive counter trips
 * over the `${dir}w${f}.png` template literals and the `//` in every URL in this codebase.
 */
function bodyOf(text: string, fn: string): string | null {
  const header = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*[(<]`).exec(text);
  if (!header) return null;
  let i = text.indexOf('{', header.index);
  if (i === -1) return null;
  const start = i;
  let depth = 0;
  let state: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  for (; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (state === 'line') { if (c === '\n') state = 'code'; continue; }
    if (state === 'block') { if (c === '*' && next === '/') { state = 'code'; i++; } continue; }
    if (state === "'" || state === '"' || state === '`') {
      if (c === '\\') { i++; continue; }
      if (c === state) state = 'code';
      continue;
    }
    if (c === '/' && next === '/') { state = 'line'; i++; continue; }
    if (c === '/' && next === '*') { state = 'block'; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { state = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

describe('asset tiers', () => {
  it('declares a tier at every call site — the doors have no default', () => {
    // Not a re-test of the type system; a guard on the ONE thing the type system cannot
    // see. `assetFetch.ts` requires the argument, so a call site without a tier does not
    // compile — but a call site that passes a tier held in a variable would compile and
    // would make the census below unreadable. Every tier in this codebase is a literal.
    const dynamic: string[] = [];
    for (const f of FILES) {
      if (f === join('src', 'render', 'assetFetch.ts')) continue;
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\b(required(?:Asset|Bytes|Text|Json|Blob)|optionalAsset)\s*(?:<[^>]*>)?\s*\(/g)) {
        const tail = text.slice(m.index, m.index + 400);
        if (!/'(mustHave|shouldHave|niceToHave)'/.test(tail)) dynamic.push(`${f}: ${m[1]}`);
      }
    }
    expect(dynamic, 'every door call names its tier as a literal, so it can be reviewed by reading').toEqual([]);
  });

  it('pins the must-have surface: nothing new becomes fatal without someone saying so', () => {
    const actual: Record<string, number> = {};
    for (const f of FILES) {
      const n = tiersIn(f).mustHave;
      if (n) actual[f.split('\\').join('/')] = n;
    }
    expect(
      actual,
      'The set of assets that END THE SESSION changed.\n' +
        'Before updating the numbers, answer the question this test exists to ask:\n' +
        'can the asset you just made must-have be requested because the pointer moved,\n' +
        'or because a frame was drawn? If so it is shouldHave at most — see the rule in\n' +
        'src/render/assetFetch.ts.',
    ).toEqual(MUST_HAVE_CENSUS);
  });

  for (const { file, fn, why } of INTERACTION_DRIVEN) {
    it(`${fn}() is not must-have — ${why}`, () => {
      const body = bodyOf(readFileSync(file, 'utf8'), fn);
      // A rename or a deletion fails HERE rather than passing an empty check, which is
      // the whole reason the body is looked up by name instead of grepped for.
      expect(body, `${fn}() not found in ${file} — was it renamed? Update this list.`).not.toBeNull();
      expect(
        body?.includes("'mustHave'"),
        `${fn}() asks for mustHave, and it is reachable from a gesture: ${why}.\n` +
          'That is the bug this test exists for — a hover could end the session.',
      ).toBe(false);
    });
  }

  it('keeps a should-have surface to report to, and a silent tier that reports nothing', () => {
    // The middle tier is worth nothing without somewhere to say it, and the bottom tier
    // is worth nothing if it is really the middle one. Both are asserted at the router
    // rather than at a call site, because that is where a tier becomes a surface.
    const ui = readFileSync(join('src', 'app', 'loadingUi.ts'), 'utf8');
    const route = bodyOf(ui, 'reportAssetError');
    expect(route, 'reportAssetError() not found — the tiers have no router').not.toBeNull();
    // Comments stripped first: this file explains itself at length, and half those
    // sentences name the very functions being counted.
    const code = (route ?? '').replace(/\/\/[^\n]*/g, '');
    expect(code).toContain('failAssets('); // mustHave
    expect(code).toContain('showLoadNote('); // shouldHave
    // niceToHave reaches no surface at all. Asserted as the ABSENCE of a third call
    // rather than by reading the switch, so wiring one in fails here.
    expect((code.match(/showLoadNote\(|failAssets\(|showFatal\(/g) ?? []).length).toBe(2);
  });
});
