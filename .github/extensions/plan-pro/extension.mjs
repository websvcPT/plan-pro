import { spawnSync } from "node:child_process";
import {
    appendFileSync,
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

import { joinSession } from "@github/copilot-sdk/extension";

const DISPLAY_NAME = "plan-pro";
const COMMAND_PREFIX = "plan-pro";
const FILESYSTEM_SLUG = "plan-pro";
const FALLBACK_VERSION = "0.0.0-dev";

const COPILOT_HOME = join(os.homedir(), ".copilot");
const USER_EXTENSION_ROOT = join(COPILOT_HOME, "extensions", COMMAND_PREFIX);
const INSTALL_ROOT = join(COPILOT_HOME, "plugins", FILESYSTEM_SLUG);
const RUNTIME_ROOT = join(COPILOT_HOME, FILESYSTEM_SLUG);
const USER_ROOT = join(RUNTIME_ROOT, "user");
const STATE_ROOT = join(RUNTIME_ROOT, "state");
const ACTIVE_RUN_PATH = join(STATE_ROOT, "active-run.json");
const INSTALL_METADATA_PATH = join(STATE_ROOT, "install.json");

const EXTENSION_ROOT = dirname(fileURLToPath(import.meta.url));
const USER_EXTENSIONS_HOME = resolve(join(COPILOT_HOME, "extensions"));
const IS_USER_EXTENSION = resolve(EXTENSION_ROOT).startsWith(`${USER_EXTENSIONS_HOME}/`);
const PROJECT_ROOT = resolve(EXTENSION_ROOT, "../../..");
const CORE_MODULE_SPECIFIER = IS_USER_EXTENSION
    ? "../../plugins/plan-pro/src/plan-pro-core.mjs"
    : "../../../src/plan-pro-core.mjs";
const {
    buildPlanFileName,
    deepMerge,
    formatTimestamp,
    renderDbExplorationSummary,
    renderTemplate,
    slugify,
} = await import(CORE_MODULE_SPECIFIER);

const FALLBACK_MANIFEST = {
    name: DISPLAY_NAME,
    version: FALLBACK_VERSION,
    filesystemSlug: FILESYSTEM_SLUG,
    description: "Slash-command planning workflow with personal config and live plan logging",
};

const runtime = {
    activeRun: null,
    loadedAgents: [],
    backgroundTasks: { agents: [], shells: [] },
    toolCalls: new Map(),
    currentModel: undefined,
    suspendAutoLog: false,
};

let session;

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pathExists(path) {
    return existsSync(path);
}

function ensureDir(path) {
    mkdirSync(path, { recursive: true });
    return path;
}

function readText(path, fallback = "") {
    try {
        return readFileSync(path, "utf8");
    } catch {
        return fallback;
    }
}

function readJson(path, fallback = {}) {
    try {
        return JSON.parse(readText(path));
    } catch {
        return fallback;
    }
}

function tryReadJson(path) {
    try {
        return { ok: true, value: JSON.parse(readText(path)) };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

function writeText(path, content) {
    ensureDir(dirname(path));
    writeFileSync(path, content, "utf8");
}

function writeJson(path, value) {
    writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function expandHome(input) {
    if (!input) {
        return input;
    }
    if (input === "~") {
        return os.homedir();
    }
    if (input.startsWith("~/")) {
        return join(os.homedir(), input.slice(2));
    }
    return input;
}

function resolvePathFromCwd(input) {
    const expanded = expandHome(input);
    return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
}

function truncate(input, maxLength = 4000) {
    if (!input || input.length <= maxLength) {
        return input || "";
    }
    return `${input.slice(0, maxLength - 3)}...`;
}

function getPackageRoot() {
    if (IS_USER_EXTENSION) {
        return INSTALL_ROOT;
    }
    return PROJECT_ROOT;
}

function getResourcesRoot() {
    return join(getPackageRoot(), "resources");
}

function getDefaultConfigPath() {
    return join(getResourcesRoot(), "default-config.json");
}

function getUserConfigPath() {
    return join(USER_ROOT, "config.json");
}

function resolveConfiguredAssetPath(configuredPath, fallbackRelative) {
    if (configuredPath) {
        const expanded = expandHome(configuredPath);
        if (isAbsolute(expanded)) {
            return expanded;
        }

        const userPath = join(USER_ROOT, expanded);
        if (pathExists(userPath)) {
            return userPath;
        }

        const packagePath = join(getResourcesRoot(), expanded);
        if (pathExists(packagePath)) {
            return packagePath;
        }
    }

    return join(getResourcesRoot(), fallbackRelative);
}

function getInstallMetadata() {
    return readJson(INSTALL_METADATA_PATH, {});
}

function getManifest() {
    return deepMerge(FALLBACK_MANIFEST, readJson(join(getResourcesRoot(), "manifest.json"), {}));
}

function ensureUserScaffold() {
    ensureDir(USER_ROOT);
    ensureDir(join(USER_ROOT, "prompts"));
    ensureDir(join(USER_ROOT, "templates"));
    ensureDir(STATE_ROOT);

    const defaultConfig = readJson(getDefaultConfigPath(), {});
    if (!pathExists(getUserConfigPath())) {
        writeJson(getUserConfigPath(), defaultConfig);
    }

    const userInstructionsTarget = join(USER_ROOT, "prompts", "user-instructions.md");
    const userInstructionsSeed = join(getResourcesRoot(), "user-seed", "prompts", "user-instructions.md");
    if (!pathExists(userInstructionsTarget) && pathExists(userInstructionsSeed)) {
        copyFileSync(userInstructionsSeed, userInstructionsTarget);
    }

    const planTemplateTarget = join(USER_ROOT, "templates", "plan-template.md");
    const basePlanTemplate = join(getResourcesRoot(), "templates", "plan-template.md");
    if (!pathExists(planTemplateTarget) && pathExists(basePlanTemplate)) {
        copyFileSync(basePlanTemplate, planTemplateTarget);
    }

    const liveLogTemplateTarget = join(USER_ROOT, "templates", "live-log-template.md");
    const baseLiveLogTemplate = join(getResourcesRoot(), "templates", "live-log-template.md");
    if (!pathExists(liveLogTemplateTarget) && pathExists(baseLiveLogTemplate)) {
        copyFileSync(baseLiveLogTemplate, liveLogTemplateTarget);
    }
}

function loadEffectiveConfig({ seedUserConfig = false } = {}) {
    if (seedUserConfig) {
        ensureUserScaffold();
    } else {
        ensureDir(USER_ROOT);
        ensureDir(join(USER_ROOT, "prompts"));
        ensureDir(join(USER_ROOT, "templates"));
        ensureDir(STATE_ROOT);
    }

    const defaults = readJson(getDefaultConfigPath(), {});
    const userOverrides = readJson(getUserConfigPath(), {});
    return deepMerge(defaults, userOverrides);
}

function readUserInstructions(config) {
    const relativePath = config.prompts?.userInstructionsFile || "prompts/user-instructions.md";
    return readText(resolveConfiguredAssetPath(relativePath, "user-seed/prompts/user-instructions.md"), "").trim();
}

function readRolePrompt(roleName, config) {
    const role = config.agents?.[roleName] || {};
    const promptFile = role.promptFile || `agents/${roleName}.md`;
    return readText(resolveConfiguredAssetPath(promptFile, `agents/${roleName}.md`), "").trim();
}

function buildCustomAgents(config) {
    const userInstructions = readUserInstructions(config);

    return Object.entries(config.agents || {})
        .filter(([, agent]) => agent && agent.enabled !== false)
        .map(([name, agent]) => {
            const tools =
                Array.isArray(agent.tools) && agent.tools.length > 0 && !agent.tools.includes("*")
                    ? agent.tools
                    : null;

            const promptSections = [
                readRolePrompt(name, config),
                userInstructions ? `Additional user instructions:\n${userInstructions}` : "",
            ].filter(Boolean);

            return {
                name,
                displayName: agent.displayName || name,
                description: agent.description || "",
                tools,
                prompt: promptSections.join("\n\n"),
                model: agent.model,
                infer: agent.infer !== false,
                userInvocable: agent.userInvocable !== false,
            };
        });
}

function renderAgentRoles(config) {
    return Object.entries(config.agents || {})
        .filter(([, agent]) => agent && agent.enabled !== false)
        .map(([name, agent]) => `- \`${name}\` (${agent.displayName}): ${agent.description} [model: ${agent.model}]`)
        .join("\n");
}

function renderToolPolicy(toolProfileName, toolProfile) {
    if (!toolProfile) {
        return "No explicit tool policy is active.";
    }
    if (toolProfile.allowAllTools) {
        return "All available tools are allowed for this run.";
    }
    return [
        `${toolProfile.description}`,
        "",
        "Allowed tools:",
        ...(toolProfile.allowedTools || []).map((toolName) => `- \`${toolName}\``),
    ].join("\n");
}

function renderDiscoverySummary(config, discoveryAnswers) {
    return (config.questions || [])
        .filter((question) => question.enabled !== false)
        .map((question) => `- **${question.label}**: ${discoveryAnswers[question.id] || "_Not provided._"}`)
        .join("\n");
}

function buildPlanFilePath(config, directory, nameSeed) {
    const resolvedDirectory = resolvePathFromCwd(directory || process.cwd());
    ensureDir(resolvedDirectory);
    return join(
        resolvedDirectory,
        buildPlanFileName({
            pattern: config.templates?.planFileNamePattern || "{name}-{date-time}-plan.md",
            nameSeed,
            timestampFormat: config.templates?.timestampFormat || "YYYY-MM-DD HH:ii:ss",
        }),
    );
}

function buildPlanningPrompt(config, manifest, toolProfileName, discoveryAnswers, runOptions) {
    const template = readText(
        resolveConfiguredAssetPath(
            config.prompts?.basePlanningPromptFile || "prompts/base-planning.md",
            "prompts/base-planning.md",
        ),
        "Plan the requested work based on the provided discovery answers.",
    );
    const toolProfile = config.toolProfiles?.[toolProfileName];
    const userInstructions = readUserInstructions(config) || "_No additional user instructions._";

    return renderTemplate(template, {
        VERSION: manifest.version,
        CWD: process.cwd(),
        AGENT_ROLES: renderAgentRoles(config),
        TOOL_PROFILE_NAME: toolProfileName,
        TOOL_PROFILE_DESCRIPTION: toolProfile?.description || "No description available.",
        TOOL_POLICY: renderToolPolicy(toolProfileName, toolProfile),
        DB_EXPLORATION_POLICY: renderDbExplorationSummary(config, runOptions.dbExploration),
        DISCOVERY_ANSWERS: renderDiscoverySummary(config, discoveryAnswers),
        USER_INSTRUCTIONS: userInstructions,
        SAVE_PLAN_NOTE: runOptions.saveProjectPlan
            ? `A project plan/log file will be written to \`${runOptions.projectPlanPath}\`.`
            : "No project-local plan/log file will be written unless the user asks later.",
    });
}

function buildImplementationPrompt(config, planContent, additionalNotes, runOptions) {
    const template = readText(
        resolveConfiguredAssetPath(
            config.prompts?.implementationPromptFile || "prompts/implementation-follow-up.md",
            "prompts/implementation-follow-up.md",
        ),
        "Begin implementing the approved plan.",
    );

    return renderTemplate(template, {
        PLAN_CONTENT: planContent,
        IMPLEMENTATION_NOTES: additionalNotes?.trim() || "_No additional notes supplied._",
        DB_EXPLORATION_POLICY: renderDbExplorationSummary(config, runOptions?.dbExploration),
        USER_INSTRUCTIONS: readUserInstructions(config) || "_No additional user instructions._",
    });
}

function getPlanTemplate(config) {
    return readText(
        resolveConfiguredAssetPath(
            config.templates?.planTemplateFile || "templates/plan-template.md",
            "templates/plan-template.md",
        ),
        "# {{PLAN_NAME}}\n\n{{PLAN_CONTENT}}\n",
    );
}

function getLiveLogTemplate(config) {
    return readText(
        resolveConfiguredAssetPath(
            config.templates?.logTemplateFile || "templates/live-log-template.md",
            "templates/live-log-template.md",
        ),
        "### {{TIMESTAMP}} - {{ENTRY_KIND}}\n\n{{ENTRY_CONTENT}}\n",
    );
}

function writeInitialProjectPlan(config, manifest, runOptions, discoveryAnswers, planContent) {
    const template = getPlanTemplate(config);
    const fileContent = renderTemplate(template, {
        PLAN_NAME: runOptions.projectPlanName,
        CREATED_AT: formatTimestamp(new Date(), config.templates?.timestampFormat || "YYYY-MM-DD HH:ii:ss"),
        SESSION_ID: session.sessionId,
        VERSION: manifest.version,
        TOOL_PROFILE: runOptions.toolProfile,
        CWD: process.cwd(),
        DISCOVERY_SUMMARY: renderDiscoverySummary(config, discoveryAnswers),
        PLAN_CONTENT: planContent,
    });

    writeText(runOptions.projectPlanPath, `${fileContent.trim()}\n`);
}

function appendProjectLogEntry(config, runState, entryKind, entryContent) {
    if (!runState?.logPath) {
        return;
    }

    const template = getLiveLogTemplate(config);
    const rendered = renderTemplate(template, {
        TIMESTAMP: formatTimestamp(new Date(), config.templates?.timestampFormat || "YYYY-MM-DD HH:ii:ss"),
        ENTRY_KIND: entryKind,
        ENTRY_CONTENT: truncate(entryContent?.trim() || "_No content._"),
    });

    appendFileSync(runState.logPath, `\n${rendered.trim()}\n`, "utf8");
}

function getActiveRun() {
    if (!runtime.activeRun) {
        return null;
    }
    if (!session || runtime.activeRun.sessionId !== session.sessionId) {
        return null;
    }
    return runtime.activeRun;
}

function setActiveRun(nextRun) {
    runtime.activeRun = nextRun;
    if (!nextRun) {
        rmSync(ACTIVE_RUN_PATH, { force: true });
        return;
    }
    writeJson(ACTIVE_RUN_PATH, nextRun);
}

function shouldAutoLog() {
    const activeRun = getActiveRun();
    return Boolean(activeRun?.trackContinuously && activeRun?.logPath && !runtime.suspendAutoLog);
}

function summarizeToolExecution(toolMeta, completionData) {
    if (!toolMeta) {
        return completionData.success ? "A tool completed successfully." : "A tool failed.";
    }

    const { toolName, arguments: toolArgs } = toolMeta;
    const normalizedName = toolMeta.mcpServerName ? `${toolMeta.mcpServerName}.${toolName}` : toolName;

    if (!completionData.success) {
        return `Tool \`${normalizedName}\` failed.`;
    }

    if ((toolName === "view" || toolName === "show_file" || toolName === "create" || toolName === "edit") && toolArgs?.path) {
        return `Tool \`${normalizedName}\` touched \`${toolArgs.path}\`.`;
    }

    if (toolName === "apply_patch") {
        return "Applied a patch to the working tree.";
    }

    if (toolName === "bash") {
        const description = toolArgs?.description || toolArgs?.command;
        return `Shell command completed: ${truncate(String(description || "bash"), 200)}`;
    }

    if (toolName === "task") {
        return `Delegated task completed: ${truncate(String(toolArgs?.description || toolArgs?.prompt || "background task"), 200)}`;
    }

    return `Tool \`${normalizedName}\` completed successfully.`;
}

function formatMarkdownTable(headers, rows) {
    const headerRow = `| ${headers.join(" | ")} |`;
    const separatorRow = `| ${headers.map(() => "---").join(" | ")} |`;
    const dataRows = rows.length > 0
        ? rows.map((row) => `| ${row.join(" | ")} |`).join("\n")
        : `| ${headers.map((_, index) => (index === 0 ? "_none_" : "")).join(" | ")} |`;
    return [headerRow, separatorRow, dataRows].join("\n");
}

function listLoadedAgents(config, currentAgentName) {
    const loaded = runtime.loadedAgents.length > 0
        ? runtime.loadedAgents
        : Object.entries(config.agents || {})
              .filter(([, agent]) => agent && agent.enabled !== false)
              .map(([name, agent]) => ({
                  name,
                  displayName: agent.displayName || name,
                  description: agent.description || "",
                  model: agent.model,
              }));

    return loaded.map((agent) => [
        agent.displayName || agent.name,
        agent.model || config.agents?.[agent.name]?.model || "_default_",
        agent.name === currentAgentName ? "selected" : "ready",
    ]);
}

function listBackgroundTaskRows() {
    const agentRows = (runtime.backgroundTasks.agents || []).map((task) => [
        "agent",
        task.agentId,
        task.description || task.agentType || "_background agent_",
        "running",
    ]);

    const shellRows = (runtime.backgroundTasks.shells || []).map((task) => [
        "shell",
        task.shellId,
        task.description || "_background shell_",
        "running",
    ]);

    return [...agentRows, ...shellRows];
}

function syncPersonalInstall(sourceRoot = getPackageRoot()) {
    const normalizedSourceRoot = resolve(sourceRoot);

    ensureDir(dirname(INSTALL_ROOT));
    ensureDir(dirname(USER_EXTENSION_ROOT));
    ensureDir(STATE_ROOT);

    if (normalizedSourceRoot !== resolve(INSTALL_ROOT)) {
        rmSync(INSTALL_ROOT, { recursive: true, force: true });
        cpSync(normalizedSourceRoot, INSTALL_ROOT, { recursive: true });
    }

    rmSync(USER_EXTENSION_ROOT, { recursive: true, force: true });
    cpSync(join(INSTALL_ROOT, ".github", "extensions", COMMAND_PREFIX), USER_EXTENSION_ROOT, { recursive: true });

    ensureUserScaffold();
    writeJson(INSTALL_METADATA_PATH, {
        name: DISPLAY_NAME,
        version: getManifest().version,
        installedAt: formatTimestamp(),
        sourceRoot: normalizedSourceRoot,
        installRoot: INSTALL_ROOT,
        extensionRoot: USER_EXTENSION_ROOT,
        runtimeRoot: RUNTIME_ROOT,
    });
}

async function loadSessionSnapshot() {
    const [currentModel, currentMode, currentAgent] = await Promise.all([
        session.rpc.model.getCurrent().catch(() => ({ modelId: undefined })),
        session.rpc.mode.get().catch(() => ({ mode: "interactive" })),
        session.rpc.agent.getCurrent().catch(() => ({ agent: null })),
    ]);

    return {
        modelId: currentModel.modelId,
        mode: currentMode.mode,
        agentName: currentAgent.agent?.name || null,
    };
}

async function activateRole(config, roleName) {
    const role = config.agents?.[roleName];
    if (!role || role.enabled === false) {
        return;
    }

    if (role.model) {
        await session.rpc.model.switchTo({ modelId: role.model }).catch(() => undefined);
        runtime.currentModel = role.model;
    }

    await session.rpc.agent.select({ name: roleName }).catch(() => undefined);
}

async function restoreSessionSnapshot(previousSnapshot) {
    if (previousSnapshot.agentName) {
        await session.rpc.agent.select({ name: previousSnapshot.agentName }).catch(() => undefined);
    } else {
        await session.rpc.agent.deselect().catch(() => undefined);
    }

    if (previousSnapshot.modelId) {
        await session.rpc.model.switchTo({ modelId: previousSnapshot.modelId }).catch(() => undefined);
        runtime.currentModel = previousSnapshot.modelId;
    }

    if (previousSnapshot.mode) {
        await session.rpc.mode.set({ mode: previousSnapshot.mode }).catch(() => undefined);
    }
}

function handleEvent(event) {
    switch (event.type) {
    case "session.custom_agents_updated":
        runtime.loadedAgents = event.data.agents || [];
        break;
    case "session.model_change":
        runtime.currentModel = event.data.newModel;
        break;
    case "session.idle":
        runtime.backgroundTasks = event.data.backgroundTasks || { agents: [], shells: [] };
        break;
    case "tool.execution_start":
        runtime.toolCalls.set(event.data.toolCallId, {
            toolName: event.data.toolName,
            arguments: event.data.arguments,
            mcpServerName: event.data.mcpServerName,
        });
        break;
    case "tool.execution_complete":
        if (shouldAutoLog()) {
            const config = loadEffectiveConfig();
            const toolMeta = runtime.toolCalls.get(event.data.toolCallId);
            appendProjectLogEntry(config, getActiveRun(), "Tool activity", summarizeToolExecution(toolMeta, event.data));
        }
        runtime.toolCalls.delete(event.data.toolCallId);
        break;
    case "session.task_complete":
        if (shouldAutoLog() && event.data.summary) {
            appendProjectLogEntry(loadEffectiveConfig(), getActiveRun(), "Task completion", event.data.summary);
        }
        break;
    case "user.message":
        if (shouldAutoLog() && event.data.content?.trim()) {
            appendProjectLogEntry(loadEffectiveConfig(), getActiveRun(), "User prompt", event.data.content);
        }
        break;
    case "assistant.message":
        if (shouldAutoLog() && event.data.content?.trim()) {
            appendProjectLogEntry(loadEffectiveConfig(), getActiveRun(), "Assistant response", event.data.content);
        }
        break;
    case "session.shutdown":
        if (getActiveRun()?.logPath) {
            appendProjectLogEntry(loadEffectiveConfig(), getActiveRun(), "Session ended", "The Copilot CLI session ended.");
        }
        setActiveRun(null);
        break;
    default:
        break;
    }
}

async function logStatusTable({ compact = false } = {}) {
    const manifest = getManifest();
    const config = loadEffectiveConfig({ seedUserConfig: true });
    const currentSnapshot = await loadSessionSnapshot();
    const currentRun = getActiveRun();

    const summaryRows = [
        ["Package", `${manifest.name} ${manifest.version}`],
        ["Mode", currentSnapshot.mode || "interactive"],
        ["Current model", currentSnapshot.modelId || runtime.currentModel || "_default_"],
        ["Current agent", currentSnapshot.agentName || "_default_"],
        ["Active tool profile", currentRun?.toolProfile || "_none_"],
        ["Project plan/log", currentRun?.logPath || "_not active_"],
    ];

    const agentRows = listLoadedAgents(config, currentSnapshot.agentName);
    const taskRows = listBackgroundTaskRows();

    const sections = [
        `**${manifest.name} ${manifest.version}**`,
        "",
        formatMarkdownTable(["Field", "Value"], summaryRows),
        "",
        "### Agents",
        formatMarkdownTable(["Agent", "Model", "Status"], agentRows),
    ];

    if (!compact) {
        sections.push("", "### Running tasks");
        if (taskRows.length > 0) {
            sections.push(formatMarkdownTable(["Kind", "ID", "Description", "Status"], taskRows));
        } else {
            sections.push("_No background tasks are currently running._");
        }
    }

    await session.log(sections.join("\n"));
}

async function handleSetupCommand() {
    ensureUserScaffold();

    const currentConfig = loadEffectiveConfig({ seedUserConfig: true });
    const toolProfiles = Object.keys(currentConfig.toolProfiles || {});

    if (!session.capabilities.ui?.elicitation) {
        await session.log("plan-pro setup requires interactive elicitation support.", { level: "error" });
        return;
    }

    const result = await session.ui.elicitation({
        message: "Configure plan-pro defaults",
        schema: {
            type: "object",
            properties: {
                implementationStartMode: {
                    type: "string",
                    title: "Implementation start mode",
                    description: "Ask before implementation, or auto-start when the plan is ready.",
                    enum: ["ask-before", "auto-start"],
                    default: currentConfig.settings?.implementationStartMode || "ask-before",
                },
                planLogDefault: {
                    type: "string",
                    title: "Project plan/log default",
                    description: "Ask every run, or never ask and do not save.",
                    enum: ["ask-every-run", "never-save"],
                    default: currentConfig.settings?.planLogDefault || "ask-every-run",
                },
                defaultToolProfile: {
                    type: "string",
                    title: "Default tool profile",
                    description: "Pick the default tool profile shown in /plan-pro.",
                    enum: toolProfiles,
                    default: currentConfig.settings?.defaultToolProfile || toolProfiles[0],
                },
                showStatusBanner: {
                    type: "boolean",
                    title: "Show status banner",
                    description: "Display the plan-pro status table whenever /plan-pro starts.",
                    default: currentConfig.settings?.showStatusBanner !== false,
                },
            },
            required: ["implementationStartMode", "planLogDefault", "defaultToolProfile", "showStatusBanner"],
        },
    });

    if (result.action !== "accept") {
        await session.log("plan-pro setup cancelled.", { ephemeral: true });
        return;
    }

    const nextUserConfig = deepMerge(readJson(getUserConfigPath(), {}), {
        settings: {
            implementationStartMode: result.content.implementationStartMode,
            planLogDefault: result.content.planLogDefault,
            defaultToolProfile: result.content.defaultToolProfile,
            showStatusBanner: result.content.showStatusBanner,
        },
        metadata: {
            lastSetupAt: formatTimestamp(),
        },
    });

    writeJson(getUserConfigPath(), nextUserConfig);
    syncPersonalInstall(getPackageRoot());

    const installMetadata = getInstallMetadata();
    const manifest = getManifest();

    await session.log(
        [
            `**${manifest.name} ${manifest.version}** setup complete.`,
            "",
            formatMarkdownTable(
                ["Path", "Value"],
                [
                    ["Install root", `\`${installMetadata.installRoot || INSTALL_ROOT}\``],
                    ["User extension", `\`${installMetadata.extensionRoot || USER_EXTENSION_ROOT}\``],
                    ["Runtime home", `\`${installMetadata.runtimeRoot || RUNTIME_ROOT}\``],
                    ["User config", `\`${getUserConfigPath()}\``],
                ],
            ),
            "",
            `Advanced agent, routing, model, tool, question, and template changes live in \`${getUserConfigPath()}\`.`,
            "",
            "If you later change agent definitions or model assignments, start a fresh session to reload them.",
        ].join("\n"),
    );
}

async function collectRunOptions(config, initialGoal) {
    if (!session.capabilities.ui?.elicitation) {
        return null;
    }

    const toolProfiles = Object.keys(config.toolProfiles || {});
    const defaultPlanSeed = slugify(initialGoal || "feature");

    const properties = {
        toolProfile: {
            type: "string",
            title: "Tool profile",
            description: "Supported profiles come first; use full for the advanced all-tools option.",
            enum: toolProfiles,
            default: config.settings?.defaultToolProfile || toolProfiles[0],
        },
    };
    const required = ["toolProfile"];

    if (config.settings?.planLogDefault !== "never-save") {
        properties.saveProjectPlan = {
            type: "boolean",
            title: "Save a project-local plan/log file",
            description: "When enabled, plan-pro writes a reusable Markdown artifact in the local project.",
            default: true,
        };
        properties.projectPlanDirectory = {
            type: "string",
            title: "Project plan directory",
            description: "Directory where the project-local plan/log file should be written.",
            default: process.cwd(),
        };
        properties.projectPlanName = {
            type: "string",
            title: "Project plan name seed",
            description: "plan-pro appends date/time and the -plan.md suffix automatically.",
            default: defaultPlanSeed,
        };
        properties.trackContinuously = {
            type: "boolean",
            title: "Keep updating the project plan/log",
            description: "Append timestamps, user prompts, assistant responses, tool activity, and task completions for the rest of the session.",
            default: false,
        };
        required.push("saveProjectPlan", "projectPlanDirectory", "projectPlanName", "trackContinuously");
    }

    const result = await session.ui.elicitation({
        message: "Choose plan-pro run settings",
        schema: {
            type: "object",
            properties,
            required,
        },
    });

    if (result.action !== "accept") {
        return null;
    }

    const saveProjectPlan =
        config.settings?.planLogDefault === "never-save" ? false : Boolean(result.content.saveProjectPlan);
    const projectPlanPath = saveProjectPlan
        ? buildPlanFilePath(config, result.content.projectPlanDirectory, result.content.projectPlanName)
        : null;

    return {
        toolProfile: result.content.toolProfile,
        saveProjectPlan,
        projectPlanDirectory: result.content.projectPlanDirectory,
        projectPlanName: slugify(result.content.projectPlanName),
        projectPlanPath,
        trackContinuously: saveProjectPlan && Boolean(result.content.trackContinuously),
    };
}

async function collectDbExplorationOptions(config) {
    if (!session.capabilities.ui?.elicitation || config.dbExploration?.enabled === false) {
        return { enabled: false };
    }

    const useDbAccess = await session.ui.confirm("Should this run include DB/data exploration?");
    if (!useDbAccess) {
        return { enabled: false };
    }

    const modes = Object.entries(config.dbExploration?.modes || {});
    const result = await session.ui.elicitation({
        message: "Configure DB/data exploration",
        schema: {
            type: "object",
            properties: {
                dbAccessMode: {
                    type: "string",
                    title: "DB/data access mode",
                    description: "Choose how plan-pro should approach DB/data exploration.",
                    enum: modes.map(([id]) => id),
                    enumNames: modes.map(([, mode]) => mode.label || "Unnamed mode"),
                    default: config.dbExploration?.defaultMode || modes[0]?.[0],
                },
                dbAccessInstructions: {
                    type: "string",
                    title: "DB/data access instructions",
                    description: "Optional connection hints, safety rules, or access notes to inject into the prompts.",
                    default: "",
                },
            },
            required: ["dbAccessMode"],
        },
    });

    if (result.action !== "accept") {
        return null;
    }

    let dbAccessInstructions = result.content.dbAccessInstructions || "";
    if (!dbAccessInstructions && result.content.dbAccessMode === "user-instructions" && typeof session.ui.input === "function") {
        dbAccessInstructions = await session.ui.input("Provide DB/data access instructions for this run", {
            title: "DB/data access instructions",
            description: "These instructions are injected into the planning and implementation prompts.",
            default: "",
        }) || "";
    }

    return {
        enabled: true,
        mode: result.content.dbAccessMode,
        instructions: dbAccessInstructions,
    };
}

async function collectDiscoveryAnswers(config, initialGoal) {
    if (!session.capabilities.ui?.elicitation) {
        return null;
    }

    const properties = {};
    const required = [];

    for (const question of config.questions || []) {
        if (question.enabled === false) {
            continue;
        }
        properties[question.id] = {
            type: "string",
            title: question.label,
            description: question.prompt,
            default: question.id === "goal" && initialGoal ? initialGoal : "",
        };
        if (question.required !== false) {
            required.push(question.id);
        }
    }

    const result = await session.ui.elicitation({
        message: "Capture the planning brief",
        schema: {
            type: "object",
            properties,
            required,
        },
    });

    if (result.action !== "accept") {
        return null;
    }

    return result.content;
}

async function maybeStartImplementation(config, planContent) {
    if (config.settings?.implementationStartMode === "auto-start") {
        return { approved: true, notes: "" };
    }

    const approved = await session.ui.confirm("Start implementation now using this plan?");
    if (!approved) {
        return { approved: false, notes: "" };
    }

    if (typeof session.ui.input !== "function") {
        return { approved: true, notes: "" };
    }

    const notes = await session.ui.input("Additional notes before implementation starts", {
        title: "Implementation notes",
        description: "Optional notes are appended to the implementation kickoff prompt.",
        default: "",
    });

    return {
        approved: true,
        notes: notes || "",
    };
}

async function handlePlanCommand(commandContext) {
    ensureUserScaffold();
    const manifest = getManifest();
    const config = loadEffectiveConfig({ seedUserConfig: true });
    const initialGoal = commandContext.args?.trim() || "";

    if (!session.capabilities.ui?.elicitation) {
        await session.log("plan-pro requires interactive elicitation support.", { level: "error" });
        return;
    }

    if (config.settings?.showStatusBanner !== false) {
        await logStatusTable({ compact: true });
    }

    const runOptions = await collectRunOptions(config, initialGoal);
    if (!runOptions) {
        await session.log("plan-pro run cancelled before planning started.", { ephemeral: true });
        return;
    }

    const dbExploration = await collectDbExplorationOptions(config);
    if (!dbExploration) {
        await session.log("plan-pro run cancelled while configuring DB/data exploration.", { ephemeral: true });
        return;
    }
    runOptions.dbExploration = dbExploration;

    const discoveryAnswers = await collectDiscoveryAnswers(config, initialGoal);
    if (!discoveryAnswers) {
        await session.log("plan-pro run cancelled while gathering discovery answers.", { ephemeral: true });
        return;
    }

    const previousSnapshot = await loadSessionSnapshot();
    const planningRole = config.routing?.leadAgent || "lead-planner";

    const runState = {
        sessionId: session.sessionId,
        startedAt: formatTimestamp(),
        toolProfile: runOptions.toolProfile,
        logPath: runOptions.projectPlanPath,
        trackContinuously: runOptions.trackContinuously,
        saveProjectPlan: runOptions.saveProjectPlan,
        goal: discoveryAnswers.goal || initialGoal || "",
    };

    setActiveRun(runState);
    runtime.suspendAutoLog = true;

    await session.rpc.mode.set({ mode: "plan" }).catch(() => undefined);
    await activateRole(config, planningRole);

    const planningPrompt = buildPlanningPrompt(config, manifest, runOptions.toolProfile, discoveryAnswers, runOptions);
    const planningResponse = await session.sendAndWait({ prompt: planningPrompt });
    const planContent = planningResponse?.data?.content?.trim();

    if (!planContent) {
        runtime.suspendAutoLog = false;
        setActiveRun(null);
        await restoreSessionSnapshot(previousSnapshot);
        await session.log("plan-pro did not receive plan content from the assistant.", { level: "error" });
        return;
    }

    await session.rpc.plan.update({ content: planContent }).catch(() => undefined);

    if (runOptions.saveProjectPlan) {
        writeInitialProjectPlan(config, manifest, runOptions, discoveryAnswers, planContent);
        appendProjectLogEntry(config, runState, "Initial plan snapshot", planContent);
    }

    const implementationDecision = await maybeStartImplementation(config, planContent);

    if (!implementationDecision.approved) {
        runtime.suspendAutoLog = false;
        if (!runOptions.trackContinuously) {
            setActiveRun(null);
        }
        await restoreSessionSnapshot(previousSnapshot);
        await session.log(
            [
                `**${manifest.name} ${manifest.version}** captured the plan.`,
                "",
                runOptions.saveProjectPlan
                    ? `Project plan/log saved to \`${runOptions.projectPlanPath}\`.`
                    : "The plan was stored in the session workspace only.",
                "",
                "Implementation was not started.",
            ].join("\n"),
        );
        return;
    }

    const implementationRole = config.routing?.implementationAgent || "implementation-planner";
    await session.rpc.mode.set({ mode: previousSnapshot.mode === "plan" ? "interactive" : previousSnapshot.mode }).catch(() => undefined);
    await activateRole(config, implementationRole);

    const implementationPrompt = buildImplementationPrompt(config, planContent, implementationDecision.notes, runOptions);
    const implementationResponse = await session.sendAndWait({ prompt: implementationPrompt });
    const implementationSummary = implementationResponse?.data?.content?.trim() || "Implementation started.";

    if (runOptions.saveProjectPlan) {
        appendProjectLogEntry(config, runState, "Implementation kickoff", implementationSummary);
    }

    runtime.suspendAutoLog = false;

    await session.log(
        [
            `**${manifest.name} ${manifest.version}** created the plan and started implementation.`,
            "",
            runOptions.saveProjectPlan
                ? `Project plan/log saved to \`${runOptions.projectPlanPath}\`.`
                : "The plan was stored in the session workspace only.",
            "",
            runOptions.trackContinuously
                ? "Live project-log updates are active for the rest of this session."
                : "Live project-log updates are not active for this run.",
        ].join("\n"),
    );
}

async function handleDoctorCommand() {
    ensureUserScaffold();

    const manifestPath = join(getResourcesRoot(), "manifest.json");
    const configPath = getUserConfigPath();
    const configCheck = tryReadJson(configPath);
    const activeRun = getActiveRun();
    const checks = [
        ["Package manifest", pathExists(manifestPath), manifestPath],
        ["User extension entrypoint", pathExists(join(USER_EXTENSION_ROOT, "extension.mjs")), join(USER_EXTENSION_ROOT, "extension.mjs")],
        ["Install root", pathExists(INSTALL_ROOT), INSTALL_ROOT],
        ["User config", configCheck.ok, configCheck.ok ? configPath : configCheck.error],
        ["User instructions prompt", pathExists(join(USER_ROOT, "prompts", "user-instructions.md")), join(USER_ROOT, "prompts", "user-instructions.md")],
        ["Plan template override", pathExists(join(USER_ROOT, "templates", "plan-template.md")), join(USER_ROOT, "templates", "plan-template.md")],
        ["Live-log template override", pathExists(join(USER_ROOT, "templates", "live-log-template.md")), join(USER_ROOT, "templates", "live-log-template.md")],
        ["Active project plan/log", activeRun?.logPath ? pathExists(activeRun.logPath) : true, activeRun?.logPath || "_not active_"],
    ];

    await session.log(
        [
            `**${getManifest().name} ${getManifest().version}** diagnostics`,
            "",
            formatMarkdownTable(
                ["Check", "Status", "Details"],
                checks.map(([label, ok, detail]) => [label, ok ? "ok" : "issue", `\`${detail}\``]),
            ),
        ].join("\n"),
    );
}

async function handleUpdateCommand() {
    ensureUserScaffold();

    const manifest = getManifest();
    const installMetadata = getInstallMetadata();
    const candidateRoots = [INSTALL_ROOT, getPackageRoot()].filter((path, index, list) => list.indexOf(path) === index);
    const gitRoot = candidateRoots.find((path) => pathExists(join(path, ".git")));

    if (!gitRoot) {
        if (installMetadata.installSource === "github-release" && installMetadata.repository) {
            const repo = installMetadata.repository;
            await session.log(
                [
                    `**${manifest.name} ${manifest.version}** was installed from a GitHub release.`,
                    "",
                    "To update without cloning, rerun:",
                    "```bash",
                    `curl -fsSL https://raw.githubusercontent.com/${repo}/main/scripts/install-from-release.sh | PLAN_PRO_REPO=${repo} bash`,
                    "```",
                    "",
                    "To pin a specific version:",
                    "```bash",
                    `curl -fsSL https://raw.githubusercontent.com/${repo}/main/scripts/install-from-release.sh | PLAN_PRO_REPO=${repo} VERSION=vX.Y.Z bash`,
                    "```",
                ].join("\n"),
                { level: "warning" },
            );
            return;
        }
        await session.log(
            [
                `**${manifest.name} ${manifest.version}** could not find a Git checkout to update.`,
                "",
                "Pull the latest repository manually and rerun `bash scripts/install.sh` from that checkout.",
            ].join("\n"),
            { level: "warning" },
        );
        return;
    }

    const gitPull = spawnSync("git", ["-C", gitRoot, "pull", "--ff-only"], {
        encoding: "utf8",
    });

    if (gitPull.status !== 0) {
        const stderr = truncate((gitPull.stderr || gitPull.stdout || "git pull failed").trim(), 4000);
        await session.log(`plan-pro update failed.\n\n${stderr}`, { level: "error" });
        return;
    }

    syncPersonalInstall(gitRoot);
    const refreshedManifest = getManifest();

    await session.log(
        [
            `**${refreshedManifest.name} ${refreshedManifest.version}** updated from \`${gitRoot}\`.`,
            "",
            "Restart Copilot CLI or start a fresh session to load the refreshed extension code and agent definitions.",
        ].join("\n"),
    );
}

const startupConfig = loadEffectiveConfig();

session = await joinSession({
    commands: [
        {
            name: COMMAND_PREFIX,
            description: "Run the plan-pro planning wizard",
            handler: handlePlanCommand,
        },
        {
            name: `${COMMAND_PREFIX}:setup`,
            description: "Configure plan-pro defaults and personal install paths",
            handler: handleSetupCommand,
        },
        {
            name: `${COMMAND_PREFIX}:status`,
            description: "Show plan-pro agents, models, tasks, and active run status",
            handler: () => logStatusTable(),
        },
        {
            name: `${COMMAND_PREFIX}:update`,
            description: "Pull the latest checkout and refresh the personal install",
            handler: handleUpdateCommand,
        },
        {
            name: `${COMMAND_PREFIX}:doctor`,
            description: "Validate plan-pro install, config, prompts, and live-log state",
            handler: handleDoctorCommand,
        },
    ],
    customAgents: buildCustomAgents(startupConfig),
    hooks: {
        onPreToolUse: async (input) => {
            const activeRun = getActiveRun();
            if (!activeRun) {
                return { permissionDecision: "allow" };
            }

            const config = loadEffectiveConfig();
            const profile = config.toolProfiles?.[activeRun.toolProfile];

            if (!profile || profile.allowAllTools) {
                return { permissionDecision: "allow" };
            }

            const allowList = new Set(profile.allowedTools || []);
            if (allowList.has(input.toolName)) {
                return { permissionDecision: "allow" };
            }

            return {
                permissionDecision: "deny",
                permissionDecisionReason: `plan-pro tool profile "${activeRun.toolProfile}" does not allow the "${input.toolName}" tool for this run.`,
            };
        },
    },
    onEvent: handleEvent,
});

runtime.activeRun = readJson(ACTIVE_RUN_PATH, null);
if (runtime.activeRun?.sessionId !== session.sessionId) {
    setActiveRun(null);
}

const startupManifest = getManifest();
await session.log(`Loaded ${startupManifest.name} ${startupManifest.version}`, { ephemeral: true });
