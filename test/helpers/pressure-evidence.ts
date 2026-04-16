import type { RunManifest } from "../../src/domain/run.js";
import { initializeProject } from "../../src/services/project.js";
import { createTempRootHarness } from "./fs.js";
import {
  createBlockedPreflightOutcomeFixture,
  createRecommendedSurvivorOutcomeFixture,
  createRunCandidateFixture,
  createRunManifestFixture,
  createTaskPacketFixture,
} from "./run-manifest.js";

export {
  writeAbstainingWinnerSelection,
  writeClarifyFollowUp,
  writeClarifyPreflightArtifact,
  writeComparisonArtifacts,
  writeComparisonReportJson,
  writeComparisonReportMarkdown,
  writeDisagreeingSecondOpinionSelection,
  writeExternalResearchPreflightArtifact,
  writeFailureAnalysis,
  writePreflightReadinessArtifact,
  writeRunManifest as writeManifest,
  writeSecondOpinionWinnerSelection,
  writeSelectedWinnerSelection,
  writeUnavailableSecondOpinionSelection,
  writeWinnerSelection,
} from "./run-artifacts.js";

const tempRootHarness = createTempRootHarness("oraculum-pressure-evidence-");

export function registerPressureEvidenceTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export async function createInitializedProject(): Promise<string> {
  const cwd = await tempRootHarness.createTempRoot();
  await initializeProject({ cwd, force: false });
  return cwd;
}

export function createManifest(runId: string, overrides: Partial<RunManifest> = {}): RunManifest {
  return createRunManifestFixture({
    runId,
    status: "completed",
    candidates: overrides.candidates ?? [createCandidate("cand-01", "exported")],
    overrides: {
      outcome: createRecommendedSurvivorOutcomeFixture(),
      ...overrides,
    },
  });
}

export function createCandidate(
  candidateId: string,
  status: RunManifest["candidates"][number]["status"],
  overrides: Partial<RunManifest["candidates"][number]> = {},
): RunManifest["candidates"][number] {
  return createRunCandidateFixture(candidateId, status, overrides);
}

export function createClarifyPressureManifest(
  runId: string,
  options: {
    createdAt?: string;
    agent?: RunManifest["agent"];
    documentDefaults?: boolean;
    taskPacketOverrides?: Partial<RunManifest["taskPacket"]>;
    preflightOverrides?: Partial<NonNullable<RunManifest["preflight"]>>;
    outcomeOverrides?: Partial<NonNullable<RunManifest["outcome"]>>;
    manifestOverrides?: Partial<
      Omit<RunManifest, "taskPacket" | "preflight" | "outcome" | "candidates" | "rounds">
    >;
  } = {},
): RunManifest {
  const taskPacketDefaults =
    options.documentDefaults === false
      ? {}
      : {
          artifactKind: "document" as const,
          targetArtifactPath: "docs/SESSION_PLAN.md",
        };

  return createManifest(runId, {
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    candidateCount: 0,
    rounds: [],
    candidates: [],
    taskPacket: createTaskPacketFixture({
      ...taskPacketDefaults,
      ...options.taskPacketOverrides,
    }),
    preflight: {
      decision: "needs-clarification",
      confidence: "medium",
      summary: "The target sections are unclear.",
      researchPosture: "repo-only",
      clarificationQuestion: "Which sections are required in the session plan?",
      ...options.preflightOverrides,
    },
    outcome: createBlockedPreflightOutcomeFixture(options.outcomeOverrides),
    ...options.manifestOverrides,
  });
}

export function createExternalResearchPressureManifest(
  runId: string,
  options: {
    createdAt?: string;
    agent?: RunManifest["agent"];
    documentDefaults?: boolean;
    taskPacketOverrides?: Partial<RunManifest["taskPacket"]>;
    preflightOverrides?: Partial<NonNullable<RunManifest["preflight"]>>;
    outcomeOverrides?: Partial<NonNullable<RunManifest["outcome"]>>;
    manifestOverrides?: Partial<
      Omit<RunManifest, "taskPacket" | "preflight" | "outcome" | "candidates" | "rounds">
    >;
  } = {},
): RunManifest {
  const taskPacketDefaults =
    options.documentDefaults === false
      ? {}
      : {
          artifactKind: "document" as const,
          targetArtifactPath: "docs/SESSION_PLAN.md",
        };

  return createManifest(runId, {
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    candidateCount: 0,
    rounds: [],
    candidates: [],
    taskPacket: createTaskPacketFixture({
      ...taskPacketDefaults,
      ...options.taskPacketOverrides,
    }),
    preflight: {
      decision: "external-research-required",
      confidence: "high",
      summary: "Official external guidance is still required.",
      researchPosture: "external-research-required",
      researchQuestion: "Which official guidance should this task rely on?",
      ...options.preflightOverrides,
    },
    outcome: {
      type: "external-research-required",
      terminal: true,
      crownable: false,
      finalistCount: 0,
      validationPosture: "validation-gaps",
      verificationLevel: "none",
      validationGapCount: 0,
      judgingBasisKind: "missing-capability",
      ...options.outcomeOverrides,
    },
    ...options.manifestOverrides,
  });
}

export function createRecommendedPressureManifest(
  runId: string,
  options: {
    createdAt?: string;
    agent?: RunManifest["agent"];
    candidateId?: string;
    candidateStatus?: "promoted" | "exported";
    candidateOverrides?: Partial<RunManifest["candidates"][number]>;
    taskPacketOverrides?: Partial<RunManifest["taskPacket"]>;
    recommendedWinnerOverrides?: Partial<NonNullable<RunManifest["recommendedWinner"]>>;
    outcomeOverrides?: Partial<NonNullable<RunManifest["outcome"]>>;
    manifestOverrides?: Partial<
      Omit<RunManifest, "taskPacket" | "recommendedWinner" | "outcome" | "candidates">
    >;
  } = {},
): RunManifest {
  const candidateId = options.candidateId ?? "cand-01";
  const candidateStatus = options.candidateStatus ?? "promoted";

  return createManifest(runId, {
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    taskPacket: createTaskPacketFixture({
      artifactKind: "document",
      targetArtifactPath: "docs/RELEASE_PLAN.md",
      ...options.taskPacketOverrides,
    }),
    candidates: [createCandidate(candidateId, candidateStatus, options.candidateOverrides ?? {})],
    recommendedWinner: {
      candidateId,
      confidence: "high",
      source: "llm-judge",
      summary: `${candidateId} is the recommended survivor.`,
      ...options.recommendedWinnerOverrides,
    },
    outcome: createRecommendedSurvivorOutcomeFixture({
      recommendedCandidateId: candidateId,
      verificationLevel: "standard",
      judgingBasisKind: "repo-local-oracle",
      ...options.outcomeOverrides,
    }),
    ...options.manifestOverrides,
  });
}

export function createFinalistsPressureManifest(
  runId: string,
  options: {
    createdAt?: string;
    agent?: RunManifest["agent"];
    taskPacketOverrides?: Partial<RunManifest["taskPacket"]>;
    candidates?: RunManifest["candidates"];
    outcomeOverrides?: Partial<NonNullable<RunManifest["outcome"]>>;
    manifestOverrides?: Partial<Omit<RunManifest, "taskPacket" | "outcome" | "candidates">>;
  } = {},
): RunManifest {
  const candidates = options.candidates ?? [
    createCandidate("cand-01", "promoted"),
    createCandidate("cand-02", "promoted"),
  ];

  return createManifest(runId, {
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    taskPacket: createTaskPacketFixture({
      artifactKind: "document",
      targetArtifactPath: "docs/RELEASE_PLAN.md",
      ...options.taskPacketOverrides,
    }),
    candidateCount: candidates.length,
    candidates,
    outcome: {
      type: "finalists-without-recommendation",
      terminal: true,
      crownable: false,
      finalistCount: candidates.length,
      validationPosture: "sufficient",
      verificationLevel: "standard",
      validationGapCount: 0,
      judgingBasisKind: "repo-local-oracle",
      ...options.outcomeOverrides,
    },
    ...options.manifestOverrides,
  });
}
