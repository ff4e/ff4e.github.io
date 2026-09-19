import { isBrowserPlayPaused } from './platform/browserAvailability.js';
import { isNativeHost } from './platform/nativeHost.js';

if (isBrowserPlayPaused(navigator, location.protocol)) {
  location.replace('/about.html#browser');
} else {
  const aboutLink = document.getElementById('about-link');
  if (aboutLink) aboutLink.hidden = isNativeHost();
  // Do not import the game (or start its asset/storage side effects) on blocked browsers.
  // Leave boot rejections uncaught: loadingUi's error traps preserve asset-tier diagnostics.
  await import('./app/main.js');
}
