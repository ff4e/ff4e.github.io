/** A phone message reflows independently of the engine's bitmap rows. */
export const PHONE_SUBTITLE_WAVE_PX = 6;
const MAX_REVEAL_MS = 800;

interface SourceRow {
  id: number;
  block: number;
  obsah: string;
}

export interface PhoneSubtitleWave {
  offsets: Map<number, number>;
  stepMs: number;
}

/**
 * Keep each message's reading-order offsets until its last source row expires.
 * Recomputing them after partial expiry would change the surviving glyphs' phase
 * on a later font rebuild. Source rows are emitted together by newSubtitle().
 */
export function syncPhoneSubtitleWaves(
  waves: Map<number, PhoneSubtitleWave>,
  rows: readonly SourceRow[],
  stepMs: number,
): void {
  const blocks = new Set(rows.map((row) => row.block));
  for (const block of blocks) {
    if (waves.has(block)) continue;
    const offsets = new Map<number, number>();
    let length = 0;
    for (const row of rows) {
      if (row.block !== block) continue;
      offsets.set(row.id, length);
      length += [...row.obsah].length + 1; // include the restored inter-row space
    }
    waves.set(block, {
      offsets,
      // A long message must finish appearing before the engine expires its rows.
      stepMs: Math.min(stepMs, MAX_REVEAL_MS / Math.max(1, length - 1)),
    });
  }
  for (const block of waves.keys()) if (!blocks.has(block)) waves.delete(block);
}
