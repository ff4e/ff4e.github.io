/**
 * The player's options, changed natively: what the Options face's sliders and buttons do in
 * the browser (`playerSettings.ts`'s `setVolume` / `setSubtitleMode`, and the subtitle-face
 * pick `ff.subfont`), restated for the native host's seams. Each change is persisted to the
 * same store keys as the browser's (`ff.options` through `saveSettings`, and `ff.subfont`)
 * and applied at once: a bus gain on the mixer, the subtitle language of the next line, the
 * map's room-name plaques, the subtitle face.
 */
import { activeScript } from '../../src/app/gameState.js';
import { busMultiplier, saveSettings, type SubtitleMode, type VolumeBus } from '../../src/core/settings.js';
import { audio } from './seams/audioEngine.js';
import { settings } from './seams/playerSettings.js';
import { musicLevel } from './sound.js';
import { SUB_FACES } from './subtitleFonts.js';
import { setSubtitleFace } from './roomSubtitles.js';
import { mapLanguageChanged } from './mapScreen.js';


/**
 * Set a volume slider index (tahlo_snd/talk/music) and apply it live.
 * restates src/app/playerSettings.ts `export function setVolume(` @ e1dac5294a41
 */
export function setVolume(bus: VolumeBus, index: number): void {
  settings.volume[bus] = index;
  audio.setBusGain(bus, busMultiplier(bus, index));
  if (activeScript) activeScript.s.musicVolume = musicLevel(); // syncScriptMusicVolume
  saveSettings(settings);
}

/**
 * Set the subtitle language (obltitcz/eng/no, Uovl.pas:716-718); cz/en also becomes tit_def,
 * the one language of the titles, the plaques and the help.
 * restates src/app/playerSettings.ts `export function setSubtitleMode(` @ 5bb1b9e691ae
 */
export function setSubtitleMode(mode: SubtitleMode): void {
  settings.subtitles = mode;
  if (mode !== 'off') settings.titDef = mode;
  saveSettings(settings);
  mapLanguageChanged(); // ensureDeskyData: the plaques follow the language
}

/** The subtitle face in use: `ff.subfont`, or the default (the first candidate). */
export function subFontName(): string {
  const saved = localStorage.getItem('ff.subfont');
  return SUB_FACES.find((f) => f.name === saved)?.name ?? SUB_FACES[0]!.name;
}

/**
 * The next (or previous) subtitle face, persisted as the browser's font previewer persists
 * it (`applySubFont`), and loaded for the next line.
 * restates src/app/main.ts `function applySubFont(` @ b17f9a6c82c6
 */
export async function cycleSubFont(by: 1 | -1): Promise<void> {
  const n = SUB_FACES.length;
  const i = SUB_FACES.findIndex((f) => f.name === subFontName());
  const c = SUB_FACES[(((i + by) % n) + n) % n]!;
  localStorage.setItem('ff.subfont', c.name);
  await setSubtitleFace(c.name);
}
