import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentAdapter } from "../adapters/types.js";
import { getPreflightReadinessPath, getResearchBriefPath } from "../core/paths.js";
import {
  type ConsultationPreflight,
  consultationPreflightSchema,
  consultationResearchBriefSchema,
  consultationResearchPostureSchema,
} from "../domain/run.js";
import type { MaterializedTaskPacket } from "../domain/task.js";

import { collectProfileRepoSignals } from "./consultation-profile.js";
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

export async function recommendConsultationPreflight(
  options: RecommendConsultationPreflightOptions,
): Promise<RecommendedConsultationPreflight> {
  const signals = await collectProfileRepoSignals(options.projectRoot, {
    rules: options.configLayers.config.managedTree,
  });
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

  const preflightPath = getPreflightReadinessPath(options.projectRoot, options.runId);
  await mkdir(dirname(preflightPath), { recursive: true });
  await writeJsonFile(preflightPath, {
    signals,
    ...(!allowRuntime ? { llmSkipped: true } : {}),
    ...(llmFailure ? { llmFailure } : {}),
    llmResult,
    recommendation: preflight,
  });
  if (preflight.decision === "external-research-required" && preflight.researchQuestion) {
    const researchBriefPath = getResearchBriefPath(options.projectRoot, options.runId);
    await writeJsonFile(
      researchBriefPath,
      consultationResearchBriefSchema.parse({
        decision: "external-research-required",
        question: preflight.researchQuestion,
        researchPosture: preflight.researchPosture,
        summary: preflight.summary,
        task: {
          id: options.taskPacket.id,
          title: options.taskPacket.title,
          sourceKind: options.taskPacket.source.kind,
          sourcePath: options.taskPacket.source.path,
        },
        notes: signals.notes,
        signalSummary: signals.capabilities.map(
          (capability) => `${capability.kind}:${capability.value}`,
        ),
      }),
    );
  }

  return {
    preflight: consultationPreflightSchema.parse(preflight),
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
