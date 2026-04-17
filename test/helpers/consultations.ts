import type { RunManifest } from "../../src/domain/run.js";
import { initializeProject } from "../../src/services/project.js";
import { createTempRootHarness } from "./fs.js";
import { normalizePathForAssertion } from "./platform.js";
import {
  createBlockedPreflightOutcomeFixture,
  createRecommendedSurvivorOutcomeFixture,
  createRunCandidateFixture,
  createRunManifestFixture,
  createRunRoundFixture,
  createTaskPacketFixture,
} from "./run-manifest.js";

export {
  writeClarifyFollowUp,
  writeComparisonReportJson,
  writeComparisonReportMarkdown,
  writeExportPlanArtifact,
  writeFailureAnalysis,
  writePreflightReadinessArtifact,
  writeProfileSelectionArtifact,
  writeRawRunManifest as writeRawManifest,
  writeRunManifest as writeManifest,
  writeSecondOpinionWinnerSelection,
  writeWinnerSelection,
} from "./run-artifacts.js";
export { createTaskPacketFixture } from "./run-manifest.js";

const tempRootHarness = createTempRootHarness("oraculum-");
type ProfileSelectionFixture = {
  profileId: NonNullable<RunManifest["profileSelection"]>["validationProfileId"];
  confidence: NonNullable<RunManifest["profileSelection"]>["confidence"];
  source: NonNullable<RunManifest["profileSelection"]>["source"];
  summary: string;
  candidateCount: number;
  strategyIds: string[];
  oracleIds: string[];
  missingCapabilities: string[];
  signals: string[];
  validationProfileId?: NonNullable<RunManifest["profileSelection"]>["validationProfileId"];
  validationSummary?: string;
  validationSignals?: string[];
  validationGaps?: string[];
};
type RecommendedManifestOverrides = Partial<
  Omit<RunManifest, "recommendedWinner" | "outcome" | "candidates" | "profileSelection">
> & {
  profileSelection?: ProfileSelectionFixture;
};
type ClarificationManifestOverrides = Partial<
  Omit<RunManifest, "preflight" | "outcome" | "candidates" | "rounds" | "profileSelection">
> & {
  profileSelection?: ProfileSelectionFixture;
};

export function registerConsultationsTempRootCleanup(): void {
  tempRootHarness.registerCleanup();
}

export function toExpectedDisplayPath(cwd: string, targetPath: string): string {
  const normalizedRoot = normalizePathForAssertion(cwd).replace(/\/+$/u, "");
  const normalizedTarget = normalizePathForAssertion(targetPath);
  if (normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return normalizedTarget.slice(normalizedRoot.length + 1);
  }
  return normalizedTarget;
}

export async function createInitializedProject(): Promise<string> {
  const cwd = await tempRootHarness.createTempRoot();
  await initializeProject({ cwd, force: false });
  return cwd;
}

export function createManifest(
  status: "planned" | "completed",
  overrides: Partial<Omit<RunManifest, "profileSelection">> & {
    profileSelection?: ProfileSelectionFixture;
  } = {},
): RunManifest {
  const { profileSelection: rawProfileSelection, ...restOverrides } = overrides;
  const profileSelection = rawProfileSelection
    ? {
        ...rawProfileSelection,
        validationProfileId:
          rawProfileSelection.validationProfileId ?? rawProfileSelection.profileId,
        validationSummary: rawProfileSelection.validationSummary ?? rawProfileSelection.summary,
        validationSignals: rawProfileSelection.validationSignals ?? rawProfileSelection.signals,
        validationGaps:
          rawProfileSelection.validationGaps ?? rawProfileSelection.missingCapabilities,
      }
    : undefined;

  return createRunManifestFixture({
    status,
    rounds: restOverrides.rounds ?? [
      createRunRoundFixture(status === "completed" ? "completed" : "pending"),
    ],
    candidates: restOverrides.candidates ?? [
      createRunCandidateFixture("cand-01", status === "completed" ? "exported" : "planned", {
        workspaceDir: "/tmp/workspace",
        taskPacketPath: "/tmp/task-packet.json",
      }),
    ],
    overrides: {
      taskPacket: createTaskPacketFixture(),
      ...restOverrides,
      ...(profileSelection ? { profileSelection } : {}),
    },
  });
}

export function createPromotedCandidate(
  candidateId = "cand-01",
  overrides: Partial<RunManifest["candidates"][number]> = {},
): RunManifest["candidates"][number] {
  return createRunCandidateFixture(candidateId, "promoted", {
    workspaceDir: "/tmp/workspace",
    taskPacketPath: "/tmp/task-packet.json",
    ...overrides,
  });
}

export function createExportedCandidate(
  candidateId = "cand-01",
  overrides: Partial<RunManifest["candidates"][number]> = {},
): RunManifest["candidates"][number] {
  return createRunCandidateFixture(candidateId, "exported", {
    workspaceDir: "/tmp/workspace",
    taskPacketPath: "/tmp/task-packet.json",
    ...overrides,
  });
}

export function createConsultationCandidate(
  candidateId: string,
  status: RunManifest["candidates"][number]["status"],
  overrides: Partial<RunManifest["candidates"][number]> = {},
): RunManifest["candidates"][number] {
  return createRunCandidateFixture(candidateId, status, {
    workspaceDir: "/tmp/workspace",
    taskPacketPath: "/tmp/task-packet.json",
    ...overrides,
  });
}

export function createRecommendedManifest(
  runId: string,
  options: {
    candidateId?: string;
    candidateStatus?: "promoted" | "exported";
    candidateOverrides?: Partial<RunManifest["candidates"][number]>;
    outcomeOverrides?: Partial<NonNullable<RunManifest["outcome"]>>;
    recommendedWinnerOverrides?: Partial<NonNullable<RunManifest["recommendedWinner"]>>;
    taskPacketOverrides?: Partial<RunManifest["taskPacket"]>;
    manifestOverrides?: RecommendedManifestOverrides;
  } = {},
): RunManifest {
  const candidateId = options.candidateId ?? "cand-01";
  const { profileSelection, ...restManifestOverrides } = options.manifestOverrides ?? {};
  const inferredValidationGapCount =
    options.outcomeOverrides?.validationGapCount ??
    profileSelection?.validationGaps?.length ??
    profileSelection?.missingCapabilities?.length ??
    0;
  const inferredValidationPosture =
    options.outcomeOverrides?.validationPosture ??
    (inferredValidationGapCount > 0 ? "validation-gaps" : "sufficient");
  const candidate =
    options.candidateStatus === "exported"
      ? createExportedCandidate(candidateId, options.candidateOverrides)
      : createPromotedCandidate(candidateId, options.candidateOverrides);

  return createManifest("completed", {
    id: runId,
    taskPacket: createTaskPacketFixture(options.taskPacketOverrides),
    recommendedWinner: {
      candidateId,
      confidence: "high",
      source: "llm-judge",
      summary: `${candidateId} is the recommended promotion.`,
      ...options.recommendedWinnerOverrides,
    },
    outcome: createRecommendedSurvivorOutcomeFixture({
      recommendedCandidateId: candidateId,
      judgingBasisKind: "repo-local-oracle",
      validationGapCount: inferredValidationGapCount,
      validationPosture: inferredValidationPosture,
      ...options.outcomeOverrides,
    }),
    candidates: [candidate],
    ...restManifestOverrides,
    ...(profileSelection ? { profileSelection } : {}),
  });
}

export function createClarificationManifest(
  runId: string,
  options: {
    taskPacketOverrides?: Partial<RunManifest["taskPacket"]>;
    preflightOverrides?: Partial<NonNullable<RunManifest["preflight"]>>;
    outcomeOverrides?: Partial<NonNullable<RunManifest["outcome"]>>;
    manifestOverrides?: ClarificationManifestOverrides;
  } = {},
): RunManifest {
  const { profileSelection, ...restManifestOverrides } = options.manifestOverrides ?? {};

  return createManifest("completed", {
    id: runId,
    candidateCount: 0,
    rounds: [],
    candidates: [],
    taskPacket: createTaskPacketFixture({
      artifactKind: "document",
      targetArtifactPath: "docs/PRD.md",
      ...options.taskPacketOverrides,
    }),
    preflight: {
      decision: "needs-clarification",
      confidence: "medium",
      summary: "The result contract is unclear.",
      researchPosture: "repo-only",
      clarificationQuestion: "Which sections must docs/PRD.md contain?",
      ...options.preflightOverrides,
    },
    outcome: createBlockedPreflightOutcomeFixture(options.outcomeOverrides),
    ...restManifestOverrides,
    ...(profileSelection ? { profileSelection } : {}),
  });
}
