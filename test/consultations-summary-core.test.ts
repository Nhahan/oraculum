import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderConsultationSummary } from "../src/services/consultations.js";
import {
  createConsultationCandidate,
  createInitializedProject,
  createManifest,
  createTaskPacketFixture,
  registerConsultationsTempRootCleanup,
  writeManifest,
} from "./helpers/consultations.js";

registerConsultationsTempRootCleanup();

describe("consultation summary core rendering", () => {
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

  it("renders outcome-only recommended survivor manifests", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      recommendedWinner: undefined,
      outcome: {
        type: "recommended-survivor",
        terminal: true,
        crownable: true,
        finalistCount: 1,
        recommendedCandidateId: "cand-01",
        validationPosture: "sufficient",
        verificationLevel: "lightweight",
        validationGapCount: 0,
        judgingBasisKind: "unknown",
      },
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Outcome: recommended-survivor");
    expect(summary).toContain("Recommended survivor: cand-01");
    expect(summary).toContain("- crown the recommended survivor: orc crown");
  });

  it("renders artifact-aware recommendation and crown guidance when the task targets a repo artifact", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      taskPacket: createTaskPacketFixture({
        artifactKind: "document",
        targetArtifactPath: "docs/SESSION_PLAN.md",
      }),
      recommendedWinner: {
        candidateId: "cand-01",
        confidence: "high",
        source: "llm-judge",
        summary: "cand-01 is the recommended promotion.",
      },
      candidates: [
        createConsultationCandidate("cand-01", "promoted", {
          workspaceMode: "copy",
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain(
      "Recommended document result for docs/SESSION_PLAN.md: cand-01 (high, llm-judge)",
    );
    expect(summary).toContain(
      "- crown the recommended document result for docs/SESSION_PLAN.md: orc crown",
    );
    expect(summary).not.toContain("- crown the recommended survivor: orc crown");
  });

  it("renders summary header fields in a stable order when origin and artifact metadata are both present", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      taskPacket: createTaskPacketFixture({
        sourceKind: "task-note",
        sourcePath: join(cwd, "tasks", "task.md"),
        originKind: "task-note",
        originPath: join(cwd, "notes", "seed.md"),
        artifactKind: "document",
        targetArtifactPath: join(cwd, "docs", "SESSION_PLAN.md"),
      }),
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("Task source: task-note (tasks/task.md)");
    expect(summary).toContain("Task origin: task-note (notes/seed.md)");
    expect(summary).toContain("Artifact kind: document");
    expect(summary).toContain("Target artifact: docs/SESSION_PLAN.md");
    expect(summary.indexOf("Task source: task-note (tasks/task.md)")).toBeLessThan(
      summary.indexOf("Task origin: task-note (notes/seed.md)"),
    );
    expect(summary.indexOf("Task origin: task-note (notes/seed.md)")).toBeLessThan(
      summary.indexOf("Artifact kind: document"),
    );
    expect(summary.indexOf("Artifact kind: document")).toBeLessThan(
      summary.indexOf("Target artifact: docs/SESSION_PLAN.md"),
    );
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

    expect(summary).toContain("orc crown");
    expect(summary).toContain("orc verdict");
    expect(summary).not.toContain("oraculum crown");
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
        createConsultationCandidate("cand-01", "promoted", {
          workspaceMode: "copy",
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd, {
      surface: "chat-native",
    });

    expect(summary).toContain("- crown the recommended survivor: orc crown");
    expect(summary).not.toContain("orc crown <branch-name>");
  });

  it("does not suggest manual promotion when no finalists survived", async () => {
    const cwd = await createInitializedProject();
    const manifest = createManifest("completed", {
      candidates: [
        createConsultationCandidate("cand-01", "eliminated", {
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
      ],
    });
    await writeManifest(cwd, manifest);

    const summary = await renderConsultationSummary(manifest, cwd);

    expect(summary).toContain("No survivor yet. Candidate states:");
    expect(summary).toContain("- review why no candidate survived the oracle rounds.");
    expect(summary).not.toContain("oraculum crown");
  });
});
