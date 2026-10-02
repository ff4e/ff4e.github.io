import { isBrowserPlayPaused, setBrowserPlayOverride } from '../platform/browserAvailability.js';

const paused = isBrowserPlayPaused(navigator, location.protocol);
for (const link of document.querySelectorAll<HTMLElement>('[data-browser-play]')) {
  link.hidden = paused;
}
const continueRow = document.getElementById('browser-continue-anyway-row');
if (continueRow) continueRow.hidden = !paused;

// The one way out of the pause: a deliberate click, remembered so it is not asked again.
// `href="/"` is the fallback for a visitor without JS; this handler is the real escape
// hatch, since without JS there is nothing to set the override and nothing to run `/`'s
// game either.
const continueAnyway = document.getElementById('browser-continue-anyway');
continueAnyway?.addEventListener('click', (event) => {
  event.preventDefault();
  setBrowserPlayOverride();
  location.href = '/';
});

// Remember a deliberate language choice (`data-lang-switch="cs"` / `"en"`) so the
// about.html head script stops auto-redirecting by browser language on this visitor's
// future visits; the link's own `href` still does the actual navigation.
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-lang-switch]')) {
  link.addEventListener('click', () => {
    try {
      localStorage.setItem('ff.aboutLang', link.dataset.langSwitch!);
    } catch {
      // Storage disabled: the link still navigates, just without being remembered.
    }
  });
}
