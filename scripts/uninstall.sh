#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_READER="$ROOT/scripts/read-manifest-field.mjs"
NAME="$(node "$MANIFEST_READER" name)"
SLUG="$(node "$MANIFEST_READER" filesystemSlug)"
COPILOT_HOME="${COPILOT_HOME:-$HOME/.copilot}"
EXTENSION_ROOT="$COPILOT_HOME/extensions/$NAME"
INSTALL_ROOT="$COPILOT_HOME/plugins/$SLUG"
RUNTIME_ROOT="$COPILOT_HOME/$SLUG"

rm -rf "$EXTENSION_ROOT" "$INSTALL_ROOT"

if [[ "${1:-}" == "--purge-runtime" ]]; then
  rm -rf "$RUNTIME_ROOT"
fi

printf 'Removed %s extension and install root.\n' "$NAME"
if [[ "${1:-}" == "--purge-runtime" ]]; then
  printf 'Removed runtime home as well.\n'
else
  printf 'User config and runtime files were kept at %s\n' "$RUNTIME_ROOT"
fi
