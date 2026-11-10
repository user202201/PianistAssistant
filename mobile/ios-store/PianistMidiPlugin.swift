import Foundation
import Capacitor
import CoreMIDI
import CoreAudioKit
import UIKit

/// Reads a MIDI keyboard / digital piano connected to the iPad (USB through the camera adapter or USB-C, or Bluetooth MIDI) and sends every key
/// press to the web page. Nothing is sent anywhere else. iPad Safari has no Web MIDI, so inside the app this plugin is the only way. JS side: src/midi.ts.
@objc(PianistMidiPlugin)
public class PianistMidiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PianistMidiPlugin"
    public let jsName = "PianistMidi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "devices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showBluetoothUI", returnType: CAPPluginReturnPromise),
    ]

    private var client = MIDIClientRef()
    private var port = MIDIPortRef()
    private var started = false

    private func displayName(_ obj: MIDIObjectRef) -> String {
        var name: Unmanaged<CFString>?
        if MIDIObjectGetStringProperty(obj, kMIDIPropertyDisplayName, &name) == noErr, let n = name?.takeRetainedValue() {
            return n as String
        }
        return "MIDI"
    }

    private func sourceNames() -> [String] {
        var out: [String] = []
        for i in 0..<MIDIGetNumberOfSources() {
            out.append(displayName(MIDIGetSource(i)))
        }
        return out
    }

    /// (re)connect every source that is there now (a piano plugged in later is found through the setup-changed notification)
    private func connectAll() {
        for i in 0..<MIDIGetNumberOfSources() {
            MIDIPortConnectSource(port, MIDIGetSource(i), nil)
        }
        notifyListeners("devices", data: ["devices": sourceNames()])
    }

    @objc func start(_ call: CAPPluginCall) {
        if started { call.resolve(["devices": sourceNames()]); return }
        var status = MIDIClientCreateWithBlock("PianistAssistant" as CFString, &client) { [weak self] notification in
            let id = notification.pointee.messageID
            if id == .msgSetupChanged || id == .msgObjectAdded || id == .msgObjectRemoved {
                DispatchQueue.main.async { self?.connectAll() }
            }
        }
        guard status == noErr else { call.reject("MIDI client could not be created (\(status))"); return }
        status = MIDIInputPortCreateWithBlock(client, "PianistAssistantIn" as CFString, &port) { [weak self] packetList, _ in
            guard let self = self else { return }
            var packet = packetList.pointee.packet
            for _ in 0..<packetList.pointee.numPackets {
                let length = Int(packet.length)
                let bytes: [UInt8] = withUnsafeBytes(of: &packet.data) { raw in Array(raw.prefix(length)) }
                var i = 0
                while i < length {
                    let s = bytes[i]
                    if s >= 0xF0 { i += 1; continue }                      // system messages: skip
                    if s < 0x80 { i += 1; continue }                       // running status is not used by keyboards for notes in practice
                    let kind = s & 0xF0
                    let n = (kind == 0xC0 || kind == 0xD0) ? 2 : 3
                    if i + n > length { break }
                    if kind == 0x90 || kind == 0x80, n == 3 {
                        let note = Int(bytes[i + 1]), vel = Int(bytes[i + 2])
                        let on = kind == 0x90 && vel > 0
                        self.notifyListeners("midi", data: ["type": on ? "on" : "off", "note": note, "velocity": vel])
                    }
                    i += n
                }
                packet = MIDIPacketNext(&packet).pointee
            }
        }
        guard status == noErr else { call.reject("MIDI port could not be created (\(status))"); return }
        started = true
        connectAll()
        call.resolve(["devices": sourceNames()])
    }

    @objc func stop(_ call: CAPPluginCall) {
        if started {
            MIDIPortDispose(port)
            MIDIClientDispose(client)
            started = false
        }
        call.resolve()
    }

    @objc func devices(_ call: CAPPluginCall) {
        call.resolve(["devices": sourceNames()])
    }

    /// the system screen for pairing a Bluetooth MIDI keyboard (iOS has no pairing for them in Settings)
    @objc func showBluetoothUI(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let vc = CABTMIDICentralViewController()
            vc.navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(self.closeBluetoothUI))
            let nav = UINavigationController(rootViewController: vc)
            nav.modalPresentationStyle = .formSheet
            self.bridge?.viewController?.present(nav, animated: true) { call.resolve() }
        }
    }

    @objc func closeBluetoothUI() {
        bridge?.viewController?.dismiss(animated: true)
    }
}
