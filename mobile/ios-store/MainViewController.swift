import UIKit
import Capacitor

/// Capacitor 7 does not find plugins inside the app by itself: this registers ours (the store plugin line is removed by build-ios.sh when PAYWALL=0).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PianistStorePlugin())
        bridge?.registerPluginInstance(PianistMidiPlugin())
    }
}
