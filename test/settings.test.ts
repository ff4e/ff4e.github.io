import { describe, it, expect, beforeEach } from 'vitest';
import {
  VOLUMES,
  DEFAULT_INDEX,
  ORIGINAL_INDEX,
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

  it('boots effects and voices at the original levels (snd=48, talk=64)', () => {
    expect(VOLUMES[DEFAULT_INDEX.effect]).toBe(48);
    expect(VOLUMES[DEFAULT_INDEX.voice]).toBe(64);
  });

  it('keeps the ORIGINAL levels as the gain reference (snd=48, talk=64, music=27)', () => {
    expect(VOLUMES[ORIGINAL_INDEX.effect]).toBe(48);
    expect(VOLUMES[ORIGINAL_INDEX.voice]).toBe(64);
    expect(VOLUMES[ORIGINAL_INDEX.music]).toBe(27);
  });

  it('boots music at the middle of the slider, quieter than the original', () => {
    // A deliberate departure from RSound.pas:35 (music_volume=27, index 9): the
    // port boots the music slider at its midpoint so the music sits under the voices.
    expect(DEFAULT_INDEX.music).toBe(6);
    expect(VOLUMES[DEFAULT_INDEX.music]).toBe(11);
    // ...and it must be an AUDIBLE change, not just a moved jockey: normalising the
    // gain on DEFAULT_INDEX instead of ORIGINAL_INDEX would make this 1.0 again.
    expect(busMultiplier('music', DEFAULT_INDEX.music)).toBeCloseTo(11 / 27, 5);
    expect(busMultiplier('music', DEFAULT_INDEX.music)).toBeLessThan(1);
  });

  it('clamps slider indices to 0..12', () => {
    expect(clampIndex(-5)).toBe(0);
    expect(clampIndex(99)).toBe(12);
    expect(clampIndex(7)).toBe(7);
    expect(clampIndex(3.9)).toBe(3);
  });

  it('bus multiplier is 1.0 at the ORIGINAL index (classic level unchanged)', () => {
    expect(busMultiplier('effect', ORIGINAL_INDEX.effect)).toBeCloseTo(1);
    expect(busMultiplier('voice', ORIGINAL_INDEX.voice)).toBeCloseTo(1);
    expect(busMultiplier('music', ORIGINAL_INDEX.music)).toBeCloseTo(1);
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
  it('defaults to English subtitles with a matching English tit_def', () => {
    const s = defaultSettings();
    expect(s.subtitles).toBe('en');
    expect(s.titDef).toBe('en');
    expect(s.volume).toEqual({ ...DEFAULT_INDEX });
    expect(s.introSeen).toBe(false); // fresh install auto-plays the intro once
  });

  it.each(['cs', 'cs-CZ', 'cs-SK', 'CS-cz'])('defaults %s to subtitles off with Czech UI', (language) => {
    expect(defaultSettings(language)).toMatchObject({ subtitles: 'off', titDef: 'cz' });
    expect(loadSettings(language)).toEqual(defaultSettings(language));
  });

  it.each(['en', 'en-US', 'sk-SK', 'de-DE', 'fr', '', 'csharp', 'cz'])(
    'defaults non-Czech or unknown language %s to English', (language) => {
      expect(defaultSettings(language)).toMatchObject({ subtitles: 'en', titDef: 'en' });
    },
  );

  it('uses the device default for partial or corrupt options without losing unrelated settings', () => {
    localStorage.setItem('ff.options', JSON.stringify({ introSeen: true, fitMode: 'large' }));
    expect(loadSettings('cs-CZ')).toMatchObject({
      subtitles: 'off', titDef: 'cz', introSeen: true, fitMode: 'large',
    });
    localStorage.setItem('ff.options', '{broken');
    expect(loadSettings('cs-CZ')).toEqual(defaultSettings('cs-CZ'));
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

  it('uses English when stored options have no language preference', () => {
    localStorage.setItem(
      'ff.options',
      JSON.stringify({ introSeen: true, volume: { effect: 3, voice: 8, music: 0 } }),
    );
    expect(loadSettings()).toEqual({
      volume: { effect: 3, voice: 8, music: 0 },
      subtitles: 'en',
      titDef: 'en',
      introSeen: true,
      fitMode: 'medium',
    });
  });

  it.each([
    ['cz', 'cz'],
    ['en', 'en'],
    ['off', 'cz'],
    ['off', 'en'],
  ] as const)('preserves saved %s subtitles and %s tit_def', (subtitles, titDef) => {
    localStorage.setItem('ff.options', JSON.stringify({ subtitles, titDef }));
    for (const language of ['cs-CZ', 'en-US', 'de-DE']) {
      expect(loadSettings(language)).toMatchObject({ subtitles, titDef });
    }
  });

  it.each([['cs-CZ', 'en'], ['en-US', 'cz']] as const)(
    '%s device recovers missing tit_def from saved %s subtitles', (language, subtitles) => {
      localStorage.setItem('ff.options', JSON.stringify({ subtitles }));
      expect(loadSettings(language)).toMatchObject({ subtitles, titDef: subtitles });
    },
  );

  it('does not overwrite saved settings when loading another device language', () => {
    const saved = { subtitles: 'off', titDef: 'en', introSeen: true };
    localStorage.setItem('ff.options', JSON.stringify(saved));
    loadSettings('cs-CZ');
    expect(JSON.parse(localStorage.getItem('ff.options')!)).toEqual(saved);
  });

  it('sanitizes out-of-range indices and unknown subtitle modes', () => {
    localStorage.setItem(
      'ff.options',
      JSON.stringify({ volume: { effect: 99, voice: -1, music: 5 }, subtitles: 'klingon', titDef: 'xx' }),
    );
    const loaded = loadSettings();
    expect(loaded.volume).toEqual({ effect: 12, voice: 0, music: 5 });
    expect(loaded.subtitles).toBe('en'); // unknown -> default
    expect(loaded.titDef).toBe('en'); // unknown -> default
  });
});
