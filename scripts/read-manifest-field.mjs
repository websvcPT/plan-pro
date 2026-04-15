#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const manifestPath = join(root, "resources", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const fieldPath = process.argv[2];

if (!fieldPath) {
    console.error("Usage: node scripts/read-manifest-field.mjs <field.path>");
    process.exit(1);
}

const value = fieldPath.split(".").reduce((current, part) => current?.[part], manifest);
if (value === undefined) {
    console.error(`Field not found in manifest: ${fieldPath}`);
    process.exit(2);
}

process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
