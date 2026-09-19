import { describe, expect, it } from 'vitest';
import { isBrowserPlayPaused } from '../src/platform/browserAvailability.js';

const devices = [
  { name: 'iPhone Safari', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', platform: 'iPhone', maxTouchPoints: 5, paused: true },
  { name: 'iPhone Chrome', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/140 Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5, paused: true },
  { name: 'iPhone Firefox', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FxiOS/140 Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5, paused: true },
  { name: 'iPad mobile', userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari/604.1', platform: 'iPad', maxTouchPoints: 5, paused: true },
  { name: 'iPad desktop mode', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5, paused: true },
  { name: 'iPad Mac platform with reduced UA', userAgent: 'Mozilla/5.0', platform: 'MacIntel', maxTouchPoints: 5, paused: true },
  { name: 'iPad Mac UA without platform', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15', platform: '', maxTouchPoints: 5, paused: true },
  { name: 'Mac', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0, paused: false },
  { name: 'Windows touchscreen', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140', platform: 'Win32', maxTouchPoints: 10, paused: false },
  { name: 'Android phone', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140 Mobile', platform: 'Linux armv8l', maxTouchPoints: 5, paused: false },
  { name: 'Android tablet', userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140', platform: 'Linux armv8l', maxTouchPoints: 5, paused: false },
  { name: 'unknown desktop', userAgent: '', platform: '', maxTouchPoints: 0, paused: false },
];

describe('temporary iPhone/iPad browser availability', () => {
  it.each(devices)('$name on the web', ({ paused, ...device }) => {
    expect(isBrowserPlayPaused(device, 'https:')).toBe(paused);
    expect(isBrowserPlayPaused(device, 'http:')).toBe(paused);
  });

  it.each(devices)('never blocks $name in the native app', (device) => {
    expect(isBrowserPlayPaused(device, 'capacitor:')).toBe(false);
  });
});
