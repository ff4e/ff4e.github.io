/**
 * TV / console (Xbox) mode flag (platform layer).
 *
 * Gates the "10-foot" visual changes — hiding the PC control panel and reflowing
 * the stage to full width, title-safe margins, controller glyphs — so the plain
 * web build is completely unaffected. Purely presentational; never referenced by
 * engine or game logic. Detected once at boot from (in order):
 *   - the Vite build target  `VITE_TARGET=xbox`  (the console build),
 *   - a `?tv` / `?xbox` URL parameter            (desktop testing of TV mode),
 *   - an Xbox user-agent                         (running in the console WebView).
 * The gamepad itself works regardless of this flag (so a pad can be tested on the
 * desktop web build); this only toggles the TV-specific UI/layout.
 */
function detectTvMode(): boolean {
  try {
    const target = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_TARGET;
    if (target === 'xbox') return true;
  } catch {
    /* import.meta.env unavailable (e.g. under a non-Vite runner) */
  }
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('tv') || params.has('xbox')) return true;
  } catch {
    /* no location (non-browser context) */
  }
  try {
    if (typeof navigator !== 'undefined' && /Xbox/i.test(navigator.userAgent)) return true;
  } catch {
    /* no navigator */
  }
  return false;
}

/** True when running in TV / console mode (see detectTvMode). Fixed for the session. */
export const tvMode: boolean = detectTvMode();
