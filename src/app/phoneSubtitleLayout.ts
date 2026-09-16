/** Phone captions keep a screen-sized font; words wrap instead of shrinking the glyphs. */
export const PHONE_SUBTITLE_FONT_PX = 20;

export function phoneSubtitleWordFlow(row: HTMLDivElement): (glyph: HTMLSpanElement, ch: string) => void {
  row.style.position = 'relative';
  row.style.flex = '0 0 auto';
  row.style.whiteSpace = 'normal';
  row.style.transition = 'none';
  row.style.padding = '0 2px';
  row.style.boxSizing = 'border-box';
  let word: HTMLSpanElement | null = null;
  return (glyph, ch) => {
    if (ch === ' ') {
      row.append(' ');
      word = null;
      return;
    }
    if (!word) {
      word = document.createElement('span');
      word.className = 'subtitle-word';
      // A normal word moves as one unit; an overlong word can wrap between its glyphs.
      word.style.cssText = 'display:inline-block;width:max-content;max-width:100%;white-space:normal;vertical-align:top';
      row.appendChild(word);
    }
    word.appendChild(glyph);
  };
}

export function phoneSubtitlePositions(rows: Iterable<HTMLElement>): Map<HTMLElement, number> {
  return new Map([...rows].map((row) => [row, row.getBoundingClientRect().top]));
}

/** Keep the existing one-tick scroll, even when a source row becomes several visual rows. */
export function animatePhoneSubtitleRows(previous: Map<HTMLElement, number>): void {
  for (const [row, top] of previous) {
    if (!row.isConnected) continue;
    for (const animation of row.getAnimations()) animation.cancel();
    const dy = top - row.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.1) continue;
    row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0px)' }], {
      duration: 80, easing: 'linear',
    });
  }
}
