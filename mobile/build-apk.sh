#!/usr/bin/env bash
# Build the PicoTrack PAD debug APK for one tenant origin.
# Default: https://efc.picotrack.fr
# Override: PAD_HOST=https://client.picotrack.fr ./mobile/build-apk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${ANDROID_HOME:-}" && -d "${HOME}/android-sdk" ]]; then
  export ANDROID_HOME="${HOME}/android-sdk"
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  echo "ANDROID_HOME est requis (Android SDK, platform android-36, build-tools 35)." >&2
  exit 1
fi

node mobile/configure.mjs

FP="$(keytool -list -v -keystore mobile/android/app/debug.keystore -alias android -storepass android | awk -F': ' '/SHA256:/{print $2; exit}')"
node --input-type=module -e '
import { readFileSync } from "node:fs";
const fp = process.argv[1];
const props = Object.fromEntries(readFileSync("mobile/android/tenant.properties","utf8").trim().split("\n").map(line => line.split("=")));
const links = JSON.parse(readFileSync(".well-known/assetlinks.json","utf8"));
if (props.hostName === "efc.picotrack.fr") {
  const hit = links.find(item => item.target && item.target.package_name === props.applicationId);
  if (!hit) { console.error("assetlinks.json ne déclare pas " + props.applicationId); process.exit(1); }
  if (!hit.target.sha256_cert_fingerprints.includes(fp)) {
    console.error("Empreinte debug absente de assetlinks.json : " + fp);
    process.exit(1);
  }
}
console.log("Certificat debug SHA256 : " + fp);
console.log("Package : " + props.applicationId);
console.log("Origine : " + props.origin);
' "$FP"

printf 'sdk.dir=%s\n' "$ANDROID_HOME" > mobile/android/local.properties
cd mobile/android
chmod +x ./gradlew
./gradlew assembleDebug --no-daemon
APK="app/build/outputs/apk/debug/app-debug.apk"
echo "APK debug : ${ROOT}/mobile/android/${APK}"
