/**
 * Which renderer paints the room's vector subtitles (src/app/subRendererChoice.ts).
 *
 * This is the decision that changed what players see: every tier that draws subtitles as
 * vector text now paints them as real DOM text animated by the compositor. `classic` is
 * absent on purpose — it bakes its subtitles into the frame and never reaches either
 * renderer. The matrix is small and entirely pure, so it is pinned here rather than in a
 * ~7.4 s browser probe — what a probe still owns is that the resolved renderer is the one
 * actually painting (tools/test-subtitles, tools/test-kufrikdemo).
 */
import { describe, it, expect } from 'vitest';
import { asSubRendererPref, resolveSubRenderer } from '../src/app/subRendererChoice.js';

describe('resolveSubRenderer — auto (the shipped default)', () => {
  it('is the DOM renderer', () => {
    expect(resolveSubRenderer('auto', true)).toBe('dom');
  });
});

describe('resolveSubRenderer — an explicit choice is honoured', () => {
  it('forces canvas', () => {
    expect(resolveSubRenderer('canvas', true)).toBe('canvas');
  });

  it('forces dom', () => {
    expect(resolveSubRenderer('dom', true)).toBe('dom');
  });
});

describe('resolveSubRenderer — the unsupported-browser fallback (PLAN D3)', () => {
  // Without the Web Animations API the wave would run on the main thread, which is the
  // stutter this change exists to remove. Canvas is then the BETTER picture, so the
  // fallback outranks an explicit request for 'dom' rather than honouring it.
  it('falls back to canvas for every preference', () => {
    for (const pref of ['auto', 'canvas', 'dom'] as const) {
      expect(resolveSubRenderer(pref, false)).toBe('canvas');
    }
  });

  it('never returns dom when the browser cannot animate', () => {
    expect(resolveSubRenderer('dom', false)).toBe('canvas');
  });
});

describe('asSubRendererPref', () => {
  it('keeps the two explicit overrides', () => {
    expect(asSubRendererPref('dom')).toBe('dom');
    expect(asSubRendererPref('canvas')).toBe('canvas');
  });

  // Absent is the normal case — `auto` is stored by REMOVING the key, so a fresh player
  // and a player who chose "auto" have to resolve identically.
  it('reads absent, null and unrecognised storage as auto', () => {
    expect(asSubRendererPref(null)).toBe('auto');
    expect(asSubRendererPref(undefined)).toBe('auto');
    expect(asSubRendererPref('')).toBe('auto');
    expect(asSubRendererPref('auto')).toBe('auto');
    expect(asSubRendererPref('DOM')).toBe('auto'); // case-sensitive on purpose
    expect(asSubRendererPref('webgl')).toBe('auto');
  });
});
