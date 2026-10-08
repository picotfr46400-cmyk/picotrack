#!/usr/bin/env bash
# Build the PicoTrack PAD debug APK for one tenant origin.
# Default: https://efc.picotrack.fr
# Override: PAD_HOST=https://client.picotrack.fr ./mobile/build-apk.sh
#
# Debug signing comes from the environment, never from the repository:
#   ANDROID_DEBUG_KEYSTORE_BASE64
#   ANDROID_DEBUG_KEYSTORE_PASSWORD
#   ANDROID_DEBUG_KEY_ALIAS
#   ANDROID_DEBUG_KEY_PASSWORD
# If the base64 secret is absent, a throwaway keystore is generated for this build only.
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

KEYSTORE_FILE="${ROOT}/mobile/android/app/debug.keystore"
rm -f "$KEYSTORE_FILE"
TRUSTED_DEBUG=0
if [[ -n "${ANDROID_DEBUG_KEYSTORE_BASE64:-}" ]]; then
  if [[ -z "${ANDROID_DEBUG_KEYSTORE_PASSWORD:-}" || -z "${ANDROID_DEBUG_KEY_ALIAS:-}" || -z "${ANDROID_DEBUG_KEY_PASSWORD:-}" ]]; then
    echo "ANDROID_DEBUG_KEYSTORE_BASE64 est défini : le mot de passe store, le mot de passe de clé et l'alias sont requis." >&2
    exit 1
  fi
  printf '%s' "$ANDROID_DEBUG_KEYSTORE_BASE64" | tr -d '\n' | base64 -d > "$KEYSTORE_FILE"
  TRUSTED_DEBUG=1
  echo "Signature debug : keystore fourni par l'environnement."
else
  ephemeral_pass="$(openssl rand -hex 24)"
  export ANDROID_DEBUG_KEYSTORE_PASSWORD="$ephemeral_pass"
  export ANDROID_DEBUG_KEY_PASSWORD="$ephemeral_pass"
  export ANDROID_DEBUG_KEY_ALIAS="picotrack-pad-debug"
  keytool -genkeypair -keystore "$KEYSTORE_FILE" -alias "$ANDROID_DEBUG_KEY_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 3650 \
    -storepass "$ANDROID_DEBUG_KEYSTORE_PASSWORD" -keypass "$ANDROID_DEBUG_KEY_PASSWORD" \
    -dname "CN=PicoTrack PAD Ephemeral Debug, OU=CI, O=PicoTrack, C=FR" >/dev/null
  unset ephemeral_pass
  echo "Signature debug : clé éphémère (absente des secrets). Elle ne correspond pas à assetlinks.json."
fi
export ANDROID_DEBUG_KEYSTORE_PATH="$KEYSTORE_FILE"

FP="$(keytool -list -v -keystore "$KEYSTORE_FILE" -alias "$ANDROID_DEBUG_KEY_ALIAS" -storepass "$ANDROID_DEBUG_KEYSTORE_PASSWORD" | awk -F': ' '/SHA256:/{print $2; exit}')"
node --input-type=module -e '
import { readFileSync } from "node:fs";
const fp = process.argv[1];
const trusted = process.argv[2] === "1";
const props = Object.fromEntries(readFileSync("mobile/android/tenant.properties","utf8").trim().split("\n").filter(Boolean).map(line => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1)];
}));
const links = JSON.parse(readFileSync(".well-known/assetlinks.json","utf8"));
console.log("Certificat debug SHA256 : " + fp);
console.log("Package : " + props.applicationId);
console.log("Origine : " + props.origin);
if (props.hostName === "efc.picotrack.fr" && trusted) {
  const hit = links.find(item => item.target && item.target.package_name === props.applicationId);
  if (!hit) { console.error("assetlinks.json ne déclare pas " + props.applicationId); process.exit(1); }
  if (!hit.target.sha256_cert_fingerprints.includes(fp)) {
    console.error("Empreinte debug absente de assetlinks.json : " + fp);
    process.exit(1);
  }
  console.log("Empreinte debug alignée avec assetlinks.json.");
}
' "$FP" "$TRUSTED_DEBUG"

printf 'sdk.dir=%s\n' "$ANDROID_HOME" > mobile/android/local.properties
cd mobile/android
chmod +x ./gradlew
./gradlew assembleDebug --no-daemon
APK="app/build/outputs/apk/debug/app-debug.apk"
echo "APK debug : ${ROOT}/mobile/android/${APK}"
