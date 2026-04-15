# plan-pro

**!!! THIS IS CURRENTLY BETA, USE AT YOUR OWN RISK !!!**

`plan-pro` is a personal GitHub Copilot CLI extension by **WebSVC** that adds a planning wizard, bundled planning agents, configurable tool profiles, optional DB/data exploration guidance, and an optional live project plan/log artifact.

![plan-pro logo](docs/img/logo-L.png)

## Install

For most users, install from a published release without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-from-release.sh | PLAN_PRO_REPO=OWNER/REPO bash
```

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-from-release.sh | PLAN_PRO_REPO=OWNER/REPO VERSION=v1.2.3 bash
```

If you prefer to install from source:

```bash
git clone <YOUR-GITHUB-REPO-URL> ~/.copilot/plugins/plan-pro
cd ~/.copilot/plugins/plan-pro
bash scripts/install.sh
```

Then restart Copilot CLI or start a fresh session so the user extension is loaded.

## What it installs

Running the installer creates three homes:

| Path | Purpose |
| --- | --- |
| `~/.copilot/plugins/plan-pro` | Installed package root |
| `~/.copilot/extensions/plan-pro` | User-scoped extension entrypoint loaded by Copilot CLI |
| `~/.copilot/plan-pro` | Runtime home containing your config, prompts, templates, and state |

## Commands

Once loaded, the extension registers these slash commands:

| Command | Purpose |
| --- | --- |
| `/plan-pro` | Start the planning wizard, collect discovery answers, create the plan, and optionally begin implementation |
| `/plan-pro:setup` | Seed/update the personal config and install the user-scoped copy |
| `/plan-pro:status` | Show the current plan-pro version, loaded agents, configured models, active tool profile, and background task status |
| `/plan-pro:update` | Pull the latest Git checkout (when available) and resync the personal install |
| `/plan-pro:doctor` | Validate install paths, config, templates, and active live-log state |

## Personalize it

Your editable runtime files live under `~/.copilot/plan-pro/user/`:

| Path | Purpose |
| --- | --- |
| `~/.copilot/plan-pro/user/config.json` | Structured settings: questions, agents, routing, models, tool profiles, output behavior |
| `~/.copilot/plan-pro/user/prompts/user-instructions.md` | Freeform appended instructions for planning/implementation behavior |
| `~/.copilot/plan-pro/user/templates/plan-template.md` | Override the initial project plan/log file layout |
| `~/.copilot/plan-pro/user/templates/live-log-template.md` | Override the per-entry append format for the live log |

The default project file name is:

```text
{name}-{date-time}-plan.md
```

The default timestamp format is:

```text
YYYY-MM-DD HH:ii:ss
```

## DB/data exploration workflow

During `/plan-pro`, the extension can now ask whether the run should include DB/data exploration.

If enabled, it captures:

1. Whether DB/data exploration is in scope
2. The preferred access mode:
   - MCP tools
   - Shell commands / CLIs
   - User-provided instructions
3. Optional DB/data access instructions that are injected into the planning and implementation prompts

## Update and uninstall

If the install root is a Git clone, `/plan-pro:update` will refresh the installed copy. You can also update manually:

```bash
cd ~/.copilot/plugins/plan-pro
git pull --ff-only
bash scripts/install.sh
```

For a release-based install, rerun the release installer instead of cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/scripts/install-from-release.sh | PLAN_PRO_REPO=OWNER/REPO bash
```

To remove the installed extension/package:

```bash
bash scripts/uninstall.sh
```

To remove runtime config and state as well:

```bash
bash scripts/uninstall.sh --purge-runtime
```

## Developer docs

Maintainer and contributor guidance lives in `docs/dev-docs.md`.
