/**
 * Every string the native UI draws, in English and Czech. The language is the one the
 * subtitles and the map's plaques are in (`subLang()`: the subtitle language, or with
 * subtitles off the last one chosen), which on a first run follows the system's.
 *
 * The web has no Czech UI chrome to reuse — its touch UI, menus and Options are English
 * only — so the Czech wording here follows the vocabulary of ALTAR's own Czech help
 * (`src/data/helpText.ts`): "uložit / nahrát pozici", "začít místnost od začátku",
 * "hlasitost hudby, efektů a řeči", "rybka", and its informal "ty" ("Stiskni…").
 */
import { subLang } from './seams/playerSettings.js';

const STRINGS = {
  // The legend (A4).
  move: ['Move', 'Pohyb'],
  switchFish: ['Switch fish', 'Přepnout rybku'],
  undo: ['Undo', 'Zpět'],
  menu: ['Menu', 'Menu'],
  little: ['Little', 'Malá'],
  big: ['Big', 'Velká'],
  map: ['Map', 'Mapa'],
  save: ['Save', 'Uložit'],
  load: ['Load', 'Nahrát'],
  restart: ['Restart', 'Restart'],
  choose: ['Choose', 'Vybrat'],
  options: ['Options', 'Nastavení'],
  select: ['Select', 'Potvrdit'],
  cancel: ['Cancel', 'Zrušit'],
  continue: ['Continue', 'Pokračovat'],
  change: ['Change', 'Změnit'],
  done: ['Done', 'Hotovo'],
  page: ['Page', 'Stránka'],
  close: ['Close', 'Zavřít'],
  yes: ['Yes', 'Ano'],
  no: ['No', 'Ne'],
  skip: ['Skip', 'Přeskočit'],
  // The top bar.
  worldMap: ['World map', 'Mapa'],
  help: ['Help', 'Nápověda'],
  // The confirm prompt.
  askSave: ['Save the game?', 'Uložit pozici?'],
  askLoad: ['Load the saved game?', 'Nahrát uloženou pozici?'],
  askRestart: ['Restart the room?', 'Začít místnost znovu?'],
  // Options.
  effectVolume: ['Effect volume', 'Hlasitost efektů'],
  talkVolume: ['Talk volume', 'Hlasitost řeči'],
  musicVolume: ['Music volume', 'Hlasitost hudby'],
  subtitles: ['Subtitles', 'Titulky'],
  exitOptions: ['Exit options', 'Zavřít nastavení'],
  subsOff: ['Off', 'Vypnuto'],
  helpValue: ['The rules and the controls', 'Pravidla a ovládání'],
  backToMenu: ['Back to the menu', 'Zpět do menu'],
  backToMap: ['Back to the map', 'Zpět na mapu'],
  // The intro.
  pressToStartBefore: ['Press ', 'Stiskni '],
  pressToStartAfter: [' to start', ' a hraj'],
  skipHint: ['Press any button to skip', 'Stiskni libovolné tlačítko pro přeskočení'],
} as const satisfies Record<string, readonly [string, string]>;

export type UiString = keyof typeof STRINGS;

/** The UI's language: the subtitles'. */
export const uiLang = (): 'en' | 'cz' => subLang();

/** `key` in the UI's language. */
export function t(key: UiString): string {
  return STRINGS[key][uiLang() === 'cz' ? 1 : 0];
}

/** Every string, in both languages: the menu smoke checks the UI font has a glyph for each character. */
export const allUiStrings = (): string[] => Object.values(STRINGS).flat();
