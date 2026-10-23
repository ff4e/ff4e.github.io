/**
 * The characters a VECTOR subtitle draws for the FFT's punctuation bytes.
 *
 * The subtitle text is CP1250, but two of its punctuation bytes do not mean what that
 * code page says — the original bitmap font (Chartab.dat/Chars.dat, IniFont,
 * URoom.pas:457-503) draws them as different marks:
 *
 *   `"`  is a three-dot ELLIPSIS: a 20 px glyph of three baseline dots, each the shape
 *        of the font's own `.`. The text uses it that way throughout — "Hmmm" Pohneš s
 *        tím", and a sentence split across two voice clips ends one with `"` and starts
 *        the next with it (1st-m-navod4/6: `…somewhere and"` / `"we'll follow…`).
 *   `` ` `` is a raised comma — the closing quote and apostrophe (`we`ll`,
 *        `'monster``). Its opening partner `'` is left alone: it is also used as a plain
 *        apostrophe (`That's`), which a straight mark draws correctly either way.
 *
 * The bitmap path (classic) draws the font's own glyphs and needs none of this. A
 * vector font draws the code point, so without it a subtitle showed an unmatched `"`
 * where the original showed `…`.
 *
 * One character in, one character out, so per-glyph wave timing (index-based) and the
 * phone wave's length bookkeeping are unchanged.
 */
const VECTOR_CHAR: Readonly<Record<string, string>> = { '"': '\u2026', '`': '\u2019' };

/** The subtitle text as a vector font should draw it. */
export function vectorSubtitleText(s: string): string {
  return s.replace(/["`]/g, (ch) => VECTOR_CHAR[ch]!);
}
