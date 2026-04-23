import type { AgentAdapter } from "../../adapters/types.js";
import { getValidationGaps } from "../../domain/profile.js";
import {
  type CandidateSpecArtifact,
  type CandidateSpecSelectionArtifact,
  type ConsultationPlanArtifact,
  candidateManifestSchema,
  candidateSpecArtifactSchema,
  candidateSpecSelectionArtifactSchema,
  type RunManifest,
} from "../../domain/run.js";
import { writeCandidateManifest, writeRunManifest } from "../execution/persistence.js";
import type { RunStore } from "../run-store.js";

interface PrepareSpecSearchOptions {
  adapter: AgentAdapter;
  consultationPlan?: ConsultationPlanArtifact;
  manifest: RunManifest;
  projectRoot: string;
  store: RunStore;
}

export interface SpecSearchPlan {
  backupCandidateIds: string[];
  implementationCandidateIds: string[];
  manifest: RunManifest;
  selectionArtifact?: CandidateSpecSelectionArtifact;
}

export async function prepareSpecSearch(
  options: PrepareSpecSearchOptions,
): Promise<SpecSearchPlan> {
  if (options.manifest.candidateCount <= 1) {
    const manifest = await writeRunManifest(options.store, {
      ...options.manifest,
      searchStrategy: "patch-tournament",
    });
    return {
      backupCandidateIds: [],
      implementationCandidateIds: manifest.candidates.map((candidate) => candidate.id),
      manifest,
    };
  }

  try {
    const specs = await proposeCandidateSpecs(options);
    return await selectCandidateSpecs({
      ...options,
      specs,
    });
  } catch (error) {
    const fallbackManifest = await persistPatchTournamentFallback(options, error);
    return {
      backupCandidateIds: [],
      implementationCandidateIds: fallbackManifest.candidates.map((candidate) => candidate.id),
      manifest: fallbackManifest,
    };
  }
}

export async function markBackupSpecSelected(options: {
  candidateId: string;
  manifest: RunManifest;
  reason: string;
  store: RunStore;
}): Promise<RunManifest> {
  const candidates = options.manifest.candidates.map((candidate) =>
    candidate.id === options.candidateId
      ? candidateManifestSchema.parse({
          ...candidate,
          specSelected: true,
          specSelectionReason: options.reason,
        })
      : candidate,
  );

  for (const candidate of candidates) {
    if (candidate.id === options.candidateId) {
      await writeCandidateManifest(options.store, options.manifest.id, candidate);
    }
  }

  return {
    ...options.manifest,
    candidates,
  };
}

export async function finalizeUnimplementedSpecCandidates(options: {
  manifest: RunManifest;
  store: RunStore;
}): Promise<RunManifest> {
  if (options.manifest.searchStrategy !== "spec-first") {
    return options.manifest;
  }

  const candidates = options.manifest.candidates.map((candidate) => {
    if (candidate.status !== "planned" || !candidate.specPath) {
      return candidate;
    }

    return candidateManifestSchema.parse({
      ...candidate,
      status: "eliminated",
      specSelected: false,
      specSelectionReason:
        candidate.specSelectionReason ??
        "Spec was retained as backup but no implementation was needed.",
    });
  });

  await Promise.all(
    candidates
      .filter((candidate, index) => candidate !== options.manifest.candidates[index])
      .map((candidate) => writeCandidateManifest(options.store, options.manifest.id, candidate)),
  );

  return {
    ...options.manifest,
    candidates,
  };
}

async function proposeCandidateSpecs(
  options: PrepareSpecSearchOptions,
): Promise<CandidateSpecArtifact[]> {
  const specs: CandidateSpecArtifact[] = [];

  for (const candidate of options.manifest.candidates) {
    const candidatePaths = options.store.getCandidatePaths(options.manifest.id, candidate.id);
    const taskPacket = await options.store.readCandidateTaskPacket(
      options.manifest.id,
      candidate.id,
    );
    const result = await options.adapter.proposeCandidateSpec({
      runId: options.manifest.id,
      candidateId: candidate.id,
      strategyId: candidate.strategyId,
      strategyLabel: candidate.strategyLabel,
      projectRoot: options.projectRoot,
      logDir: candidatePaths.logsDir,
      taskPacket,
      ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
    });

    if (result.status !== "completed" || !result.recommendation) {
      throw new Error(`Candidate spec proposal failed for ${candidate.id}: ${result.summary}`);
    }

    const spec = candidateSpecArtifactSchema.parse({
      runId: options.manifest.id,
      candidateId: candidate.id,
      strategyId: candidate.strategyId,
      strategyLabel: candidate.strategyLabel,
      adapter: result.adapter,
      createdAt: result.completedAt,
      ...result.recommendation,
    });
    await options.store.writeJsonArtifact(candidatePaths.specPath, spec);

    const updatedCandidate = candidateManifestSchema.parse({
      ...candidate,
      specPath: candidatePaths.specPath,
    });
    await writeCandidateManifest(options.store, options.manifest.id, updatedCandidate);
    specs.push(spec);
  }

  return specs;
}

async function selectCandidateSpecs(
  options: PrepareSpecSearchOptions & {
    specs: CandidateSpecArtifact[];
  },
): Promise<SpecSearchPlan> {
  const taskPacket = await options.store.readCandidateTaskPacket(
    options.manifest.id,
    options.manifest.candidates[0]?.id ?? "",
  );
  const runPaths = options.store.getRunPaths(options.manifest.id);
  const result = await options.adapter.selectCandidateSpec({
    runId: options.manifest.id,
    projectRoot: options.projectRoot,
    logDir: runPaths.reportsDir,
    taskPacket,
    specs: options.specs,
    ...(options.consultationPlan ? { consultationPlan: options.consultationPlan } : {}),
    ...(options.manifest.profileSelection
      ? {
          consultationProfile: {
            confidence: options.manifest.profileSelection.confidence,
            validationProfileId: options.manifest.profileSelection.validationProfileId,
            validationSummary: options.manifest.profileSelection.validationSummary,
            validationSignals: options.manifest.profileSelection.validationSignals,
            validationGaps: getValidationGaps(options.manifest.profileSelection),
          },
        }
      : {}),
  });

  if (result.status !== "completed" || !result.recommendation) {
    throw new Error(`Candidate spec selection failed: ${result.summary}`);
  }

  const candidateIds = options.manifest.candidates.map((candidate) => candidate.id);
  const rankedCandidateIds = normalizeRankedCandidateIds(
    result.recommendation.rankedCandidateIds,
    candidateIds,
  );
  const hasValidationGaps =
    result.recommendation.validationGaps.length > 0 ||
    getValidationGaps(options.manifest.profileSelection).length > 0;
  const implementationLimit =
    result.recommendation.implementationVarianceRisk === "high" || hasValidationGaps ? 2 : 1;
  const implementationCandidateIds = rankedCandidateIds.slice(0, implementationLimit);
  const backupCandidateIds =
    implementationLimit === 1 ? rankedCandidateIds.slice(1, 2) : rankedCandidateIds.slice(2, 3);
  const retainedCandidateIds = new Set([...implementationCandidateIds, ...backupCandidateIds]);
  const reasonByCandidate = buildReasonMap(result.recommendation.reasons);
  const selectionArtifact = candidateSpecSelectionArtifactSchema.parse({
    ...result.recommendation,
    runId: options.manifest.id,
    adapter: result.adapter,
    createdAt: result.completedAt,
    status: "selected",
    rankedCandidateIds,
    selectedCandidateIds: implementationCandidateIds,
  });
  await options.store.writeJsonArtifact(runPaths.specSelectionPath, selectionArtifact);

  const specPathByCandidate = new Map(
    options.specs.map((spec) => [
      spec.candidateId,
      options.store.getCandidatePaths(options.manifest.id, spec.candidateId).specPath,
    ]),
  );
  const candidates = options.manifest.candidates.map((candidate) => {
    const rank = rankedCandidateIds.indexOf(candidate.id) + 1;
    const selected = implementationCandidateIds.includes(candidate.id);
    const retainedBackup = backupCandidateIds.includes(candidate.id);
    const reason =
      reasonByCandidate.get(candidate.id) ??
      (selected
        ? "Selected for implementation by spec-first search."
        : retainedBackup
          ? "Retained as backup implementation spec."
          : "Rejected during spec-first selection.");

    return candidateManifestSchema.parse({
      ...candidate,
      ...(specPathByCandidate.get(candidate.id)
        ? { specPath: specPathByCandidate.get(candidate.id) }
        : {}),
      status: retainedCandidateIds.has(candidate.id) ? candidate.status : "eliminated",
      specSelected: selected,
      specSelectionReason: rank > 0 ? `Rank ${rank}: ${reason}` : reason,
    });
  });

  await Promise.all(
    candidates.map((candidate) =>
      writeCandidateManifest(options.store, options.manifest.id, candidate),
    ),
  );

  const manifest = await writeRunManifest(options.store, {
    ...options.manifest,
    searchStrategy: "spec-first",
    candidates,
  });

  return {
    backupCandidateIds,
    implementationCandidateIds,
    manifest,
    selectionArtifact,
  };
}

async function persistPatchTournamentFallback(
  options: PrepareSpecSearchOptions,
  error: unknown,
): Promise<RunManifest> {
  const runPaths = options.store.getRunPaths(options.manifest.id);
  const candidateIds = options.manifest.candidates.map((candidate) => candidate.id);
  const summary = `Spec-first search failed; falling back to patch tournament. ${formatError(error)}`;
  const fallbackArtifact = candidateSpecSelectionArtifactSchema.parse({
    runId: options.manifest.id,
    adapter: options.adapter.name,
    createdAt: new Date().toISOString(),
    status: "fallback-to-patch-tournament",
    rankedCandidateIds: candidateIds,
    selectedCandidateIds: candidateIds,
    implementationVarianceRisk: "high",
    validationGaps: [summary],
    summary,
    reasons: candidateIds.map((candidateId, index) => ({
      candidateId,
      rank: index + 1,
      selected: true,
      reason: "Patch tournament fallback executes this candidate directly.",
    })),
  });
  await options.store.writeJsonArtifact(runPaths.specSelectionPath, fallbackArtifact);

  const candidates = options.manifest.candidates.map((candidate) =>
    candidateManifestSchema.parse({
      ...candidate,
      status: "planned",
      specSelected: undefined,
      specSelectionReason: undefined,
    }),
  );
  await Promise.all(
    candidates.map((candidate) =>
      writeCandidateManifest(options.store, options.manifest.id, candidate),
    ),
  );

  return writeRunManifest(options.store, {
    ...options.manifest,
    searchStrategy: "patch-tournament",
    candidates,
  });
}

function normalizeRankedCandidateIds(ranked: string[], allCandidateIds: string[]): string[] {
  const valid = new Set(allCandidateIds);
  const normalized: string[] = [];
  for (const candidateId of ranked) {
    if (valid.has(candidateId) && !normalized.includes(candidateId)) {
      normalized.push(candidateId);
    }
  }
  for (const candidateId of allCandidateIds) {
    if (!normalized.includes(candidateId)) {
      normalized.push(candidateId);
    }
  }
  return normalized;
}

function buildReasonMap(reasons: CandidateSpecSelectionArtifact["reasons"]): Map<string, string> {
  return new Map(reasons.map((reason) => [reason.candidateId, reason.reason]));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
