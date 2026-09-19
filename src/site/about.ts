import { isBrowserPlayPaused } from '../platform/browserAvailability.js';

const paused = isBrowserPlayPaused(navigator, location.protocol);
for (const link of document.querySelectorAll<HTMLElement>('[data-browser-play]')) {
  link.hidden = paused;
}
const notice = document.getElementById('browser-paused');
if (notice) notice.hidden = !paused;
