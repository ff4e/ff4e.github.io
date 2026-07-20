/**
 * The control-help screens (Help.pas / FHelp): a set of full-screen 640x480
 * pages the original shows when the player opens Help from the options panel
 * (akce_help / ToggleHelp). The page list + order come from the index file
 * (`helpy.txt` for Czech, `helps.txt` for English, Help.pas:FormShow) — its first
 * line is `W H margin`, then alternating tab-name / BMP-filename lines.
 *
 * Navigation mirrors the original: clicking advances to the next page (wrapping),
 * and any key closes the viewer (Help.pas:Image1Click / FormKeyDown).
 */
import { parseBmp, bmpToRgba } from '../data/bmp.js';

export interface HelpPage {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
}

export class HelpScreens {
  /** Loaded pages per language (cz/en), lazily fetched + cached. */
  private byLang = new Map<'cz' | 'en', HelpPage[]>();
  page = 0;

  /** Parse an index file into the ordered list of BMP filenames (Help.pas:FormShow). */
  private static parseIndex(text: string): string[] {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /\.bmp$/i.test(l));
  }

  /** Fetch + decode the help pages for a language (cached). */
  async load(lang: 'cz' | 'en'): Promise<HelpPage[]> {
    const cached = this.byLang.get(lang);
    if (cached) return cached;
    const index = lang === 'cz' ? 'helpy.txt' : 'helps.txt';
    const text = await fetch(`/data/Help/${index}`).then((r) => r.text());
    const files = HelpScreens.parseIndex(text);
    const pages = await Promise.all(
      files.map(async (f) => {
        const ab = await fetch(`/data/Help/${f}`).then((r) => r.arrayBuffer());
        const bmp = parseBmp(new Uint8Array(ab));
        return { rgba: bmpToRgba(bmp), w: bmp.w, h: bmp.h };
      }),
    );
    this.byLang.set(lang, pages);
    return pages;
  }

  /** The pages for a language if already loaded (else empty). */
  pages(lang: 'cz' | 'en'): HelpPage[] {
    return this.byLang.get(lang) ?? [];
  }

  /** Advance to the next page, wrapping (Image1Click, Help.pas). */
  next(count: number): void {
    if (count > 0) this.page = (this.page + 1) % count;
  }

  /** Go to the previous page, wrapping. */
  prev(count: number): void {
    if (count > 0) this.page = (this.page - 1 + count) % count;
  }
}
