import UIKit
import Capacitor

/**
 Publishes the device's safe-area insets to the web app as CSS custom properties.

 ── Why this exists ────────────────────────────────────────────────────────────

 The web way to avoid a display cutout is `env(safe-area-inset-*)` with
 `viewport-fit=cover`, and `index.html` is written that way — it works in iOS Safari, so
 the website already handles the notch correctly.

 It does not work here. Measured on an iPhone 17 Pro in the Simulator, every
 `env(safe-area-inset-*)` resolves to `0px` inside Capacitor's WKWebView, and stays 0
 across all of: `viewport-fit=cover` set, the status bar shown and hidden
 (`UIStatusBarHidden`), and `ios.contentInset` of both `never` (Capacitor's default) and
 `always`. Meanwhile the web view IS full-screen — `CAPBridgeViewController.loadView()`
 does `view = webView` — so the content genuinely runs under the status bar and under the
 Dynamic Island. The result was the touch bar's Map and Restart buttons sitting beneath
 the clock and the battery icon, and its two middle buttons behind the island.

 So the numbers have to come from the native side, which is the one place that actually
 knows them. `view.safeAreaInsets` is exactly the right value; this hands it to the page
 as `--sa-top`/`--sa-right`/`--sa-bottom`/`--sa-left`, which is precisely the shape
 `index.html` already consumes:

     --bar-h: calc(54px + var(--sa-top));

 Nothing in `src/` learns about any of this. The web app keeps asking CSS how big the
 cutout is; on iOS the answer is now supplied rather than computed, and everywhere else
 the `env()` fallbacks in `index.html` still apply.

 ── Why a subclass, and why these two hooks ───────────────────────────────────

 `Main.storyboard` names this class, so it replaces the stock controller with no other
 wiring. The insets are pushed from:

   - `viewSafeAreaInsetsDidChange` — the authoritative moment. Fires on rotation, and on
     the first layout pass.
   - `viewDidAppear` — because the first `viewSafeAreaInsetsDidChange` can land before the
     web view has a document to run script in, and a value written to a page that does not
     exist yet is silently lost.

 Both are idempotent, so running twice costs one `evaluateJavaScript` and changes nothing.
 */
class SafeAreaBridgeViewController: CAPBridgeViewController {

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        publishSafeAreaInsets()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        publishSafeAreaInsets()
    }

    /// Write the current insets onto `:root` as CSS custom properties, in CSS px.
    private func publishSafeAreaInsets() {
        // UIKit points and CSS px are the same unit here — both are the logical, non-Retina
        // coordinate space — so the values pass through without scaling by `contentScaleFactor`.
        let insets = view.safeAreaInsets
        let js = """
        (function () {
          var r = document.documentElement;
          if (!r) { return; }
          r.style.setProperty('--sa-top', '\(insets.top)px');
          r.style.setProperty('--sa-right', '\(insets.right)px');
          r.style.setProperty('--sa-bottom', '\(insets.bottom)px');
          r.style.setProperty('--sa-left', '\(insets.left)px');
        })();
        """
        webView?.evaluateJavaScript(js)
    }
}
