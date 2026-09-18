/** Phone captions keep a screen-sized font; words wrap instead of shrinking the glyphs. */
export const PHONE_SUBTITLE_FONT_PX = 20;

/** Source rows retain their lifetimes, but share one wrapping context and message wave. */
export function phoneSubtitleMessage(host: HTMLDivElement, block: number, font: string): HTMLDivElement {
  const existing = host.querySelector<HTMLDivElement>(`[data-subtitle-block="${block}"]`);
  if (existing) return existing;
  const message = document.createElement('div');
  message.dataset.subtitleBlock = String(block);
  message.style.cssText =
    `flex:0 0 auto;padding:0 2px;box-sizing:border-box;text-align:center;white-space:normal;text-wrap:balance;font:${font}`;
  host.appendChild(message);
  return message;
}

export function phoneSubtitleWordFlow(row: HTMLDivElement): (glyph: HTMLSpanElement, ch: string) => void {
  row.style.position = 'relative';
  row.style.display = 'inline';
  row.style.whiteSpace = 'normal';
  row.style.lineHeight = 'var(--phone-subtitle-line-height, 1.5)';
  row.style.transition = 'none';
  row.style.transform = '';
  row.style.willChange = '';
  // Restore the space consumed by the engine's bitmap wrap; leading whitespace collapses.
  row.append(' ');
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

export function phoneSubtitlePositions(rows: Iterable<Element>): Map<Element, number> {
  return new Map([...rows].map((row) => [row, row.getBoundingClientRect().top]));
}

/** Scroll existing messages only when new text arrives, never when old text expires. */
export function animatePhoneSubtitleRows(previous: Map<Element, number>): void {
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
