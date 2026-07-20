/**
 * help.cap parser + KUFRIK demonstration replay-action shape tests.
 *
 * help.cap is the recorded input stream that drives KUFRIK's automatic
 * demonstration (showmode). It is a Pascal `file of integer` — a flat stream of
 * 32-bit LE ints — with each recorded tick encoded as (kdo, akce) and, for
 * akce_go, a trailing (x, y). These tests lock the parser against the real asset.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHelpCap, AKCE, KDO } from '../src/intro/helpCap.js';

const capPath = join(__dirname, '..', 'public', 'data', 'Intro', 'help.cap');
const bytes = new Uint8Array(readFileSync(capPath));
const actions = parseHelpCap(bytes);

describe('parseHelpCap', () => {
  it('parses the recorded stream into (kdo, akce[, x, y]) actions', () => {
    expect(actions.length).toBeGreaterThan(1000);
    // Every action carries valid kdo (0..3) and a non-negative akce.
    for (const a of actions) {
      expect(a.kdo).toBeGreaterThanOrEqual(0);
      expect(a.kdo).toBeLessThanOrEqual(3);
      expect(a.akce).toBeGreaterThanOrEqual(0);
    }
  });

  it('consumes an extra (x, y) pair only for akce_go', () => {
    // Re-derive the int count the parser must have consumed and confirm it fits
    // the file: 2 ints per action, +2 for each go.
    const goes = actions.filter((a) => a.akce === AKCE.go).length;
    const intsConsumed = actions.length * 2 + goes * 2;
    const totalInts = Math.floor(bytes.length / 4);
    expect(intsConsumed).toBeLessThanOrEqual(totalInts);
    // The remainder must be a partial trailing action (< one full record).
    expect(totalInts - intsConsumed).toBeLessThan(4);
  });

  it('matches the recorded action mix (kdo=0 no-ops dominate; go dominates commands)', () => {
    const noop = actions.filter((a) => a.kdo === KDO.none).length;
    const go = actions.filter(
      (a) => (a.kdo === KDO.little || a.kdo === KDO.big) && a.akce === AKCE.go,
    ).length;
    const helptext = actions.filter(
      (a) => a.kdo === KDO.sys && a.akce === AKCE.helptext,
    ).length;
    // help1..help23 are voiced across the demo (URoom.pas:24495).
    expect(helptext).toBe(23);
    // Idle/animation no-op ticks are the bulk of the recording.
    expect(noop).toBeGreaterThan(go);
    // Swimming (go) is the dominant fish command.
    expect(go).toBeGreaterThan(100);
  });

  it('go actions carry in-grid target coordinates', () => {
    for (const a of actions) {
      if (a.akce === AKCE.go) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x).toBeLessThan(60);
        expect(a.y).toBeLessThan(60);
      }
    }
  });
});
