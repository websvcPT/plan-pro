#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node --check "$ROOT/.github/extensions/plan-pro/extension.mjs"
node --check "$ROOT/scripts/read-manifest-field.mjs"
bash -n "$ROOT/scripts/install.sh"
bash -n "$ROOT/scripts/uninstall.sh"
bash -n "$ROOT/scripts/bump-version.sh"
bash -n "$ROOT/scripts/install-from-release.sh"
node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
const files = [
  "resources/manifest.json",
  "resources/default-config.json",
];
for (const file of files) {
  JSON.parse(readFileSync(file, "utf8"));
}
EOF

printf 'plan-pro checks passed.\n'
