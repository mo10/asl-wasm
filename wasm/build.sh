#!/usr/bin/env bash
# Build AS (and the companion tools) as WebAssembly modules.
#
# The upstream sources in asl-release/ are not modified: the only files
# created there are the untracked build artifacts Makefile.def (copied
# from wasm/Makefile.def, exactly as upstream's INSTALL instructs) and
# the object directories obj-host/ + obj-wasm/.
#
# Requires: emcc (Emscripten) in PATH, a native C compiler, GNU make.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/asl-release"
DIST="$ROOT/dist"

TOOLS="asl plist alink pbind p2hex p2bin"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found in PATH - install/activate emsdk first" >&2
  exit 1
fi

cp "$ROOT/wasm/Makefile.def" "$SRC/Makefile.def"
mkdir -p "$SRC/obj-host" "$SRC/obj-wasm"

make -C "$SRC" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" binaries

rm -rf "$DIST"
mkdir -p "$DIST"
for tool in $TOOLS; do
  cp "$SRC/obj-wasm/$tool.js" "$SRC/obj-wasm/$tool.wasm" "$DIST/"
done
cp "$ROOT/js/index.js" "$DIST/index.js"
printf '{ "type": "module" }\n' > "$DIST/package.json"

echo "done - WASM modules written to $DIST"
