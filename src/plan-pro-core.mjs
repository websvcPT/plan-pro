export function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(baseValue, overrideValue) {
    if (overrideValue === undefined) {
        return baseValue;
    }
    if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
        return Array.isArray(overrideValue) ? overrideValue : baseValue;
    }
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
        const merged = { ...baseValue };
        for (const [key, value] of Object.entries(overrideValue)) {
            merged[key] = deepMerge(baseValue[key], value);
        }
        return merged;
    }
    return overrideValue;
}

function pad(value) {
    return String(value).padStart(2, "0");
}

export function formatTimestamp(date = new Date(), pattern = "YYYY-MM-DD HH:ii:ss", { forFile = false } = {}) {
    const replacements = [
        ["YYYY", String(date.getFullYear())],
        ["MM", pad(date.getMonth() + 1)],
        ["DD", pad(date.getDate())],
        ["HH", pad(date.getHours())],
        ["ii", pad(date.getMinutes())],
        ["ss", pad(date.getSeconds())],
    ];

    let formatted = pattern;
    for (const [token, replacement] of replacements) {
        formatted = formatted.split(token).join(replacement);
    }

    return forFile ? formatted.replace(/[^\w.-]+/g, "-") : formatted;
}

export function slugify(input) {
    return String(input || "")
        .toLowerCase()
        .trim()
        .replace(/\.md$/i, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "plan";
}

export function renderTemplate(template, replacements) {
    return Object.entries(replacements).reduce(
        (content, [key, value]) => content.split(`{{${key}}}`).join(value ?? ""),
        template,
    );
}

export function buildPlanFileName({
    pattern = "{name}-{date-time}-plan.md",
    nameSeed = "plan",
    timestampFormat = "YYYY-MM-DD HH:ii:ss",
    date = new Date(),
} = {}) {
    const fileName = pattern
        .split("{name}")
        .join(slugify(nameSeed))
        .split("{date-time}")
        .join(formatTimestamp(date, timestampFormat, { forFile: true }));
    const sanitized = fileName.replace(/[^\w.-]+/g, "-");
    return sanitized.endsWith(".md") ? sanitized : `${sanitized}.md`;
}

export function parseDebugCommandInput(input = "") {
    const normalized = String(input || "").trim().toLowerCase();

    if (!normalized) {
        return { ok: true, mode: "status" };
    }

    if (normalized === "on" || normalized === "off") {
        return { ok: true, mode: normalized };
    }

    return {
        ok: false,
        error: `Expected "on" or "off", received "${normalized}".`,
    };
}

export function formatDebugLogEntry({
    timestamp = formatTimestamp(),
    sessionId = "unknown",
    scope = "runtime",
    event = "info",
    detail = "",
    metadata,
} = {}) {
    const parts = [
        timestamp,
        `session=${sessionId}`,
        `scope=${scope}`,
        `event=${event}`,
        String(detail || "").trim() || "_No detail provided._",
    ];

    if (metadata !== undefined) {
        parts.push(`meta=${JSON.stringify(metadata)}`);
    }

    return parts.join(" | ");
}

export function renderDbExplorationSummary(config, dbExploration) {
    if (!dbExploration?.enabled) {
        return "Database/data exploration is not enabled for this run.";
    }

    const modeConfig = config?.dbExploration?.modes?.[dbExploration.mode] || {};
    const lines = [
        "Database/data exploration is enabled for this run.",
        `Preferred access mode: ${modeConfig.label || dbExploration.mode}.`,
    ];

    if (modeConfig.prompt) {
        lines.push(modeConfig.prompt);
    }

    if (dbExploration.instructions?.trim()) {
        lines.push(`DB/data access instructions:\n${dbExploration.instructions.trim()}`);
    } else if (dbExploration.mode === "user-instructions") {
        lines.push("Ask the user for explicit DB/data access instructions before attempting exploration.");
    }

    return lines.join("\n\n");
}
