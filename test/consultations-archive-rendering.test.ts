import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listRecentConsultations,
  renderConsultationArchive,
  renderConsultationSummary,
} from "../src/services/consultations.js";
import {
  createConsultationCandidate,
  createInitializedProject,
  createManifest,
  createTaskPacketFixture,
  registerConsultationsTempRootCleanup,
  writeManifest,
  writeRawManifest,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation archive rendering", () => {
  it("normalizes absolute artifact target paths in archive output when the project root is known", async () => {
    const cwd = await createInitializedProject();
    const absoluteTargetArtifactPath = join(cwd, "docs", "SESSION_PLAN.md");
    const manifest = createManifest("completed", {
      taskPacket: createTaskPacketFixture({
        sourcePath: join(cwd, "task.md"),
        artifactKind: "document",
        targetArtifactPath: absoluteTargetArtifactPath,
      }),
      outcome: {
        type: "no-survivors",
        terminal: true,
        crownable: false,
        finalistCount: 0,
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        missingCapabilityCount: 0,
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
      candidates: [
        createConsultationCandidate("cand-01", "eliminated", {
          workspaceDir: join(cwd, "workspace", "cand-01"),
          taskPacketPath: join(cwd, "task-packet.json"),
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
      ],
    });

    const summary = await renderConsultationSummary(manifest, cwd);
    const archive = renderConsultationArchive([manifest], { projectRoot: cwd });

    expect(summary).toContain(
      "No recommended document result for docs/SESSION_PLAN.md yet. Candidate states:",
    );
    expect(archive).toContain("artifact document @ docs/SESSION_PLAN.md");
    expect(archive).toContain("no recommended document result for docs/SESSION_PLAN.md yet");
    expect(archive).not.toContain(absoluteTargetArtifactPath);
  });

  it("renders artifact metadata in archive entries when the task packet carries it", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("planned", {
      id: "run_artifact",
      taskPacket: createTaskPacketFixture({
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      }),
    });
    await writeManifest(cwd, manifest);

    const archive = renderConsultationArchive(await listRecentConsultations(cwd, 10));

    expect(archive).toContain(
      "- run_artifact | planned | Task | artifact document @ docs/SESSION_PLAN.md | no auto validation posture | pending execution",
    );
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
    expect(archive).toContain(
      "- run_newer | planned | Task | no auto validation posture | pending execution",
    );
    expect(archive).toContain(
      "- run_older | completed | Task | no auto validation posture | finalists without recommendation",
    );
    expect(archive).toContain("orc verdict run_newer");
  });

  it("renders distinct terminal archive summaries for finalists without recommendation and validation gaps", async () => {
    const cwd = await createInitializedProject();
    const finalists = createManifest("completed", {
      id: "run_finalists",
      candidates: [
        createConsultationCandidate("cand-01", "promoted", {
          workspaceDir: "/tmp/workspace-a",
          taskPacketPath: "/tmp/task-packet-a.json",
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
      ],
    });
    const validationGaps = createManifest("completed", {
      id: "run_gaps",
      candidates: [
        createConsultationCandidate("cand-02", "eliminated", {
          workspaceDir: "/tmp/workspace-b",
          taskPacketPath: "/tmp/task-packet-b.json",
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
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
      "- run_finalists | completed | Task | no auto validation posture | finalists without recommendation",
    );
    expect(archive).toContain(
      "- run_gaps | completed | Task | validation posture frontend | completed with validation gaps",
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

  it("renders archive output with the orc prefix for chat-native surfaces", async () => {
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

    const archive = renderConsultationArchive([manifest], {
      surface: "chat-native",
    });

    expect(archive).toContain(`orc verdict ${manifest.id}`);
    expect(archive).not.toContain("oraculum verdict");
  });
});
