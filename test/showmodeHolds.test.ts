/**
 * The KUFRIK demonstration's hand-lengthened pauses (`SHOWMODE_HOLDS`).
 *
 * The table is the demo's only deliberate departure from the 1998 recording, and its
 * safety rests on one property that is easy to state and easy to get wrong: every hold
 * must key an entry in `help.cap` that **does nothing**. `showmodeHolds.ts` says so; this
 * checks it against the real recording, so the rule is enforced rather than remembered.
 *
 * The trap is `akce_restart`. `applyCapAction` (cutscene.ts) tests `akce === restart`
 * before it tests `kdo` at all, so a `kdo=0` restart still calls `buildRoom(true)` — and
 * all three restart runs in the recording are `kdo=0`. "kdo=0 means no-op" is therefore
 * true of everything except restart and load, which is exactly the case a reader of a
 * generated timeline would miss.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AKCE, KDO, parseHelpCap } from '../src/intro/helpCap.js';
import { SHOWMODE_HOLDS } from '../src/app/showmodeHolds.js';

const actions = parseHelpCap(
  new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'data', 'Intro', 'help.cap'))),
);

describe('SHOWMODE_HOLDS', () => {
  it('keys only entries that exist in the recording', () => {
    for (const [idx] of SHOWMODE_HOLDS) {
      expect(Number.isInteger(idx), `${idx} is not an index`).toBe(true);
      expect(idx, `${idx} is out of range`).toBeGreaterThanOrEqual(0);
      expect(idx, `${idx} is out of range`).toBeLessThan(actions.length);
    }
  });

  it('holds only on entries that do nothing', () => {
    for (const [idx] of SHOWMODE_HOLDS) {
      const a = actions[idx]!;
      // kdo=0: the recording's own idle tick. Extending it cannot desync the replay.
      expect(a.kdo, `hold at ${idx} lands on a live action (kdo=${a.kdo}, akce=${a.akce})`).toBe(
        KDO.none,
      );
      // ...except these two, which act regardless of kdo. A hold keyed on one would sit
      // INSIDE the run that rebuilds the room rather than in front of it.
      expect(a.akce, `hold at ${idx} lands on a recorded restart`).not.toBe(AKCE.restart);
      expect(a.akce, `hold at ${idx} lands on a recorded load`).not.toBe(AKCE.load);
    }
  });

  it('holds for a positive whole number of ticks', () => {
    for (const [idx, ticks] of SHOWMODE_HOLDS) {
      expect(Number.isInteger(ticks), `hold at ${idx} is not a whole number of ticks`).toBe(true);
      expect(ticks, `hold at ${idx} does not hold`).toBeGreaterThan(0);
    }
  });

  it('still describes a recording whose restart runs are kdo=0', () => {
    // The premise of the two checks above. If a future recording ever carried a restart
    // with a real `kdo`, the "does nothing" test would silently weaken, so pin it.
    const restarts = actions.filter((a) => a.akce === AKCE.restart);
    expect(restarts.length).toBeGreaterThan(0);
    expect(restarts.every((a) => a.kdo === KDO.none)).toBe(true);
  });
});
