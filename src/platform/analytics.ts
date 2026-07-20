/**
 * Web analytics (platform layer).
 *
 * Cloudflare Web Analytics: a cookieless, privacy-friendly beacon (page views +
 * RUM performance) that works on GitHub Pages with no consent banner. It is loaded
 * ONLY in a production build and ONLY when a beacon token is supplied at build time
 * via `VITE_CF_BEACON_TOKEN`, so dev runs and token-less builds send nothing.
 *
 * This lives in the platform layer, never in engine/game logic: a non-web target
 * (console/desktop) simply doesn't call it, or provides its own implementation.
 * Custom in-game event telemetry (rooms reached, completions) is intentionally NOT
 * here — that is a deferred, separate beacon per the release plan.
 */
export function initAnalytics(): void {
  const token = import.meta.env.VITE_CF_BEACON_TOKEN;
  if (!import.meta.env.PROD || !token) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token }));
  document.head.appendChild(s);
}
