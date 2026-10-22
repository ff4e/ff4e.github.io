import { VECTOR_GEOM, lineOffset, waveDy } from '../render/subtitleGeom.js';

type Bounds = Pick<DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>;

/** Centre captions within the game while keeping side clearance for tablet Undo. */
export function tabletSubtitleBox(
  contentW: number,
  game: Bounds,
  undo?: Bounds,
): { left: number; width: number } {
  if (!undo || undo.left >= undo.right || undo.top >= undo.bottom ||
    undo.bottom <= game.top || undo.top >= game.bottom ||
    undo.right <= game.left || undo.left >= game.right) return { left: 0, width: contentW };
  // Keep 8px before the actual button, including the host's 1px transparent border.
  const centre = (game.left + game.right) / 2;
  const width = Math.max(1, Math.min(contentW, 2 * (undo.left - 8 - centre) - 2));
  return { left: (contentW - width) / 2, width };
}

/** A bottom-aligned caption can wave upward, but cannot dip through the clipping edge. */
export function tabletSubtitleWaveDy(phase: number, amplitude: number): number {
  return Math.min(0, waveDy(phase, amplitude));
}

/** The lowest settled row ends at the host's bottom, including its outline. */
export function tabletSubtitleLineY(
  height: number,
  ys: number,
  textScale: number,
  lineBoxHeight: number,
  stroke: number,
): number {
  return height + (lineOffset(ys) - lineOffset(-VECTOR_GEOM.row)) * textScale - lineBoxHeight - stroke / 2;
}
