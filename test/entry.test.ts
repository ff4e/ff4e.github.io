import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startGame = vi.fn();
const replace = vi.fn();
const about = { hidden: true };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  startGame.mockReset();
  about.hidden = true;
  vi.doMock('../src/app/main.js', () => { startGame(); return {}; });
  vi.stubGlobal('document', { getElementById: (id: string) => id === 'about-link' ? about : null });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', maxTouchPoints: 5 });
  vi.stubGlobal('location', { protocol: 'https:', replace });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('game entry', () => {
  it('redirects an iPhone without evaluating the game', async () => {
    await import('../src/entry.js');
    expect(replace).toHaveBeenCalledWith('/about.html#browser');
    expect(startGame).not.toHaveBeenCalled();
  });

  it('boots the native iOS app directly and keeps the website link hidden', async () => {
    vi.stubGlobal('location', { protocol: 'capacitor:', replace });
    await import('../src/entry.js');
    expect(startGame).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(about.hidden).toBe(true);
  });

  it('boots desktop browsers and exposes the project link', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 });
    await import('../src/entry.js');
    expect(startGame).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(about.hidden).toBe(false);
  });

  it('preserves boot failures for the game error handlers instead of swallowing them', async () => {
    vi.stubGlobal('location', { protocol: 'capacitor:', replace });
    const failure = new Error('required boot asset unavailable');
    startGame.mockImplementation(() => { throw failure; });
    // Vitest wraps a throwing module factory but preserves the import error as its cause.
    await expect(import('../src/entry.js')).rejects.toMatchObject({ cause: failure });
  });
});
