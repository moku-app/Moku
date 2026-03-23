#!/bin/sh
# Moku — Suwayomi launcher sidecar for macOS.
# Tauri calls this script directly; the rootDir JVM flag is prepended by
# spawn_server in lib.rs as the first element of invocation.args.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

# When running from inside the .app bundle the sidecar lives in
# Contents/MacOS/; the bundle is in Contents/Resources/.
# Walk up to find the bundle directory.
find_bundle() {
  local base="$1"
  for candidate in \
    "${base}/suwayomi-bundle" \
    "${base}/../Resources/suwayomi-bundle" \
    "${base}/../Resources/binaries/suwayomi-bundle"
  do
    if [ -f "${candidate}/Suwayomi-Server.jar" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

BUNDLE=$(find_bundle "$DIR") || {
  echo "[sidecar] ERROR: cannot locate suwayomi-bundle relative to $DIR" >&2
  exit 1
}

JAVA="${BUNDLE}/jre/bin/java"
JAR="${BUNDLE}/Suwayomi-Server.jar"

if [ ! -x "$JAVA" ]; then
  echo "[sidecar] ERROR: java not found at $JAVA" >&2
  exit 1
fi
if [ ! -f "$JAR" ]; then
  echo "[sidecar] ERROR: jar not found at $JAR" >&2
  exit 1
fi

exec "$JAVA" \
  -Djava.awt.headless=true \
  "$@" \
  -jar "$JAR"
