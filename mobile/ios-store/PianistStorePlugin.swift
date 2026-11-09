import Foundation
import Capacitor
import StoreKit

/// The only native code of the app: asks the App Store (StoreKit 2, on the device, no server) whether the one-time unlock was bought,
/// when the app was first downloaded (for the 14-day trial), and runs the purchase / restore. JS side: src/entitlement.ts.
@objc(PianistStorePlugin)
public class PianistStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PianistStorePlugin"
    public let jsName = "PianistStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
    ]
    /// must be the same id as the in-app purchase made in App Store Connect (docs: packages/ios/README.md)
    static let productId = "com.pianistassistant.app.unlock"

    private func owned() async -> Bool {
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == Self.productId, t.revocationDate == nil { return true }
        }
        return false
    }
    private func product() async -> Product? {
        return try? await Product.products(for: [Self.productId]).first
    }

    @objc func status(_ call: CAPPluginCall) {
        Task {
            var out: [String: Any] = ["owned": await owned()]
            if #available(iOS 16.0, *) {
                // the date Apple recorded for the first download: reinstalling does not restart the trial
                if let r = try? await AppTransaction.shared, case .verified(let at) = r {
                    out["firstInstall"] = at.originalPurchaseDate.timeIntervalSince1970 * 1000
                }
            }
            if let p = await product() { out["price"] = p.displayPrice }
            call.resolve(out)
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        Task {
            guard let p = await product() else { call.reject("The App Store has no product \(Self.productId)"); return }
            do {
                switch try await p.purchase() {
                case .success(let v):
                    if case .verified(let t) = v {
                        await t.finish()
                        call.resolve(["owned": true])
                    } else {
                        call.reject("The App Store could not verify the purchase")
                    }
                case .userCancelled:
                    call.resolve(["owned": false, "cancelled": true])
                case .pending: // e.g. "ask to buy" for a child account: it arrives later
                    call.resolve(["owned": false])
                @unknown default:
                    call.resolve(["owned": false])
                }
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                call.resolve(["owned": await owned()])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }
}
