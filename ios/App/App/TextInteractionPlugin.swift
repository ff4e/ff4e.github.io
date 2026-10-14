import Capacitor
import UIKit

/// Lets the page turn WebKit text interaction back on while it actually has text to edit.
///
/// `SafeAreaBridgeViewController` starts the web view with text interaction OFF, which is
/// what keeps iOS's selection loupe off the buttons. The feedback form is the exception: its
/// textarea needs a caret and selection, and its preview is meant to be selectable by hand
/// when the clipboard is out of reach. `src/platform/textInteraction.ts` flips this on while
/// that form is open and back off when it closes.
@objc(TextInteractionPlugin)
public class TextInteractionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextInteractionPlugin"
    public let jsName = "TextInteraction"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise)
    ]

    @objc func setEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("Missing 'enabled'")
            return
        }
        DispatchQueue.main.async {
            // `configuration` hands back a copy, but a shallow one: `preferences` is the
            // web view's live object, and WebKit applies a change to it to the running page.
            guard let preferences = self.bridge?.webView?.configuration.preferences else {
                call.reject("No web view")
                return
            }
            preferences.isTextInteractionEnabled = enabled
            call.resolve()
        }
    }
}
