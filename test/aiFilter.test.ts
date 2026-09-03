/**
 * The AI tier's colour filter: what it stores, what it refuses to store, and when it
 * declares itself inactive.
 *
 * Unit tests rather than a probe, deliberately. Two of the three things worth pinning are
 * pure — clamping and parsing — and the third (whether the filter is active at all) is a
 * boolean over three numbers. None of that needs a browser, and the suite's own rule is
 * to buy a probe only when the browser IS the thing under test. What a probe would add
 * here is the DOM half — that the custom properties land and the attribute appears — and
 * that is asserted by `tools/test-ai-filter.mjs`.
 *
 * The clamp is the part that actually matters. `ff.aiFilter` is a localStorage key: a
 * player can edit it, a stale one can survive a version, and `brightness(0)` is a black
 * screen that persists across reloads. So the range cannot express a value that blanks
 * the game, and these tests are what says so.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
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

  it('falls back to neutral for anything not a finite number', () => {
    for (const bad of ['', 'abc', NaN, Infinity, null, undefined, {}]) {
      expect(clampAiFilter('contrast', bad)).toBe(AI_FILTER_NEUTRAL.contrast);
    }
  });

  it('accepts the string a range input actually produces', () => {
    expect(clampAiFilter('contrast', '1.25')).toBe(1.25);
  });
});

describe('parseAiFilter', () => {
  it('returns neutral for missing, malformed or non-object storage', () => {
    for (const raw of [null, '', 'not json', '[1,2,3]', 'null', '7']) {
      expect(parseAiFilter(raw)).toEqual(AI_FILTER_NEUTRAL);
    }
  });

  it('fills a missing channel with its neutral value rather than dropping it', () => {
    expect(parseAiFilter('{"contrast":1.2}')).toEqual({ ...AI_FILTER_NEUTRAL, contrast: 1.2 });
  });

  it('clamps a persisted value that is out of range', () => {
    const v = parseAiFilter('{"brightness":99}');
    expect(v.brightness).toBe(AI_FILTER_RANGES.brightness.max);
  });
});

describe('aiFilterActive', () => {
  it('is false at identity, which is what keeps the filter off the shipped default', () => {
    expect(aiFilterActive(AI_FILTER_NEUTRAL)).toBe(false);
  });

  it('is true as soon as any one channel moves', () => {
    for (const key of AI_FILTER_KEYS) {
      expect(aiFilterActive({ ...AI_FILTER_NEUTRAL, [key]: 1.1 })).toBe(true);
    }
  });
});

describe('persistence', () => {
  it('writes the tuning under ff.aiFilter and reads it back', () => {
    setAiFilter('contrast', 1.3);
    expect(JSON.parse(store.map.get('ff.aiFilter')!).contrast).toBe(1.3);
    initAiFilter();
    expect(aiFilterValues().contrast).toBe(1.3);
  });

  it('leaves no key behind when the tuning is returned to identity', () => {
    setAiFilter('saturate', 1.4);
    expect(store.map.has('ff.aiFilter')).toBe(true);
    setAiFilter('saturate', 1);
    expect(store.map.has('ff.aiFilter')).toBe(false);
  });

  it('resets every channel at once', () => {
    setAiFilter('contrast', 1.3);
    setAiFilter('brightness', 1.1);
    expect(resetAiFilter()).toEqual(AI_FILTER_NEUTRAL);
    expect(store.map.has('ff.aiFilter')).toBe(false);
  });

  it('boots neutral from empty storage', () => {
    initAiFilter();
    expect(aiFilterValues()).toEqual(AI_FILTER_NEUTRAL);
    expect(aiFilterActive()).toBe(false);
  });
});
