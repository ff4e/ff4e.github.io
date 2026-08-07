/**
 * Device gate: Fish Fillets wants a mouse, so it runs on a PC or a Mac only.
 *
 * The port keeps the original's two input schemes and adds neither: the keyboard drives
 * the fish directly (UMain.pas' key handler), and the mouse does the rest — left-click a
 * fish to select it, left-click water to swim there (`akce_go`), right-click to drive the
 * active fish a step in that direction and so shove things (`ZaznamenejPrikazRoom`,
 * mbRight). Both assume a pointer that can hover and right-click. There is no touch
 * scheme, and a tap cannot express the right-click that pushes an object at all.
 *
 * So a phone or tablet would download the art and then be unable to finish a room. The
 * gate refuses before any of that is fetched.
 *
 * WHAT IS DETECTED, AND WHY IT IS THE POINTER AND NOT THE USER AGENT
 *
 * User-agent sniffing gets this wrong in both directions and needs constant upkeep:
 * iPadOS 13+ deliberately reports itself as "Macintosh", while a Windows laptop with a
 * touchscreen looks like a tablet to most UA regexes. The pointing device answers the
 * question the game actually cares about — is there a mouse-class pointer here at all?
 *
 * So the rule is: block when the device offers NO fine pointer but does offer a coarse
 * one. `any-pointer` (not `pointer`) is deliberate: it asks about EVERY input the device
 * has, not just the primary one, so a touchscreen laptop still counts as supported
 * because its trackpad is there alongside the touchscreen. An iPad reporting itself as a
 * Mac is still caught, because it has no fine pointer to report.
 *
 * It FAILS OPEN. If neither query matches — an old browser without `any-pointer`, or a
 * headless environment that reports nothing — the device is treated as supported. A
 * desktop player wrongly refused entry has no way past it (the block is deliberately
 * absolute), whereas a phone wrongly let in merely meets the same wall the first time a
 * room needs a shove and there is no right-click to give it. The asymmetry decides which
 * way to lean.
 */

/** The overlay explaining why the game will not start. Markup lives in index.html. */
const NOTICE_ID = 'unsupported';

/**
 * Is this a phone or tablet — i.e. a device with touch and nothing mouse-like?
 *
 * Takes its window so the unit tests can hand it a stub; the app passes the real one.
 */
export function isUnsupportedDevice(win: Pick<Window, 'matchMedia'>): boolean {
  const asks = (q: string): boolean => {
    try {
      return win.matchMedia(q).matches;
    } catch {
      return false; // no matchMedia at all -> fail open, see the file comment
    }
  };
  const fine = asks('(any-pointer: fine)');
  const coarse = asks('(any-pointer: coarse)');
  return !fine && coarse;
}

/**
 * Show the refusal and take the game's own UI off screen.
 *
 * The loading overlay is already up by the time the module runs (index.html paints it
 * before the bundle arrives), so it has to be dismissed here or it would sit spinning
 * behind a notice that says nothing is going to load.
 */
export function showUnsupportedNotice(doc: Document): void {
  const notice = doc.getElementById(NOTICE_ID);
  const loading = doc.getElementById('loading');
  if (loading) loading.setAttribute('hidden', '');
  if (notice) notice.removeAttribute('hidden');
  // Marks the document for the stylesheet, which hides the stage/dev bar. Also the
  // signal the UI probe asserts on, since it survives even if the markup is missing.
  doc.documentElement.dataset.unsupported = '1';
}
