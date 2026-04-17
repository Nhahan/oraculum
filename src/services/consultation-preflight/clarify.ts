import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentAdapter } from "../../adapters/types.js";
import { getClarifyFollowUpPath } from "../../core/paths.js";
import {
  type ConsultationClarifyFollowUp,
  consultationClarifyFollowUpSchema,
} from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";

import { normalizeConsultationScopePath } from "../consultation-artifacts.js";
import { collectPressureEvidence } from "../pressure-evidence.js";
import { writeJsonFile } from "../project.js";

import type { ClarifyBlockedPreflight, ClarifyPressureContext, ProfileSignals } from "./types.js";

export async function maybeWriteClarifyFollowUp(options: {
  adapter: AgentAdapter;
  preflight: ClarifyBlockedPreflight;
  projectRoot: string;
  runId: string;
  signals: ProfileSignals;
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
  const report = await collectPressureEvidence(projectRoot);
  if (!report.clarifyPressure.promotionSignal.shouldPromote) {
    return undefined;
  }

  const targetArtifactPath = taskPacket.targetArtifactPath
    ? normalizeConsultationScopePath(projectRoot, taskPacket.targetArtifactPath)
    : undefined;
  const matchingTargetCases = targetArtifactPath
    ? report.clarifyPressure.cases.filter((item) => item.targetArtifactPath === targetArtifactPath)
    : [];
  if (targetArtifactPath && matchingTargetCases.length >= 2) {
    return buildClarifyPressureContext("target-artifact", targetArtifactPath, matchingTargetCases);
  }

  const sourcePath = normalizeConsultationScopePath(
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
  matchingCases: Awaited<ReturnType<typeof collectPressureEvidence>>["clarifyPressure"]["cases"],
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
