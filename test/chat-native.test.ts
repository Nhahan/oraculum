import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { agentJudgeResultSchema } from "../src/adapters/types.js";
import { APP_VERSION } from "../src/core/constants.js";
import {
  getClarifyFollowUpPath,
  getExportPlanPath,
  getFailureAnalysisPath,
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunConfigPath,
  getRunDir,
  getSecondOpinionWinnerSelectionPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import {
  consultToolResponseSchema,
  crownMaterializationSchema,
  crownToolRequestSchema,
  crownToolResponseSchema,
  mcpToolIdSchema,
  setupStatusToolResponseSchema,
} from "../src/domain/chat-native.js";
import { consultationProfileSelectionArtifactSchema } from "../src/domain/profile.js";
import {
  consultationClarifyFollowUpSchema,
  consultationPreflightReadinessArtifactSchema,
  consultationResearchBriefSchema,
  exportPlanSchema,
} from "../src/domain/run.js";
import {
  buildConsultationArtifacts,
  buildSetupDiagnosticsResponse,
  filterSetupDiagnosticsResponse,
  getMcpToolSchemas,
  hasClaudePluginArtifactsInstalled,
  oraculumCommandManifest,
  oraculumMcpToolSurface,
  summarizeSetupDiagnosticsHosts,
} from "../src/services/chat-native.js";
import { failureAnalysisSchema } from "../src/services/failure-analysis.js";
import { secondOpinionWinnerSelectionArtifactSchema } from "../src/services/finalist-judge.js";
import { comparisonReportSchema } from "../src/services/finalist-report.js";
import { createOraculumMcpServer } from "../src/services/mcp-server.js";
import { runCrownTool } from "../src/services/mcp-tools.js";
import { initializeProject } from "../src/services/project.js";

vi.mock("../src/services/mcp-tools.js", () => ({
  runConsultTool: vi.fn(),
  runCrownTool: vi.fn(),
  runDraftTool: vi.fn(),
  runInitTool: vi.fn(),
  runSetupStatusTool: vi.fn(),
  runVerdictArchiveTool: vi.fn(),
  runVerdictTool: vi.fn(),
}));

const tempRoots: string[] = [];
const mockedRunCrownTool = vi.mocked(runCrownTool);

afterEach(async () => {
  mockedRunCrownTool.mockReset();
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("chat-native MCP surface", () => {
  it("defines schemas for every declared MCP tool", () => {
    const declaredToolIds = oraculumMcpToolSurface.map((tool) => tool.id);

    expect(new Set(declaredToolIds)).toHaveLength(declaredToolIds.length);
    expect(new Set(declaredToolIds)).toEqual(new Set(mcpToolIdSchema.options));

    for (const tool of oraculumMcpToolSurface) {
      const schemas = getMcpToolSchemas(tool.id);
      expect(schemas.request).toBeDefined();
      expect(schemas.response).toBeDefined();
    }
  });

  it("describes crown tooling in artifact-neutral terms", () => {
    const crownTool = oraculumMcpToolSurface.find((tool) => tool.id === "oraculum_crown");
    const crownCommand = oraculumCommandManifest.find((entry) => entry.id === "crown");

    expect(crownTool?.purpose).toContain("recommended result");
    expect(crownTool?.purpose).toContain("explicitly selected finalist");
    expect(crownTool?.requestShape).toBe("crownToolRequestInputSchema");
    expect(crownCommand?.summary).toBe(
      "Crown the recommended result and materialize it in the project.",
    );
    expect(crownCommand?.requestShape).toBe("crownToolRequestInputSchema");
  });

  it("publishes crown input schema without requiring branchName, materializationName, or materializationLabel", async () => {
    const mcpServer = createOraculumMcpServer();
    const requestHandlers = (
      mcpServer.server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const listTools = requestHandlers.get("tools/list") as (request: {
      method: "tools/list";
      params: Record<string, never>;
    }) => Promise<{ tools: Array<{ inputSchema: Record<string, unknown>; name: string }> }>;

    const response = await listTools({
      method: "tools/list",
      params: {},
    });
    const crown = response.tools.find((tool) => tool.name === "oraculum_crown");

    expect(crown).toBeDefined();
    expect(crown?.inputSchema).toMatchObject({
      properties: {
        branchName: {
          minLength: 1,
          type: "string",
        },
        materializationName: {
          minLength: 1,
          type: "string",
        },
        materializationLabel: {
          minLength: 1,
          type: "string",
        },
      },
      required: ["cwd"],
      type: "object",
    });
  });

  it("describes default crown responses as recommended-result materialization", async () => {
    const mcpServer = createOraculumMcpServer();
    const requestHandlers = (
      mcpServer.server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const callTool = requestHandlers.get("tools/call") as (request: {
      method: "tools/call";
      params: {
        name: "oraculum_crown";
        arguments: {
          cwd: string;
          withReport?: boolean;
        };
      };
    }) => Promise<{ content: Array<{ text: string; type: "text" }> }>;

    mockedRunCrownTool.mockResolvedValueOnce(createCrownToolResponse("cand-01"));

    const response = await callTool({
      method: "tools/call",
      params: {
        name: "oraculum_crown",
        arguments: {
          cwd: "/tmp/project",
          withReport: false,
        },
      },
    });

    expect(response.content[0]?.text).toContain(
      "The recommended result has already been materialized; do not materialize it again.",
    );
    expect(response.content[0]?.text).not.toContain(
      "The selected finalist has already been materialized",
    );
  });

  it("describes explicit crown responses as selected-finalist materialization", async () => {
    const mcpServer = createOraculumMcpServer();
    const requestHandlers = (
      mcpServer.server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    const callTool = requestHandlers.get("tools/call") as (request: {
      method: "tools/call";
      params: {
        name: "oraculum_crown";
        arguments: {
          candidateId: string;
          cwd: string;
          withReport?: boolean;
        };
      };
    }) => Promise<{ content: Array<{ text: string; type: "text" }> }>;

    mockedRunCrownTool.mockResolvedValueOnce(createCrownToolResponse("cand-02"));

    const response = await callTool({
      method: "tools/call",
      params: {
        name: "oraculum_crown",
        arguments: {
          cwd: "/tmp/project",
          candidateId: "cand-02",
          withReport: false,
        },
      },
    });

    expect(response.content[0]?.text).toContain(
      "The selected finalist has already been materialized; do not materialize it again.",
    );
    expect(response.content[0]?.text).not.toContain(
      "The recommended result has already been materialized",
    );
  });

  it("accepts crown materialization aliases in both request and response schemas", () => {
    const request = crownToolRequestSchema.parse({
      cwd: "/tmp/project",
      materializationName: "fix/session-loss",
      withReport: true,
    });
    const materialization = crownMaterializationSchema.parse({
      materialized: true,
      verified: true,
      materializationMode: "branch",
      materializationName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js"],
      changedPathCount: 1,
      checks: [
        {
          id: "current-branch",
          status: "passed",
          summary: "Current git branch is fix/session-loss.",
        },
      ],
    });

    expect(request.branchName).toBe("fix/session-loss");
    expect(request.materializationName).toBe("fix/session-loss");
    expect(materialization.mode).toBe("git-branch");
    expect(materialization.materializationMode).toBe("branch");
    expect(materialization.branchName).toBe("fix/session-loss");
    expect(materialization.materializationName).toBe("fix/session-loss");
  });

  it("keeps one shared command vocabulary on the orc prefix", () => {
    expect(oraculumCommandManifest.map((entry) => entry.path.join(" "))).toEqual([
      "consult",
      "verdict",
      "verdict archive",
      "crown",
      "draft",
      "init",
    ]);

    for (const entry of oraculumCommandManifest) {
      expect(entry.prefix).toBe("orc");
      expect(oraculumMcpToolSurface.some((tool) => tool.id === entry.mcpTool)).toBe(true);
    }
  });

  it("describes consultation candidate counts in artifact-neutral terms", () => {
    const consultCommand = oraculumCommandManifest.find((entry) => entry.id === "consult");
    const draftCommand = oraculumCommandManifest.find((entry) => entry.id === "draft");
    const crownCommand = oraculumCommandManifest.find((entry) => entry.id === "crown");

    expect(
      consultCommand?.arguments.find((argument) => argument.name === "candidates")?.description,
    ).toBe("Number of candidate variants to plan.");
    expect(
      draftCommand?.arguments.find((argument) => argument.name === "candidates")?.description,
    ).toBe("Number of candidate variants to plan.");
    expect(crownCommand?.arguments[0]).toMatchObject({
      name: "materializationName",
      description:
        "Branch name to create, or an optional workspace-sync materialization label in non-Git projects.",
    });
  });

  it("binds every MCP tool to real repo modules plus at most a thin adapter layer", async () => {
    for (const tool of oraculumMcpToolSurface) {
      for (const binding of tool.bindings) {
        const modulePath = join(process.cwd(), binding.module);
        await expect(access(modulePath, constants.F_OK)).resolves.toBeUndefined();
      }
    }
  });

  it("builds machine-readable consultation artifact paths for MCP responses", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-"));
    tempRoots.push(projectRoot);
    const consultationId = "run_20260409_demo";

    await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });
    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeFile(getRunConfigPath(projectRoot, consultationId), "{}\n", "utf8");
    await writePreflightReadinessArtifact(projectRoot, consultationId);
    await writeFile(
      getFinalistComparisonJsonPath(projectRoot, consultationId),
      `${JSON.stringify(
        comparisonReportSchema.parse({
          runId: consultationId,
          generatedAt: "2026-04-14T00:00:00.000Z",
          agent: "codex",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          targetResultLabel: "recommended result",
          finalistCount: 0,
          researchRerunRecommended: false,
          verificationLevel: "lightweight",
          finalists: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getClarifyFollowUpPath(projectRoot, consultationId),
      `${JSON.stringify(
        consultationClarifyFollowUpSchema.parse({
          runId: consultationId,
          adapter: "codex",
          decision: "needs-clarification",
          scopeKeyType: "target-artifact",
          scopeKey: "docs/SESSION_PLAN.md",
          repeatedCaseCount: 2,
          repeatedKinds: ["clarify-needed"],
          recurringReasons: ["Which sections are required?"],
          summary: "The document contract is still underspecified.",
          keyQuestion: "Which sections are required?",
          missingResultContract: "The expected section contract is still missing.",
          missingJudgingBasis: "The judging basis for the document is still missing.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getResearchBriefPath(projectRoot, consultationId),
      `${JSON.stringify(
        consultationResearchBriefSchema.parse({
          runId: consultationId,
          decision: "external-research-required",
          question: "What does the official API documentation say?",
          researchPosture: "external-research-required",
          summary: "Official documentation is still required.",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          notes: [],
          signalSummary: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getFailureAnalysisPath(projectRoot, consultationId),
      `${JSON.stringify(
        failureAnalysisSchema.parse({
          runId: consultationId,
          generatedAt: "2026-04-14T00:00:00.000Z",
          trigger: "finalists-without-recommendation",
          summary: "Investigate before rerun.",
          recommendedAction: "investigate-root-cause-before-rerun",
          validationGaps: [],
          candidates: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getFinalistComparisonMarkdownPath(projectRoot, consultationId),
      `# Finalist Comparison\n\n- Run: ${consultationId}\n`,
      "utf8",
    );
    await writeFile(
      getWinnerSelectionPath(projectRoot, consultationId),
      `${JSON.stringify(
        agentJudgeResultSchema.parse({
          runId: consultationId,
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-14T00:00:00.000Z",
          completedAt: "2026-04-14T00:00:01.000Z",
          exitCode: 0,
          summary: "Judge selected cand-01.",
          recommendation: {
            decision: "select",
            candidateId: "cand-01",
            confidence: "high",
            summary: "cand-01 is the recommended promotion.",
          },
          artifacts: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getSecondOpinionWinnerSelectionPath(projectRoot, consultationId),
      `${JSON.stringify(
        secondOpinionWinnerSelectionArtifactSchema.parse({
          runId: consultationId,
          advisoryOnly: true,
          adapter: "claude-code",
          triggerKinds: ["low-confidence"],
          triggerReasons: ["Primary judge confidence was low."],
          primaryRecommendation: {
            source: "llm-judge",
            decision: "select",
            candidateId: "cand-01",
            confidence: "low",
            summary: "cand-01 remained the leading primary recommendation.",
          },
          result: {
            runId: consultationId,
            adapter: "claude-code",
            status: "completed",
            startedAt: "2026-04-14T00:00:00.000Z",
            completedAt: "2026-04-14T00:00:01.000Z",
            exitCode: 0,
            summary: "Second opinion agreed with cand-01.",
            recommendation: {
              decision: "select",
              candidateId: "cand-01",
              confidence: "medium",
              summary: "cand-01 remains the safest recommendation.",
            },
            artifacts: [],
          },
          agreement: "agrees-select",
          advisorySummary: "The second opinion agrees with the primary recommendation.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getProfileSelectionPath(projectRoot, consultationId),
      `${JSON.stringify(
        consultationProfileSelectionArtifactSchema.parse({
          runId: consultationId,
          signals: {
            packageManager: "npm",
            scripts: [],
            dependencies: [],
            files: [],
            workspaceRoots: [],
            workspaceMetadata: [],
            notes: [],
            capabilities: [],
            provenance: [],
            commandCatalog: [],
            skippedCommandCandidates: [],
          },
          recommendation: {
            validationProfileId: "generic",
            confidence: "low",
            validationSummary: "No executable validation evidence was detected.",
            candidateCount: 3,
            strategyIds: ["minimal-change"],
            selectedCommandIds: [],
            validationGaps: ["No repo-local validation command was detected."],
          },
          appliedSelection: {
            validationProfileId: "generic",
            confidence: "low",
            source: "fallback-detection",
            validationSummary: "No executable validation evidence was detected.",
            candidateCount: 3,
            strategyIds: ["minimal-change"],
            oracleIds: [],
            validationGaps: ["No repo-local validation command was detected."],
            validationSignals: [],
          },
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getExportPlanPath(projectRoot, consultationId),
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: consultationId,
          winnerId: "cand-01",
          branchName: `orc/${consultationId}-cand-01`,
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-14T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const artifacts = buildConsultationArtifacts(projectRoot, consultationId, {
      hasExportedCandidate: true,
    });
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBe(getRunConfigPath(projectRoot, consultationId));
    expect(parsed.preflightReadinessPath).toBe(
      getPreflightReadinessPath(projectRoot, consultationId),
    );
    expect(parsed.clarifyFollowUpPath).toBe(getClarifyFollowUpPath(projectRoot, consultationId));
    expect(parsed.researchBriefPath).toBe(getResearchBriefPath(projectRoot, consultationId));
    expect(parsed.failureAnalysisPath).toBe(getFailureAnalysisPath(projectRoot, consultationId));
    expect(parsed.profileSelectionPath).toBe(getProfileSelectionPath(projectRoot, consultationId));
    expect(parsed.comparisonJsonPath).toBe(
      getFinalistComparisonJsonPath(projectRoot, consultationId),
    );
    expect(parsed.comparisonMarkdownPath).toBe(
      getFinalistComparisonMarkdownPath(projectRoot, consultationId),
    );
    expect(parsed.secondOpinionWinnerSelectionPath).toBe(
      getSecondOpinionWinnerSelectionPath(projectRoot, consultationId),
    );
    expect(parsed.crowningRecordPath).toBe(getExportPlanPath(projectRoot, consultationId));
    expect(parsed.profileSelectionPath).toBe(getProfileSelectionPath(projectRoot, consultationId));
  });

  it("resolves consultation artifacts from a nested cwd", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-nested-"));
    tempRoots.push(projectRoot);
    const nestedCwd = join(projectRoot, "packages", "app");
    const consultationId = "run_20260409_nested";

    await initializeProject({ cwd: projectRoot, force: false });
    await mkdir(nestedCwd, { recursive: true });
    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeFile(getRunConfigPath(projectRoot, consultationId), "{}\n", "utf8");
    await writePreflightReadinessArtifact(projectRoot, consultationId);
    await writeFile(
      getClarifyFollowUpPath(projectRoot, consultationId),
      `${JSON.stringify(
        consultationClarifyFollowUpSchema.parse({
          runId: consultationId,
          adapter: "codex",
          decision: "needs-clarification",
          scopeKeyType: "task-source",
          scopeKey: "tasks/operator-memo.md",
          repeatedCaseCount: 2,
          repeatedKinds: ["clarify-needed"],
          recurringReasons: ["Who is the intended audience?"],
          summary: "The memo audience is still underspecified.",
          keyQuestion: "Who is the intended audience?",
          missingResultContract: "The operator memo deliverable is still underspecified.",
          missingJudgingBasis: "The memo review basis is still underspecified.",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getResearchBriefPath(projectRoot, consultationId),
      `${JSON.stringify(
        consultationResearchBriefSchema.parse({
          runId: consultationId,
          decision: "external-research-required",
          question: "What does the vendor documentation say?",
          researchPosture: "external-research-required",
          summary: "Vendor documentation is still required.",
          task: {
            id: "task",
            title: "Task",
            sourceKind: "task-note",
            sourcePath: "/tmp/task.md",
          },
          notes: [],
          signalSummary: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      getFailureAnalysisPath(projectRoot, consultationId),
      `${JSON.stringify(
        failureAnalysisSchema.parse({
          runId: consultationId,
          generatedAt: "2026-04-14T00:00:00.000Z",
          trigger: "no-survivors",
          summary: "Investigate before rerun.",
          recommendedAction: "investigate-root-cause-before-rerun",
          validationGaps: [],
          candidates: [],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const artifacts = buildConsultationArtifacts(nestedCwd, consultationId, {
      hasExportedCandidate: false,
    });
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBe(getRunConfigPath(projectRoot, consultationId));
    expect(parsed.preflightReadinessPath).toBe(
      getPreflightReadinessPath(projectRoot, consultationId),
    );
    expect(parsed.clarifyFollowUpPath).toBe(getClarifyFollowUpPath(projectRoot, consultationId));
    expect(parsed.researchBriefPath).toBe(getResearchBriefPath(projectRoot, consultationId));
    expect(parsed.failureAnalysisPath).toBe(getFailureAnalysisPath(projectRoot, consultationId));
    expect(parsed.secondOpinionWinnerSelectionPath).toBeUndefined();
  });

  it("omits a valid crowning record when no candidate was exported", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-stale-crown-"));
    tempRoots.push(projectRoot);
    const consultationId = "run_20260409_stale_crown";

    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeFile(
      getExportPlanPath(projectRoot, consultationId),
      `${JSON.stringify(
        exportPlanSchema.parse({
          runId: consultationId,
          winnerId: "cand-01",
          branchName: `orc/${consultationId}-cand-01`,
          mode: "git-branch",
          materializationMode: "branch",
          workspaceDir: "/tmp/workspace",
          withReport: true,
          createdAt: "2026-04-14T00:00:00.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const artifacts = buildConsultationArtifacts(projectRoot, consultationId, {
      hasExportedCandidate: false,
    });
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.crowningRecordPath).toBeUndefined();
  });

  it("omits invalid machine-readable artifact paths from MCP responses", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-invalid-"));
    tempRoots.push(projectRoot);
    const consultationId = "run_20260409_invalid";

    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeFile(getPreflightReadinessPath(projectRoot, consultationId), "not-json\n", "utf8");
    await writeFile(getClarifyFollowUpPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getResearchBriefPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getFailureAnalysisPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getProfileSelectionPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getFinalistComparisonJsonPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getWinnerSelectionPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(getExportPlanPath(projectRoot, consultationId), "{}\n", "utf8");
    await writeFile(
      getSecondOpinionWinnerSelectionPath(projectRoot, consultationId),
      "{}\n",
      "utf8",
    );

    const artifacts = buildConsultationArtifacts(projectRoot, consultationId, {
      hasExportedCandidate: false,
    });
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.preflightReadinessPath).toBeUndefined();
    expect(parsed.clarifyFollowUpPath).toBeUndefined();
    expect(parsed.researchBriefPath).toBeUndefined();
    expect(parsed.failureAnalysisPath).toBeUndefined();
    expect(parsed.profileSelectionPath).toBeUndefined();
    expect(parsed.comparisonJsonPath).toBeUndefined();
    expect(parsed.winnerSelectionPath).toBeUndefined();
    expect(parsed.secondOpinionWinnerSelectionPath).toBeUndefined();
    expect(parsed.crowningRecordPath).toBeUndefined();
  });

  it("omits blank comparison markdown paths from MCP responses", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-blank-md-"));
    tempRoots.push(projectRoot);
    const consultationId = "run_20260409_blank_markdown";

    await mkdir(join(getRunDir(projectRoot, consultationId), "reports"), { recursive: true });
    await writeFile(getFinalistComparisonMarkdownPath(projectRoot, consultationId), " \n", "utf8");

    const artifacts = buildConsultationArtifacts(projectRoot, consultationId, {
      hasExportedCandidate: false,
    });
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.comparisonMarkdownPath).toBeUndefined();
  });

  it("omits artifact paths that do not exist on disk", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-chat-native-missing-"));
    tempRoots.push(projectRoot);
    const consultationId = "run_20260409_missing";

    await mkdir(getRunDir(projectRoot, consultationId), { recursive: true });

    const artifacts = buildConsultationArtifacts(projectRoot, consultationId, {
      hasExportedCandidate: false,
    });
    const parsed = consultToolResponseSchema.shape.artifacts.parse(artifacts);

    expect(parsed.consultationRoot).toBe(getRunDir(projectRoot, consultationId));
    expect(parsed.configPath).toBeUndefined();
    expect(parsed.preflightReadinessPath).toBeUndefined();
    expect(parsed.clarifyFollowUpPath).toBeUndefined();
    expect(parsed.researchBriefPath).toBeUndefined();
    expect(parsed.failureAnalysisPath).toBeUndefined();
    expect(parsed.profileSelectionPath).toBeUndefined();
    expect(parsed.comparisonJsonPath).toBeUndefined();
    expect(parsed.comparisonMarkdownPath).toBeUndefined();
    expect(parsed.secondOpinionWinnerSelectionPath).toBeUndefined();
    expect(parsed.crowningRecordPath).toBeUndefined();
  });

  it("describes setup diagnostics with actionable host readiness states", () => {
    const diagnostics = setupStatusToolResponseSchema.parse(
      buildSetupDiagnosticsResponse(process.cwd()),
    );

    expect(diagnostics.targetPrefix).toBe("orc");
    expect(diagnostics.hosts).toHaveLength(2);
    expect(diagnostics.summary).toContain("host-native");
    for (const host of diagnostics.hosts) {
      expect(["ready", "partial", "needs-setup"]).toContain(host.status);
      if (host.status === "ready") {
        expect(host.nextAction.startsWith("Use `orc ...` directly in ")).toBe(true);
      } else {
        expect(host.nextAction).toContain("oraculum setup --runtime");
      }
    }
    expect(
      diagnostics.hosts
        .find((host) => host.host === "claude-code")
        ?.notes.some(
          (note) =>
            note.includes("oraculum setup --runtime claude-code") ||
            note.includes(".claude/plugins"),
        ),
    ).toBe(true);
    expect(
      diagnostics.hosts
        .find((host) => host.host === "claude-code")
        ?.notes.some((note) => note.includes(".claude/plugins")),
    ).toBe(true);
    expect(
      diagnostics.hosts
        .find((host) => host.host === "codex")
        ?.notes.some((note) => note.includes("oraculum setup --runtime codex")),
    ).toBe(true);
  });

  it("omits project config paths from setup diagnostics when the project is not initialized", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "oraculum-setup-diagnostics-"));
    tempRoots.push(projectRoot);

    const diagnostics = setupStatusToolResponseSchema.parse(
      buildSetupDiagnosticsResponse(projectRoot),
    );

    expect(diagnostics.projectInitialized).toBe(false);
    expect(diagnostics.configPath).toBeUndefined();
    expect(diagnostics.advancedConfigPath).toBeUndefined();
  });

  it("filters setup diagnostics by host and recomputes the summary", () => {
    const diagnostics = setupStatusToolResponseSchema.parse(
      buildSetupDiagnosticsResponse(process.cwd()),
    );

    const filtered = filterSetupDiagnosticsResponse(diagnostics, "codex");

    expect(filtered.hosts).toHaveLength(1);
    expect(filtered.hosts[0]?.host).toBe("codex");
    expect(filtered.summary).toBe(
      summarizeSetupDiagnosticsHosts(
        filtered.hosts.map((host) => ({
          host: host.host,
          status: host.status,
          registered: host.registered,
          artifactsInstalled: host.artifactsInstalled,
        })),
      ),
    );
  });

  it("recognizes the Claude plugin cache layout created by Claude Code", async () => {
    const root = await mkdtemp(join(tmpdir(), "oraculum-claude-plugin-cache-"));
    tempRoots.push(root);
    const pluginsDir = join(root, "plugins");
    const installPath = join(pluginsDir, "cache", "oraculum", "oraculum", APP_VERSION);
    await mkdir(installPath, { recursive: true });
    await writeFile(join(installPath, "plugin.json"), "{}\n", "utf8");
    await writeFile(
      join(pluginsDir, "installed_plugins.json"),
      `${JSON.stringify(
        {
          version: 2,
          plugins: {
            "oraculum@oraculum": [
              {
                installPath,
                scope: "user",
                version: APP_VERSION,
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(hasClaudePluginArtifactsInstalled(pluginsDir)).toBe(true);
  });
});

function createCrownToolResponse(candidateId: string) {
  return crownToolResponseSchema.parse({
    mode: "crown",
    plan: {
      runId: "run_1",
      winnerId: candidateId,
      branchName: "fix/session-loss",
      mode: "git-branch",
      materializationMode: "branch",
      workspaceDir: "/tmp/workspace",
      patchPath: "/tmp/export.patch",
      materializationPatchPath: "/tmp/export.patch",
      withReport: false,
      createdAt: "2026-04-05T00:00:00.000Z",
    },
    recordPath: "/tmp/export-plan.json",
    materialization: {
      materialized: true,
      verified: true,
      mode: "git-branch",
      materializationMode: "branch",
      branchName: "fix/session-loss",
      materializationName: "fix/session-loss",
      currentBranch: "fix/session-loss",
      changedPaths: ["src/message.js"],
      changedPathCount: 1,
      checks: [
        {
          id: "current-branch",
          status: "passed",
          summary: "Current git branch is fix/session-loss.",
        },
      ],
    },
    consultation: {
      id: "run_1",
      status: "completed",
      taskPath: "/tmp/task.md",
      taskPacket: {
        id: "task-1",
        title: "Fix session loss",
        sourceKind: "task-note",
        sourcePath: "/tmp/task.md",
      },
      agent: "codex",
      candidateCount: 1,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
      rounds: [],
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: candidateId,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "repo-local-oracle",
      },
      recommendedWinner: {
        candidateId,
        confidence: "high",
        source: "llm-judge",
        summary: `${candidateId} is the recommended survivor.`,
      },
      candidates: [
        {
          id: candidateId,
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    },
    status: {
      consultationId: "run_1",
      consultationState: "completed",
      outcomeType: "recommended-survivor",
      terminal: true,
      crownable: true,
      taskSourceKind: "task-note",
      taskSourcePath: "/tmp/task.md",
      researchSignalCount: 0,
      finalistCount: 1,
      validationPosture: "sufficient",
      validationGapCount: 0,
      validationGapsPresent: false,
      verificationLevel: "lightweight",
      judgingBasisKind: "repo-local-oracle",
      researchPosture: "repo-only",
      researchRerunRecommended: false,
      researchConflictsPresent: false,
      nextActions: ["reopen-verdict", "browse-archive", "crown-recommended-result"],
      recommendedCandidateId: candidateId,
      validationSignals: [],
      validationGaps: [],
      preflightDecision: "proceed",
      updatedAt: "2026-04-05T00:00:00.000Z",
    },
  });
}

async function writePreflightReadinessArtifact(
  projectRoot: string,
  consultationId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    getPreflightReadinessPath(projectRoot, consultationId),
    `${JSON.stringify(
      consultationPreflightReadinessArtifactSchema.parse({
        runId: consultationId,
        signals: {
          packageManager: "npm",
          scripts: [],
          dependencies: [],
          files: [],
          workspaceRoots: [],
          workspaceMetadata: [],
          notes: [],
          capabilities: [],
          provenance: [],
          commandCatalog: [],
          skippedCommandCandidates: [],
        },
        recommendation: {
          decision: "proceed",
          confidence: "low",
          summary: "Proceed conservatively with the default consultation flow.",
          researchPosture: "repo-only",
        },
        ...overrides,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );
}
