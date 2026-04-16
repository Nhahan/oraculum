import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { getRunManifestPath } from "../src/core/paths.js";
import { readRunManifest } from "../src/services/runs.js";
import { createInitializedProject, registerProjectTempRootCleanup } from "./helpers/project.js";

registerProjectTempRootCleanup();

describe("project legacy manifests", () => {
  it("reads legacy run manifests that do not record candidateCount", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_legacy_manifest";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "planned",
          taskPath: join(cwd, "tasks", "legacy-task.md"),
          taskPacket: {
            id: "task_legacy",
            title: "Legacy task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "legacy-task.md"),
          },
          agent: "codex",
          createdAt,
          rounds: [
            {
              id: "fast",
              label: "Fast",
              status: "pending",
              verdictCount: 0,
              survivorCount: 0,
              eliminatedCount: 0,
            },
          ],
          candidates: [
            {
              id: "cand-01",
              strategyId: "minimal-change",
              strategyLabel: "Minimal Change",
              status: "planned",
              workspaceDir: join(cwd, ".oraculum", "workspaces", runId, "cand-01"),
              taskPacketPath: join(
                cwd,
                ".oraculum",
                "runs",
                runId,
                "candidates",
                "cand-01",
                "task-packet.json",
              ),
              createdAt,
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await readRunManifest(cwd, runId);

    expect(manifest.candidateCount).toBe(1);
    expect(manifest.candidates).toHaveLength(1);
    expect(manifest.updatedAt).toBe(createdAt);
    expect(manifest.outcome).toMatchObject({
      type: "pending-execution",
      terminal: false,
      crownable: false,
    });
  });

  it("reads blocked preflight manifests without planned candidates", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_blocked_preflight";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "blocked-task.md"),
          taskPacket: {
            id: "task_blocked",
            title: "Blocked task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "blocked-task.md"),
          },
          agent: "codex",
          candidateCount: 0,
          createdAt,
          updatedAt: createdAt,
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
            validationGapCount: 0,
            judgingBasisKind: "unknown",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await readRunManifest(cwd, runId);

    expect(manifest.candidateCount).toBe(0);
    expect(manifest.candidates).toEqual([]);
    expect(manifest.preflight).toEqual({
      decision: "needs-clarification",
      confidence: "medium",
      summary: "The target file is unclear.",
      researchPosture: "repo-only",
      clarificationQuestion: "Which file should Oraculum update?",
    });
    expect(manifest.outcome).toMatchObject({
      type: "needs-clarification",
      terminal: true,
      crownable: false,
      verificationLevel: "none",
    });
  });

  it("reconstructs blocked preflight outcomes when legacy manifests only persisted preflight", async () => {
    const cwd = await createInitializedProject();
    const runId = "run_blocked_preflight_legacy";
    const createdAt = "2026-04-06T00:00:00.000Z";
    await mkdir(dirname(getRunManifestPath(cwd, runId)), { recursive: true });

    await writeFile(
      getRunManifestPath(cwd, runId),
      `${JSON.stringify(
        {
          id: runId,
          status: "completed",
          taskPath: join(cwd, "tasks", "blocked-task.md"),
          taskPacket: {
            id: "task_blocked",
            title: "Blocked task",
            sourceKind: "task-note",
            sourcePath: join(cwd, "tasks", "blocked-task.md"),
          },
          agent: "codex",
          candidateCount: 0,
          createdAt,
          updatedAt: createdAt,
          rounds: [],
          candidates: [],
          preflight: {
            decision: "external-research-required",
            confidence: "high",
            summary: "Official docs are required before execution.",
            researchPosture: "external-research-required",
            researchQuestion:
              "What does the official API documentation say about the current behavior?",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const manifest = await readRunManifest(cwd, runId);

    expect(manifest.preflight).toMatchObject({
      decision: "external-research-required",
      confidence: "high",
    });
    expect(manifest.outcome).toMatchObject({
      type: "external-research-required",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "validation-gaps",
      validationGapCount: 0,
      verificationLevel: "none",
    });
  });
});
