import { describe, expect, it } from 'vitest';
import { isSwapKey } from '../src/app/keyTables.js';

const key = (code: string, mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey', boolean>> = {},
  target: EventTarget | null = null) =>
  ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, target, ...mods });
const onControl = { closest: (s: string) => (s.includes('button') ? {} : null) } as unknown as EventTarget;
const onBody = { closest: () => null } as unknown as EventTarget;

describe('isSwapKey', () => {
  it('Space swaps, unconditionally as before', () => {
    expect(isSwapKey(key('Space'))).toBe(true);
    expect(isSwapKey(key('Space', { shiftKey: true }, onControl))).toBe(true);
  });

  it('a bare Tab outside a focused control swaps', () => {
    expect(isSwapKey(key('Tab'))).toBe(true);
    expect(isSwapKey(key('Tab', {}, onBody))).toBe(true);
  });

  it('Tab stays focus navigation with a modifier or from a focused control', () => {
    for (const m of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const) {
      expect(isSwapKey(key('Tab', { [m]: true }))).toBe(false);
    }
    expect(isSwapKey(key('Tab', {}, onControl))).toBe(false);
  });

  it('other keys do not swap', () => {
    expect(isSwapKey(key('Enter'))).toBe(false);
    expect(isSwapKey(key('KeyT'))).toBe(false);
  });
});
