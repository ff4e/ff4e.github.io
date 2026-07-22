/**
 * Service-worker registration (PWA app shell).
 *
 * Registered only in production builds (`import.meta.env.PROD`) so the dev server and
 * the headless UI tests are never affected by SW caching. Failure is swallowed — the
 * game runs identically without a service worker; it only adds installability + an
 * offline shell. See public/sw.js for the caching strategy.
 */
export function registerServiceWorker(): void {
  const prod = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD === true;
  if (!prod) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW is a progressive enhancement; ignore registration failures */
    });
  });
}
