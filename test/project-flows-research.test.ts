import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { getPreflightReadinessPath, getResearchBriefPath } from "../src/core/paths.js";
import { consultationResearchBriefSchema } from "../src/domain/run.js";
import { deriveResearchSignalFingerprint } from "../src/domain/task.js";
import { planRun } from "../src/services/runs.js";
import { FAKE_AGENT_TIMEOUT_MS } from "./helpers/integration.js";
import {
  createInitializedProject,
  createStaticOutputCodexBinary,
  registerProjectFlowsTempRootCleanup,
  writeProjectFlowFile,
} from "./helpers/project-flows.js";

registerProjectFlowsTempRootCleanup();

describe("project flows research", () => {
  it("writes a research brief artifact when preflight requires external research", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
    const fakeCodex = await createStaticOutputCodexBinary(
      cwd,
      '{"decision":"external-research-required","confidence":"high","summary":"Official versioned API docs are required before execution.","researchPosture":"external-research-required","researchQuestion":"What does the official API documentation say about the current versioned behavior?"}',
    );

    const manifest = await planRun({
      cwd,
      taskInput: "tasks/fix-session-loss.md",
      agent: "codex",
      preflight: {
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    expect(manifest.preflight?.decision).toBe("external-research-required");
    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(await readFile(getResearchBriefPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(researchBrief).toMatchObject({
      decision: "external-research-required",
      confidence: "high",
      researchPosture: "external-research-required",
      question:
        "What does the official API documentation say about the current versioned behavior?",
      task: manifest.taskPacket,
    });
    expect(researchBrief.sources).toEqual([]);
    expect(researchBrief.claims).toEqual([]);
    expect(researchBrief.versionNotes).toEqual([]);
    expect(researchBrief.unresolvedConflicts).toEqual([]);
    expect(researchBrief.conflictHandling).toBe("accepted");
    expect(researchBrief.signalSummary.length).toBeGreaterThan(0);
    expect(researchBrief.signalFingerprint).toBe(
      deriveResearchSignalFingerprint(researchBrief.signalSummary),
    );
  });

  it("accepts a persisted research brief as the next task input", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
            artifactKind: "document",
            targetArtifactPath: "docs/SESSION_PLAN.md",
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
          signalFingerprint: deriveResearchSignalFingerprint([
            "Detected explicit lint and test scripts.",
          ]),
          conflictHandling: "accepted",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
    });

    expect(manifest.taskPath).toBe(getResearchBriefPath(cwd, "run_research"));
    expect(manifest.taskPacket).toMatchObject({
      id: "fix-session-loss",
      title: "fix session loss",
      sourceKind: "research-brief",
      sourcePath: getResearchBriefPath(cwd, "run_research"),
      artifactKind: "document",
      targetArtifactPath: "docs/SESSION_PLAN.md",
      researchContext: {
        question:
          "What does the official API documentation say about the current versioned behavior?",
        summary: "Review the official versioned API docs before execution.",
        conflictHandling: "accepted",
        signalSummary: ["Detected explicit lint and test scripts."],
        signalFingerprint: deriveResearchSignalFingerprint([
          "Detected explicit lint and test scripts.",
        ]),
        sources: [],
        claims: [],
        versionNotes: [],
        unresolvedConflicts: [],
      },
      originKind: "task-note",
      originPath: join(cwd, "tasks", "fix-session-loss.md"),
    });
  });

  it("uses repo-plus-external-docs fallback posture while failing closed for a persisted research brief without runtime", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
          conflictHandling: "accepted",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.preflight).toMatchObject({
      decision: "needs-clarification",
      confidence: "low",
      researchPosture: "repo-plus-external-docs",
      clarificationQuestion:
        "What exact outcome should Oraculum produce so the tournament can judge success?",
    });
    expect(manifest.preflight?.summary).toContain(
      "Candidate generation is blocked until the operator confirms the task contract.",
    );
  });

  it("rejects persisted research briefs whose conflict handling disagrees with unresolved conflicts", () => {
    expect(() =>
      consultationResearchBriefSchema.parse({
        runId: "run_invalid_conflict_handling",
        decision: "external-research-required",
        question: "What does the official API documentation say?",
        confidence: "medium",
        researchPosture: "repo-plus-external-docs",
        summary: "Review the official versioned API docs before execution.",
        task: {
          id: "task",
          title: "Task",
          sourceKind: "task-note",
          sourcePath: "/tmp/task.md",
        },
        sources: [],
        claims: [],
        versionNotes: [],
        unresolvedConflicts: ["The repo comments still describe the pre-v3.2 refresh flow."],
        conflictHandling: "accepted",
        notes: [],
        signalSummary: [],
      }),
    ).toThrow(
      "conflictHandling must match unresolvedConflicts: use manual-review-required when conflicts exist, otherwise accepted.",
    );
  });

  it("records research basis drift when a persisted research brief carries a stale fingerprint", async () => {
    const cwd = await createInitializedProject();
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official versioned API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "fix-session-loss.md"),
          },
          signalSummary: ["language:typescript"],
          signalFingerprint: "stale-fingerprint",
          notes: ["Prefer official docs."],
          conflictHandling: "accepted",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      candidates: 1,
      preflight: {
        allowRuntime: false,
      },
    });

    expect(manifest.preflight?.decision).toBe("needs-clarification");
    expect(manifest.preflight?.researchBasisDrift).toBe(true);
    const readiness = JSON.parse(
      await readFile(getPreflightReadinessPath(cwd, manifest.id), "utf8"),
    ) as {
      researchBasis?: {
        status?: string;
        refreshAction?: string;
      };
    };
    expect(readiness.researchBasis?.status).toBe("stale");
    expect(readiness.researchBasis?.refreshAction).toBe("refresh-before-rerun");
  });

  it("preserves the original task provenance when a reused research brief still needs external research", async () => {
    const cwd = await createInitializedProject();
    const originalTaskPath = join(cwd, "tasks", "fix-session-loss.md");
    await writeProjectFlowFile(cwd, "tasks/fix-session-loss.md", "# fix session loss\n");
    await mkdir(dirname(getResearchBriefPath(cwd, "run_research")), { recursive: true });
    await writeFile(
      getResearchBriefPath(cwd, "run_research"),
      `${JSON.stringify(
        {
          runId: "run_research",
          decision: "external-research-required",
          question:
            "What does the official API documentation say about the current versioned behavior?",
          researchPosture: "external-research-required",
          summary: "Review the official API docs before execution.",
          task: {
            id: "fix-session-loss",
            title: "fix session loss",
            sourceKind: "task-note",
            sourcePath: originalTaskPath,
          },
          notes: ["Prefer official docs."],
          signalSummary: ["Detected explicit lint and test scripts."],
          conflictHandling: "accepted",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const fakeCodex = await createStaticOutputCodexBinary(
      cwd,
      '{"decision":"external-research-required","confidence":"high","summary":"More official API documentation is required before execution.","researchPosture":"external-research-required","researchQuestion":"What does the official API documentation say about the newly surfaced edge case?"}',
    );

    const manifest = await planRun({
      cwd,
      taskInput: ".oraculum/runs/run_research/reports/research-brief.json",
      agent: "codex",
      preflight: {
        codexBinaryPath: fakeCodex,
        timeoutMs: FAKE_AGENT_TIMEOUT_MS,
      },
    });

    const researchBrief = consultationResearchBriefSchema.parse(
      JSON.parse(await readFile(getResearchBriefPath(cwd, manifest.id), "utf8")) as unknown,
    );
    expect(researchBrief.task).toMatchObject({
      id: "fix-session-loss",
      title: "fix session loss",
      sourceKind: "task-note",
      sourcePath: originalTaskPath,
    });
  });
});
