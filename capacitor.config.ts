import type { CapacitorConfig } from '@capacitor/cli';
import { assertStagedDist } from './tools/check-ios-payload';

/**
 * Checked here, at config load, rather than in an npm script, because that is the only
 * place that covers `npx cap sync` — the command Capacitor's own docs tell you to run,
 * and the one that silently packages 250 MB of masters when `dist/` is still the symlink
 * tree `npm run test:ui` leaves behind. See tools/check-ios-payload.ts for the whole
 * story. It is a few stats, and it is a no-op when `dist/` does not exist yet.
 *
 * The config is loaded for every `cap` command, so the check picks out the ones that
 * actually copy. `cap doctor` and `cap ls` never touch `webDir`, and a diagnostic that
 * refuses to run when something is wrong is worse than no diagnostic at all.
 */
assertStagedDist();


/**
 * Native iOS shell for the existing web build. The app is the SAME web app, hosted by a
 * WKWebView instead of a browser — not a fork, not a rewrite. Nothing under `src/` knows
 * it is running natively, and that is the property to preserve.
 *
 * ── Why `webDir: 'dist'` and nothing else ────────────────────────────────────────
 *
 * `dist/` is already the exact tree GitHub Pages serves: `vite build` writes the app
 * shell there, then `tools/stage-pages-assets.mjs` copies the runtime assets out of
 * `public/` with the never-fetched originals filtered off (Music `.wav`, Sound `.ffs`,
 * the help bitmaps, the credits BMPs — 387 MB staged, against 658 MB on disk).
 *
 * Pointing Capacitor at the same directory means the app and the site ship byte-identical
 * content by construction. There is no second staging path to keep in sync, and no way for
 * "works on the site, missing in the app" to happen quietly. `npm run build:ios` is
 * `build` + `stage-pages-assets` + `cap sync`, in that order, for the same reason.
 *
 * ── Why the asset paths need no rewriting ────────────────────────────────────────
 *
 * Every game asset is fetched from a ROOT-RELATIVE url — `/data/Graphic/001.ffr`,
 * `/enhanced-ai/<room>/`, `/data/Music/<name>.m4a`. The tiered loaders take a `base`
 * argument, and `src/app/art.ts` passes `'/'` at every call site. Capacitor serves
 * `webDir` at the root of `capacitor://localhost`, so `/data/...` resolves into the app
 * bundle with no code change and no `<base href>`. That was the single riskiest unknown
 * in this whole packaging exercise; it costs nothing because the site was already built
 * this way.
 */
const config: CapacitorConfig = {
  // Three names, deliberately different:
  //
  //   App Store listing   "Fish Fillets Forever"  (App Store Connect, 30 char limit)
  //   Home screen         "Fishes"                (CFBundleDisplayName in Info.plist)
  //   Web build / console "Fish Fillets 4ever"    (unchanged; ff4e is the site's identity)
  //
  // iOS truncates the home-screen label at roughly twelve characters, so any name built
  // on "Fish Fillets " is shown as an ellipsis and nothing else. "Fishes" fits whole, and
  // carrying no part of the brand there also keeps the icon and its caption clear of
  // Guideline 4.1(c).
  //
  // The cost, written down because it is a real one: Guideline 2.3.7 asks that the name on
  // the device and the name in App Store Connect be SIMILAR, so that someone can find the
  // app they installed. "Fishes" shares no word with "Fish Fillets Forever", so this is a
  // bet rather than a rule being obeyed, and a reviewer is entitled to ask for it back.
  // Taken anyway on 2026-09-06: the ellipsis is a certain problem and this is a possible
  // one. If review does ask, "Fillets" is the fallback — it fits whole and shares a word.
  //
  // The listing name is "Fish Fillets Forever", not "Fish Fillets". No trademark for
  // "Fish Fillets" is registered in any software or game class in any register (TMview,
  // including the Czech ÚPV — every "fillets" mark found is a food-industry one, mostly
  // expired), and the studio that made the game was struck off in 2010. But Bohemia
  // Interactive still sells Fish Fillets 2 today, and unregistered marks arise from use
  // in commerce, so the empty register is not a green light. Guideline 4.1(c) — "you
  // cannot use another developer's brand or product name in your app's icon or name" —
  // is what the trailing "Forever" is doing work against.
  //
  // The bundle id can still change up to the moment an App Store Connect record exists.
  // After that it is permanent, so that registration is the point of no return.
  appId: 'io.github.ff4e.fishfillets4ever',
  appName: 'Fish Fillets Forever',
  webDir: 'dist',
  ios: {
    // The game paints its own background; a white flash between the launch screen and the
    // first frame reads as a bug on an underwater game that is almost entirely dark.
    backgroundColor: '#000000',
    // The canvas is the whole app. Rubber-band scrolling on a fixed-size stage only ever
    // detaches the view from the touch controls the touch series spent six PRs building.
    scrollEnabled: false,
    // Capacitor's default, spelled out because the name suggests a restriction and the
    // value that reads like "off" is the permissive one. It is WKWebView's app-bound
    // domains switch: `true` confines the web view to the domains listed in an
    // `WKAppBoundDomains` plist key and unlocks a few privileged APIs with it. The app
    // is served entirely from the bundle, so there is nothing to gain — and the one
    // navigation that does leave it, the feedback dialog's `target="_blank"` link to
    // github.com (index.html:1097), is exactly the kind `true` is there to stop.
    limitsNavigationsToAppBoundDomains: false,
    // `src/platform/nativeHost.ts` decides it is on the native host by reading
    // `location.protocol`, and this is what sets it. It is Capacitor's default, but a
    // default is not a promise: change it and `isNativeHost()` goes quietly false on the
    // device, which turns off the media workaround and stops the music loading — on the
    // device only, with the web build perfectly fine. Pinned here, and asserted against
    // `NATIVE_SCHEME` by test/nativeHost.test.ts.
    scheme: 'capacitor',
  },
};

export default config;
