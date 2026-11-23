/**
 * Seam for `src/app/playerSettings.ts` (persisted options, read through the audio engine, the
 * device gate and the DOM shell's host). The subtitle half is real: the same `ff.options`
 * the browser keeps, loaded from the native store, deciding whether a line is shown and in
 * which language. The volumes wait for the native audio.
 *
 * The default language follows the browser's rule for a device that is not a desktop — a
 * TV or a console is not — which is the system's: Czech on a Czech system, else English
 * (`defaultSettings`). The host reports it (`locale`).
 */
import type * as Real from '../../../src/app/playerSettings.js';
import { defaultSettings, loadSettings, type Settings } from '../../../src/core/settings.js';

export let settings: Settings = defaultSettings();

/**
 * `initPlayerSettings`' load, without the host it hands over: the native host has no plaque
 * reload or info line to refresh. After the store is loaded (`initGame`).
 */
export function initNativeSettings(language: string | null): void {
  settings = loadSettings(language ?? undefined);
}

/**
 * Whether dialogue text is shown. The browser's also shows it in silent-film mode, a cheat
 * the native host cannot type.
 * restates src/app/playerSettings.ts `export function subsOn(` @ 2803d6071dae
 */
export const subsOn: typeof Real.subsOn = () => settings.subtitles !== 'off';
/** restates src/app/playerSettings.ts `export function subLang(` @ 35881fad1b32 */
export const subLang: typeof Real.subLang = () => (settings.subtitles === 'off' ? settings.titDef : settings.subtitles);
