import { isNativeHost } from '../platform/nativeHost.js';
import { requestStoreReview } from '../platform/storeReview.js';
import { tetrisModal } from './cheats.js';
import { roomLoading } from './framePacing.js';
import { loadmode, replaymode, showmode } from './gameState.js';
import { mapLaunching } from './roomLaunch.js';
import { ui } from './screenState.js';
import { inSolvemode } from './solveMode.js';
import { touchOptionsOpen } from './touchOptions.js';

const MILESTONES: readonly number[] = [4, 12, 30];
const ATTEMPT_KEY = 'ff.reviewMilestone';
let pending: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let mapVisit = 0;

/** Called before adding a first genuine solve to the persisted solved set. */
export function noteReviewSolve(roomNum: number, solved: ReadonlySet<number>): void {
  if (!isNativeHost() || solved.has(roomNum) || showmode || replaymode || loadmode || inSolvemode()) return;
  const count = solved.size + 1;
  if (MILESTONES.includes(count)) pending = count;
}

/** A rebuild abandons the old win, including a restart before its map countdown ends. */
export function cancelStoreReview(): void {
  pending = null;
  mapVisit++;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/**
 * A deliberate native-only addition: ask at a quiet map break, never over the win
 * dialogue or a leg's story page. Moving on within two seconds skips this opportunity;
 * there is no startup catch-up, no custom pre-prompt and no way to know who has rated.
 */
export function scheduleStoreReview(): void {
  const milestone = pending;
  cancelStoreReview();
  if (!isNativeHost() || milestone === null) return;
  const visit = mapVisit;
  timer = setTimeout(() => {
    timer = null;
    void attemptReview(milestone, visit);
  }, 2000);
}

function mapIsQuiet(visit: number): boolean {
  return ui.screen === 'map' && mapVisit === visit &&
    !document.hidden && !roomLoading && mapLaunching() === null &&
    ui.mapOverlay === 'none' && ui.mapInfoRoom === null && !ui.creditsLoading &&
    !ui.helpOpen && !touchOptionsOpen() && !ui.feedback?.isOpen() && !tetrisModal() &&
    document.querySelector('#loading:not([hidden]), #fatal:not([hidden]), dialog[open]') === null;
}

async function attemptReview(milestone: number, visit: number): Promise<void> {
  if (!mapIsQuiet(visit)) return;
  try {
    const raw = localStorage.getItem(ATTEMPT_KEY);
    if (raw !== null && !MILESTONES.some((n) => String(n) === raw)) {
      throw new Error(`Invalid ${ATTEMPT_KEY} value`);
    }
    if (raw !== null && Number(raw) >= milestone) return;
    await requestStoreReview(() => {
      // Loading the native chunk is async: the player may have left the map meanwhile.
      if (!mapIsQuiet(visit)) return false;
      // Persist an ATTEMPT, not a shown prompt or a rating. StoreKit reports neither.
      // Write first; if storage fails, skip rather than risk repeatedly asking.
      localStorage.setItem(ATTEMPT_KEY, String(milestone));
      return true;
    });
  } catch (error) {
    console.warn('store review: could not request a review', error);
  }
}
