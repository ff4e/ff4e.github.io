/**
 * Service-worker registration (PWA app shell).
 *
 * Registered only in production builds (`import.meta.env.PROD`) so the dev server and
 * the headless UI tests are never affected by SW caching. Failure is swallowed — the
 * game runs identically without a service worker; it only adds installability + an
 * offline shell. See public/sw.js for the caching strategy.
 *
 * Skipped entirely in the packaged console build (`VITE_TARGET=xbox`): there every
 * asset already ships inside the MSIX and is served from a local virtual host, so a
 * cache layer would only duplicate ~350 MB into WebView2's storage and risk serving
 * a stale shell after an app update. See xbox/README.md.
 */
export function registerServiceWorker(): void {
  const env = (import.meta as unknown as { env?: { PROD?: boolean; VITE_TARGET?: string } }).env;
  if (env?.PROD !== true) return;
  if (env?.VITE_TARGET === 'xbox') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW is a progressive enhancement; ignore registration failures */
    });
  });
}
