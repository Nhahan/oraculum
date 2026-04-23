import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getReportsDir,
} from "../src/core/paths.js";
import type { OracleVerdict } from "../src/domain/oracle.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import { writeFinalistComparisonReport } from "../src/services/finalist-report.js";
import { createTaskPacketSummaryFixture } from "./helpers/contract-fixtures.js";
import { createTempRootHarness } from "./helpers/fs.js";

const tempRootHarness = createTempRootHarness("oraculum-finalist-report-");
tempRootHarness.registerCleanup();

describe("finalist comparison reports", () => {
  it("writes comparison artifacts with recommendation and verdict counts", async () => {
    const projectRoot = await createTempRoot();
    await mkdir(getReportsDir(projectRoot, "run_1"), { recursive: true });
    await mkdir(join(projectRoot, "workspace", "cand-01"), { recursive: true });
    await writeFile(
      join(projectRoot, "workspace", "cand-01", "src.ts"),
      "export const value = 1;\n",
    );

    const result = await writeFinalistComparisonReport({
      agent: "codex",
      runId: "run_1",
      taskPacket: createTaskPacketSummaryFixture({
        id: "task-1",
        title: "Fix session loss",
        sourceKind: "task-note",
        sourcePath: join(projectRoot, "task.md"),
        artifactKind: "document",
        targetArtifactPath: join(projectRoot, "docs", "SESSION_PLAN.md"),
        researchContext: {
          question: "What does the official API documentation say about the current behavior?",
          summary: "Review the official versioned API docs before execution.",
          confidence: "medium",
          signalSummary: ["language:javascript"],
          signalFingerprint: deriveResearchSignalFingerprint(["language:javascript"]),
          sources: [
            {
              kind: "official-doc",
              title: "Current API docs",
              locator: "https://example.com/docs/current-api",
            },
          ],
          claims: [
            {
              statement: "The current API requires a version header on session refresh.",
              sourceLocators: ["https://example.com/docs/current-api"],
            },
          ],
          versionNotes: ["Behavior changed in v3.2 compared with the legacy session API."],
          unresolvedConflicts: ["The repo comments still describe the pre-v3.2 refresh flow."],
          conflictHandling: "manual-review-required",
        },
        originKind: "task-note",
        originPath: join(projectRoot, "task.md"),
      }),
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 best matches the task intent.",
      },
      preflight: {
        decision: "proceed",
        confidence: "medium",
        summary: "Repository evidence is sufficient to proceed.",
        researchPosture: "repo-plus-external-docs",
        researchBasisDrift: true,
      },
      consultationProfile: {
        validationProfileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        validationSummary: "Package export evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["lint-fast", "full-suite-deep"],
        validationGaps: [],
        validationSignals: ["build-system:package-export-metadata"],
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: join(projectRoot, "workspace", "cand-01"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 1,
          repairedRounds: ["impact"],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
        {
          id: "cand-02",
          strategyId: "exploratory",
          strategyLabel: "Exploratory",
          status: "eliminated",
          workspaceDir: join(projectRoot, "workspace", "cand-02"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
      candidateResults: [
        {
          runId: "run_1",
          candidateId: "cand-01",
          adapter: "codex",
          status: "completed",
          startedAt: "2026-04-06T00:00:00.000Z",
          completedAt: "2026-04-06T00:00:01.000Z",
          exitCode: 0,
          summary: "Small, reviewable patch.",
          artifacts: [
            {
              kind: "patch",
              path: join(projectRoot, "patch.diff"),
            },
            {
              kind: "stdout",
              path: join(projectRoot, "stdout.log"),
            },
          ],
        },
      ],
      verdictsByCandidate: new Map<string, OracleVerdict[]>([
        [
          "cand-01",
          [
            {
              oracleId: "lint-fast",
              roundId: "fast",
              status: "pass",
              severity: "info",
              summary: "Lint passed.",
              invariant: "Code must pass lint.",
              confidence: "high",
              affectedScope: ["src/app.ts"],
              witnesses: [],
            },
            {
              oracleId: "api-impact",
              roundId: "impact",
              status: "repairable",
              severity: "warning",
              summary: "Public API drift needs review.",
              invariant: "Public API should remain stable.",
              confidence: "medium",
              affectedScope: ["src/api.ts"],
              repairHint: "Review the session restore API surface.",
              witnesses: [
                {
                  id: "witness-1",
                  kind: "command-output",
                  title: "API drift",
                  detail: "Public API drift needs review.",
                  scope: ["src/api.ts"],
                },
              ],
            },
          ],
        ],
      ]),
      projectRoot,
      verificationLevel: "standard",
    });

    expect(result.jsonPath).toBe(getFinalistComparisonJsonPath(projectRoot, "run_1"));
    expect(result.markdownPath).toBe(getFinalistComparisonMarkdownPath(projectRoot, "run_1"));

    const comparisonJson = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
      finalistCount: number;
      targetResultLabel: string;
      task: {
        originKind?: string;
        researchContext?: unknown;
      };
      validationProfileId?: string;
      validationSummary?: string;
      validationSignals: string[];
      validationGaps: string[];
      researchBasisStatus: string;
      researchConflictHandling?: string;
      researchBasisDrift?: boolean;
      researchRerunRecommended: boolean;
      researchRerunInputPath?: string;
      finalists: Array<{
        verdictCounts: {
          warning: number;
        };
      }>;
    };
    expect(comparisonJson.finalistCount).toBe(1);
    expect(comparisonJson.targetResultLabel).toBe(
      "recommended document result for docs/SESSION_PLAN.md",
    );
    expect(comparisonJson.task.originKind).toBe("task-note");
    expect(comparisonJson.task.researchContext).toBeTruthy();
    expect(comparisonJson.validationProfileId).toBe("library");
    expect(comparisonJson.validationSummary).toBe("Package export evidence is strongest.");
    expect(comparisonJson.validationSignals).toEqual(["build-system:package-export-metadata"]);
    expect(comparisonJson.validationGaps).toEqual([]);
    expect(comparisonJson.researchBasisStatus).toBe("stale");
    expect(comparisonJson.researchConflictHandling).toBe("manual-review-required");
    expect(comparisonJson.researchBasisDrift).toBe(true);
    expect(comparisonJson.researchRerunRecommended).toBe(true);
    expect(comparisonJson.researchRerunInputPath).toBeUndefined();
    expect(comparisonJson.finalists[0]?.verdictCounts.warning).toBe(1);
    const markdown = await readFile(result.markdownPath, "utf8");
    expect(markdown).toContain("# Finalist Comparison");
    expect(markdown).toContain("## Recommended Result");
    expect(markdown).toContain(
      "- Target result: recommended document result for docs/SESSION_PLAN.md",
    );
    expect(markdown).toContain("- Task source: task-note (task.md)");
    expect(markdown).toContain("- Artifact kind: document");
    expect(markdown).toContain("- Target artifact: docs/SESSION_PLAN.md");
    expect(markdown).toContain(
      "- Research summary: Review the official versioned API docs before execution.",
    );
    expect(markdown).toContain("- Research confidence: medium");
    expect(markdown).toContain("- Research basis status: stale");
    expect(markdown).toContain("- Research signal basis: 1");
    expect(markdown).toContain(
      `- Research signal fingerprint: ${deriveResearchSignalFingerprint(["language:javascript"])}`,
    );
    expect(markdown).toContain("- Research sources: 1");
    expect(markdown).toContain("- Research claims: 1");
    expect(markdown).toContain("- Research version notes: 1");
    expect(markdown).toContain("- Research conflicts: 1");
    expect(markdown).toContain("- Research conflict handling: manual-review-required");
    expect(markdown).toContain("- Research basis drift: detected");
    expect(markdown).toContain("- Task origin: task-note (task.md)");
    expect(markdown).toContain("## Consultation Validation Posture");
    expect(markdown).toContain("- Validation posture: library");
    expect(markdown).toContain("- Validation evidence: build-system:package-export-metadata");
    expect(markdown).toContain("- Why this won: cand-01 best matches the task intent.");
    expect(markdown).toContain("Repair attempts: 1 (impact)");
    expect(markdown).toContain("Review the session restore API surface.");
    expect(markdown).toContain("API drift");
    expect(markdown.indexOf("- Task origin: task-note (")).toBeLessThan(
      markdown.indexOf("- Target result: recommended document result for docs/SESSION_PLAN.md"),
    );
    expect(
      markdown.indexOf("- Target result: recommended document result for docs/SESSION_PLAN.md"),
    ).toBeLessThan(markdown.indexOf("- Artifact kind: document"));
    expect(markdown.indexOf("- Artifact kind: document")).toBeLessThan(
      markdown.indexOf("- Target artifact: docs/SESSION_PLAN.md"),
    );
    expect(markdown.indexOf("- Target artifact: docs/SESSION_PLAN.md")).toBeLessThan(
      markdown.indexOf("- Task source: task-note ("),
    );
  });

  it("renders an explicit no-finalists report when nobody survives", async () => {
    const projectRoot = await createTempRoot();
    await mkdir(getReportsDir(projectRoot, "run_2"), { recursive: true });

    await writeFinalistComparisonReport({
      agent: "claude-code",
      runId: "run_2",
      taskPacket: createTaskPacketSummaryFixture({
        id: "task-2",
        title: "Fix auth regression",
        sourceKind: "task-note",
        sourcePath: join(projectRoot, "task.md"),
        artifactKind: "patch",
        targetArtifactPath: "src/auth/session.ts",
        originKind: "task-note",
        originPath: join(projectRoot, "task.md"),
      }),
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: join(projectRoot, "workspace", "cand-01"),
          taskPacketPath: join(projectRoot, "task-packet.json"),
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-06T00:00:00.000Z",
        },
      ],
      candidateResults: [],
      verdictsByCandidate: new Map(),
      projectRoot,
      verificationLevel: "none",
    });

    await expect(
      readFile(getFinalistComparisonMarkdownPath(projectRoot, "run_2"), "utf8"),
    ).resolves.toContain("No finalists cleared this run.");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(projectRoot, "run_2"), "utf8"),
    ).resolves.toContain("- Target result: recommended patch result for src/auth/session.ts");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(projectRoot, "run_2"), "utf8"),
    ).resolves.toContain("- Task source: task-note (");
    await expect(
      readFile(getFinalistComparisonMarkdownPath(projectRoot, "run_2"), "utf8"),
    ).resolves.toContain("- Artifact kind: patch");
  });

  it("surfaces rerun input when comparison is based on a stale research brief", async () => {
    const projectRoot = await createTempRoot();
    await mkdir(getReportsDir(projectRoot, "run_3"), { recursive: true });
    const researchBriefPath = join(
      projectRoot,
      ".oraculum",
      "runs",
      "run_src",
      "reports",
      "research-brief.json",
    );

    const result = await writeFinalistComparisonReport({
      agent: "codex",
      runId: "run_3",
      taskPacket: createTaskPacketSummaryFixture({
        id: "task-3",
        title: "Fix session loss",
        sourceKind: "research-brief",
        sourcePath: researchBriefPath,
        researchContext: {
          question: "What does the official API documentation say about the current behavior?",
          summary: "Review the official versioned API docs before execution.",
          confidence: "medium",
          signalSummary: ["language:javascript"],
          signalFingerprint: deriveResearchSignalFingerprint(["language:javascript"]),
          sources: [],
          claims: [],
          versionNotes: [],
          unresolvedConflicts: [],
          conflictHandling: "accepted",
        },
      }),
      preflight: {
        decision: "proceed",
        confidence: "medium",
        summary: "Repository evidence is sufficient to proceed.",
        researchPosture: "repo-plus-external-docs",
        researchBasisDrift: true,
      },
      candidates: [],
      candidateResults: [],
      verdictsByCandidate: new Map(),
      projectRoot,
      verificationLevel: "none",
    });

    const comparisonJson = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
      researchBasisDrift?: boolean;
      researchRerunRecommended: boolean;
      researchRerunInputPath?: string;
      targetResultLabel: string;
    };

    expect(comparisonJson.researchBasisDrift).toBe(true);
    expect(comparisonJson.researchRerunRecommended).toBe(true);
    expect(comparisonJson.researchRerunInputPath).toBe(researchBriefPath);
    expect(comparisonJson.targetResultLabel).toBe("recommended survivor");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Research rerun input: .oraculum/runs/run_src/reports/research-brief.json",
    );
  });

  it("preserves absolute target artifact paths outside the project root in report labels", async () => {
    const projectRoot = await createTempRoot();
    const externalTargetArtifactPath = join(tmpdir(), "external", "SESSION_PLAN.md");
    await mkdir(getReportsDir(projectRoot, "run_external_target"), { recursive: true });

    const result = await writeFinalistComparisonReport({
      agent: "codex",
      runId: "run_external_target",
      taskPacket: createTaskPacketSummaryFixture({
        id: "task_external_target",
        title: "Draft plan",
        sourceKind: "task-note",
        sourcePath: join(projectRoot, "task.md"),
        artifactKind: "document",
        targetArtifactPath: externalTargetArtifactPath,
      }),
      candidates: [],
      candidateResults: [],
      verdictsByCandidate: new Map(),
      projectRoot,
      verificationLevel: "none",
    });

    const comparisonJson = JSON.parse(await readFile(result.jsonPath, "utf8")) as {
      targetResultLabel: string;
    };
    const markdown = await readFile(result.markdownPath, "utf8");
    const normalizedExternalTarget = externalTargetArtifactPath.replaceAll("\\", "/");

    expect(comparisonJson.targetResultLabel).toBe(
      `recommended document result for ${normalizedExternalTarget}`,
    );
    expect(markdown).toContain(
      `- Target result: recommended document result for ${normalizedExternalTarget}`,
    );
    expect(markdown).toContain(`- Target artifact: ${normalizedExternalTarget}`);
    expect(markdown).not.toContain("../external/SESSION_PLAN.md");
  });
});

async function createTempRoot(): Promise<string> {
  return tempRootHarness.createTempRoot();
}
