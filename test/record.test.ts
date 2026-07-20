/**
 * Move-record helper tests (src/core/record.ts): char<->move round-trip,
 * lengthOfRecord move-counting (skipping q/x/o/b markers), and movesOf.
 */
import { describe, it, expect } from 'vitest';
import { moveChar, parseMoveChar, lengthOfRecord, movesOf } from '../src/core/record.js';
import { Dir } from '../src/core/dir.js';

const CASES: Array<['little' | 'big', number, string]> = [
  ['little', Dir.up, 'I'],
  ['little', Dir.down, 'K'],
  ['little', Dir.left, 'J'],
  ['little', Dir.right, 'L'],
  ['big', Dir.up, 'W'],
  ['big', Dir.down, 'S'],
  ['big', Dir.left, 'A'],
  ['big', Dir.right, 'D'],
];

describe('record helpers', () => {
  it('round-trips every fish/direction to its char', () => {
    for (const [which, dir, ch] of CASES) {
      expect(moveChar(which, dir)).toBe(ch);
      expect(parseMoveChar(ch)).toEqual({ which, dir });
    }
  });

  it('lengthOfRecord counts moves, skipping consequence markers', () => {
    expect(lengthOfRecord('IJKL')).toBe(4);
    expect(lengthOfRecord('Iq012K')).toBe(2); // q + 3 index bytes skipped
    expect(lengthOfRecord('Ix1Kb2L')).toBe(3); // x/b + 1 byte skipped
  });

  it('movesOf extracts the move commands, skipping markers', () => {
    const ms = movesOf('Iq012K');
    expect(ms).toEqual([
      { which: 'little', dir: Dir.up },
      { which: 'little', dir: Dir.down },
    ]);
  });
});
