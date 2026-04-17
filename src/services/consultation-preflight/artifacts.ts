import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { getPreflightReadinessPath, getResearchBriefPath } from "../../core/paths.js";
import {
  type ConsultationClarifyFollowUp,
  type ConsultationPreflight,
  consultationPreflightReadinessArtifactSchema,
  consultationPreflightSchema,
  consultationResearchBriefSchema,
} from "../../domain/run.js";
import {
  deriveResearchBasisStatus,
  deriveResearchConflictHandling,
  type MaterializedTaskPacket,
} from "../../domain/task.js";
import { writeJsonFile } from "../project.js";

import type { PreflightRuntimeResult, PreflightSignalContext } from "./types.js";

export async function writePreflightArtifacts(options: {
  allowRuntime: boolean;
  clarifyFollowUp?: ConsultationClarifyFollowUp;
  llmFailure?: string;
  llmResult?: PreflightRuntimeResult;
  preflight: ConsultationPreflight;
  projectRoot: string;
  runId: string;
  signalContext: PreflightSignalContext;
  taskPacket: MaterializedTaskPacket;
}): Promise<ConsultationPreflight> {
  const recommendedPreflight = withResearchBasisDrift(
    options.preflight,
    options.signalContext.researchBasisDrift,
  );
  const preflightPath = getPreflightReadinessPath(options.projectRoot, options.runId);
  await mkdir(dirname(preflightPath), { recursive: true });
  await writeJsonFile(
    preflightPath,
    consultationPreflightReadinessArtifactSchema.parse({
      runId: options.runId,
      signals: options.signalContext.signals,
      ...buildResearchBasisArtifact(options.taskPacket, options.signalContext),
      ...(!options.allowRuntime ? { llmSkipped: true } : {}),
      ...(options.llmFailure ? { llmFailure: options.llmFailure } : {}),
      ...(options.llmResult ? { llmResult: options.llmResult } : {}),
      ...(options.clarifyFollowUp ? { clarifyFollowUp: options.clarifyFollowUp } : {}),
      recommendation: recommendedPreflight,
    }),
  );

  await maybeWriteResearchBrief({
    preflight: options.preflight,
    projectRoot: options.projectRoot,
    runId: options.runId,
    signalContext: options.signalContext,
    taskPacket: options.taskPacket,
  });

  return recommendedPreflight;
}

function withResearchBasisDrift(
  preflight: ConsultationPreflight,
  researchBasisDrift: boolean | undefined,
): ConsultationPreflight {
  return consultationPreflightSchema.parse(
    researchBasisDrift !== undefined ? { ...preflight, researchBasisDrift } : preflight,
  );
}

function buildResearchBasisArtifact(
  taskPacket: MaterializedTaskPacket,
  signalContext: PreflightSignalContext,
): {
  researchBasis?: {
    acceptedSignalFingerprint: string;
    currentSignalFingerprint?: string;
    driftDetected?: boolean;
    refreshAction: "refresh-before-rerun" | "reuse";
    status: ReturnType<typeof deriveResearchBasisStatus>;
  };
} {
  if (!taskPacket.researchContext?.signalFingerprint) {
    return {};
  }

  return {
    researchBasis: {
      acceptedSignalFingerprint: taskPacket.researchContext.signalFingerprint,
      ...(signalContext.signalFingerprint
        ? { currentSignalFingerprint: signalContext.signalFingerprint }
        : {}),
      ...(signalContext.researchBasisDrift !== undefined
        ? { driftDetected: signalContext.researchBasisDrift }
        : {}),
      status: deriveResearchBasisStatus({
        researchContext: taskPacket.researchContext,
        researchBasisDrift: signalContext.researchBasisDrift,
      }),
      refreshAction: signalContext.researchBasisDrift ? "refresh-before-rerun" : "reuse",
    },
  };
}

async function maybeWriteResearchBrief(options: {
  preflight: ConsultationPreflight;
  projectRoot: string;
  runId: string;
  signalContext: PreflightSignalContext;
  taskPacket: MaterializedTaskPacket;
}): Promise<void> {
  if (
    options.preflight.decision !== "external-research-required" ||
    !options.preflight.researchQuestion
  ) {
    return;
  }

  const researchBriefPath = getResearchBriefPath(options.projectRoot, options.runId);
  await writeJsonFile(
    researchBriefPath,
    consultationResearchBriefSchema.parse({
      runId: options.runId,
      decision: "external-research-required",
      question: options.preflight.researchQuestion,
      confidence: options.preflight.confidence,
      researchPosture: options.preflight.researchPosture,
      summary: options.preflight.summary,
      task: {
        id: options.taskPacket.id,
        title: options.taskPacket.title,
        sourceKind: options.taskPacket.source.originKind ?? options.taskPacket.source.kind,
        sourcePath: options.taskPacket.source.originPath ?? options.taskPacket.source.path,
        ...(options.taskPacket.artifactKind
          ? { artifactKind: options.taskPacket.artifactKind }
          : {}),
        ...(options.taskPacket.targetArtifactPath
          ? { targetArtifactPath: options.taskPacket.targetArtifactPath }
          : {}),
      },
      notes: options.signalContext.signals.notes,
      signalSummary: options.signalContext.signalSummary,
      ...(options.signalContext.signalFingerprint
        ? { signalFingerprint: options.signalContext.signalFingerprint }
        : {}),
      conflictHandling: deriveResearchConflictHandling([]),
    }),
  );
}
