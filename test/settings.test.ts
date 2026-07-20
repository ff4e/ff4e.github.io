import { describe, it, expect, beforeEach } from 'vitest';
import {
  VOLUMES,
  DEFAULT_INDEX,
  clampIndex,
  busMultiplier,
  defaultSettings,
  loadSettings,
  saveSettings,
  type Settings,
} from '../src/core/settings.js';

// A minimal in-memory localStorage for the persistence round-trip.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe('settings volume model (Uovl.pas Volumes / tahlo)', () => {
  it('matches the original 13-step Volumes table', () => {
    expect([...VOLUMES]).toEqual([1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64]);
  });

  it('boots at the original default levels (snd=48, talk=64, music=27)', () => {
    expect(VOLUMES[DEFAULT_INDEX.effect]).toBe(48);
    expect(VOLUMES[DEFAULT_INDEX.voice]).toBe(64);
    expect(VOLUMES[DEFAULT_INDEX.music]).toBe(27);
  });

  it('clamps slider indices to 0..12', () => {
    expect(clampIndex(-5)).toBe(0);
    expect(clampIndex(99)).toBe(12);
    expect(clampIndex(7)).toBe(7);
    expect(clampIndex(3.9)).toBe(3);
  });

  it('bus multiplier is 1.0 at the default index (classic level unchanged)', () => {
    expect(busMultiplier('effect', DEFAULT_INDEX.effect)).toBeCloseTo(1);
    expect(busMultiplier('voice', DEFAULT_INDEX.voice)).toBeCloseTo(1);
    expect(busMultiplier('music', DEFAULT_INDEX.music)).toBeCloseTo(1);
  });

  it('bus multiplier scales proportionally to Volumes across the steps', () => {
    // effect default = 48 (idx 11): index 5 (=8) -> 8/48, index 12 (=64) -> 64/48
    expect(busMultiplier('effect', 5)).toBeCloseTo(8 / 48);
    expect(busMultiplier('effect', 12)).toBeCloseTo(64 / 48);
    // muting: index 0 (=1) is a near-silent tiny fraction, never negative
    expect(busMultiplier('music', 0)).toBeGreaterThan(0);
  });
});

describe('settings persistence', () => {
  it('defaults to Czech subtitles with a matching Czech tit_def', () => {
    const s = defaultSettings();
    expect(s.subtitles).toBe('cz');
    expect(s.titDef).toBe('cz');
    expect(s.volume).toEqual({ ...DEFAULT_INDEX });
    expect(s.introSeen).toBe(false); // fresh install auto-plays the intro once
  });

  it('round-trips through localStorage', () => {
    const s: Settings = {
      volume: { effect: 3, voice: 8, music: 0 },
      subtitles: 'off',
      titDef: 'cz',
      introSeen: true,
      fitMode: 'large',
    };
    saveSettings(s);
    const loaded = loadSettings();
    expect(loaded).toEqual(s);
  });

  it("migrates the legacy 'capped' fit mode to 'medium'", () => {
    localStorage.setItem('ff.options', JSON.stringify({ fitMode: 'capped' }));
    expect(loadSettings().fitMode).toBe('medium');
  });

  it('falls back to defaults on absent/corrupt data', () => {
    expect(loadSettings()).toEqual(defaultSettings());
    localStorage.setItem('ff.options', '{ not valid json');
    expect(loadSettings()).toEqual(defaultSettings());
  });

  it('sanitizes out-of-range indices and unknown subtitle modes', () => {
    localStorage.setItem(
      'ff.options',
      JSON.stringify({ volume: { effect: 99, voice: -1, music: 5 }, subtitles: 'klingon', titDef: 'xx' }),
    );
    const loaded = loadSettings();
    expect(loaded.volume).toEqual({ effect: 12, voice: 0, music: 5 });
    expect(loaded.subtitles).toBe('cz'); // unknown -> default
    expect(loaded.titDef).toBe('cz'); // unknown -> default
  });
});
