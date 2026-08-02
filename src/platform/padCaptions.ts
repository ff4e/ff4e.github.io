/**
 * Controller-correct tutorial captions.
 *
 * KUFRIK's demonstration teaches saving and loading by naming PC keys — "press the F2
 * key", "press the F3 key", "press F1 and read the help section". On a console those
 * keys do not exist, so the game's own tutorial teaches controls the player cannot use.
 *
 * These are drop-in replacements for the affected captions, applied to the parsed FFT
 * only when the console build is running (see `applyPadCaptions`). The original data
 * files are never modified: this is a lookup over what was loaded, so the web build and
 * the shipped assets are untouched, and a future re-extract cannot lose the edit.
 *
 * All four lines belong to the big fish, which is why only one voice has to be
 * reproduced when the matching audio is recorded (see tools/extract-voice.mjs).
 * Replacement wording deliberately keeps the sentence shape and roughly the length of
 * the original, so the caption still matches the pacing of the scene.
 */
import type { FftEntry, FftSubtitle } from '../data/fft.js';

/** Czech and English replacements, keyed by caption id. */
interface CaptionText {
  readonly cz: string;
  readonly en: string;
}

const PAD_CAPTIONS: Readonly<Record<string, CaptionText>> = {
  help2: {
    cz: 'Než vstoupíme do dílny, uložíme si pozici - dělá se to tlačítkem LB.',
    en: "Before entering the workshop, let`s save the game - just press the LB button.",
  },
  help7: {
    cz: 'Nyní začínáme znovu - můžeme však nahrát uloženou pozici tlačítkem RB.',
    en: "Now we`ll start again - or we can load the saved game by pressing the RB button.",
  },
  help11: {
    cz: 'Znovu nahrajeme pozici tlačítkem RB.',
    en: 'Again, we load a saved game by pressing the RB button.',
  },
  help22: {
    cz: 'Tak, to by asi bylo z pravidel všechno. Chceš-li vědět více, stiskni tlačítko Menu a vyber Nápovědu.',
    en: "That`s about it for the rules. If you want to know more, press the Menu button and choose Help.",
  },
};

/** True when `name` has a controller-specific replacement. */
export function hasPadCaption(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PAD_CAPTIONS, name);
}

/** Re-wrap replacement text as a subtitle, preserving the original's colour code. */
function retext(orig: FftSubtitle, text: string): FftSubtitle {
  return { color: orig.color, text, raw: orig.color ? `${orig.color} ${text}` : text };
}

/**
 * Return `entries` with the tutorial captions rewritten for a controller. Returns the
 * input unchanged when `on` is false, or when the room contains none of them — so this
 * costs nothing for the 75 rooms that are not the tutorial.
 */
export function applyPadCaptions(entries: readonly FftEntry[], on: boolean): readonly FftEntry[] {
  if (!on || !entries.some((e) => hasPadCaption(e.name))) return entries;
  return entries.map((e) => {
    const repl = PAD_CAPTIONS[e.name];
    if (!repl) return e;
    return { ...e, cz: retext(e.cz, repl.cz), en: retext(e.en, repl.en) };
  });
}
