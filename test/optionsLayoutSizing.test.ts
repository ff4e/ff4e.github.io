import { beforeEach, afterEach, expect, it, vi } from 'vitest';

vi.mock('../src/app/touchButtons.js', () => ({ phoneUi: () => true }));
vi.mock('../src/app/touchOptions.js', () => ({ touchOptionsOpen: () => true }));
vi.mock('../src/app/stageGeometry.js', () => ({ stage: { scale: 2 } }));
vi.mock('../src/app/frameClock.js', () => ({ wake: vi.fn() }));

import { touchFaceCss } from '../src/app/optionsLayout.js';
import { wake } from '../src/app/frameClock.js';

let resized: () => void;
let dialog: { clientWidth: number; clientHeight: number };
let padding: { paddingTop: string; paddingRight: string; paddingBottom: string; paddingLeft: string };
let bar: { hidden: boolean; offsetHeight: number; style: { width: string } };
const observe = vi.fn();
const styles = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resized = () => { throw new Error('The dialog has no resize observer'); };
  dialog = { clientWidth: 852, clientHeight: 393 };
  padding = { paddingTop: '10px', paddingRight: '16px', paddingBottom: '20px', paddingLeft: '78px' };
  bar = { hidden: false, offsetHeight: 24, style: { width: '' } };
  const canvas = {};
  styles.mockImplementation((el) => {
    if (el === dialog) return padding;
    if (el === bar) return { marginTop: '8px' };
    if (el === canvas) return {
      borderLeftWidth: '1px', borderRightWidth: '1px', borderTopWidth: '1px', borderBottomWidth: '1px',
    };
    throw new Error('Unexpected element');
  });
  vi.stubGlobal('window', { innerWidth: 852, innerHeight: 393 });
  const elements = new Map<string, object>([['touchopts', dialog], ['panel', canvas], ['feedbar', bar]]);
  vi.stubGlobal('document', { getElementById: (id: string) => elements.get(id) });
  vi.stubGlobal('getComputedStyle', styles);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe = observe;
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

it('refits when the dialog catches up with the rotated viewport', () => {
  dialog.clientHeight = 852;
  expect(touchFaceCss('landscape').h).toBeGreaterThan(393);
  expect(observe).toHaveBeenCalledWith(dialog);
  dialog.clientHeight = 393;
  resized();
  expect(wake).toHaveBeenCalledOnce();
  expect(touchFaceCss('landscape')).toEqual({ w: expect.closeTo(305 * 329 / 198), h: 329 });
});

it('refits for a late native safe-area update without a viewport resize', () => {
  padding.paddingTop = '72px';
  padding.paddingBottom = '34px';
  const before = touchFaceCss('landscape');
  padding.paddingTop = '10px';
  padding.paddingBottom = '20px';
  resized();
  const after = touchFaceCss('landscape');
  expect(after.h - before.h).toBeCloseTo(76);
  expect(after.h).toBe(329);
});

it('keeps the fit cached between actual dialog changes and restores the strip width', () => {
  const first = touchFaceCss('landscape');
  const reads = styles.mock.calls.length;
  expect(touchFaceCss('landscape')).toBe(first);
  expect(styles).toHaveBeenCalledTimes(reads);
  expect(bar.style.width).toBe('');
  expect(observe).toHaveBeenCalledOnce();
});

it('does not cache a dialog before it has a content box', () => {
  dialog.clientHeight = 0;
  expect(touchFaceCss('landscape')).toEqual({ w: 0, h: 0 });
  dialog.clientHeight = 393;
  expect(touchFaceCss('landscape').h).toBe(329);
});
