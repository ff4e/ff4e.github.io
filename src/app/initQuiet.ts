/**
 * The `init` half of `RoomScript.carriedSounds`.
 *
 * An instant restore (undo) rebuilds the room and re-runs its `init`, which re-cues the
 * room's opening sounds — DRAKAR1's starts its intro music, `rybky04`. When the room has
 * declared a priority as part of a performance that plays on through the undo, the
 * rebuild has just left that sound running (`audio.killVoices(carried)`), so a cue from
 * `init` would either start it a second time or revive one the room had since stopped.
 * While `initializing()` holds, every call on a carried priority is dropped; once `init`
 * has returned the script drives those priorities as usual.
 */
import type { SoundFns } from '../core/script.js';

export function initQuiet(carried: readonly number[], initializing: () => boolean, fns: SoundFns): SoundFns {
  if (carried.length === 0) return fns;
  const quiet = (prior: number) => initializing() && carried.includes(prior);
  return {
    ...fns,
    snd: (name, prior) => void (quiet(prior) || fns.snd?.(name, prior)),
    sndcyc: (name, prior) => void (quiet(prior) || fns.sndcyc?.(name, prior)),
    sndvol: (name, prior, vol) => void (quiet(prior) || fns.sndvol?.(name, prior, vol)),
    ksnd: (prior) => void (quiet(prior) || fns.ksnd?.(prior)),
    music: (name, prior) => void (quiet(prior) || fns.music?.(name, prior)),
    musiccyc: (name, prior) => void (quiet(prior) || fns.musiccyc?.(name, prior)),
  };
}
