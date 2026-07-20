/**
 * Player-adjustable options (the control-panel Options sub-panel, Uovl.pas):
 * three 13-step volume sliders + the subtitle language, persisted across
 * sessions. Faithful to the original's model — a slider is a 0..12 index
 * (`tahlo_snd/talk/music`) mapped to a level through the `Volumes[]` table
 * (Uovl.pas:19), and the subtitle mode is Czech / English / off
 * (`titles = tit_cz | tit_eng | tit_no`, with `tit_def` remembering the last
 * non-off choice for the help screens).
 */

import { isFitMode, type FitMode } from '../app/layout.js';

/** The 13 slider levels (Uovl.pas:19 `Volumes:array[0..12]`). */
export const VOLUMES = [1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64] as const;

/** The three volume categories, each with its own slider + audio bus. */
export type VolumeBus = 'effect' | 'voice' | 'music';

/** Subtitle language, extending the port's cz/en with an off state (tit_no). */
export type SubtitleMode = 'cz' | 'en' | 'off';

/**
 * Default slider indices — the levels the original boots with (RSound.pas:33-35
 * snd_volume=48, talk_volume=64, music_volume=27, read into tahlo by PrectiZvuk,
 * Uovl.pas:286): snd -> 48 (index 11), talk -> 64 (index 12), music -> 27 (index 9).
 */
export const DEFAULT_INDEX: Record<VolumeBus, number> = {
  effect: 11,
  voice: 12,
  music: 9,
};

/** Clamp a raw slider index to the valid 0..12 range. */
export function clampIndex(i: number): number {
  return Math.max(0, Math.min(VOLUMES.length - 1, Math.floor(i)));
}

/**
 * The bus-gain multiplier for a slider index, relative to the category's
 * default level (so the default index yields exactly 1.0 and the existing
 * per-call category mix — EFFECT_VOL etc. — is preserved unchanged). Across the
 * 13 steps the multiplier is proportional to `Volumes[]`, matching the original's
 * playback curve (which is likewise proportional to the chosen volume level).
 */
export function busMultiplier(bus: VolumeBus, index: number): number {
  return VOLUMES[clampIndex(index)]! / VOLUMES[DEFAULT_INDEX[bus]]!;
}

export interface Settings {
  /** Slider indices per category (tahlo_snd/talk/music), 0..12. */
  volume: Record<VolumeBus, number>;
  /** Current subtitle language (titles). */
  subtitles: SubtitleMode;
  /** Last non-off subtitle language (tit_def) — used by the help screens. */
  titDef: 'cz' | 'en';
  /**
   * Whether the intro movie has already been shown (the original's `START`
   * registry flag, flipped `START`→`NO` after the first run — UMain.pas:677-682).
   * False on a fresh install so the logo→intro chain auto-plays once; the map's
   * top-left corner replays the intro regardless.
   */
  introSeen: boolean;
  /**
   * Room-scaling fit mode (public-release Approach D/C). 'fixed' keeps a constant
   * on-screen object size in every room (small rooms letterboxed); the graded
   * 'small'/'medium'/'large'/'fill' modes enlarge small rooms by an increasing
   * amount so they fill more of the stage. (Legacy 'capped' loads as 'medium'.)
   */
  fitMode: FitMode;
}

const STORAGE_KEY = 'ff.options';

/** The port's factory defaults (subtitles default to Czech — the port's choice —
 *  and tit_def matches, so the titles/plaques/help and subtitles start as one
 *  consistent language). */
export function defaultSettings(): Settings {
  return {
    volume: { ...DEFAULT_INDEX },
    subtitles: 'cz',
    titDef: 'cz',
    introSeen: false,
    fitMode: 'medium',
  };
}

function isBusRecord(v: unknown): v is Record<VolumeBus, number> {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (['effect', 'voice', 'music'] as const).every((k) => typeof o[k] === 'number');
}

/** Load persisted settings from localStorage, falling back to defaults. */
export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return s;
    const j = JSON.parse(raw) as Partial<Settings>;
    if (isBusRecord(j.volume)) {
      for (const bus of ['effect', 'voice', 'music'] as const) {
        s.volume[bus] = clampIndex(j.volume[bus]);
      }
    }
    if (j.subtitles === 'cz' || j.subtitles === 'en' || j.subtitles === 'off') {
      s.subtitles = j.subtitles;
    }
    if (j.titDef === 'cz' || j.titDef === 'en') s.titDef = j.titDef;
    if (typeof j.introSeen === 'boolean') s.introSeen = j.introSeen;
    // Legacy 'capped' → 'medium'; otherwise accept any current fit mode.
    const fm = (j as { fitMode?: unknown }).fitMode;
    if (fm === 'capped') s.fitMode = 'medium';
    else if (isFitMode(fm)) s.fitMode = fm;
  } catch {
    /* corrupt/absent — keep defaults */
  }
  return s;
}

/** Persist settings to localStorage. */
export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — ignore */
  }
}
