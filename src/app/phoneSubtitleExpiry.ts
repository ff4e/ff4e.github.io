import type { SubtitleSystem } from '../render/subtitles.js';

export type SubtitleRow = ReturnType<SubtitleSystem['debugLines']>[number];

export interface PhoneSubtitleLine {
  source: SubtitleRow;
  spans: HTMLSpanElement[];
  expired: boolean;
}

/** Expired source rows still supply text to a displayed line crossing a bitmap break. */
export function retainPhoneSubtitleRows(
  active: readonly SubtitleRow[],
  previous: Iterable<Pick<PhoneSubtitleLine, 'source'>>,
): SubtitleRow[] {
  const ids = new Set(active.map(row => row.id));
  const blocks = new Set(active.map(row => row.block));
  // The engine expires oldest-first, so retained rows precede the active rows.
  const retained = [...previous].map(line => line.source)
    .filter(row => !ids.has(row.id) && blocks.has(row.block));
  return [...retained, ...active];
}

/** Read layout coordinates, not animated transforms or inline-fragment rectangles. */
function layoutTop(glyph: HTMLElement): number {
  let top = 0;
  for (let el: HTMLElement | null = glyph; el;) {
    top += el.offsetTop;
    const parent: Element | null = el.offsetParent;
    el = parent instanceof HTMLElement ? parent : null;
  }
  return top;
}

/** A whole displayed line retires only after its last contributing source row expires. */
export function syncPhoneSubtitleExpiry(lines: Iterable<PhoneSubtitleLine>): void {
  const rows = new Map<string, { spans: HTMLSpanElement[]; live: boolean }>();
  for (const line of lines) {
    for (const span of line.spans) {
      if (!span.isConnected) continue; // phone spaces are text nodes, not glyph spans
      const key = `${line.source.block}:${layoutTop(span)}`;
      let row = rows.get(key);
      if (!row) rows.set(key, row = { spans: [], live: false });
      row.spans.push(span);
      row.live ||= !line.expired;
    }
  }
  // Keep layout slots and compositor state; only the ink's visibility changes.
  for (const row of rows.values()) {
    const visibility = row.live ? '' : 'hidden';
    for (const span of row.spans) {
      if (span.style.visibility !== visibility) span.style.visibility = visibility;
    }
  }
}
