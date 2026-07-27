#!/usr/bin/env sh
CLI="$(dirname "$0")/../@@NAME@@.exe"
ELECTRON_RUN_AS_NODE=1 exec "$CLI" "$(dirname "$0")/../resources/app/out/cli.js" "$@"
