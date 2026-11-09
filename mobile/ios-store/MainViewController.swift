import UIKit
import Capacitor

/// Capacitor 7 does not find plugins inside the app by itself: this registers ours.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PianistStorePlugin())
    }
}
