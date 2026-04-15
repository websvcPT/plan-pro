# Repository instructions

## Build, test, and lint commands

| Command | Purpose |
| --- | --- |
| `bash scripts/check.sh` | Primary validation pass: syntax-check the extension and parse the shipped JSON config/manifest files. |
| `npm test` | Run the full Node test suite for the extension/package. |
| `node --test tests/plan-pro-core.test.mjs` | Run the pure core-logic unit tests only. |
| `node --test tests/install-scripts.test.mjs` | Run the install-script integration tests only. |
| `node --check .github/extensions/plan-pro/extension.mjs` | Fast single-file syntax check while iterating on the extension entrypoint. |
| `bash scripts/install.sh` | Install or sync the personal copy into `~/.copilot/plugins/plan-pro` and `~/.copilot/extensions/plan-pro`. |
| `bash scripts/install-from-release.sh` | Install from a tagged release archive without cloning; provide `PLAN_PRO_REPO=OWNER/REPO` and optionally `VERSION=vX.Y.Z`. |
| `bash scripts/bump-version.sh 1.2.3` | Update the canonical release version in `resources/manifest.json` and rerun repository checks. |
| `bash scripts/uninstall.sh` | Remove the installed extension and package root while keeping runtime/user config. |
| `bash scripts/uninstall.sh --purge-runtime` | Remove install artifacts and the runtime home under `~/.copilot/plan-pro`. |

There is no separate lint tool or test suite yet.

## High-level architecture

This repository ships **plan-pro** as an **extension-backed personal package**, not as a static prompt-only skill/plugin bundle.

1. The executable runtime lives in `.github/extensions/plan-pro/extension.mjs`. It registers the slash commands, drives the interactive wizard through the extension UI APIs, installs tool-guard hooks, and maintains live plan/log state.
2. Base assets live in `resources/`. `default-config.json` defines the default question set, agent/model map, routing, and tool profiles. `resources/prompts/` and `resources/templates/` supply the base planning prompts and Markdown output templates. `resources/agents/` contains the role-specific prompt bodies used to register custom planning agents programmatically.
3. Personal installation is file-based: `scripts/install.sh` copies the package to `~/.copilot/plugins/plan-pro`, copies the runnable extension to `~/.copilot/extensions/plan-pro`, and seeds the user-editable runtime home at `~/.copilot/plan-pro`.
4. User overrides live under `~/.copilot/plan-pro/user/`. The extension merges `resources/default-config.json` with `~/.copilot/plan-pro/user/config.json` on each command run. User prompt/template files in the runtime home override the base shipped versions.

## Key conventions

1. **Use `plan-pro` everywhere.** The command name, extension name, install root, runtime home, manifest slug, and config slug should all stay aligned on `plan-pro`.
2. **Dynamic behavior belongs in the extension, not static command files.** The interactive planning wizard, live-log tracking, and status/doctor/update commands are all implemented in the extension because `.claude/commands/*.md`-style commands are prompt files, not executable workflows.
3. **Config is layered, not regenerated.** Treat `resources/default-config.json` as the base contract and merge user overrides on top. Do not overwrite `~/.copilot/plan-pro/user/config.json` or seeded prompt/template files once they exist.
4. **Agent definitions are registered programmatically at session start.** If you change agent prompts, routing, or model assignments, a fresh session is required to reload the updated custom-agent definitions.
5. **Project logs are append-only artifacts.** The extension creates `{name}-{date-time}-plan.md` files and appends timestamped entries for prompts, assistant responses, tool activity, and task completions rather than rewriting historical log entries.
6. **`resources/manifest.json` is the canonical release version source.** Do not hardcode the release version elsewhere. The `version` field in `resources/default-config.json` is the config schema version and is intentionally separate.
7. **DB/data exploration is explicit per run.** The runtime asks whether DB/data exploration is needed, then captures the access mode and optional instructions so planning/implementation prompts can safely reflect the user's chosen access path.
