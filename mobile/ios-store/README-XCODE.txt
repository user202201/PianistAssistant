Pianist Assistant - Xcode project (self-contained)

1. Open  ios/App/App.xcworkspace  in Xcode (the workspace, not the .xcodeproj).
2. Xcode > Settings > Accounts: sign in with your Apple ID.
3. Click the blue "App" project > TARGETS > App > Signing & Capabilities:
   tick "Automatically manage signing", choose your Team, and change the Bundle Identifier to something of your own (e.g. com.yourname.pianist).
4. Connect the iPad, trust the computer, choose the iPad at the top of the window, press Run.
5. On the iPad: Settings > General > VPN & Device Management > trust your Apple ID.

Everything the project needs is in this folder (Pods/ and node_modules/@capacitor/ios). Do not move ios/ away from node_modules/.
If Xcode still complains that Pods are missing:  cd ios/App && pod install   (needs CocoaPods: sudo gem install cocoapods)
