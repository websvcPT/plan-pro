import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "resources", "manifest.json"), "utf8"));

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: repoRoot,
        encoding: "utf8",
        ...options,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result;
}

test("install.sh writes manifest version and local-checkout metadata", (t) => {
    const tempRoot = mkdtempSync(join(os.tmpdir(), "plan-pro-install-"));
    t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

    const copilotHome = join(tempRoot, "copilot-home");
    run("bash", ["scripts/install.sh"], {
        env: { ...process.env, COPILOT_HOME: copilotHome },
    });

    const installMetadata = JSON.parse(readFileSync(join(copilotHome, "plan-pro", "state", "install.json"), "utf8"));

    assert.equal(installMetadata.name, manifest.name);
    assert.equal(installMetadata.version, manifest.version);
    assert.equal(installMetadata.installSource, "local-checkout");
    assert.ok(existsSync(join(copilotHome, "extensions", "plan-pro", "extension.mjs")));
});

test("install-from-release.sh installs from a local release archive without cloning", (t) => {
    const tempRoot = mkdtempSync(join(os.tmpdir(), "plan-pro-release-"));
    t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

    const archivePath = join(tempRoot, "plan-pro-release.tar.gz");
    const repoParent = dirname(repoRoot);
    run("tar", ["-czf", archivePath, "-C", repoParent, basename(repoRoot)]);

    const copilotHome = join(tempRoot, "copilot-home");
    run("bash", ["scripts/install-from-release.sh"], {
        env: {
            ...process.env,
            COPILOT_HOME: copilotHome,
            PLAN_PRO_ARCHIVE_FILE: archivePath,
            VERSION: `v${manifest.version}`,
        },
    });

    const installMetadata = JSON.parse(readFileSync(join(copilotHome, "plan-pro", "state", "install.json"), "utf8"));
    const userConfig = JSON.parse(readFileSync(join(copilotHome, "plan-pro", "user", "config.json"), "utf8"));

    assert.equal(installMetadata.installSource, "release-archive");
    assert.equal(installMetadata.requestedVersion, `v${manifest.version}`);
    assert.equal(userConfig.filesystemSlug, manifest.filesystemSlug);
    assert.ok(existsSync(join(copilotHome, "plugins", "plan-pro")));
});
