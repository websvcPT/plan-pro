import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionSource = readFileSync(
    join(repoRoot, ".github", "extensions", "plan-pro", "extension.mjs"),
    "utf8",
);

test("elicitation calls use requestedSchema", () => {
    const elicitationCallCount = (extensionSource.match(/session\.ui\.elicitation\(/g) || []).length;
    const requestedSchemaCount = (extensionSource.match(/requestedSchema:\s*\{/g) || []).length;

    assert.equal(elicitationCallCount, 4);
    assert.equal(requestedSchemaCount, 4);
    assert.equal(extensionSource.includes("schema: {"), false);
});
