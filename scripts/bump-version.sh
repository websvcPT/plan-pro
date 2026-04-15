#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT/resources/manifest.json"
CURRENT_VERSION="$(node "$ROOT/scripts/read-manifest-field.mjs" version)"
NEXT_VERSION="${1:-}"

if [[ -z "$NEXT_VERSION" ]]; then
  printf 'Usage: bash scripts/bump-version.sh <semver>\n' >&2
  exit 1
fi

if [[ ! "$NEXT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  printf 'Invalid version: %s\nExpected semver like 1.2.3 or 1.2.3-rc.1\n' "$NEXT_VERSION" >&2
  exit 1
fi

if [[ "$NEXT_VERSION" == "$CURRENT_VERSION" ]]; then
  printf 'Version is already %s\n' "$CURRENT_VERSION"
  exit 0
fi

node - "$MANIFEST_PATH" "$NEXT_VERSION" <<'EOF'
const [manifestPath, nextVersion] = process.argv.slice(2);
const { readFileSync, writeFileSync } = require("node:fs");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = nextVersion;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
EOF

bash "$ROOT/scripts/check.sh"

printf 'Updated plan-pro release version: %s -> %s\n' "$CURRENT_VERSION" "$NEXT_VERSION"
printf '\nCanonical release version lives only in resources/manifest.json.\n'
printf '\nSuggested next steps:\n'
printf '  git add -A\n'
printf '  git commit -m "release: v%s"\n' "$NEXT_VERSION"
printf '  git tag v%s\n' "$NEXT_VERSION"
printf '  git push origin <branch> --tags\n'
printf '  gh release create v%s --generate-notes\n' "$NEXT_VERSION"
