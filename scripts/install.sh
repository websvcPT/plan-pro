#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_READER="$SOURCE_ROOT/scripts/read-manifest-field.mjs"
NAME="$(node "$MANIFEST_READER" name)"
VERSION="$(node "$MANIFEST_READER" version)"
SLUG="$(node "$MANIFEST_READER" filesystemSlug)"
COPILOT_HOME="${COPILOT_HOME:-$HOME/.copilot}"
INSTALL_ROOT="$COPILOT_HOME/plugins/$SLUG"
EXTENSION_ROOT="$COPILOT_HOME/extensions/$NAME"
RUNTIME_ROOT="$COPILOT_HOME/$SLUG"
USER_ROOT="$RUNTIME_ROOT/user"
STATE_ROOT="$RUNTIME_ROOT/state"
INSTALL_SOURCE="${PLAN_PRO_INSTALL_SOURCE:-local-checkout}"
REPOSITORY="${PLAN_PRO_REPOSITORY:-}"
REQUESTED_VERSION="${PLAN_PRO_REQUESTED_VERSION:-}"
if [[ "${PLAN_PRO_SOURCE_ROOT+x}" == "x" ]]; then
  SOURCE_ROOT_METADATA="$PLAN_PRO_SOURCE_ROOT"
else
  SOURCE_ROOT_METADATA="$SOURCE_ROOT"
fi

mkdir -p "$(dirname "$INSTALL_ROOT")" "$(dirname "$EXTENSION_ROOT")" "$USER_ROOT/prompts" "$USER_ROOT/templates" "$STATE_ROOT"

if [[ "$SOURCE_ROOT" != "$INSTALL_ROOT" ]]; then
  rm -rf "$INSTALL_ROOT"
  cp -a "$SOURCE_ROOT" "$INSTALL_ROOT"
fi

rm -rf "$EXTENSION_ROOT"
cp -a "$INSTALL_ROOT/.github/extensions/$NAME" "$EXTENSION_ROOT"

if [[ ! -f "$USER_ROOT/config.json" ]]; then
  cp "$INSTALL_ROOT/resources/default-config.json" "$USER_ROOT/config.json"
fi

if [[ ! -f "$USER_ROOT/prompts/user-instructions.md" ]]; then
  cp "$INSTALL_ROOT/resources/user-seed/prompts/user-instructions.md" "$USER_ROOT/prompts/user-instructions.md"
fi

if [[ ! -f "$USER_ROOT/templates/plan-template.md" ]]; then
  cp "$INSTALL_ROOT/resources/templates/plan-template.md" "$USER_ROOT/templates/plan-template.md"
fi

if [[ ! -f "$USER_ROOT/templates/live-log-template.md" ]]; then
  cp "$INSTALL_ROOT/resources/templates/live-log-template.md" "$USER_ROOT/templates/live-log-template.md"
fi

node - "$STATE_ROOT/install.json" "$NAME" "$VERSION" "$SOURCE_ROOT_METADATA" "$INSTALL_ROOT" "$EXTENSION_ROOT" "$RUNTIME_ROOT" "$(date '+%Y-%m-%d %H:%M:%S')" "$INSTALL_SOURCE" "$REPOSITORY" "$REQUESTED_VERSION" <<'EOF'
const [installFile, name, version, sourceRoot, installRoot, extensionRoot, runtimeRoot, installedAt, installSource, repository, requestedVersion] = process.argv.slice(2);
const { writeFileSync } = require("node:fs");

const payload = {
  name,
  version,
  installRoot,
  extensionRoot,
  runtimeRoot,
  installedAt,
  installSource,
};

if (sourceRoot) {
  payload.sourceRoot = sourceRoot;
}
if (repository) {
  payload.repository = repository;
}
if (requestedVersion) {
  payload.requestedVersion = requestedVersion;
}

writeFileSync(installFile, `${JSON.stringify(payload, null, 2)}\n`);
EOF

printf '\nInstalled %s %s.\n\n' "$NAME" "$VERSION"
printf 'Install root: %s\n' "$INSTALL_ROOT"
printf 'User extension: %s\n' "$EXTENSION_ROOT"
printf 'Runtime home: %s\n' "$RUNTIME_ROOT"
printf '\nRestart Copilot CLI or start a fresh session to load the user extension.\n'
