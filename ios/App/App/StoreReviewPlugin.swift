import Capacitor
import StoreKit
import UIKit

@objc(StoreReviewPlugin)
public class StoreReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreReviewPlugin"
    public let jsName = "StoreReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestReview", returnType: CAPPluginReturnPromise)
    ]

    @objc func requestReview(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = self.bridge?.viewController?.view.window?.windowScene,
                  scene.activationState == .foregroundActive else {
                call.reject("No active window scene for a review request")
                return
            }
            if #available(iOS 16.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            // StoreKit doesn't report whether it displayed a prompt or received a rating.
            call.resolve()
        }
    }
}
