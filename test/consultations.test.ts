import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getExportPlanPath,
  getFinalistComparisonMarkdownPath,
  getPreflightReadinessPath,
  getProfileSelectionPath,
  getResearchBriefPath,
  getRunManifestPath,
  getWinnerSelectionPath,
} from "../src/core/paths.js";
import {
  buildSavedConsultationStatus,
  consultationResearchBriefSchema,
  type RunManifest,
} from "../src/domain/run.js";
import {
  buildVerdictReview,
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import { initializeProject } from "../src/services/project.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("consultation workflow summaries", () => {
  it("renders a richer consultation summary with entry paths and next steps", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Library scripts and package export signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
        signals: ["package-export", "lint-script"],
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getProfileSelectionPath(cwd, manifest.id), "{}\n", "utf8");
    await writeFile(getFinalistComparisonMarkdownPath(cwd, manifest.id), "# comparison\n", "utf8");
    await writeFile(getWinnerSelectionPath(cwd, manifest.id), "{}\n", "utf8");
    await writeFile(getExportPlanPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Opened: 2026-04-04T00:00:00.000Z");
    expect(summary).toContain("Outcome: recommended-survivor");
    expect(summary).toContain("Validation posture: sufficient");
    expect(summary).toContain("Verification level: lightweight");
    expect(summary).toContain("Entry paths:");
    expect(summary).toContain("- consultation root: .oraculum/runs/run_1");
    expect(summary).toContain(
      "- profile selection: .oraculum/runs/run_1/reports/profile-selection.json",
    );
    expect(summary).toContain("- comparison report: .oraculum/runs/run_1/reports/comparison.md");
    expect(summary).toContain(
      "- winner selection: .oraculum/runs/run_1/reports/winner-selection.json",
    );
    expect(summary).toContain("- crowning record: .oraculum/runs/run_1/reports/export-plan.json");
    expect(summary).toContain("Auto profile: library (high, llm-recommendation)");
    expect(summary).toContain("Recommended survivor: cand-01 (high, llm-judge)");
    expect(summary).toContain("Next:");
    expect(summary).toContain(
      "- reopen the crowning record: .oraculum/runs/run_1/reports/export-plan.json",
    );
    expect(summary).toContain("orc verdict archive");
    expect(summary).not.toContain("oraculum verdict");
  });

  it("renders pending consultations without completed artifacts", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("planned");
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Outcome: pending-execution");
    expect(summary).toContain("- comparison report: not available yet");
    expect(summary).toContain("- winner selection: not available yet");
    expect(summary).toContain("- crowning record: not created yet");
    expect(summary).toContain(`orc verdict ${manifest.id}`);
  });

  it("renders blocked preflight consultations with readiness guidance", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidateCount: 0,
      rounds: [],
      candidates: [],
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The target file and expected sections are unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which file should Oraculum update, and what sections are required?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getPreflightReadinessPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("Preflight: needs-clarification (medium, repo-only)");
    expect(summary).toContain("Verification level: none");
    expect(summary).toContain(
      "No candidates were generated because execution stopped at preflight.",
    );
    expect(summary).not.toContain("Candidate states:");
    expect(summary).toContain(
      "Clarification needed: Which file should Oraculum update, and what sections are required?",
    );
    expect(summary).toContain(
      "- preflight readiness: .oraculum/runs/run_1/reports/preflight-readiness.json",
    );
    expect(summary).toContain(
      "- answer the preflight clarification question, then rerun `orc consult`.",
    );
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "review-preflight-readiness",
      "answer-clarification-and-rerun",
    ]);
  });

  it("builds a machine-readable verdict review from saved consultation state", async () => {
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "frontend",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Frontend evidence is strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["build-impact"],
        missingCapabilities: ["No e2e or visual deep check was detected."],
        signals: ["frontend-framework", "build-script"],
      },
      preflight: {
        decision: "proceed",
        confidence: "high",
        summary: "Repository evidence is sufficient to execute immediately.",
        researchPosture: "repo-only",
      },
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
    });

    const review = buildVerdictReview(manifest, {
      preflightReadinessPath: "/tmp/run_1/reports/preflight-readiness.json",
      profileSelectionPath: "/tmp/run_1/reports/profile-selection.json",
      comparisonMarkdownPath: "/tmp/run_1/reports/comparison.md",
      winnerSelectionPath: "/tmp/run_1/reports/winner-selection.json",
    });

    expect(review).toEqual({
      outcomeType: "recommended-survivor",
      verificationLevel: "lightweight",
      validationPosture: "validation-gaps",
      judgingBasisKind: "repo-local-oracle",
      recommendedCandidateId: "cand-01",
      finalistIds: ["cand-01"],
      profileId: "frontend",
      profileMissingCapabilities: ["No e2e or visual deep check was detected."],
      preflightDecision: "proceed",
      researchPosture: "repo-only",
      artifactAvailability: {
        preflightReadiness: true,
        researchBrief: false,
        profileSelection: true,
        comparisonReport: true,
        winnerSelection: true,
        crowningRecord: false,
      },
      candidateStateCounts: {
        exported: 1,
      },
    });
  });

  it("renders blocked preflight consultations distinctly in the archive", async () => {
    const cwd = await createInitializedProject();
    const blocked = createManifest("completed", {
      id: "run_blocked",
      candidateCount: 0,
      rounds: [],
      candidates: [],
      preflight: {
        decision: "needs-clarification",
        confidence: "medium",
        summary: "The target file is unclear.",
        researchPosture: "repo-only",
        clarificationQuestion: "Which file should Oraculum update?",
      },
      outcome: {
        type: "needs-clarification",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "unknown",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, blocked);

    const manifests = await listRecentConsultations(cwd, 10);
    const archive = renderConsultationArchive(manifests);

    expect(archive).toContain(
      "- run_blocked | completed | Task | no auto profile | needs clarification",
    );
  });

  it("renders external research preflight artifacts and writes a structured research brief", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidateCount: 0,
      rounds: [],
      candidates: [],
      preflight: {
        decision: "external-research-required",
        confidence: "high",
        summary: "Current versioned API behavior must be verified against official documentation.",
        researchPosture: "external-research-required",
        researchQuestion:
          "What does the official API documentation say about the current versioned behavior?",
      },
      outcome: {
        type: "external-research-required",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "validation-gaps",
        verificationLevel: "none",
        missingCapabilityCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getPreflightReadinessPath(cwd, manifest.id), "{}\n", "utf8");
    await writeFile(
      getResearchBriefPath(cwd, manifest.id),
      `${JSON.stringify(
        consultationResearchBriefSchema.parse({
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary:
            "Current versioned API behavior must be verified against official documentation.",
          task: manifest.taskPacket,
          notes: ["Official docs are required before proceeding."],
          signalSummary: ["language:javascript"],
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);
    const review = buildVerdictReview(manifest, {
      preflightReadinessPath: getPreflightReadinessPath(cwd, manifest.id),
      researchBriefPath: getResearchBriefPath(cwd, manifest.id),
    });

    expect(summary).toContain("- research brief: .oraculum/runs/run_1/reports/research-brief.json");
    expect(summary).toContain(
      "Research needed: What does the official API documentation say about the current versioned behavior?",
    );
    expect(review.researchPosture).toBe("external-research-required");
    expect(review.researchQuestion).toBe(
      "What does the official API documentation say about the current versioned behavior?",
    );
    expect(review.artifactAvailability.researchBrief).toBe(true);
  });

  it("does not report a promotion record when only a stale export plan file exists", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);
    await writeFile(getExportPlanPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("- crowning record: not created yet");
    expect(summary).not.toContain("- reopen the crowning record:");
  });

  it("does not claim a profile-selection artifact when the file is missing", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Library scripts and package export signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "test-amplified"],
        oracleIds: ["lint-fast", "typecheck-fast"],
        missingCapabilities: [],
        signals: ["package-export", "lint-script"],
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("- profile selection: not available");
  });

  it("shows profile gaps in the consultation summary when deep validation is incomplete", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      rounds: [
        {
          id: "fast",
          label: "Fast",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "impact",
          label: "Impact",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "deep",
          label: "Deep",
          status: "completed",
          verdictCount: 1,
          survivorCount: 1,
          eliminatedCount: 0,
        },
      ],
      profileSelection: {
        profileId: "frontend",
        confidence: "medium",
        source: "fallback-detection",
        summary: "Frontend signals are strongest.",
        candidateCount: 4,
        strategyIds: ["minimal-change", "safety-first"],
        oracleIds: ["lint-fast", "typecheck-fast", "build-impact"],
        missingCapabilities: ["No e2e or visual deep check was detected."],
        signals: ["frontend-framework", "build-script"],
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(getProfileSelectionPath(cwd, manifest.id), "{}\n", "utf8");

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("Outcome: finalists-without-recommendation");
    expect(summary).toContain("Validation posture: validation-gaps");
    expect(summary).toContain("Verification level: standard");
    expect(summary).toContain("Profile gaps:");
    expect(summary).toContain("- No e2e or visual deep check was detected.");
    expect(status.verificationLevel).toBe("standard");
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
      "review-validation-gaps",
      "add-repo-local-oracle",
    ]);
  });

  it("shows skipped profile commands from the profile-selection artifact", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      profileSelection: {
        profileId: "generic",
        confidence: "low",
        source: "fallback-detection",
        summary: "No executable profile-specific command evidence was detected.",
        candidateCount: 3,
        strategyIds: ["minimal-change", "safety-first"],
        oracleIds: [],
        missingCapabilities: ["No repo-local validation command was detected."],
        signals: ["e2e-config"],
      },
    });
    await writeManifest(cwd, manifest);
    await writeFile(
      getProfileSelectionPath(cwd, manifest.id),
      `${JSON.stringify(
        {
          signals: {
            packageManager: "unknown",
            skippedCommandCandidates: [
              {
                id: "e2e-deep",
                label: "End-to-end or visual checks",
                capability: "e2e-or-visual",
                reason: "missing-explicit-command",
                detail:
                  "A test-runner capability was detected, but no repo-local e2e/smoke script or explicit oracle exposes the executable command.",
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Skipped profile commands:");
    expect(summary).toContain(
      "- e2e-deep: missing-explicit-command - A test-runner capability was detected",
    );
  });

  it("does not suggest manual promotion when no finalists survived", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("No survivor yet. Candidate states:");
    expect(summary).toContain(
      "- review why no candidate survived the oracle rounds: open the comparison report above.",
    );
    expect(summary).not.toContain("oraculum crown");
    expect(status.verificationLevel).toBe("lightweight");
    expect(status.nextActions).toEqual([
      "reopen-verdict",
      "browse-archive",
      "inspect-comparison-report",
      "rerun-with-different-candidate-count",
    ]);
  });

  it("lists recent consultations in descending order", async () => {
    const cwd = await createInitializedProject();
    const older = createManifest("completed", {
      id: "run_older",
      createdAt: "2026-04-03T00:00:00.000Z",
    });
    const newer = createManifest("planned", {
      id: "run_newer",
      createdAt: "2026-04-04T00:00:00.000Z",
    });
    await writeManifest(cwd, older);
    await writeManifest(cwd, newer);

    const manifests = await listRecentConsultations(cwd, 10);
    const archive = renderConsultationArchive(manifests);

    expect(manifests.map((manifest) => manifest.id)).toEqual(["run_newer", "run_older"]);
    expect(archive).toContain("Recent consultations:");
    expect(archive).toContain("- run_newer | planned | Task | no auto profile | pending execution");
    expect(archive).toContain(
      "- run_older | completed | Task | no auto profile | finalists without recommendation",
    );
    expect(archive).toContain("orc verdict run_newer");
  });

  it("renders distinct terminal archive summaries for finalists without recommendation and validation gaps", async () => {
    const cwd = await createInitializedProject();
    const finalists = createManifest("completed", {
      id: "run_finalists",
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace-a",
          taskPacketPath: "/tmp/task-packet-a.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    const validationGaps = createManifest("completed", {
      id: "run_gaps",
      candidates: [
        {
          id: "cand-02",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "eliminated",
          workspaceDir: "/tmp/workspace-b",
          taskPacketPath: "/tmp/task-packet-b.json",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
      profileSelection: {
        profileId: "frontend",
        confidence: "medium",
        source: "fallback-detection",
        summary: "Frontend signals are strongest.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: ["build-impact"],
        missingCapabilities: ["No e2e or visual deep check was detected."],
        signals: ["frontend-framework"],
      },
    });
    await writeManifest(cwd, finalists);
    await writeManifest(cwd, validationGaps);

    const archive = renderConsultationArchive(await listRecentConsultations(cwd, 10));

    expect(archive).toContain(
      "- run_finalists | completed | Task | no auto profile | finalists without recommendation",
    );
    expect(archive).toContain(
      "- run_gaps | completed | Task | profile frontend | completed with validation gaps",
    );
  });

  it("keeps legacy manifests without candidateCount visible in recent consultation listings", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      id: "run_legacy",
      createdAt: "2026-04-05T00:00:00.000Z",
    });
    const { candidateCount: _candidateCount, ...legacyManifest } = manifest;
    await writeRawManifest(cwd, manifest.id, legacyManifest);

    const manifests = await listRecentConsultations(cwd, 10);

    expect(manifests).toEqual([
      expect.objectContaining({
        id: "run_legacy",
        candidateCount: 1,
        updatedAt: "2026-04-05T00:00:00.000Z",
        outcome: expect.objectContaining({
          type: "finalists-without-recommendation",
          terminal: true,
          crownable: false,
        }),
      }),
    ]);
  });

  it("renders chat-native next steps with the orc prefix", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd, {
      surface: "chat-native",
    });
    const archive = renderConsultationArchive([manifest], {
      surface: "chat-native",
    });

    expect(summary).toContain("orc crown <branch-name>");
    expect(summary).toContain("orc verdict");
    expect(summary).toContain("orc verdict archive");
    expect(summary).not.toContain("oraculum crown");
    expect(archive).toContain(`orc verdict ${manifest.id}`);
    expect(archive).not.toContain("oraculum verdict");
  });

  it("renders bare crown guidance for non-git workspace-sync survivors", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
      candidates: [
        {
          id: "cand-01",
          strategyId: "minimal-change",
          strategyLabel: "Minimal Change",
          status: "promoted",
          workspaceDir: "/tmp/workspace",
          taskPacketPath: "/tmp/task-packet.json",
          workspaceMode: "copy",
          repairCount: 0,
          repairedRounds: [],
          createdAt: "2026-04-04T00:00:00.000Z",
        },
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd, {
      surface: "chat-native",
    });

    expect(summary).toContain("- crown the recommended survivor: orc crown");
    expect(summary).not.toContain("orc crown <branch-name>");
  });

  it("reports thorough verification when deep coverage completed without gaps", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      rounds: [
        {
          id: "fast",
          label: "Fast",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "impact",
          label: "Impact",
          status: "completed",
          verdictCount: 2,
          survivorCount: 1,
          eliminatedCount: 0,
        },
        {
          id: "deep",
          label: "Deep",
          status: "completed",
          verdictCount: 1,
          survivorCount: 1,
          eliminatedCount: 0,
        },
      ],
      profileSelection: {
        profileId: "library",
        confidence: "high",
        source: "llm-recommendation",
        summary: "Library validation coverage is explicit.",
        candidateCount: 1,
        strategyIds: ["minimal-change"],
        oracleIds: ["lint-fast", "unit-impact", "full-suite-deep"],
        missingCapabilities: [],
        signals: ["library"],
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);
    const status = buildSavedConsultationStatus(manifest);

    expect(summary).toContain("Verification level: thorough");
    expect(status.verificationLevel).toBe("thorough");
  });
});

async function createInitializedProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "oraculum-"));
  tempRoots.push(cwd);
  await initializeProject({ cwd, force: false });
  return cwd;
}

async function writeManifest(cwd: string, manifest: RunManifest): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", manifest.id), { recursive: true });
  await mkdir(join(cwd, ".oraculum", "runs", manifest.id, "reports"), { recursive: true });
  await writeFile(
    getRunManifestPath(cwd, manifest.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function writeRawManifest(cwd: string, runId: string, manifest: unknown): Promise<void> {
  await mkdir(join(cwd, ".oraculum", "runs", runId), { recursive: true });
  await mkdir(join(cwd, ".oraculum", "runs", runId, "reports"), { recursive: true });
  await writeFile(getRunManifestPath(cwd, runId), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function createManifest(
  status: "planned" | "completed",
  overrides: Partial<RunManifest> = {},
): RunManifest {
  return {
    id: "run_1",
    status,
    taskPath: "/tmp/task.md",
    taskPacket: {
      id: "task",
      title: "Task",
      sourceKind: "task-note",
      sourcePath: "/tmp/task.md",
    },
    agent: "codex",
    candidateCount: 1,
    createdAt: "2026-04-04T00:00:00.000Z",
    rounds: [
      {
        id: "fast",
        label: "Fast",
        status: status === "completed" ? "completed" : "pending",
        verdictCount: status === "completed" ? 1 : 0,
        survivorCount: status === "completed" ? 1 : 0,
        eliminatedCount: 0,
      },
    ],
    candidates: [
      {
        id: "cand-01",
        strategyId: "minimal-change",
        strategyLabel: "Minimal Change",
        status: status === "completed" ? "exported" : "planned",
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
        repairCount: 0,
        repairedRounds: [],
        createdAt: "2026-04-04T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}
