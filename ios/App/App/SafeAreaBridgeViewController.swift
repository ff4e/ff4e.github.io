import UIKit
import Capacitor

/**
 Publishes the device's safe-area insets to the web app as CSS custom properties.

 ── Why this exists ────────────────────────────────────────────────────────────

 The web way to avoid a display cutout is `env(safe-area-inset-*)` with
 `viewport-fit=cover`. `index.html` deliberately does NOT set that keyword: it would only
 change the public website (putting it under the notch and the home indicator in iOS
 Safari) and would buy this app nothing, for the reason below.

 It does not work here with or without the keyword. Measured on an iPhone 17 Pro in the
 Simulator, every `env(safe-area-inset-*)` resolves to `0px` inside Capacitor's WKWebView,
 and stays 0 across all of: `viewport-fit=cover` set, the status bar shown and hidden
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

 ── Why a subclass, and why these three hooks ─────────────────────────────────

 `SceneDelegate` installs this class as the window's root controller (see the note there —
 the storyboard is a decoy), so it replaces the stock bridge controller with no other
 wiring. The insets are pushed from:

   - `viewSafeAreaInsetsDidChange` — the authoritative moment. Fires on rotation, and on
     the first layout pass.
   - `viewDidAppear` — because the first `viewSafeAreaInsetsDidChange` can land before the
     web view has a document to run script in, and a value written to a page that does not
     exist yet is silently lost.
   - the end of every page load — because `viewDidAppear` is not late enough either, and
     believing it was is what put the touch bar under the notch on a real iPhone 12. Both
     of the hooks above fire while the web view still holds the empty document it starts
     with. Writing to that one succeeds and then evaporates: loading `index.html` installs
     a NEW document, and inline styles do not survive a navigation. Nothing fired again
     afterwards — the insets had not CHANGED, so `viewSafeAreaInsetsDidChange` had no
     reason to — so the page ran with no `--sa-*` at all, fell back to the `env()` values
     in `index.html` (every one of them 0 in this web view), and drew its buttons under the
     housing. Rotating "fixed" it only because rotation is the one path that publishes
     again. Observing `isLoading` catches the moment the real document exists.
   - `viewWillTransition(to:with:)` — because of the landscape mirroring described below.
     Turning the device 180° from one landscape to the other swaps which side the sensor
     housing is on, but leaves `view.safeAreaInsets` bit-for-bit identical (that is the
     whole point of mirroring), so `viewSafeAreaInsetsDidChange` never fires. Without this
     hook the published values stay frozen on the previous orientation and the touch bar
     keeps its gap on the wrong side.

 All three are idempotent, so running twice costs one `evaluateJavaScript` and changes nothing.
 */
class SafeAreaBridgeViewController: CAPBridgeViewController {

    /// Held for the controller's lifetime — releasing it ends the observation.
    private var loadObservation: NSKeyValueObservation?

    override func viewDidLoad() {
        super.viewDidLoad()
        // Republish once the web view has finished loading a document, which is the first
        // moment a write to `:root` has anything durable to land on. See the note above.
        //
        // KVO rather than `WKNavigationDelegate`: the bridge is already the navigation
        // delegate and there is only one of those, so taking it would break Capacitor.
        // Observing is additive and tells nobody else anything.
        loadObservation = webView?.observe(\.isLoading, options: [.new]) { [weak self] _, change in
            guard change.newValue == false else { return }
            DispatchQueue.main.async { self?.publishSafeAreaInsets() }
        }
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        publishSafeAreaInsets()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        publishSafeAreaInsets()
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        // Publish after the transition, not during it: `interfaceOrientation` is still the
        // outgoing value while the rotation is in flight.
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.publishSafeAreaInsets()
        }
    }

    /// Write the current insets onto `:root` as CSS custom properties, in CSS px.
    private func publishSafeAreaInsets() {
        // UIKit points and CSS px are the same unit here — both are the logical, non-Retina
        // coordinate space — so the values pass through without scaling by `contentScaleFactor`.
        var insets = view.safeAreaInsets

        // ── UIKit mirrors the housing inset in landscape; we un-mirror it ──────────
        //
        // Measured on an iPhone 17 Pro. Portrait reports what you would expect:
        // `top=62 right=0 bottom=34 left=0`. Landscape reports `top=0 right=62 bottom=20
        // left=62` — the sensor housing is on ONE side, but the inset appears on BOTH.
        //
        // That is deliberate of UIKit: a symmetric inset keeps content from shifting when
        // the device is flipped 180°, which is the right default for a document. It is the
        // wrong answer for the touch bar, which is pinned to the left edge and only needs
        // to clear something physically in its way. Padded on both sides, it wasted 62pt on
        // whichever side the island was not — visible as a wide empty gap left of the
        // buttons with the island over on the right.
        //
        // `interfaceOrientation` says which side the housing is on. Do not reason about this
        // from the names or from Apple's "home button on the right" wording:
        // `UIInterfaceOrientation` is the mirror image of `UIDeviceOrientation`
        // (`landscapeLeft` is raw value 4 here and 3 there), so the obvious reading comes out
        // backwards. Measured directly in the Simulator on an iPhone 17 Pro instead: with
        // `interfaceOrientation == .landscapeLeft` the Dynamic Island sits on the RIGHT of the
        // rendered page, so the right inset is the real one and the left inset is the mirror.
        // `.landscapeRight` is the reverse.
        //
        // Only the horizontal pair is touched: `bottom` is the home indicator and is real in
        // both orientations.
        if let orientation = view.window?.windowScene?.interfaceOrientation {
            switch orientation {
            case .landscapeLeft: insets.left = 0
            case .landscapeRight: insets.right = 0
            default: break
            }
        }

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
