#!/usr/bin/env bash

set -e

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTENTS="$(cd "$APP_ROOT/../.." && pwd)"

export ELECTRON_RUN_AS_NODE=1
export VSCODE_CLI=1

exec "$CONTENTS/MacOS/@@NAME@@" "$CONTENTS/Resources/app/out/cli.js" "$@"
