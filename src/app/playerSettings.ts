/**
 * The player's own options: subtitle language and the three volume buses.
 *
 * Small, but it earns a file by being read from nearly everywhere — the panel, the map,
 * the room, the cutscene, the help screens and the geometry all ask it something — while
 * depending on almost nothing itself. That is the shape that costs the most when it lives
 * inside `main.ts`, because every module extracted afterwards has to be handed it.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * `loadSettings()` reads `localStorage`, so it does NOT run at module scope: `persist.ts`
 * requires `migrateSaves()` to run before any `ff.*` key is read, and an imported module
 * is evaluated before any statement of its importer. `initPlayerSettings()` does the load,
 * from the point in `main.ts` where the declaration used to sit. Until then `settings`
 * holds the same defaults `loadSettings()` would fall back to. See AGENTS.md, "the
 * module-evaluation trap".
 */
import { silentFilm } from './cheats.js';
import { activeScript } from './gameState.js';
import { audio } from './audioEngine.js';
import {
  VOLUMES,
  busMultiplier,
  defaultSettings,
  loadSettings,
  saveSettings,
  type Settings,
  type SubtitleMode,
  type VolumeBus,
} from '../core/settings.js';

/**
 * The three names this module needs from `main.ts`.
 *
 * `audio` is the engine the volume buses live on; `ensureDeskyData` reloads the room-name
 * plaques when the language changes; `setInfo` refreshes the dev caption, which prints the
 * subtitle mode.
 */
export interface PlayerSettingsHost {
  readonly ensureDeskyData: () => Promise<void> | void;
  readonly setInfo: () => void;
}

let host!: PlayerSettingsHost;

// Player options (volume sliders + subtitle language), persisted across sessions
// (core/settings.ts). Subtitles extend the port's cz/en with an off state (tit_no);
// `titDef` remembers the last cz/en pick — the one language used for the titles,
// room-name plaques and help (and the subtitles when on). subLang() resolves it.
//
// `let`, and loaded in initPlayerSettings() rather than here, because `loadSettings()`
// reads localStorage: `migrateSaves()` must run before any `ff.*` key is read, and module
// scope runs before any statement of the importer. The object is replaced exactly once, at
// init, so every importer's live binding sees the loaded values from then on.
export let settings: Settings = defaultSettings();
/**
 * True while dialogue text should be shown (titles <> tit_no).
 *
 * Silent-film mode overrides the "off" setting: `Talk` swaps `titles` to `tit_def`
 * for the duration (URoom.pas:630-635), because the cheat has muted every voice
 * and the intertitle cards are all the player has left.
 */
export function subsOn(): boolean {
  return settings.subtitles !== 'off' || silentFilm;
}
/** The language to render dialogue text in (falls back to tit_def when off). */
export function subLang(): 'cz' | 'en' {
  return settings.subtitles === 'off' ? settings.titDef : settings.subtitles;
}
/**
 * Set the subtitle language (obltitcz/eng/no, Uovl.pas:716-718). Choosing cz/en
 * also updates tit_def (the remembered language used when subtitles are off), so
 * the titles/plaques/help and the subtitles are always the one same language.
 */
export function setSubtitleMode(mode: SubtitleMode): void {
  settings.subtitles = mode;
  if (mode !== 'off') settings.titDef = mode;
  saveSettings(settings);
  void host.ensureDeskyData(); // language may have changed -> reload the room-name plaques
  host.setInfo();
}
/** Set a volume slider index (tahlo_snd/talk/music) and apply it live. */
export function setVolume(bus: VolumeBus, index: number): void {
  settings.volume[bus] = index;
  audio.setBusGain(bus, busMultiplier(bus, index));
  syncScriptMusicVolume();
  saveSettings(settings);
}

/**
 * music_volume (RSound.pas:36) on the original's 0..64 scale — the level the
 * player's 0..12 slider index maps to through Volumes[]. Room scripts (VES's
 * quiet-music easter egg, URoom.pas:12190) compare against this, not the index.
 */
export function musicLevel(): number {
  if (silentFilm) return 0; // xsilent sets music_volume := 0 (URoom.pas:24647)
  return VOLUMES[Math.max(0, Math.min(VOLUMES.length - 1, settings.volume.music))]!;
}

/** Push the effective music_volume at the running room script. */
export function syncScriptMusicVolume(): void {
  if (activeScript) activeScript.s.musicVolume = musicLevel();
}

/** Push all persisted volume levels into the audio buses (NastavZvuk, on boot). */
export function applyVolumeSettings(): void {
  for (const bus of ['effect', 'voice', 'music'] as const) {
    audio.setBusGain(bus, busMultiplier(bus, settings.volume[bus]));
  }
}

/** Hand this module its view of the game and load the persisted options. */
export function initPlayerSettings(h: PlayerSettingsHost): void {
  host = h;
  settings = loadSettings();
}
