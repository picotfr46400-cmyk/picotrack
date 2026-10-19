#!/usr/bin/env bash
# Boot smoke test of the debug APK on a running emulator, WITHOUT any Custom Tabs browser.
# usage: emulator-smoke.sh <apk> <api-level> <require-login:0|1>
set -uo pipefail
APK="$1"; API="$2"; REQUIRE_LOGIN="$3"
PKG="$(grep '^applicationId=' mobile/android/tenant.properties | cut -d= -f2)"
OUT="${RUNNER_TEMP:-/tmp}/smoke-api${API}"; mkdir -p "$OUT"
fail() { echo "ÉCHEC : $*" >&2; adb logcat -d > "$OUT/logcat.txt" 2>&1; exit 1; }

adb wait-for-device
adb install -r -g "$APK" || fail "installation"

# No Custom Tabs browser: disable every browser package present on the image.
for p in com.android.chrome com.chrome.beta com.chrome.dev com.android.browser org.chromium.chrome; do
  if adb shell pm list packages "$p" | tr -d '\r' | grep -qx "package:$p"; then
    adb shell pm disable-user --user 0 "$p" && echo "Navigateur désactivé : $p"
  fi
done
if [ "$API" -ge 26 ]; then
  ct="$(adb shell cmd package query-services -a android.support.customtabs.action.CustomTabsService 2>/dev/null | tr -d '\r' | grep -c 'packageName=' || true)"
  echo "Fournisseurs Custom Tabs restants : ${ct:-0}"
  [ "${ct:-0}" = 0 ] || fail "un fournisseur Custom Tabs est encore actif"
fi
adb shell dumpsys webviewupdate 2>/dev/null | grep -iE "current webview package|valid package" | head -3 || true

adb logcat -c
adb shell am start -W -n "$PKG/fr.picotrack.pad.LauncherActivity" || fail "lancement"

found=0; reached=0
for i in $(seq 1 40); do
  sleep 3
  focus="$( { adb shell dumpsys window; adb shell dumpsys activity activities; } 2>/dev/null | tr -d "\r" | grep -E "mCurrentFocus|mFocusedApp|topResumedActivity|mResumedActivity" | head -4)"
  echo "$focus" | grep -q "WebViewFallbackActivity" && reached=1
  if [ "$REQUIRE_LOGIN" = 1 ] && [ "$reached" = 1 ]; then
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb pull /sdcard/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
    if grep -qiE "Connecter ce terminal|Connexion terminal terrain|Code environnement" "$OUT/ui.xml" 2>/dev/null; then found=1; break; fi
  elif [ "$REQUIRE_LOGIN" != 1 ] && [ "$reached" = 1 ] && [ "$i" -ge 10 ]; then
    break
  fi
done
echo "Focus : $focus"
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png "$OUT/screen.png" >/dev/null 2>&1
adb logcat -d > "$OUT/logcat.txt" 2>&1

if grep -E "FATAL EXCEPTION|Fatal signal" "$OUT/logcat.txt"; then fail "FATAL dans logcat"; fi
adb shell pidof "$PKG" >/dev/null 2>&1 || adb shell ps | grep -q "$PKG" || fail "le processus $PKG n'est plus vivant"
[ "$reached" = 1 ] || fail "page non atteinte (WebViewFallbackActivity jamais au premier plan)"
grep -q "chromium" "$OUT/logcat.txt" && echo "WebView chargée (logs chromium présents)."
if [ "$REQUIRE_LOGIN" = 1 ]; then [ "$found" = 1 ] || fail "écran de connexion non affiché"; echo "Écran de connexion affiché."; fi
echo "OK API $API : démarrage sans navigateur Custom Tabs, aucun FATAL, page atteinte."
