import { describe, expect, it } from 'vitest';
import { phoneUndoFocus } from '../src/app/phoneUndoFocus.js';

const both = { little: true, big: true };

describe('phone Undo focus', () => {
  it.each([
    ['D', '', 'little', 'big'],
    ['L', '', 'big', 'little'],
    ['LD', 'L', 'little', 'big'],
    ['DL', 'D', 'big', 'little'],
    ['DAJL', 'D', 'big', 'little'],
    ['LD', 'LL', 'little', 'big'],
  ] as const)('focuses the discarded move in %s -> %s, not the selected or retained fish', (current, restored, selected, expected) => {
    expect(phoneUndoFocus(current, restored, selected, both)).toBe(expected);
  });

  it('ignores consequence markers and their move-like payload characters', () => {
    expect(phoneUndoFocus('LDq012xLoAbW', 'L', 'little', both)).toBe('big');
    expect(phoneUndoFocus('DLq012xDoAbW', 'D', 'big', both)).toBe('little');
  });

  it('keeps selection when only consequences changed or no move was removed', () => {
    expect(phoneUndoFocus('Dq012xL', 'D', 'little', both)).toBe('little');
    expect(phoneUndoFocus('L', 'L', 'big', both)).toBe('big');
    expect(phoneUndoFocus('', '', 'big', both)).toBe('big');
    expect(phoneUndoFocus('D', 'DL', 'little', both)).toBe('little');
  });

  it('uses an available fish rather than focusing one that is dead or has exited', () => {
    expect(phoneUndoFocus('LD', 'L', 'little', { little: true, big: false })).toBe('little');
    expect(phoneUndoFocus('DL', 'D', 'big', { little: false, big: true })).toBe('big');
    expect(phoneUndoFocus('Dq012', 'D', 'big', { little: true, big: false })).toBe('little');
    expect(phoneUndoFocus('D', '', 'big', { little: false, big: false })).toBeNull();
  });
});
