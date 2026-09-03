/**
 * The AI tier's colour filter: what it stores, what it refuses to store, and when it
 * declares itself inactive.
 *
 * Unit tests rather than a probe, deliberately. Two of the three things worth pinning are
 * pure — clamping and parsing — and the third (whether the filter is active at all) is a
 * boolean over three numbers. None of that needs a browser, and the suite's own rule is
 * to buy a probe only when the browser IS the thing under test. What a probe would add
 * here is the DOM half — that the custom properties land and the attribute appears — and
 * that is asserted by the block added to `tools/test-devbar.mjs`.
 *
 * The clamp is the part that actually matters. `ff.aiFilter` is a localStorage key: a
 * player can edit it, a stale one can survive a version, and `brightness(0)` is a black
 * screen that persists across reloads. So the range cannot express a value that blanks
 * the game, and these tests are what says so.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_FILTER_DEFAULT,
  AI_FILTER_KEYS,
  AI_FILTER_NEUTRAL,
  AI_FILTER_RANGES,
  aiFilterActive,
  aiFilterValues,
  clampAiFilter,
  initAiFilter,
  parseAiFilter,
  resetAiFilter,
  setAiFilter,
} from '../src/app/aiFilter.js';

/** A localStorage good enough for this module: it only ever gets/sets/removes one key. */
function fakeStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage & { map: Map<string, string> };
}

let store: Storage & { map: Map<string, string> };

beforeEach(() => {
  store = fakeStorage();
  (globalThis as { localStorage?: Storage }).localStorage = store;
  resetAiFilter();
});

describe('clampAiFilter', () => {
  it('holds every channel inside its slider range', () => {
    for (const key of AI_FILTER_KEYS) {
      const { min, max } = AI_FILTER_RANGES[key];
      expect(clampAiFilter(key, min - 10)).toBe(min);
      expect(clampAiFilter(key, max + 10)).toBe(max);
      expect(clampAiFilter(key, (min + max) / 2)).toBe((min + max) / 2);
    }
  });

  it('cannot be talked into a value that blanks the screen', () => {
    // brightness(0) is black and contrast(0) is flat grey, and both would persist.
    expect(clampAiFilter('brightness', 0)).toBeGreaterThan(0);
    expect(clampAiFilter('contrast', 0)).toBeGreaterThan(0);
  });

  it('falls back to identity for anything not a finite number', () => {
    for (const bad of ['', 'abc', NaN, Infinity, null, undefined, {}]) {
      expect(clampAiFilter('contrast', bad)).toBe(AI_FILTER_NEUTRAL.contrast);
    }
  });

  it('accepts the string a range input actually produces', () => {
    expect(clampAiFilter('contrast', '1.25')).toBe(1.25);
  });
});

describe('parseAiFilter', () => {
  it('returns the SHIPPED DEFAULT for missing, malformed or non-object storage', () => {
    // Not identity. The key records a deviation from the default look, so "nothing
    // stored" has to mean "the default look" or every player would lose the grade.
    for (const raw of [null, '', 'not json', '[1,2,3]', 'null', '7']) {
      expect(parseAiFilter(raw)).toEqual(AI_FILTER_DEFAULT);
    }
  });

  it('leaves the channels a partial blob does not name at their default', () => {
    expect(parseAiFilter('{"contrast":1.2}')).toEqual({ ...AI_FILTER_DEFAULT, contrast: 1.2 });
  });

  it('clamps a persisted value that is out of range', () => {
    const v = parseAiFilter('{"brightness":99}');
    expect(v.brightness).toBe(AI_FILTER_RANGES.brightness.max);
  });

  it('falls back to the DEFAULT for a corrupt channel, not to identity', () => {
    // A half-applied grade — one channel at 1, the others graded — is worse than either
    // whole answer, so an unusable channel takes the shipped value.
    for (const bad of ['null', '"abc"', '""', '{}', '[]']) {
      const v = parseAiFilter(`{"contrast":${bad}}`);
      expect(v.contrast, `{"contrast":${bad}}`).toBe(AI_FILTER_DEFAULT.contrast);
    }
  });
});

describe('aiFilterActive', () => {
  it('is false at identity, which is what takes the canvases off the filter path', () => {
    expect(aiFilterActive(AI_FILTER_NEUTRAL)).toBe(false);
  });

  it('is true as soon as any one channel moves', () => {
    for (const key of AI_FILTER_KEYS) {
      expect(aiFilterActive({ ...AI_FILTER_NEUTRAL, [key]: 1.1 })).toBe(true);
    }
  });
});

describe('the shipped default', () => {
  it('is a real grade, so the filter is live out of the box', () => {
    expect(AI_FILTER_DEFAULT).not.toEqual(AI_FILTER_NEUTRAL);
    expect(aiFilterActive(AI_FILTER_DEFAULT)).toBe(true);
  });

  it('is inside every slider range, so the dev bar can express and undo it', () => {
    for (const key of AI_FILTER_KEYS) {
      const { min, max } = AI_FILTER_RANGES[key];
      expect(AI_FILTER_DEFAULT[key]).toBeGreaterThanOrEqual(min);
      expect(AI_FILTER_DEFAULT[key]).toBeLessThanOrEqual(max);
      expect(clampAiFilter(key, AI_FILTER_DEFAULT[key])).toBe(AI_FILTER_DEFAULT[key]);
    }
  });

  it('is the ONLY copy of the numbers — the stylesheet must not repeat them', () => {
    // A `:root { --ai-*: ... }` block was tried and removed: the rule also needs
    // `data-graphics` and `data-ai-filter`, both written by JS in the same call as the
    // properties, so a stylesheet copy is unreachable in every state. An unreachable
    // second copy of a shipped value is a trap for whoever edits one of them.
    const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
    for (const key of AI_FILTER_KEYS) {
      expect(html, `index.html must not declare --ai-${key}`).not.toMatch(new RegExp(`--ai-${key}\\s*:`));
    }
    // ...but it must still USE them, or the grade would never reach the canvases.
    expect(html).toContain('var(--ai-contrast)');
  });

  it('can be turned to greyscale but never to an unreadable screen', () => {
    // saturate(0) is a deliberate exception: greyscale keeps every shape and subtitle.
    expect(AI_FILTER_RANGES.saturate.min).toBe(0);
    expect(AI_FILTER_RANGES.contrast.min).toBeGreaterThan(0);
    expect(AI_FILTER_RANGES.brightness.min).toBeGreaterThan(0);
  });
});

describe('persistence', () => {
  it('writes the tuning under ff.aiFilter and reads it back', () => {
    setAiFilter('contrast', 1.3);
    expect(JSON.parse(store.map.get('ff.aiFilter')!).contrast).toBe(1.3);
    initAiFilter();
    expect(aiFilterValues().contrast).toBe(1.3);
  });

  it('leaves no key behind when the tuning is returned to the default', () => {
    setAiFilter('saturate', 1.4);
    expect(store.map.has('ff.aiFilter')).toBe(true);
    setAiFilter('saturate', AI_FILTER_DEFAULT.saturate);
    expect(store.map.has('ff.aiFilter')).toBe(false);
  });

  it('stores ONLY the channels that moved, so the others still track the default', () => {
    setAiFilter('contrast', 1.3);
    expect(JSON.parse(store.map.get('ff.aiFilter')!)).toEqual({ contrast: 1.3 });
    // The whole point: a later retune of the default must still reach the untouched two.
    const restored = parseAiFilter(store.map.get('ff.aiFilter')!);
    expect(restored.saturate).toBe(AI_FILTER_DEFAULT.saturate);
    expect(restored.brightness).toBe(AI_FILTER_DEFAULT.brightness);
  });

  it('stores identity, because turning the grade OFF is a real choice to remember', () => {
    for (const key of AI_FILTER_KEYS) setAiFilter(key, 1);
    expect(store.map.has('ff.aiFilter')).toBe(true);
    expect(aiFilterActive()).toBe(false);
    initAiFilter();
    expect(aiFilterValues()).toEqual(AI_FILTER_NEUTRAL);
  });

  it('resets to the default, not to identity', () => {
    setAiFilter('contrast', 1.3);
    setAiFilter('brightness', 1.1);
    expect(resetAiFilter()).toEqual(AI_FILTER_DEFAULT);
    expect(store.map.has('ff.aiFilter')).toBe(false);
  });

  it('boots to the default from empty storage', () => {
    initAiFilter();
    expect(aiFilterValues()).toEqual(AI_FILTER_DEFAULT);
    expect(aiFilterActive()).toBe(true);
  });
});
