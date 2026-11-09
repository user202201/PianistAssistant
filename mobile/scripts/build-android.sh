#!/usr/bin/env bash
# Builds the Android app from the web code. Needs: Node 22, JDK 21, the Android SDK (all present on GitHub's ubuntu runners).
# Output: packages/android/out/  PianistAssistant-debug.apk (installable at once)  and, if signing secrets are given, a signed .aab for Google Play.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RUN="${GITHUB_RUN_NUMBER:-1}"

[ -d node_modules ] || npm ci
MOBILE=1 npm run build            # website code -> dist-app (relative paths, no service worker)
bash mobile/scripts/fetch-sounds.sh dist-app   # the default piano sound goes inside the app
cd mobile
[ -d node_modules ] || npm ci
[ -d android ] || npx cap add android
npx capacitor-assets generate --android --iconBackgroundColor '#1f2937' --splashBackgroundColor '#f2f2f7'
npx cap sync android

# every build gets a higher version number (Google Play insists on it)
sed -i "s/versionCode [0-9]*/versionCode ${RUN}/; s/versionName \"[^\"]*\"/versionName \"1.0.${RUN}\"/" android/app/build.gradle

# optional: sign the release with your own key (secrets of the repository, see packages/android/README.md)
SIGN=0
if [ -n "${ANDROID_KEYSTORE_B64:-}" ]; then
  echo "$ANDROID_KEYSTORE_B64" | base64 -d > "$PWD/release.keystore"
  export KEYSTORE_PATH="$PWD/release.keystore"
  cat >> android/app/build.gradle <<'GRADLE'

android {
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes { release { signingConfig signingConfigs.release } }
}
GRADLE
  SIGN=1
fi

cd android
chmod +x gradlew
if [ "$SIGN" = 1 ]; then ./gradlew --no-daemon assembleDebug bundleRelease assembleRelease; else ./gradlew --no-daemon assembleDebug; fi

OUT="$ROOT/packages/android/out"
mkdir -p "$OUT"
cp app/build/outputs/apk/debug/app-debug.apk "$OUT/PianistAssistant-debug.apk"
if [ "$SIGN" = 1 ]; then
  cp app/build/outputs/bundle/release/app-release.aab "$OUT/PianistAssistant-release.aab"
  cp app/build/outputs/apk/release/app-release.apk "$OUT/PianistAssistant-release.apk"
fi
ls -la "$OUT"
