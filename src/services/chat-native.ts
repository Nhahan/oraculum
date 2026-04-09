import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ZodTypeAny } from "zod";

import {
  getAdvancedConfigPath,
  getConfigPath,
  getExportPlanPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getProfileSelectionPath,
  getRunConfigPath,
  getRunDir,
  getWinnerSelectionPath,
  resolveProjectRoot,
} from "../core/paths.js";
import {
  type CommandManifestEntry,
  commandManifestEntrySchema,
  consultToolRequestSchema,
  consultToolResponseSchema,
  crownToolRequestSchema,
  crownToolResponseSchema,
  draftToolRequestSchema,
  draftToolResponseSchema,
  initToolRequestSchema,
  initToolResponseSchema,
  type McpToolId,
  mcpToolIdSchema,
  setupStatusToolRequestSchema,
  setupStatusToolResponseSchema,
  type ToolMetadata,
  toolMetadataSchema,
  verdictArchiveToolRequestSchema,
  verdictArchiveToolResponseSchema,
  verdictToolRequestSchema,
  verdictToolResponseSchema,
} from "../domain/chat-native.js";
import { getExpectedCodexRuleFileName, getExpectedCodexSkillDirs } from "./codex-chat-native.js";
import type { InitializeProjectResult } from "./project.js";

export const oraculumMcpSchemas = {
  oraculum_consult: {
    request: consultToolRequestSchema,
    response: consultToolResponseSchema,
  },
  oraculum_draft: {
    request: draftToolRequestSchema,
    response: draftToolResponseSchema,
  },
  oraculum_verdict: {
    request: verdictToolRequestSchema,
    response: verdictToolResponseSchema,
  },
  oraculum_verdict_archive: {
    request: verdictArchiveToolRequestSchema,
    response: verdictArchiveToolResponseSchema,
  },
  oraculum_crown: {
    request: crownToolRequestSchema,
    response: crownToolResponseSchema,
  },
  oraculum_init: {
    request: initToolRequestSchema,
    response: initToolResponseSchema,
  },
  oraculum_setup_status: {
    request: setupStatusToolRequestSchema,
    response: setupStatusToolResponseSchema,
  },
} satisfies Record<
  McpToolId,
  {
    request: ZodTypeAny;
    response: ZodTypeAny;
  }
>;

export const oraculumMcpToolSurface = [
  {
    id: "oraculum_consult",
    purpose:
      "Start a full consultation, execute candidates, and return the completed verdict state.",
    requestShape: "consultToolRequestSchema",
    responseShape: "consultToolResponseSchema",
    bindings: [
      {
        kind: "existing-service",
        module: "src/services/project.ts",
        symbol: "ensureProjectInitialized",
      },
      {
        kind: "existing-service",
        module: "src/services/runs.ts",
        symbol: "planRun",
      },
      {
        kind: "existing-service",
        module: "src/services/execution.ts",
        symbol: "executeRun",
      },
      {
        kind: "existing-service",
        module: "src/services/consultations.ts",
        symbol: "renderConsultationSummary",
      },
      {
        kind: "new-adapter-layer",
        module: "src/services/chat-native.ts",
        symbol: "buildConsultationArtifacts",
        note: "Machine-readable MCP response assembly layer.",
      },
    ],
    machineReadableArtifacts: [
      "run.json",
      "consultation-config.json",
      "profile-selection.json",
      "comparison.json",
      "comparison.md",
      "winner-selection.json",
    ],
  },
  {
    id: "oraculum_draft",
    purpose: "Plan a consultation without executing candidates and return the drafted run state.",
    requestShape: "draftToolRequestSchema",
    responseShape: "draftToolResponseSchema",
    bindings: [
      {
        kind: "existing-service",
        module: "src/services/project.ts",
        symbol: "ensureProjectInitialized",
      },
      {
        kind: "existing-service",
        module: "src/services/runs.ts",
        symbol: "planRun",
      },
      {
        kind: "existing-service",
        module: "src/services/consultations.ts",
        symbol: "renderConsultationSummary",
      },
      {
        kind: "new-adapter-layer",
        module: "src/services/chat-native.ts",
        symbol: "buildConsultationArtifacts",
        note: "Machine-readable MCP response assembly layer.",
      },
    ],
    machineReadableArtifacts: ["run.json", "consultation-config.json", "profile-selection.json"],
  },
  {
    id: "oraculum_verdict",
    purpose: "Reopen the latest or a specific consultation and return the saved verdict state.",
    requestShape: "verdictToolRequestSchema",
    responseShape: "verdictToolResponseSchema",
    bindings: [
      {
        kind: "existing-service",
        module: "src/services/runs.ts",
        symbol: "readLatestRunManifest",
      },
      {
        kind: "existing-service",
        module: "src/services/runs.ts",
        symbol: "readRunManifest",
      },
      {
        kind: "existing-service",
        module: "src/services/consultations.ts",
        symbol: "renderConsultationSummary",
      },
      {
        kind: "new-adapter-layer",
        module: "src/services/chat-native.ts",
        symbol: "buildConsultationArtifacts",
        note: "Machine-readable MCP response assembly layer.",
      },
    ],
    machineReadableArtifacts: [
      "run.json",
      "consultation-config.json",
      "profile-selection.json",
      "comparison.json",
      "comparison.md",
      "winner-selection.json",
      "export-plan.json",
    ],
  },
  {
    id: "oraculum_verdict_archive",
    purpose:
      "List recent consultations in machine-readable form for archive browsing and reopen flows.",
    requestShape: "verdictArchiveToolRequestSchema",
    responseShape: "verdictArchiveToolResponseSchema",
    bindings: [
      {
        kind: "existing-service",
        module: "src/services/consultations.ts",
        symbol: "listRecentConsultations",
      },
      {
        kind: "existing-service",
        module: "src/services/consultations.ts",
        symbol: "renderConsultationArchive",
      },
    ],
    machineReadableArtifacts: ["run.json"],
  },
  {
    id: "oraculum_crown",
    purpose:
      "Crown the recommended or explicitly selected survivor and materialize it into the project.",
    requestShape: "crownToolRequestSchema",
    responseShape: "crownToolResponseSchema",
    bindings: [
      {
        kind: "existing-service",
        module: "src/services/exports.ts",
        symbol: "materializeExport",
      },
      {
        kind: "existing-service",
        module: "src/services/runs.ts",
        symbol: "readRunManifest",
      },
    ],
    machineReadableArtifacts: ["export-plan.json", "export.patch", "export-sync.json"],
  },
  {
    id: "oraculum_init",
    purpose: "Initialize the quick-start project scaffold and return the created paths.",
    requestShape: "initToolRequestSchema",
    responseShape: "initToolResponseSchema",
    bindings: [
      {
        kind: "existing-service",
        module: "src/services/project.ts",
        symbol: "initializeProject",
      },
    ],
    machineReadableArtifacts: ["config.json"],
  },
  {
    id: "oraculum_setup_status",
    purpose:
      "Return setup diagnostics that explain whether host registration is ready for chat-native commands.",
    requestShape: "setupStatusToolRequestSchema",
    responseShape: "setupStatusToolResponseSchema",
    bindings: [
      {
        kind: "existing-service",
        module: "src/services/project.ts",
        symbol: "pathExists",
      },
      {
        kind: "new-adapter-layer",
        module: "src/services/chat-native.ts",
        symbol: "buildSetupDiagnosticsResponse",
        note: "Host registration inspection layer until full setup/install commands land.",
      },
    ],
    machineReadableArtifacts: [],
  },
].map((tool) => toolMetadataSchema.parse(tool));

export const oraculumCommandManifest = [
  {
    id: "consult",
    prefix: "orc",
    path: ["consult"],
    summary: "Run the full consultation tournament and return the completed verdict state.",
    mcpTool: "oraculum_consult",
    requestShape: "consultToolRequestSchema",
    responseShape: "consultToolResponseSchema",
    arguments: [
      {
        name: "taskInput",
        kind: "string",
        description: "Inline task text, a task note path, or a task packet path.",
        required: true,
        positional: true,
      },
      {
        name: "agent",
        kind: "string",
        description: "Agent runtime override.",
        option: "--agent",
      },
      {
        name: "candidates",
        kind: "integer",
        description: "Number of candidate patches to plan.",
        option: "--candidates",
      },
      {
        name: "timeoutMs",
        kind: "integer",
        description: "Adapter timeout in milliseconds.",
        option: "--timeout-ms",
      },
    ],
    examples: ['orc consult "fix session loss on refresh"'],
    hostAdditions: {},
  },
  {
    id: "verdict",
    prefix: "orc",
    path: ["verdict"],
    summary: "Reopen the latest verdict or inspect a specific consultation.",
    mcpTool: "oraculum_verdict",
    requestShape: "verdictToolRequestSchema",
    responseShape: "verdictToolResponseSchema",
    arguments: [
      {
        name: "consultationId",
        kind: "string",
        description: "Consultation identifier; defaults to the latest consultation.",
        positional: true,
      },
    ],
    examples: ["orc verdict", "orc verdict run_20260404_xxxx"],
    hostAdditions: {},
  },
  {
    id: "verdict-archive",
    prefix: "orc",
    path: ["verdict", "archive"],
    summary: "Browse recent consultations without reopening one immediately.",
    mcpTool: "oraculum_verdict_archive",
    requestShape: "verdictArchiveToolRequestSchema",
    responseShape: "verdictArchiveToolResponseSchema",
    arguments: [
      {
        name: "count",
        kind: "integer",
        description: "Maximum number of recent consultations to show.",
        positional: true,
      },
    ],
    examples: ["orc verdict archive", "orc verdict archive 20"],
    hostAdditions: {},
  },
  {
    id: "crown",
    prefix: "orc",
    path: ["crown"],
    summary: "Crown the recommended or selected survivor and materialize it in the project.",
    mcpTool: "oraculum_crown",
    requestShape: "crownToolRequestSchema",
    responseShape: "crownToolResponseSchema",
    arguments: [
      {
        name: "branchName",
        kind: "string",
        description: "Target branch name to create.",
        required: true,
        positional: true,
      },
    ],
    examples: ["orc crown fix/session-loss"],
    hostAdditions: {},
  },
  {
    id: "draft",
    prefix: "orc",
    path: ["draft"],
    summary: "Stage a consultation without executing candidates.",
    mcpTool: "oraculum_draft",
    requestShape: "draftToolRequestSchema",
    responseShape: "draftToolResponseSchema",
    arguments: [
      {
        name: "taskInput",
        kind: "string",
        description: "Inline task text, a task note path, or a task packet path.",
        required: true,
        positional: true,
      },
      {
        name: "agent",
        kind: "string",
        description: "Agent runtime override.",
        option: "--agent",
      },
      {
        name: "candidates",
        kind: "integer",
        description: "Number of candidate patches to plan.",
        option: "--candidates",
      },
    ],
    examples: ['orc draft "fix session loss on refresh"'],
    hostAdditions: {},
  },
  {
    id: "init",
    prefix: "orc",
    path: ["init"],
    summary: "Initialize the quick-start scaffold explicitly.",
    mcpTool: "oraculum_init",
    requestShape: "initToolRequestSchema",
    responseShape: "initToolResponseSchema",
    arguments: [
      {
        name: "force",
        kind: "boolean",
        description: "Reset quick-start config and remove advanced overrides.",
        option: "--force",
      },
    ],
    examples: ["orc init", "orc init --force"],
    hostAdditions: {},
  },
].map((entry) => commandManifestEntrySchema.parse(entry));

export function getMcpToolSchemas(toolId: McpToolId): {
  request: ZodTypeAny;
  response: ZodTypeAny;
} {
  return oraculumMcpSchemas[toolId];
}

export function buildConsultationArtifacts(
  projectRoot: string,
  consultationId: string,
): {
  consultationRoot: string;
  configPath: string;
  profileSelectionPath?: string;
  comparisonJsonPath?: string;
  comparisonMarkdownPath?: string;
  winnerSelectionPath?: string;
  crowningRecordPath?: string;
} {
  return {
    consultationRoot: getRunDir(projectRoot, consultationId),
    configPath: getRunConfigPath(projectRoot, consultationId),
    profileSelectionPath: getProfileSelectionPath(projectRoot, consultationId),
    comparisonJsonPath: getFinalistComparisonJsonPath(projectRoot, consultationId),
    comparisonMarkdownPath: getFinalistComparisonMarkdownPath(projectRoot, consultationId),
    winnerSelectionPath: getWinnerSelectionPath(projectRoot, consultationId),
    crowningRecordPath: getExportPlanPath(projectRoot, consultationId),
  };
}

export function buildProjectInitializationResult(result: InitializeProjectResult): {
  projectRoot: string;
  configPath: string;
  createdPaths: string[];
} {
  return {
    projectRoot: result.projectRoot,
    configPath: result.configPath,
    createdPaths: result.createdPaths,
  };
}

export function buildSetupDiagnosticsResponse(cwd: string): {
  mode: "setup-status";
  cwd: string;
  projectInitialized: boolean;
  configPath: string;
  advancedConfigPath: string;
  shellFallbackCommand: "oraculum";
  targetPrefix: "orc";
  hosts: Array<{
    host: "claude-code" | "codex";
    registered: boolean;
    artifactsInstalled: boolean;
    notes: string[];
  }>;
  summary: string;
} {
  const projectRoot = resolveProjectRoot(cwd);
  const configPath = getConfigPath(projectRoot);
  const advancedConfigPath = getAdvancedConfigPath(projectRoot);
  const claudeMcpPath = join(homedir(), ".claude", "mcp.json");
  const claudePluginRoot = join(homedir(), ".claude");
  const codexConfigPath = join(homedir(), ".codex", "config.toml");
  const codexSkillsDir = join(homedir(), ".codex", "skills");
  const codexRulesDir = join(homedir(), ".codex", "rules");
  const claudeRegistered = hasMcpServer(claudeMcpPath, "oraculum");
  const codexRegistered = hasCodexMcpServer(codexConfigPath);
  const codexArtifactsInstalled = hasCodexArtifactsInstalled(codexSkillsDir, codexRulesDir);

  return {
    mode: "setup-status",
    cwd: projectRoot,
    projectInitialized: existsSync(configPath),
    configPath,
    advancedConfigPath,
    shellFallbackCommand: "oraculum",
    targetPrefix: "orc",
    hosts: [
      {
        host: "claude-code",
        registered: claudeRegistered,
        artifactsInstalled: hasClaudePluginInstalled(),
        notes: [
          `Expected MCP config path: ${claudeMcpPath}`,
          `Expected Claude plugin root: ${claudePluginRoot}`,
          "Run `oraculum setup --runtime claude-code` to register the MCP server and install the Oraculum plugin.",
        ],
      },
      {
        host: "codex",
        registered: codexRegistered,
        artifactsInstalled: codexArtifactsInstalled,
        notes: [
          `Expected MCP config path: ${codexConfigPath}`,
          `Expected skill install root: ${codexSkillsDir}`,
          `Expected rule install root: ${codexRulesDir}`,
          "Run `oraculum setup --runtime codex` to register the MCP server and install the Oraculum skills and rules.",
        ],
      },
    ],
    summary:
      "Oraculum can register Claude Code and Codex host-native routing through `oraculum setup --runtime <host>`.",
  };
}

export function assertToolId(value: string): McpToolId {
  return mcpToolIdSchema.parse(value);
}

export const typedOraculumMcpToolSurface: ToolMetadata[] = oraculumMcpToolSurface;
export const typedOraculumCommandManifest: CommandManifestEntry[] = oraculumCommandManifest;

function hasMcpServer(path: string, serverId: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Boolean(parsed.mcpServers?.[serverId]);
  } catch {
    return false;
  }
}

function hasClaudePluginInstalled(): boolean {
  const pluginsDir = join(homedir(), ".claude", "plugins");
  if (!existsSync(pluginsDir)) {
    return false;
  }

  return existsSync(join(pluginsDir, "oraculum")) || existsSync(join(pluginsDir, "@oraculum"));
}

function hasCodexMcpServer(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    const raw = readFileSync(path, "utf8");
    return /\[mcp_servers\.oraculum\]/u.test(raw);
  } catch {
    return false;
  }
}

function hasCodexArtifactsInstalled(skillsDir: string, rulesDir: string): boolean {
  if (!existsSync(skillsDir) || !existsSync(rulesDir)) {
    return false;
  }

  const expectedRule = join(rulesDir, getExpectedCodexRuleFileName());
  if (!existsSync(expectedRule)) {
    return false;
  }

  return getExpectedCodexSkillDirs().every((dirName) => existsSync(join(skillsDir, dirName)));
}
