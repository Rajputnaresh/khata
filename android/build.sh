#!/usr/bin/env bash
#
# Build + sign the Khata Android wrapper.
#
# This drives the raw SDK toolchain (aapt2 -> javac -> d8 -> zipalign ->
# apksigner) instead of Gradle. Reasons:
#   * no AGP/Gradle plugin resolution is needed, so the build is hermetic and
#     works offline apart from nothing at all;
#   * there is exactly one module and one Activity, so Gradle would be pure
#     overhead;
#   * the first AGP download on this machine is a ~1GB cold cache.
#
# Usage:  ./build.sh [--debug] [--install]
# Env:    ANDROID_SDK (default ~/Library/Android/sdk), JAVA_HOME (required)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_SDK="${ANDROID_SDK:-$HOME/Library/Android/sdk}"

# JDK 17 lives in Homebrew and is not on PATH by default on this machine.
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17 ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17
fi
export PATH="$JAVA_HOME/bin:$PATH"

BUILD_TOOLS="$ANDROID_SDK/build-tools/35.0.0"
PLATFORM="$ANDROID_SDK/platforms/android-35/android.jar"
SRC="$HERE/src/app"
BUILD="$HERE/build"
OUT="$HERE/dist"

INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
  esac
done

for tool in "$BUILD_TOOLS/aapt2" "$BUILD_TOOLS/d8" "$BUILD_TOOLS/zipalign" "$BUILD_TOOLS/apksigner" "$PLATFORM"; do
  [ -e "$tool" ] || { echo "missing: $tool" >&2; exit 1; }
done

PKG=khata.app
APK="$OUT/$PKG.apk"

rm -rf "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$OUT"

echo "==> 1/6  resources (aapt2 compile)"
"$BUILD_TOOLS/aapt2" compile --dir "$SRC/res" -o "$BUILD/gen/res.zip"

echo "==> 2/6  resources (aapt2 link)"
# --auto-add-overlay is required because aapt2 compile emits one .flat per
# values/values-night file, and the linker would otherwise treat each of them
# as an overlay of the first and refuse to merge.
"$BUILD_TOOLS/aapt2" link \
  -I "$PLATFORM" \
  --manifest "$SRC/AndroidManifest.xml" \
  -R "$BUILD/gen/res.zip" \
  --auto-add-overlay \
  --java "$BUILD/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 35 \
  --version-code 1 \
  --version-name 1.0.0 \
  -o "$BUILD/gen/base.apk"

echo "==> 3/6  java"
# Do NOT pass -bootclasspath/-source 17: javac 17 refuses --boot-classpath when
# targeting 17, and the Android platform jar is a plain compile-time classpath
# dependency here anyway (every used API predates minSdk 24). Just compile
# against android.jar with a 17 target so lambdas and the service-worker client
# work, and let d8 desugar down to API 24.
find "$SRC" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
javac -nowarn \
  -source 17 -target 17 \
  -classpath "$PLATFORM" \
  -d "$BUILD/classes" \
  @"$BUILD/sources.txt"

echo "==> 4/6  dex (d8)"
find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
[ -s "$BUILD/classes.txt" ] || { echo "no class files produced" >&2; exit 1; }
"$BUILD_TOOLS/d8" \
  --lib "$PLATFORM" \
  --min-api 24 \
  --release \
  @"$BUILD/classes.txt" \
  --output "$BUILD/dex"

echo "==> 5/6  package"
cp "$BUILD/gen/base.apk" "$APK"
# Add every dex d8 produced (one today; more if a future change exceeds the
# 64K method limit and d8 splits).
(cd "$BUILD/dex" && zip -q -X "$APK" ./*.dex)

echo "==> 6/6  align + sign"
"$BUILD_TOOLS/zipalign" -p -f 4 "$APK" "$BUILD/aligned.apk"
"$BUILD_TOOLS/apksigner" sign \
  --ks "$HERE/keystore/khata-debug.jks" \
  --ks-pass pass:khataandroid \
  --key-pass pass:khataandroid \
  --ks-key-alias khata \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$APK" \
  "$BUILD/aligned.apk"
rm -f "$BUILD/aligned.apk"

echo
echo "built  $APK"
ls -l "$APK" | awk '{printf "size   %s bytes (%.1f KB)\n", $5, $5/1024}'
"$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | head -4

if [ "$INSTALL" = 1 ]; then
  echo
  echo "==> installing"
  adb install -r "$APK"
fi
