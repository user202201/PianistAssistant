#!/usr/bin/env bash
# Builds the iOS app from the web code. Needs a Mac with Xcode 16+ (GitHub's macos-15 runner has it) and CocoaPods.
# Always: checks that the project compiles (simulator build) and packs the Xcode project -> packages/ios/out/PianistAssistant-ios-xcode-project.zip
# With Apple signing secrets (see packages/ios/README.md): also an .ipa for TestFlight / App Store -> PianistAssistant.ipa
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RUN="${GITHUB_RUN_NUMBER:-1}"

[ -d node_modules ] || npm ci
# store builds are local-only: no account, no GitHub, the developer cannot see anybody's library (set LOCAL_ONLY=0 for a build that can sync)
MOBILE=1 LOCAL_ONLY="${LOCAL_ONLY:-1}" npm run build
bash mobile/scripts/fetch-sounds.sh dist-app   # the default piano sound goes inside the app
cd mobile
[ -d node_modules ] || npm ci
[ -d ios ] || npx cap add ios
npx capacitor-assets generate --ios --iconBackgroundColor '#1f2937' --splashBackgroundColor '#f2f2f7'
npx cap sync ios

cd ios/App
# native plugins: the MIDI keyboard input (always) and the trial + one-time purchase (docs: packages/ios/README.md; PAYWALL=0 builds a version without the purchase)
cp ../../ios-store/PianistStorePlugin.swift ../../ios-store/PianistMidiPlugin.swift ../../ios-store/MainViewController.swift App/
[ "${PAYWALL:-1}" = "0" ] && sed -i '' '/PianistStorePlugin()/d' App/MainViewController.swift
ruby -e 'require "xcodeproj"' 2>/dev/null || gem install xcodeproj --no-document --user-install
ruby ../../ios-store/add-to-project.rb App.xcodeproj
# the first screen must be our subclass (it registers the plugins)
sed -i '' 's/customClass="CAPBridgeViewController" customModule="Capacitor"/customClass="MainViewController" customModule="App"/' App/Base.lproj/Main.storyboard
grep -q 'customClass="MainViewController"' App/Base.lproj/Main.storyboard || { echo "could not point Main.storyboard at MainViewController"; exit 1; }
# Bluetooth MIDI keyboards: iOS asks for permission with this text
/usr/libexec/PlistBuddy -c "Add :NSBluetoothAlwaysUsageDescription string Used to connect a Bluetooth MIDI keyboard or digital piano. Nothing is sent anywhere." App/Info.plist 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :NSBluetoothAlwaysUsageDescription 'Used to connect a Bluetooth MIDI keyboard or digital piano. Nothing is sent anywhere.'" App/Info.plist || true
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 1.0.${RUN}" App/Info.plist || true
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${RUN}" App/Info.plist || true
# App Store Connect asks about encryption on every upload: the app only uses the system's HTTPS, which is exempt
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" App/Info.plist 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" App/Info.plist || true
# the languages of the app (system dialogs follow them; the App Store page languages are set in App Store Connect)
/usr/libexec/PlistBuddy -c "Delete :CFBundleLocalizations" App/Info.plist 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleLocalizations array" App/Info.plist || true
i=0; for l in en zh-Hans fr de ja ko; do /usr/libexec/PlistBuddy -c "Add :CFBundleLocalizations:$i string $l" App/Info.plist || true; i=$((i+1)); done
# the app plays audio and talks to GitHub: nothing else is needed. (Files are chosen with the system picker.)

WSARG=(-project App.xcodeproj); [ -d App.xcworkspace ] && WSARG=(-workspace App.xcworkspace)
xcodebuild "${WSARG[@]}" -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build

OUT="$ROOT/packages/ios/out"
mkdir -p "$OUT"
cd "$ROOT/mobile"
zip -qr "$OUT/PianistAssistant-ios-xcode-project.zip" ios -x 'ios/App/Pods/*' -x 'ios/App/build/*' -x '*/DerivedData/*'

# An UNSIGNED .ipa: lets you try the app on your own iPad from a Windows PC with a free Apple ID (a tool such as Sideloadly / AltStore signs it
# on your PC; it then runs for 7 days). Not for the App Store. A failure here must not stop the real build.
if ! (
  cd "$ROOT/mobile/ios/App"
  WS=(-project App.xcodeproj); [ -d App.xcworkspace ] && WS=(-workspace App.xcworkspace)
  xcodebuild "${WS[@]}" -scheme App -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
    -archivePath "$PWD/build/unsigned.xcarchive" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" archive
  rm -rf build/Payload && mkdir -p build/Payload
  cp -R build/unsigned.xcarchive/Products/Applications/*.app build/Payload/
  (cd build && zip -qry "$OUT/PianistAssistant-unsigned.ipa" Payload)
); then echo "warning: the unsigned .ipa could not be built"; fi

# optional: signed .ipa (needs an Apple Developer account)
if [ -n "${IOS_CERT_P12_B64:-}" ] && [ -n "${IOS_PROFILE_B64:-}" ]; then
  KC=build.keychain; KP="$(openssl rand -hex 12)"
  security create-keychain -p "$KP" $KC; security set-keychain-settings -lut 21600 $KC
  security unlock-keychain -p "$KP" $KC; security list-keychains -d user -s $KC login.keychain
  echo "$IOS_CERT_P12_B64" | base64 -d > cert.p12
  security import cert.p12 -k $KC -P "${IOS_CERT_PASSWORD:-}" -T /usr/bin/codesign -T /usr/bin/security
  security set-key-partition-list -S apple-tool:,apple: -s -k "$KP" $KC >/dev/null
  mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"
  echo "$IOS_PROFILE_B64" | base64 -d > profile.mobileprovision
  PROFILE_UUID=$(/usr/libexec/PlistBuddy -c "Print UUID" /dev/stdin <<<"$(security cms -D -i profile.mobileprovision)")
  PROFILE_NAME=$(/usr/libexec/PlistBuddy -c "Print Name" /dev/stdin <<<"$(security cms -D -i profile.mobileprovision)")
  cp profile.mobileprovision "$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
  cd ios/App
  cat > ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>teamID</key><string>${IOS_TEAM_ID}</string>
<key>signingStyle</key><string>manual</string><key>provisioningProfiles</key><dict><key>com.pianistassistant.app</key><string>${PROFILE_NAME}</string></dict></dict></plist>
PLIST
  WSARG=(-project App.xcodeproj); [ -d App.xcworkspace ] && WSARG=(-workspace App.xcworkspace)
  xcodebuild "${WSARG[@]}" -scheme App -configuration Release -archivePath "$PWD/build/App.xcarchive" \
    CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$IOS_TEAM_ID" PROVISIONING_PROFILE_SPECIFIER="$PROFILE_NAME" CODE_SIGN_IDENTITY="Apple Distribution" archive
  xcodebuild -exportArchive -archivePath "$PWD/build/App.xcarchive" -exportOptionsPlist ExportOptions.plist -exportPath "$PWD/build/ipa"
  cp build/ipa/*.ipa "$OUT/PianistAssistant.ipa"
  # optional: send it to App Store Connect (TestFlight) right away, using an App Store Connect API key
  if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -n "${ASC_KEY_P8_B64:-}" ]; then
    mkdir -p "$HOME/.appstoreconnect/private_keys"
    echo "$ASC_KEY_P8_B64" | base64 -d > "$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
    xcrun altool --upload-app -f "$OUT/PianistAssistant.ipa" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
  fi
fi
ls -la "$OUT"
