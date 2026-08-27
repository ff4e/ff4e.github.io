/**
 * Device gate: Fish Fillets refuses to run on a phone.
 *
 * WHAT THE GAME NEEDS
 *
 * The port keeps the original's two input schemes and adds neither:
 *
 *  - the keyboard drives the fish (`TRoom.FormKeyDown`, URoom.pas:26784, mapping keys to
 *    `akce` in `ZaznamenejPrikazKlavesou`, Uovl.pas:744);
 *  - the mouse does the same work through the room and the control panel — left-click a
 *    fish to select it, left-click water to swim there (`akce_go`, URoom.pas:26863),
 *    right-click to drive the active fish a step and so shove things
 *    (`ZaznamenejPrikazRoom`, mbRight branch, URoom.pas:26808/26814), plus the panel's
 *    own direction/select/swap/save/load/exit/restart buttons.
 *
 * Neither scheme survives a phone: no keyboard, no right-click, no hover, and at phone
 * size the panel's buttons are a few millimetres across. There is no touch control
 * scheme to fall back on, so the game would download its art and then be unplayable. The
 * gate refuses before any of that art is fetched.
 *
 * WHAT IS DETECTED, AND WHY IT IS NOT THE USER AGENT
 *
 * User-agent sniffing gets this wrong in both directions and needs constant upkeep:
 * iPadOS 13+ deliberately reports itself as "Macintosh", while a Windows laptop with a
 * touchscreen looks like a tablet to most UA regexes.
 *
 * Two signals instead, and BOTH must hold before anything is refused:
 *
 *  1. `(any-pointer: coarse)` — is this touch-capable at all? `any-pointer` rather than
 *     `pointer` is deliberate: it reports EVERY input the device has, not just the
 *     primary one.
 *  2. the screen's short side in CSS pixels — density-independent, so it tracks physical
 *     size. Phones sit at or below ~430 (iPhone 15 Pro Max 430, Pixel 7 Pro 412, iPhone
 *     SE 375); the smallest tablet is far above (iPad mini 744, iPad 10.9 820).
 *
 * SIZE is what does the separating, and that is why there is no `(any-pointer: fine)`
 * test here. An earlier draft opened with "any fine pointer -> allow", which reads
 * plausibly but turns out to decide exactly ONE case that size does not already decide:
 * a phone with a mouse paired to it. Every other device — touchscreen laptop, iPad with
 * a trackpad, plain desktop — is settled by its size or by having no touch at all. A
 * mutation test proved the branch dead in every other configuration, so it is gone: one
 * signal fewer, one untested path fewer, and a phone with a mouse is still a phone.
 *
 * A tablet is therefore ALLOWED, deliberately: its screen is big enough for the control
 * panel, which covers every in-room action (direction, select, swap, save, load, exit,
 * restart — see the panel region table in main.ts). The game is playable there, if not
 * as comfortable as with a keyboard.
 *
 * It FAILS OPEN, twice over: a device that reports no pointer information, or no usable
 * screen size, is treated as supported. Wrongly refusing a desktop player is
 * unrecoverable, whereas wrongly admitting a phone leaves a player facing a room they
 * cannot comfortably drive, which they can simply leave. The asymmetry decides which way
 * to lean.
 *
 * THE REFUSAL IS NO LONGER ABSOLUTE
 *
 * It used to be: "the block is deliberately absolute, with no override". That premise was
 * that a refused phone had nowhere to go, so an override could only ever produce a
 * confused player. It is being replaced by a touch control scheme (icon buttons + swipe),
 * and the override is the first step of that — it is what makes the rest testable on real
 * hardware, and what lets a player who knows what they are doing proceed.
 *
 * The override is deliberately NOT part of `isUnsupportedDevice`. That function answers
 * "is this a phone?", which is a fact about the device and is pinned by
 * test/deviceGate.test.ts against real device sizes; whether the player has asked to
 * continue anyway is a separate question, asked separately at the call site. Keeping them
 * apart means the override cannot drift into the detection rule.
 */

/** The overlay explaining why the game will not start. Markup lives in index.html. */
const NOTICE_ID = 'unsupported';

/**
 * Largest short-side screen dimension, in CSS pixels, still considered a phone.
 *
 * Sits in the empty band between the two device classes rather than next to either: the
 * biggest phones are ~430 and the smallest tablet is 744, so any threshold from roughly
 * 500 to 700 behaves identically. A foldable opened out (Pixel Fold ~840) reads as a
 * tablet, which is right — unfolded it has the room for the panel.
 */
export const PHONE_MAX_SHORT_SIDE = 600;

/** The parts of `window` the rule reads. Narrowed so tests can pass a plain stub. */
export type GateWindow = Pick<Window, 'matchMedia'> & {
  screen?: { width?: number; height?: number };
};

/**
 * Is this a phone — touch-capable, on a phone-sized screen?
 *
 * Takes its window so the unit tests can hand it a stub; the app passes the real one.
 */
export function isUnsupportedDevice(win: GateWindow): boolean {
  let touch: boolean;
  try {
    touch = win.matchMedia('(any-pointer: coarse)').matches;
  } catch {
    return false; // no matchMedia at all -> fail open, see the file comment
  }
  // Not touch-capable (or the browser cannot say) -> a desktop, or fail open.
  if (!touch) return false;
  // Touch-capable. Only phone-SIZED screens are refused; a tablet has room for the
  // panel, and a touchscreen laptop is nowhere near this small.
  const short = Math.min(win.screen?.width ?? 0, win.screen?.height ?? 0);
  return short > 0 && short <= PHONE_MAX_SHORT_SIDE;
}

/** The "Continue anyway" button inside that overlay. Markup lives in index.html. */
const CONTINUE_ID = 'unsupported-continue';

/**
 * Where the player's "continue anyway" choice is remembered, alongside the game's other
 * `ff.*` keys (persist.ts, cheats.ts, devBar.ts). Clear it to be refused again:
 * `localStorage.removeItem('ff.phoneOverride')`.
 *
 * NOTE FOR ANY FUTURE SAVE MIGRATION. This is the one `ff.*` key that is read BEFORE
 * `openSaveStore()` runs `migrateSaves()`, and it cannot be otherwise: the gate must
 * decide before every other side effect, which is the whole ordering contract of
 * `main.ts`'s first statement. `persist.ts` states the invariant that no `ff.*` key is
 * read before migration; this key is the deliberate exception. So it must keep its
 * `'1'`-or-absent shape for ever — a migration that changed it could never reach a phone
 * that needs it, because the un-migrated value would refuse the boot that would have run
 * the migration. If it ever must change, version it under a NEW key and leave this one
 * readable.
 */
export const PHONE_OVERRIDE_KEY = 'ff.phoneOverride';

/**
 * URL escape hatch, `?phone=1`. Two jobs, and the second is why it exists at all:
 *
 *  - it works where storage does not (Safari private browsing throws on `setItem`), so
 *    the button cannot end up doing nothing at all;
 *  - it makes the override reachable without a click, which is how the browser probe
 *    (and anyone testing on a borrowed phone) gets a booted game in a phone-shaped
 *    context.
 */
export const PHONE_OVERRIDE_PARAM = 'phone';

/** The parts of `window` the override reads and writes. Narrowed for the unit tests. */
export type OverrideWindow = {
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  location?: { href?: string; search?: string; replace?: (url: string) => void };
};

/**
 * Has the player already said "continue anyway"?
 *
 * FAILS CLOSED, unlike `isUnsupportedDevice` above, and for the same reason that one
 * fails open: the safe answer is the one that leaves the player where they were. A
 * storage read that throws means "no override was found", i.e. a phone stays refused —
 * whereas treating an unreadable store as consent would admit phones nobody asked to
 * admit.
 */
export function phoneOverrideActive(win: OverrideWindow): boolean {
  try {
    const search = win.location?.search ?? '';
    if (search && new URLSearchParams(search).get(PHONE_OVERRIDE_PARAM) === '1') return true;
  } catch {
    // A malformed query string is not consent; fall through to storage.
  }
  try {
    return win.localStorage?.getItem(PHONE_OVERRIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Remember the choice, so a returning player is not asked again on every visit.
 *
 * Best-effort by design: if storage is unavailable the caller still proceeds via the URL
 * parameter, so a failure here costs persistence, not the override itself.
 */
export function rememberPhoneOverride(win: OverrideWindow): void {
  try {
    win.localStorage?.setItem(PHONE_OVERRIDE_KEY, '1');
  } catch {
    // Storage disabled or full. The `?phone=1` parameter carries this load regardless.
  }
}

/**
 * Show the refusal and take the game's own UI off screen.
 *
 * The loading overlay is already up by the time the module runs (index.html paints it
 * before the bundle arrives), so it has to be dismissed here or it would sit spinning
 * behind a notice that says nothing is going to load.
 *
 * It also arms the "Continue anyway" button, which is why this takes a window: the button
 * remembers the choice and RELOADS rather than resuming the boot in place. Resuming is
 * not available — the gate stops `main.ts` with a never-settling top-level await, and
 * there is no way back into a module that has already stopped. A reload is also the
 * honest version: the second load runs the whole boot in its normal order, with the gate
 * simply not firing, so the continued game is not a special half-booted state that
 * nothing else in the codebase knows about.
 */
export function showUnsupportedNotice(doc: Document, win?: OverrideWindow): void {
  const notice = doc.getElementById(NOTICE_ID);
  const loading = doc.getElementById('loading');
  if (loading) loading.setAttribute('hidden', '');
  if (notice) notice.removeAttribute('hidden');
  // Marks the document for the stylesheet, which hides the stage/dev bar. Also the
  // signal the UI probe asserts on, since it survives even if the markup is missing.
  doc.documentElement.dataset.unsupported = '1';
  const cont = doc.getElementById(CONTINUE_ID);
  const w = win ?? (typeof window !== 'undefined' ? (window as OverrideWindow) : undefined);
  if (!cont || !w) return;
  cont.addEventListener('click', () => {
    rememberPhoneOverride(w);
    // The query parameter, not just the stored flag: storage can be unavailable (Safari
    // private browsing throws on setItem), and a button that silently does nothing is
    // worse than no button. With `?phone=1` on the URL the next load admits regardless.
    const loc = w.location;
    if (!loc) return;
    try {
      const url = new URL(loc.href ?? '');
      url.searchParams.set(PHONE_OVERRIDE_PARAM, '1');
      loc.replace?.(url.toString());
    } catch {
      // No usable absolute href to build on. A relative URL resolves against the current
      // document, which is all this needs — the button must never be a dead end.
      loc.replace?.(`?${PHONE_OVERRIDE_PARAM}=1`);
    }
  });
}
