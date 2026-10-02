/**
 * The decisions behind recovering from a lost GPU process, kept free of the DOM and of
 * the running game so they can be unit-tested (`test/gpuLoss.test.ts`). The wiring that
 * acts on them is `gpuLossRecovery.ts`, whose header has the whole story.
 */

/** Where the reload must put the player back: one room, and the attempt in progress there. */
export interface GpuLossResume {
  /** 1-based room number. */
  readonly room: number;
  /** The move record to replay; '' re-enters the room from its start. */
  readonly rec: string;
  /** The room script's variables at `rec` (a `ScriptSnapshot`), or null. */
  readonly vars: unknown;
  /** The undo history, as `undoHistoryForSave()` encodes it, or null. */
  readonly undo: unknown;
  /** The fish that was selected, so the player is not handed the other one. */
  readonly active: 'little' | 'big' | null;
}

/** sessionStorage, not localStorage: the hand-over is for the reload, never for a later launch. */
export const RESUME_KEY = 'ff.gpuLossResume';
/** When the last recovery reload was started, so a loss that keeps recurring cannot loop. */
export const RECOVERED_AT_KEY = 'ff.gpuLossAt';
/** A second loss inside this window is reported, not reloaded again. */
export const RECOVERY_COOLDOWN_MS = 30_000;

/**
 * Whether the sentinel's one pixel says its backing store was thrown away.
 *
 * Measured in the iPhone 17 Pro simulator (iOS 26.5) by killing `com.apple.WebKit.GPU`:
 * every canvas and ImageBitmap read back as `[0, 0, 0, 0]` — accelerated or
 * `willReadFrequently`, it made no difference — while new drawing kept working. So the
 * test is "the alpha we painted opaque is now zero", and only that. Comparing the whole
 * colour would also fire on browsers that perturb canvas reads against fingerprinting,
 * which nudge the colour and never zero the alpha, and every false alarm is a reload.
 */
export function sentinelWiped(rgba: ArrayLike<number>): boolean {
  return rgba[3] === 0;
}

/** May a recovery reload start now, given when the previous one did (null: never)? */
export function mayRecover(now: number, lastAt: number | null): boolean {
  return lastAt === null || !(now - lastAt >= 0 && now - lastAt < RECOVERY_COOLDOWN_MS);
}

export function encodeResume(r: GpuLossResume): string {
  return JSON.stringify(r);
}

/** Parse a stored hand-over, or null for anything that is not one. */
export function decodeResume(raw: string | null): GpuLossResume | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.room !== 'number' || !Number.isInteger(o.room) || o.room < 1) return null;
  if (typeof o.rec !== 'string') return null;
  const active = o.active === 'little' || o.active === 'big' ? o.active : null;
  return { room: o.room, rec: o.rec, vars: o.vars ?? null, undo: o.undo ?? null, active };
}
