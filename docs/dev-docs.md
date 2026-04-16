# Developer docs

## Running checks and tests

Use these commands from the repository root:

| Command | Purpose |
| --- | --- |
| `bash scripts/check.sh` | Fast validation: syntax-check the extension and scripts, and parse the shipped JSON files |
| `npm test` | Run the full Node test suite |
| `node --test tests/plan-pro-core.test.mjs` | Run only the pure core-logic tests |
| `node --test tests/install-scripts.test.mjs` | Run only the install-script integration tests |

The test suite uses Node's built-in test runner. There are no third-party test dependencies.

## Local development install

For a local dev install that keeps using your current checkout:

```bash
bash scripts/install.sh
```

If you are developing from another checkout, `bash scripts/install.sh` copies that checkout into `~/.copilot/plugins/plan-pro` and installs the same user-scoped extension/runtime layout.

This copies the package to `~/.copilot/plugins/plan-pro`, installs the runnable user extension at `~/.copilot/extensions/plan-pro`, and seeds runtime state under `~/.copilot/plan-pro`.

After installing, restart Copilot CLI or reload extensions so the current session picks up the new code.

To test the no-clone release path locally, build a tarball of the repo and point the release installer at it:

```bash
TMP_DIR="$(mktemp -d)"
tar -czf "$TMP_DIR/plan-pro-release.tar.gz" -C .. plan-pro
COPILOT_HOME="$TMP_DIR/copilot-home" PLAN_PRO_ARCHIVE_FILE="$TMP_DIR/plan-pro-release.tar.gz" VERSION=v1.0.0 bash scripts/install-from-release.sh
```

## Runtime debug logging

Use the slash command below to enable or disable debug breadcrumbs for the current Copilot session:

```text
/plan-pro:debug on|off
```

Behavior notes:

1. The toggle is **session-only**; it does not persist into `~/.copilot/plan-pro/user/config.json`
2. Runtime diagnostics are appended to `~/.copilot/plan-pro/state/debug.log`
3. `/plan-pro` and `/plan-pro:setup` only show the extra on-screen troubleshooting guidance while debug mode is enabled
4. `/plan-pro:doctor` reports the current debug state and log path

If you are reproducing a stuck interactive flow, enable debug mode first, rerun the command, then inspect `debug.log`.

## How config works

`resources/default-config.json` is the base contract. At runtime, the extension merges it with `~/.copilot/plan-pro/user/config.json`.

Merge behavior:

1. **Objects** merge recursively
2. **Arrays** are replaced wholesale by the user value
3. **Scalars** (`string`, `number`, `boolean`) override the default value
4. **Missing user values** leave the default untouched

Examples:

### Override one setting

```json
{
  "settings": {
    "implementationStartMode": "auto-start"
  }
}
```

### Replace an array entirely

```json
{
  "routing": {
    "planningSequence": [
      "research-exploration",
      "lead-planner"
    ]
  }
}
```

### Add or override DB exploration defaults

```json
{
  "dbExploration": {
    "defaultMode": "shell",
    "modes": {
      "shell": {
        "label": "Shell commands / CLIs",
        "prompt": "Use the approved psql and mysql CLIs only."
      }
    }
  }
}
```

Prompt and template overrides are file-based:

| Path | Effect |
| --- | --- |
| `~/.copilot/plan-pro/user/prompts/user-instructions.md` | Appended to the planning/implementation prompts |
| `~/.copilot/plan-pro/user/templates/plan-template.md` | Overrides the initial project plan/log layout |
| `~/.copilot/plan-pro/user/templates/live-log-template.md` | Overrides the append-only log entry layout |

## Adding new agents

1. Add or edit the prompt body in `resources/agents/<agent-name>.md`
2. Register the agent in `resources/default-config.json` under `agents`
3. If it should be part of the default flow, update `routing`
4. Reinstall with `bash scripts/install.sh`
5. Restart or reload Copilot CLI so the session reloads the custom-agent definitions

## Adding or changing tool profiles

Tool profiles live in `resources/default-config.json` under `toolProfiles`.

Rules:

1. `allowedTools` is a whitelist
2. `allowAllTools: true` bypasses the whitelist
3. The extension enforces the active profile in `onPreToolUse`

To add a new profile:

```json
{
  "toolProfiles": {
    "db-heavy": {
      "description": "Planning with DB exploration tools enabled.",
      "allowedTools": ["bash", "view", "glob", "rg", "sql", "task", "web_fetch"]
    }
  }
}
```

## Adding prompts and templates

Base prompt/template files live in:

| Directory | Purpose |
| --- | --- |
| `resources/prompts/` | Main planning and implementation prompts |
| `resources/templates/` | Project plan/log templates |
| `resources/user-seed/` | User-editable seed files copied into `~/.copilot/plan-pro/user/` |

If you add a new prompt/template and want it to be configurable, add the new config key to `resources/default-config.json`, then read that key in the extension runtime.

## Adding new config options

When adding a new config option:

1. Add the default value to `resources/default-config.json`
2. Read it from `loadEffectiveConfig()` in the extension
3. If it affects user prompts or templates, document the override path in this file and in `README.md`
4. Add tests for the new merge or rendering behavior when feasible

## DB/data exploration workflow

The runtime asks on each `/plan-pro` run whether DB/data exploration is needed.

If enabled, it captures:

1. Whether DB/data exploration is in scope
2. The access mode:
   - MCP tools
   - Shell commands / CLIs
   - User-provided instructions
3. Optional DB access instructions that are injected into the planning and implementation prompts

Defaults for this flow live in `resources/default-config.json` under `dbExploration`.

## Release process

The **canonical release version** lives in `resources/manifest.json`.

Version sources:

| File | Meaning |
| --- | --- |
| `resources/manifest.json` → `version` | Canonical plan-pro release version |
| `resources/default-config.json` → `version` | Config schema version, not the release version |

To prepare a new release:

```bash
bash scripts/bump-version.sh 1.2.3
git add -A
git commit -m "release: v1.2.3"
git tag v1.2.3
git push origin <branch> --tags
gh release create v1.2.3 --generate-notes
```

End-user install without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-from-release.sh | PLAN_PRO_REPO=OWNER/REPO bash
```

Pin a version:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-from-release.sh | PLAN_PRO_REPO=OWNER/REPO VERSION=v1.2.3 bash
```

## Distribution options

| Option | Fit |
| --- | --- |
| Git clone + `bash scripts/install.sh` | Best for development and contributors |
| GitHub Releases + `install-from-release.sh` | Best for end users who want install/update without cloning |
| Copilot marketplace | Future option only if plan-pro is repackaged as a first-class `plugin.json` plugin |

The current marketplace story is intentionally deferred: `plan-pro` is delivered as an extension-backed package, so a first-class marketplace path would require a plugin wrapper or repackaging step.
