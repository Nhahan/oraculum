import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getFinalistComparisonJsonPath,
  getFinalistComparisonMarkdownPath,
  getReportsDir,
} from "../src/core/paths.js";
import type { OracleVerdict } from "../src/domain/oracle.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import { writeFinalistComparisonReport } from "../src/services/finalist-report.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

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
      taskPacket: {
        id: "task-1",
        title: "Fix session loss",
        sourceKind: "task-note",
        sourcePath: join(projectRoot, "task.md"),
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
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
        },
        originKind: "task-note",
        originPath: join(projectRoot, "task.md"),
      },
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
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Package export evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["lint-fast", "full-suite-deep"],
        missingCapabilities: [],
        signals: ["intent:library"],
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
      task: {
        originKind?: string;
        researchContext?: unknown;
      };
      validationProfileId?: string;
      validationSummary?: string;
      validationSignals: string[];
      validationGaps: string[];
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
    expect(comparisonJson.task.originKind).toBe("task-note");
    expect(comparisonJson.task.researchContext).toBeTruthy();
    expect(comparisonJson.validationProfileId).toBe("library");
    expect(comparisonJson.validationSummary).toBe("Package export evidence is strongest.");
    expect(comparisonJson.validationSignals).toEqual(["intent:library"]);
    expect(comparisonJson.validationGaps).toEqual([]);
    expect(comparisonJson.researchBasisDrift).toBe(true);
    expect(comparisonJson.researchRerunRecommended).toBe(true);
    expect(comparisonJson.researchRerunInputPath).toBeUndefined();
    expect(comparisonJson.finalists[0]?.verdictCounts.warning).toBe(1);
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "## Recommended Survivor",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Task source: task-note (",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Artifact kind: document",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Target artifact: docs/SESSION_PLAN.md",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Research summary: Review the official versioned API docs before execution.",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Research confidence: medium",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Research signal basis: 1",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      `- Research signal fingerprint: ${deriveResearchSignalFingerprint(["language:javascript"])}`,
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("- Research sources: 1");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("- Research claims: 1");
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Research version notes: 1",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Research conflicts: 1",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Research basis drift: detected",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Task origin: task-note (",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "## Consultation Validation Profile",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Validation profile: library",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Validation evidence: intent:library",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "- Why this won: cand-01 best matches the task intent.",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "Repair attempts: 1 (impact)",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      "Review the session restore API surface.",
    );
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain("API drift");
  });

  it("renders an explicit no-finalists report when nobody survives", async () => {
    const projectRoot = await createTempRoot();
    await mkdir(getReportsDir(projectRoot, "run_2"), { recursive: true });

    await writeFinalistComparisonReport({
      agent: "claude-code",
      runId: "run_2",
      taskPacket: {
        id: "task-2",
        title: "Fix auth regression",
        sourceKind: "task-note",
        sourcePath: join(projectRoot, "task.md"),
        artifactKind: "patch",
        targetArtifactPath: "src/auth/session.ts",
        originKind: "task-note",
        originPath: join(projectRoot, "task.md"),
      },
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
    ).resolves.toContain("No survivors cleared this run.");
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
      taskPacket: {
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
        },
      },
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
    };

    expect(comparisonJson.researchBasisDrift).toBe(true);
    expect(comparisonJson.researchRerunRecommended).toBe(true);
    expect(comparisonJson.researchRerunInputPath).toBe(researchBriefPath);
    await expect(readFile(result.markdownPath, "utf8")).resolves.toContain(
      `- Research rerun input: ${researchBriefPath}`,
    );
  });
});

async function createTempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oraculum-finalist-report-"));
  tempRoots.push(path);
  return path;
}
