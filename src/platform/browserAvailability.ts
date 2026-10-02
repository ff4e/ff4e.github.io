import { NATIVE_SCHEME } from './nativeHost.js';

// One switch for the temporary website restriction; never a touch-layout decision.
const IOS_BROWSER_PAUSED = true;

type BrowserDevice = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>;

export function isBrowserPlayPaused(device: BrowserDevice, protocol: string): boolean {
  if (!IOS_BROWSER_PAUSED || protocol === NATIVE_SCHEME) return false;
  // iPadOS can request desktop sites with a Mac user agent, even with a trackpad.
  const touchMac = device.maxTouchPoints > 1 &&
    (/^Mac/.test(device.platform) || /Macintosh/i.test(device.userAgent));
  return /iPhone|iPad|iPod/i.test(device.userAgent) || touchMac;
}

/** `localStorage` key for a visitor's own choice to continue in the browser anyway. */
const BROWSER_PLAY_OVERRIDE_KEY = 'ff.browserPlayOverride';

/**
 * Has this visitor already said "continue to the web version anyway" — this visit or an
 * earlier one?
 *
 * Deliberately storage-only, with no URL carrier like `touchMode.ts`'s override: that one
 * is dev chrome meant to be put in a shareable link, while this is a player's one-time
 * choice about their OWN device, made by clicking a button on the paused page — there is
 * nothing to share. Missing or disabled storage reads as "not yet overridden", the same
 * fail-closed lean as the rest of this file: the pause stays the default until a visitor
 * deliberately says otherwise.
 */
export function browserPlayOverridden(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(BROWSER_PLAY_OVERRIDE_KEY) === '1';
}

/** Record that this visitor chose to continue in the browser anyway. Best-effort. */
export function setBrowserPlayOverride(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(BROWSER_PLAY_OVERRIDE_KEY, '1');
}
