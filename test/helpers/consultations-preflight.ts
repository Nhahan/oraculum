import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentAdapter } from "../../src/adapters/types.js";
import { getClarifyFollowUpPath } from "../../src/core/paths.js";
import type { RunManifest } from "../../src/domain/run.js";
import { consultationClarifyFollowUpSchema } from "../../src/domain/run.js";
import { materializedTaskPacketSchema } from "../../src/domain/task.js";
import { recommendConsultationPreflight } from "../../src/services/consultation-preflight.js";
import { loadProjectConfigLayers } from "../../src/services/project.js";
import {
  createManifest,
  registerConsultationsTempRootCleanup,
  writeManifest,
  writePreflightReadinessArtifact,
} from "./consultations.js";

let registered = false;

export function registerConsultationsPreflightTempRootCleanup(): void {
  if (registered) {
    return;
  }

  registered = true;
  registerConsultationsTempRootCleanup();
}

type PressureContext = Parameters<AgentAdapter["recommendClarifyFollowUp"]>[0]["pressureContext"];

export function createCapturingClarifyPreflightAdapter(options: {
  clarificationQuestion?: string;
  keyQuestion: string;
  missingJudgingBasis: string;
  missingResultContract: string;
  preflightDecision?: "needs-clarification" | "external-research-required";
  preflightResearchPosture?: "repo-only" | "external-research-required";
  preflightSummary: string;
  researchQuestion?: string;
  summary: string;
}): {
  adapter: AgentAdapter;
  getClarifyCalls(): number;
  getPressureContext(): PressureContext | undefined;
} {
  let clarifyCalls = 0;
  let capturedPressureContext: PressureContext | undefined;

  const adapter: AgentAdapter = {
    name: "codex",
    async runCandidate() {
      throw new Error("not used");
    },
    async recommendWinner() {
      throw new Error("not used");
    },
    async recommendProfile() {
      throw new Error("not used");
    },
    async proposeCandidateSpec() {
      throw new Error("not used");
    },
    async selectCandidateSpec() {
      throw new Error("not used");
    },
    async recommendPreflight(request) {
      return {
        runId: request.runId,
        adapter: "codex",
        status: "completed",
        startedAt: "2026-04-14T00:00:00.000Z",
        completedAt: "2026-04-14T00:00:01.000Z",
        exitCode: 0,
        summary: options.preflightSummary,
        recommendation: {
          decision: options.preflightDecision ?? "needs-clarification",
          confidence: "medium",
          summary: options.preflightSummary,
          researchPosture: options.preflightResearchPosture ?? "repo-only",
          ...(options.clarificationQuestion
            ? { clarificationQuestion: options.clarificationQuestion }
            : {}),
          ...(options.researchQuestion ? { researchQuestion: options.researchQuestion } : {}),
        },
        artifacts: [],
      };
    },
    async recommendClarifyFollowUp(request) {
      clarifyCalls += 1;
      capturedPressureContext = request.pressureContext;
      return {
        runId: request.runId,
        adapter: "codex",
        status: "completed",
        startedAt: "2026-04-14T00:00:00.000Z",
        completedAt: "2026-04-14T00:00:01.000Z",
        exitCode: 0,
        summary: options.summary,
        recommendation: {
          summary: options.summary,
          keyQuestion: options.keyQuestion,
          missingResultContract: options.missingResultContract,
          missingJudgingBasis: options.missingJudgingBasis,
        },
        artifacts: [],
      };
    },
  };

  return {
    adapter,
    getClarifyCalls: () => clarifyCalls,
    getPressureContext: () => capturedPressureContext,
  };
}

export function createTimedOutPreflightAdapter(): AgentAdapter {
  return {
    name: "codex",
    async runCandidate() {
      throw new Error("not used");
    },
    async recommendWinner() {
      throw new Error("not used");
    },
    async recommendProfile() {
      throw new Error("not used");
    },
    async proposeCandidateSpec() {
      throw new Error("not used");
    },
    async selectCandidateSpec() {
      throw new Error("not used");
    },
    async recommendPreflight(request) {
      return {
        runId: request.runId,
        adapter: "codex",
        status: "timed-out",
        startedAt: "2026-04-15T00:00:00.000Z",
        completedAt: "2026-04-15T00:00:45.000Z",
        exitCode: 0,
        summary: "Timed out before returning structured output.",
        artifacts: [],
      };
    },
    async recommendClarifyFollowUp() {
      throw new Error("not used");
    },
  };
}

export function createBlockedPreflightManifest(
  runId: string,
  options: {
    artifactKind?: RunManifest["taskPacket"]["artifactKind"];
    originKind?: RunManifest["taskPacket"]["originKind"];
    originPath?: string;
    preflightDecision: "needs-clarification" | "external-research-required";
    preflightQuestion: string;
    preflightSummary: string;
    sourceKind?: RunManifest["taskPacket"]["sourceKind"];
    sourcePath: string;
    targetArtifactPath?: string;
  },
): RunManifest {
  return createManifest("completed", {
    id: runId,
    candidateCount: 0,
    rounds: [],
    candidates: [],
    taskPacket: {
      id: "task",
      title: "Task",
      sourceKind: options.sourceKind ?? "task-note",
      sourcePath: options.sourcePath,
      ...(options.originKind && options.originPath
        ? { originKind: options.originKind, originPath: options.originPath }
        : {}),
      ...(options.artifactKind ? { artifactKind: options.artifactKind } : {}),
      ...(options.targetArtifactPath ? { targetArtifactPath: options.targetArtifactPath } : {}),
    },
    preflight: {
      decision: options.preflightDecision,
      confidence: options.preflightDecision === "needs-clarification" ? "medium" : "high",
      summary: options.preflightSummary,
      researchPosture:
        options.preflightDecision === "needs-clarification"
          ? "repo-only"
          : "external-research-required",
      ...(options.preflightDecision === "needs-clarification"
        ? { clarificationQuestion: options.preflightQuestion }
        : { researchQuestion: options.preflightQuestion }),
    },
    outcome: {
      type:
        options.preflightDecision === "needs-clarification"
          ? "needs-clarification"
          : "external-research-required",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture:
        options.preflightDecision === "needs-clarification" ? "unknown" : "validation-gaps",
      verificationLevel: "none",
      missingCapabilityCount: 0,
      validationGapCount: 0,
      judgingBasisKind: "unknown",
    },
  });
}

export async function writeBlockedPreflightHistory(
  cwd: string,
  manifests: RunManifest[],
): Promise<void> {
  for (const manifest of manifests) {
    // eslint-disable-next-line no-await-in-loop
    await writeManifest(cwd, manifest);
    // eslint-disable-next-line no-await-in-loop
    await writePreflightReadinessArtifact(cwd, manifest.id);
  }
}

export async function writePreflightTaskPacket(options: {
  artifactKind?: "document";
  contents: string;
  cwd: string;
  id: string;
  intent: string;
  runId: string;
  sourcePath: string;
  targetArtifactPath?: string;
  title: string;
}): Promise<ReturnType<typeof materializedTaskPacketSchema.parse>> {
  const taskPacket = materializedTaskPacketSchema.parse({
    id: options.id,
    title: options.title,
    intent: options.intent,
    nonGoals: [],
    acceptanceCriteria: [],
    risks: [],
    oracleHints: [],
    strategyHints: [],
    contextFiles: [],
    ...(options.artifactKind ? { artifactKind: options.artifactKind } : {}),
    ...(options.targetArtifactPath ? { targetArtifactPath: options.targetArtifactPath } : {}),
    source: {
      kind: "task-note",
      path: options.sourcePath,
    },
  });
  await writeFile(taskPacket.source.path, options.contents, "utf8");
  return taskPacket;
}

export async function runConsultationPreflightScenario(options: {
  adapter: AgentAdapter;
  cwd: string;
  runId: string;
  taskPacket: ReturnType<typeof materializedTaskPacketSchema.parse>;
}): Promise<Awaited<ReturnType<typeof recommendConsultationPreflight>>> {
  return recommendConsultationPreflight({
    adapter: options.adapter,
    configLayers: await loadProjectConfigLayers(options.cwd),
    projectRoot: options.cwd,
    reportsDir: join(options.cwd, ".oraculum", "runs", options.runId, "reports"),
    runId: options.runId,
    taskPacket: options.taskPacket,
  });
}

export function createTargetArtifactBlockedPreflightManifest(
  cwd: string,
  runId: string,
  targetArtifactPath: string,
  options: {
    preflightDecision: "needs-clarification" | "external-research-required";
    preflightQuestion: string;
    preflightSummary: string;
  },
): RunManifest {
  return createBlockedPreflightManifest(runId, {
    artifactKind: "document",
    preflightDecision: options.preflightDecision,
    preflightQuestion: options.preflightQuestion,
    preflightSummary: options.preflightSummary,
    sourcePath: join(cwd, "task.md"),
    targetArtifactPath,
  });
}

export async function writeTargetArtifactTaskPacket(options: {
  contents: string;
  cwd: string;
  id: string;
  intent: string;
  runId: string;
  sourcePath?: string;
  targetArtifactPath: string;
  title: string;
}): Promise<ReturnType<typeof materializedTaskPacketSchema.parse>> {
  return writePreflightTaskPacket({
    artifactKind: "document",
    contents: options.contents,
    cwd: options.cwd,
    id: options.id,
    intent: options.intent,
    runId: options.runId,
    sourcePath: options.sourcePath ?? join(options.cwd, "task.md"),
    targetArtifactPath: options.targetArtifactPath,
    title: options.title,
  });
}

export async function readClarifyFollowUpArtifact(cwd: string, runId: string) {
  return consultationClarifyFollowUpSchema.parse(
    JSON.parse(await readFile(getClarifyFollowUpPath(cwd, runId), "utf8")) as unknown,
  );
}
