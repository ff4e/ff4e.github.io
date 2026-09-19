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
