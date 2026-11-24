/**
 * The player's options, changed natively: what the Options face's sliders and buttons do in
 * the browser (`playerSettings.ts`'s `setVolume` / `setSubtitleMode`), restated for the
 * native host's seams. Each change is persisted to the same store key as the browser's
 * (`ff.options`, through `saveSettings`) and applied at once: a bus gain on the mixer, the
 * subtitle language of the next line, the map's room-name plaques. The subtitle face is not
 * offered here: the subtitles read `ff.subfont` (`roomSubtitles.ts`), but nothing native
 * changes it.
 */
import { activeScript } from '../../src/app/gameState.js';
import { busMultiplier, saveSettings, type SubtitleMode, type VolumeBus } from '../../src/core/settings.js';
import { audio } from './seams/audioEngine.js';
import { settings } from './seams/playerSettings.js';
import { musicLevel } from './sound.js';
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
