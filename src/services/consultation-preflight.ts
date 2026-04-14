import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentAdapter } from "../adapters/types.js";
import {
  getClarifyFollowUpPath,
  getPreflightReadinessPath,
  getResearchBriefPath,
} from "../core/paths.js";
import {
  type ConsultationClarifyFollowUp,
  type ConsultationPreflight,
  consultationClarifyFollowUpSchema,
  consultationPreflightSchema,
  consultationResearchBriefSchema,
  consultationResearchPostureSchema,
} from "../domain/run.js";
import {
  deriveResearchBasisStatus,
  deriveResearchConflictHandling,
  deriveResearchSignalFingerprint,
  type MaterializedTaskPacket,
} from "../domain/task.js";

import { collectProfileRepoSignals } from "./consultation-profile.js";
import { collectP3Evidence, normalizeEvidenceScopePath } from "./p3-evidence.js";
import { type ProjectConfigLayers, writeJsonFile } from "./project.js";

interface RecommendConsultationPreflightOptions {
  adapter: AgentAdapter;
  allowRuntime?: boolean;
  configLayers: ProjectConfigLayers;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}

export interface RecommendedConsultationPreflight {
  preflight: ConsultationPreflight;
  signals: Awaited<ReturnType<typeof collectProfileRepoSignals>>;
}

interface ClarifyPressureContext {
  scopeKeyType: "target-artifact" | "task-source";
  scopeKey: string;
  repeatedCaseCount: number;
  repeatedKinds: Array<"clarify-needed" | "external-research-required">;
  recurringReasons: string[];
  priorQuestions: string[];
}

export async function recommendConsultationPreflight(
  options: RecommendConsultationPreflightOptions,
): Promise<RecommendedConsultationPreflight> {
  const signals = await collectProfileRepoSignals(options.projectRoot, {
    rules: options.configLayers.config.managedTree,
  });
  const signalSummary = signals.capabilities.map(
    (capability) => `${capability.kind}:${capability.value}`,
  );
  const signalFingerprint =
    signalSummary.length > 0 ? deriveResearchSignalFingerprint(signalSummary) : undefined;
  const researchBasisDrift =
    options.taskPacket.researchContext?.signalFingerprint && signalFingerprint
      ? signalFingerprint !== options.taskPacket.researchContext.signalFingerprint
      : options.taskPacket.researchContext?.signalFingerprint
        ? true
        : undefined;
  let llmResult: Awaited<ReturnType<AgentAdapter["recommendPreflight"]>> | undefined;
  let llmFailure: string | undefined;
  const allowRuntime = options.allowRuntime ?? true;

  if (allowRuntime) {
    try {
      llmResult = await options.adapter.recommendPreflight({
        runId: options.runId,
        projectRoot: options.projectRoot,
        logDir: options.reportsDir,
        taskPacket: options.taskPacket,
        signals,
      });
    } catch (error) {
      llmFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const preflight =
    llmResult?.status === "completed" && llmResult.recommendation
      ? llmResult.recommendation
      : buildFallbackPreflight({
          runtimeAttempted: allowRuntime,
          taskPacket: options.taskPacket,
          ...(llmFailure ? { llmFailure } : {}),
        });
  const clarifyFollowUp = isClarifyBlockedPreflight(preflight)
    ? await maybeWriteClarifyFollowUp({
        adapter: options.adapter,
        preflight,
        projectRoot: options.projectRoot,
        runId: options.runId,
        signals,
        taskPacket: options.taskPacket,
      })
    : undefined;

  const preflightPath = getPreflightReadinessPath(options.projectRoot, options.runId);
  await mkdir(dirname(preflightPath), { recursive: true });
  await writeJsonFile(preflightPath, {
    signals,
    ...(options.taskPacket.researchContext?.signalFingerprint
      ? {
          researchBasis: {
            acceptedSignalFingerprint: options.taskPacket.researchContext.signalFingerprint,
            currentSignalFingerprint: signalFingerprint,
            driftDetected: researchBasisDrift,
            status: deriveResearchBasisStatus({
              researchContext: options.taskPacket.researchContext,
              researchBasisDrift,
            }),
            refreshAction: researchBasisDrift ? "refresh-before-rerun" : "reuse",
          },
        }
      : {}),
    ...(!allowRuntime ? { llmSkipped: true } : {}),
    ...(llmFailure ? { llmFailure } : {}),
    llmResult,
    ...(clarifyFollowUp ? { clarifyFollowUp } : {}),
    recommendation:
      researchBasisDrift !== undefined ? { ...preflight, researchBasisDrift } : preflight,
  });
  if (preflight.decision === "external-research-required" && preflight.researchQuestion) {
    const researchBriefPath = getResearchBriefPath(options.projectRoot, options.runId);
    await writeJsonFile(
      researchBriefPath,
      consultationResearchBriefSchema.parse({
        decision: "external-research-required",
        question: preflight.researchQuestion,
        confidence: preflight.confidence,
        researchPosture: preflight.researchPosture,
        summary: preflight.summary,
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
        notes: signals.notes,
        signalSummary,
        ...(signalFingerprint ? { signalFingerprint } : {}),
        conflictHandling: deriveResearchConflictHandling([]),
      }),
    );
  }

  return {
    preflight: consultationPreflightSchema.parse(
      researchBasisDrift !== undefined ? { ...preflight, researchBasisDrift } : preflight,
    ),
    signals,
  };
}

function buildFallbackPreflight(options: {
  runtimeAttempted: boolean;
  taskPacket: MaterializedTaskPacket;
  llmFailure?: string;
}): ConsultationPreflight {
  const reusedResearchBrief = options.taskPacket.source.kind === "research-brief";
  const defaultFlow = reusedResearchBrief
    ? "Proceed conservatively using the persisted research brief plus repository evidence."
    : "Proceed conservatively with the default consultation flow.";
  const summary = options.runtimeAttempted
    ? options.llmFailure
      ? `Runtime preflight failed: ${options.llmFailure}. ${defaultFlow}`
      : `Runtime preflight did not return a structured recommendation. ${defaultFlow}`
    : `Runtime preflight was skipped. ${defaultFlow}`;

  return consultationPreflightSchema.parse({
    decision: "proceed",
    confidence: "low",
    summary,
    researchPosture: reusedResearchBrief
      ? consultationResearchPostureSchema.enum["repo-plus-external-docs"]
      : consultationResearchPostureSchema.enum["repo-only"],
  });
}

function isClarifyBlockedPreflight(
  preflight: ConsultationPreflight,
): preflight is ConsultationPreflight & {
  decision: "needs-clarification" | "external-research-required";
} {
  return (
    preflight.decision === "needs-clarification" ||
    preflight.decision === "external-research-required"
  );
}

async function maybeWriteClarifyFollowUp(options: {
  adapter: AgentAdapter;
  preflight: ConsultationPreflight & {
    decision: "needs-clarification" | "external-research-required";
  };
  projectRoot: string;
  runId: string;
  signals: Awaited<ReturnType<typeof collectProfileRepoSignals>>;
  taskPacket: MaterializedTaskPacket;
}): Promise<ConsultationClarifyFollowUp | undefined> {
  const pressureContext = await resolveClarifyPressureContext(
    options.projectRoot,
    options.taskPacket,
  );
  if (!pressureContext) {
    return undefined;
  }

  try {
    const result = await options.adapter.recommendClarifyFollowUp({
      runId: options.runId,
      projectRoot: options.projectRoot,
      logDir: dirname(getClarifyFollowUpPath(options.projectRoot, options.runId)),
      taskPacket: options.taskPacket,
      signals: options.signals,
      preflight: options.preflight,
      pressureContext,
    });
    if (result.status !== "completed" || !result.recommendation) {
      return undefined;
    }

    const artifact = consultationClarifyFollowUpSchema.parse({
      runId: options.runId,
      adapter: options.adapter.name,
      decision: options.preflight.decision,
      scopeKeyType: pressureContext.scopeKeyType,
      scopeKey: pressureContext.scopeKey,
      repeatedCaseCount: pressureContext.repeatedCaseCount,
      repeatedKinds: pressureContext.repeatedKinds,
      recurringReasons: pressureContext.recurringReasons,
      ...result.recommendation,
    });
    const clarifyFollowUpPath = getClarifyFollowUpPath(options.projectRoot, options.runId);
    await mkdir(dirname(clarifyFollowUpPath), { recursive: true });
    await writeJsonFile(clarifyFollowUpPath, artifact);
    return artifact;
  } catch {
    return undefined;
  }
}

async function resolveClarifyPressureContext(
  projectRoot: string,
  taskPacket: MaterializedTaskPacket,
): Promise<ClarifyPressureContext | undefined> {
  const report = await collectP3Evidence(projectRoot);
  if (!report.clarifyPressure.promotionSignal.shouldPromote) {
    return undefined;
  }

  const targetArtifactPath = taskPacket.targetArtifactPath
    ? normalizeEvidenceScopePath(projectRoot, taskPacket.targetArtifactPath)
    : undefined;
  const matchingTargetCases = targetArtifactPath
    ? report.clarifyPressure.cases.filter((item) => item.targetArtifactPath === targetArtifactPath)
    : [];
  if (targetArtifactPath && matchingTargetCases.length >= 2) {
    return buildClarifyPressureContext("target-artifact", targetArtifactPath, matchingTargetCases);
  }

  const sourcePath = normalizeEvidenceScopePath(
    projectRoot,
    taskPacket.source.originPath ?? taskPacket.source.path,
  );
  const matchingSourceCases = report.clarifyPressure.cases.filter(
    (item) => item.taskSourcePath === sourcePath,
  );
  if (matchingSourceCases.length >= 2) {
    return buildClarifyPressureContext("task-source", sourcePath, matchingSourceCases);
  }

  return undefined;
}

function buildClarifyPressureContext(
  scopeKeyType: "target-artifact" | "task-source",
  scopeKey: string,
  matchingCases: Awaited<ReturnType<typeof collectP3Evidence>>["clarifyPressure"]["cases"],
): ClarifyPressureContext {
  const repeatedKinds = Array.from(
    new Set(
      matchingCases
        .map((item) =>
          item.kind === "clarify-needed" || item.kind === "external-research-required"
            ? item.kind
            : undefined,
        )
        .filter((item): item is "clarify-needed" | "external-research-required" => Boolean(item)),
    ),
  );
  return {
    scopeKeyType,
    scopeKey,
    repeatedCaseCount: matchingCases.length,
    repeatedKinds,
    recurringReasons: Array.from(
      new Set(matchingCases.map((item) => item.question ?? item.summary).filter(Boolean)),
    ).slice(0, 5),
    priorQuestions: Array.from(
      new Set(
        matchingCases.map((item) => item.question).filter((item): item is string => Boolean(item)),
      ),
    ).slice(0, 5),
  };
}
