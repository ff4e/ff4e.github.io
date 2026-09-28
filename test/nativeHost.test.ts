import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { hostFetchInit, isNativeHost, NATIVE_SCHEME } from '../src/platform/nativeHost.js';

/**
 * The native host's media quirk, pinned.
 *
 * The bug this guards is not one a browser can reproduce: Capacitor answers a media file
 * with a `URLResponse` that has no status code, `fetch` reports that as `status: 0`, and
 * the asset door reads a falsy `res.ok` as "authoritatively absent" and gives up. Every
 * `Music/*.m4a` track is a `mustHave`, so it took the whole game to the fatal screen with
 * the file sitting in the bundle. The `Range` header is what moves the handler onto the
 * path that returns a real HTTP response.
 *
 * A UI probe could not have caught it either — the probes run in a browser, where the
 * quirk does not exist. What IS testable, and what actually broke, is the decision: which
 * urls get the header, and on which host. So that is what this pins.
 */

const setProtocol = (protocol: string): void => {
  Object.defineProperty(globalThis, 'location', { value: { protocol }, configurable: true, writable: true });
};

afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, 'location');
});

describe('isNativeHost', () => {
  it('is true only for the capacitor scheme', () => {
    setProtocol('capacitor:');
    expect(isNativeHost()).toBe(true);
    setProtocol('https:');
    expect(isNativeHost()).toBe(false);
    setProtocol('http:');
    expect(isNativeHost()).toBe(false);
  });
});

describe('hostFetchInit', () => {
  it('leaves every request alone on the web, media or not', () => {
    setProtocol('https:');
    expect(hostFetchInit('/data/Music/menu.m4a')).toBeUndefined();
    expect(hostFetchInit('/data/Graphic/001.ffr')).toBeUndefined();
    const init = { cache: 'no-store' as RequestCache };
    expect(hostFetchInit('/data/Music/menu.m4a', init)).toBe(init);
  });

  it('adds a whole-file Range to media requests on the native host', () => {
    setProtocol('capacitor:');
    // Every extension Capacitor's isMediaExtension() claims, since any of them would hit
    // the same statusless response.
    for (const ext of ['m4v', 'mov', 'mp4', 'aac', 'ac3', 'aiff', 'au', 'flac', 'm4a', 'mp3', 'wav']) {
      const got = hostFetchInit(`/data/Music/menu.${ext}`);
      expect(got?.headers, ext).toEqual({ Range: 'bytes=0-' });
    }
  });

  it('leaves the game\'s own formats alone — they were never broken', () => {
    setProtocol('capacitor:');
    // .ffs2 is the voice package and .ffr the room art: both are fetched exactly as before,
    // because Capacitor answers anything it does not call media with a real 200.
    for (const url of ['/data/Graphic/001.ffr', '/data/Sound/x01.ffs2', '/enhanced-ai/UTES/w.webp', '/data/Title/001.fft']) {
      expect(hostFetchInit(url), url).toBeUndefined();
    }
  });

  it('matches the extension case-insensitively and ignores a query string', () => {
    setProtocol('capacitor:');
    expect(hostFetchInit('/data/Music/menu.M4A')?.headers).toEqual({ Range: 'bytes=0-' });
    expect(hostFetchInit('/data/Music/menu.m4a?v=2')?.headers).toEqual({ Range: 'bytes=0-' });
  });

  it('keeps the caller\'s own init and headers', () => {
    setProtocol('capacitor:');
    const got = hostFetchInit('/data/Music/menu.m4a', { cache: 'no-store', headers: { Accept: 'audio/*' } });
    expect(got?.cache).toBe('no-store');
    expect(got?.headers).toEqual({ Accept: 'audio/*', Range: 'bytes=0-' });
  });

  /**
   * A HEAD asks whether the file is there. The handler does not read the method, so the
   * range it is given is the range it reads — resident, not mapped — and `introOverlay.ts`
   * probes a 44 MB `intro_ai.mp4` this way on the default graphics setting, at boot.
   *
   * One byte answers the same question. The status and `Content-Range` still arrive, which
   * is all a HEAD's caller can look at anyway.
   */
  it('asks for one byte when the caller is only probing with HEAD', () => {
    setProtocol('capacitor:');
    expect(hostFetchInit('/data/Movie/intro_ai.mp4', { method: 'HEAD' })?.headers).toEqual({ Range: 'bytes=0-0' });
    expect(hostFetchInit('/data/Movie/intro_ai.mp4', { method: 'head' })?.headers).toEqual({ Range: 'bytes=0-0' });
    // Everything that actually wants the bytes still gets all of them.
    expect(hostFetchInit('/data/Movie/intro_ai.mp4', { method: 'GET' })?.headers).toEqual({ Range: 'bytes=0-' });
    expect(hostFetchInit('/data/Movie/intro_ai.mp4')?.headers).toEqual({ Range: 'bytes=0-' });
    // And the method survives — the probe is still a HEAD.
    expect(hostFetchInit('/data/Movie/intro_ai.mp4', { method: 'HEAD' })?.method).toBe('HEAD');
  });
});

/**
 * The one fact in this module that is not local to it.
 *
 * `isNativeHost()` is the switch every workaround here hangs off, and it reads a value
 * the Capacitor config chooses. If the two ever disagree the app does not crash and no
 * test fails — the music simply stops loading, on the device only, with the web build
 * fine. That is exactly the shape of bug worth a cheap assertion.
 */
describe('NATIVE_SCHEME', () => {
  it('is the scheme capacitor.config.ts pins', () => {
    const config = readFileSync(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
    const pinned = /^\s*scheme:\s*'([^']+)'/m.exec(config)?.[1];
    expect(pinned, 'capacitor.config.ts no longer pins ios.scheme').toBeTruthy();
    expect(`${pinned}:`).toBe(NATIVE_SCHEME);
  });
});

describe('iOS app identity', () => {
  it('declares Czech and English with Czech as the native Base development language', () => {
    const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
    const localizations = /<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1] ?? '';
    const languages = [...localizations.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]);
    expect(languages).toEqual(['cs', 'en']);
    expect(/<key>CFBundleDevelopmentRegion<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1])
      .toBe('cs');
    const project = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
    expect(/^\s*developmentRegion = ([^;]+);/m.exec(project)?.[1]).toBe('cs');
    const regions = /knownRegions = \(([\s\S]*?)\);/.exec(project)?.[1] ?? '';
    expect(regions.split(',').map((region) => region.trim()).filter(Boolean)).toEqual(['cs', 'en', 'Base']);
  });

  it('keeps the Home Screen name recognizable and the policy consistent', () => {
    const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
    const name = /<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
    expect(name).toBe('Fish Fillets');
    const policy = readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8');
    expect(policy).toContain(`shown as <strong>${name}</strong> on iOS`);
  });

  it('preserves the shipping bundle ID in Capacitor and both native configurations', () => {
    const config = readFileSync(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
    expect(/^\s*appId:\s*'([^']+)'/m.exec(config)?.[1]).toBe('io.github.ff4e.fishfillets4ever');
    const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
    expect(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1])
      .toBe('$(PRODUCT_BUNDLE_IDENTIFIER)');
    const project = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
    const identifiers = [...project.matchAll(/^\s*PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/gm)]
      .map((match) => match[1]);
    expect(identifiers).toEqual(['io.github.ff4e.fishfillets4ever', 'io.github.ff4e.fishfillets4ever']);
  });
});
