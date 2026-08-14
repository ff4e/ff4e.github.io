/**
 * Which renderer paints the room's vector subtitles (src/app/subRendererChoice.ts).
 *
 * This is the decision that changed what players see: the `ai` tier now paints its
 * subtitles as real DOM text animated by the compositor, while `classic` and `enhanced`
 * keep the canvas/baked path they were tuned against. The matrix is small and entirely
 * pure, so it is pinned here rather than in a ~7.4 s browser probe — what a probe still
 * owns is that the resolved renderer is the one actually painting (tools/test-subtitles).
 */
import { describe, it, expect } from 'vitest';
import { asSubRendererPref, resolveSubRenderer } from '../src/app/subRendererChoice.js';

const TIERS = ['classic', 'enhanced', 'ai'] as const;

describe('resolveSubRenderer — auto (the shipped default)', () => {
  it('gives the ai tier the DOM renderer', () => {
    expect(resolveSubRenderer('auto', 'ai', true)).toBe('dom');
  });

  it('leaves classic and enhanced on canvas', () => {
    expect(resolveSubRenderer('auto', 'classic', true)).toBe('canvas');
    expect(resolveSubRenderer('auto', 'enhanced', true)).toBe('canvas');
  });

  // The tier string arrives from persisted settings, so an unknown value is reachable
  // (an old or hand-edited ff.graphics). It must not opt into the newer path by accident.
  it('treats an unknown tier as canvas, not as ai', () => {
    expect(resolveSubRenderer('auto', 'sepia', true)).toBe('canvas');
    expect(resolveSubRenderer('auto', '', true)).toBe('canvas');
  });
});

describe('resolveSubRenderer — an explicit choice overrides the tier', () => {
  it('forces canvas in every tier, including ai', () => {
    for (const tier of TIERS) expect(resolveSubRenderer('canvas', tier, true)).toBe('canvas');
  });

  it('forces dom in every tier, including classic', () => {
    for (const tier of TIERS) expect(resolveSubRenderer('dom', tier, true)).toBe('dom');
  });
});

describe('resolveSubRenderer — the unsupported-browser fallback (PLAN D3)', () => {
  // Without the Web Animations API the wave would run on the main thread, which is the
  // stutter this change exists to remove. Canvas is then the BETTER picture, so the
  // fallback outranks an explicit request for 'dom' rather than honouring it.
  it('falls back to canvas in every tier and for every preference', () => {
    for (const tier of TIERS) {
      for (const pref of ['auto', 'canvas', 'dom'] as const) {
        expect(resolveSubRenderer(pref, tier, false)).toBe('canvas');
      }
    }
  });

  it('never returns dom when the browser cannot animate', () => {
    expect(resolveSubRenderer('dom', 'ai', false)).toBe('canvas');
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
