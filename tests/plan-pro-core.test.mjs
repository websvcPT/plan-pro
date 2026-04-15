import test from "node:test";
import assert from "node:assert/strict";

import {
    buildPlanFileName,
    deepMerge,
    formatTimestamp,
    renderDbExplorationSummary,
} from "../src/plan-pro-core.mjs";

test("deepMerge recursively merges objects and replaces arrays", () => {
    const merged = deepMerge(
        {
            settings: { mode: "ask-before", flags: ["a"] },
            nested: { keep: true, override: "base" },
        },
        {
            settings: { flags: ["b"], showStatusBanner: false },
            nested: { override: "user" },
        },
    );

    assert.deepEqual(merged, {
        settings: { mode: "ask-before", flags: ["b"], showStatusBanner: false },
        nested: { keep: true, override: "user" },
    });
});

test("formatTimestamp supports custom patterns and file-safe output", () => {
    const date = new Date(2026, 3, 15, 0, 27, 44);

    assert.equal(formatTimestamp(date, "YYYY-MM-DD HH:ii:ss"), "2026-04-15 00:27:44");
    assert.equal(
        formatTimestamp(date, "YYYY/MM/DD HH:ii:ss", { forFile: true }),
        "2026-04-15-00-27-44",
    );
});

test("buildPlanFileName uses the configured pattern and slugifies the name seed", () => {
    const date = new Date(2026, 3, 15, 0, 27, 44);
    const fileName = buildPlanFileName({
        pattern: "{name}-{date-time}-plan.md",
        nameSeed: "Billing API",
        timestampFormat: "YYYY-MM-DD HH:ii:ss",
        date,
    });

    assert.equal(fileName, "billing-api-2026-04-15-00-27-44-plan.md");
});

test("renderDbExplorationSummary includes mode guidance and user instructions", () => {
    const summary = renderDbExplorationSummary(
        {
            dbExploration: {
                modes: {
                    mcp: {
                        label: "MCP tools",
                        prompt: "Prefer MCP tools for DB/data exploration when available.",
                    },
                },
            },
        },
        {
            enabled: true,
            mode: "mcp",
            instructions: "Use the readonly analytics database only.",
        },
    );

    assert.match(summary, /Database\/data exploration is enabled/);
    assert.match(summary, /Preferred access mode: MCP tools/);
    assert.match(summary, /Use the readonly analytics database only/);
});
