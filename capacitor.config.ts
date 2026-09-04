import type { CapacitorConfig } from '@capacitor/cli';

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
  // Placeholder. The final bundle id is blocked on the app-name decision — it has to
  // match the App Store Connect record, and renaming after that record exists is the
  // expensive direction. Do not register anything against this string.
  appId: 'io.github.ff4e.app',
  appName: 'Fish Fillets 4ever',
  webDir: 'dist',
  ios: {
    // The game paints its own background; a white flash between the launch screen and the
    // first frame reads as a bug on an underwater game that is almost entirely dark.
    backgroundColor: '#000000',
    // The canvas is the whole app. Rubber-band scrolling on a fixed-size stage only ever
    // detaches the view from the touch controls the touch series spent six PRs building.
    scrollEnabled: false,
    // The game handles its own text; letting iOS scale it reflows the HTML overlays
    // (touch options, subtitles) independently of the canvas they sit on.
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
