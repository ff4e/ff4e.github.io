/**
 * The menu smoke's checks of what the UI draws with, apart from any one screen: the carved
 * icons (`rusticIcons.ts`) and the UI's strings (`uiStrings.ts`) in its font.
 */
import { iconNames, partCounts, releaseIcons, warmIcon } from './rusticIcons.js';
import type { UiFonts } from './uiDraw.js';
import { allUiStrings } from './uiStrings.js';

type Check = (ok: boolean, what: string) => void;

const ms = (t0: number): number => Math.round(__native.now() - t0);

/**
 * Every icon rasterises with ink in each painted part, and the fast rasteriser makes the
 * masks the exhaustive one does in this interpreter too. Then the cost a 4K TV (2160 lines)
 * pays: the whole set at the pause menu's and the confirm prompt's sizes there — printed, and
 * held under a bound far above it (a wall-clock gate is only a tripwire under load; this one
 * is for a return to testing every segment at every sample, which took ~6 s for the pause
 * menu's icons alone).
 */
export function checkIcons(check: Check): void {
  const names = iconNames();
  const empty = names.filter((n) => warmIcon(n, 40).some((ink) => !(ink > 0)));
  check(empty.length === 0, `every icon (${names.length}) rasterises, with ink in every painted part${empty.length ? `; not ${empty.join(', ')}` : ''}`);
  // In this interpreter the exhaustive way is slow (~1 s at 25 px, ~6 s with 1080 lines' 40
  // and 48): one size here, 25 px, where a stroke once lost a sample, and
  // test/native-icons.test.ts sweeps 45 sizes under V8 in ~2 s.
  const t1 = __native.now();
  const differ = names.filter((n) => {
    const fast = partCounts(n, 25), slow = partCounts(n, 25, true);
    return fast.some((c, i) => c.some((v, p) => v !== slow[i]![p]));
  });
  check(differ.length === 0, `the fast rasteriser's masks are the exhaustive one's at 25 px (${ms(t1)} ms)${differ.length ? `; not ${differ.join(', ')}` : ''}`);
  const at4k: string[] = [];
  let total = 0;
  for (const size of [80, 96]) {
    releaseIcons();
    const t0 = __native.now();
    for (const n of names) warmIcon(n, size);
    total += ms(t0);
    at4k.push(`${ms(t0)} ms at ${size} px`);
  }
  releaseIcons();
  check(total < 2000, `at 2160 lines the whole set rasterises in ${at4k.join(', ')}`);
}

/** A glyph's pixels, to tell it from the face's missing-glyph box. */
function glyphKey(face: number, cp: number): string {
  const g = __native.fontGlyph(face, cp, 34, 0, 0, 0);
  return g.w ? `${g.w}×${g.h} ${new Uint8Array(g.fill!).join()}` : '';
}

/**
 * Every UI string, in both languages, has a glyph for each character in both of the UI's
 * weights: one that inks, and is not the face's missing-glyph box (what a code point no font
 * has draws).
 */
export function checkStrings(check: Check, fonts: UiFonts): void {
  const strings = allUiStrings();
  const chars = [...new Set(strings.join(''))].filter((c) => c.trim() !== '');
  const missing: string[] = [];
  for (const face of [fonts.regular, fonts.bold]) {
    const notdef = glyphKey(face.id, 0x10ffff);
    for (const c of chars) {
      const key = glyphKey(face.id, c.codePointAt(0)!);
      if (!key || key === notdef) missing.push(`${c} (${face.name})`);
    }
  }
  check(missing.length === 0, `every UI string (${strings.length}, English and Czech) has a glyph for each of its ${chars.length} characters in the UI font${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
}
