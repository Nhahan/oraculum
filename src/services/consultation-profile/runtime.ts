import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentAdapter } from "../../adapters/types.js";
import { getProfileSelectionPath } from "../../core/paths.js";
import type { ProjectConfig } from "../../domain/config.js";
import {
  type AgentProfileRecommendation,
  type ConsultationProfileId,
  isSupportedConsultationProfileId,
  type ProfileRepoSignals,
  toCanonicalAgentProfileRecommendation,
  toCanonicalConsultationProfileSelection,
} from "../../domain/profile.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";
import { type ProjectConfigLayers, writeJsonFile } from "../project.js";
import { buildFallbackRecommendation, sanitizeRecommendation } from "./fallback.js";
import { applyProfileSelection } from "./selection.js";
import { type RecommendedConsultationProfile, VALIDATION_POSTURE_DESCRIPTIONS } from "./shared.js";
import { collectProfileRepoSignals } from "./signals.js";

interface RecommendConsultationProfileOptions {
  adapter: AgentAdapter;
  allowRuntime?: boolean;
  baseConfig: ProjectConfig;
  configLayers: ProjectConfigLayers;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  signals?: ProfileRepoSignals;
  taskPacket: MaterializedTaskPacket;
}

export type { RecommendedConsultationProfile } from "./shared.js";
export { collectProfileRepoSignals } from "./signals.js";

export async function recommendConsultationProfile(
  options: RecommendConsultationProfileOptions,
): Promise<RecommendedConsultationProfile> {
  const signals =
    options.signals ??
    (await collectProfileRepoSignals(options.projectRoot, {
      rules: options.baseConfig.managedTree,
    }));
  const fallback = buildFallbackRecommendation(signals, options.taskPacket);
  let llmResult: Awaited<ReturnType<AgentAdapter["recommendProfile"]>> | undefined;
  let llmFailure: string | undefined;
  const allowRuntime = options.allowRuntime ?? true;
  if (allowRuntime) {
    try {
      llmResult = await options.adapter.recommendProfile({
        runId: options.runId,
        projectRoot: options.projectRoot,
        logDir: options.reportsDir,
        taskPacket: options.taskPacket,
        signals,
        validationPostureOptions: (
          Object.entries(VALIDATION_POSTURE_DESCRIPTIONS) as Array<[ConsultationProfileId, string]>
        ).map(([id, description]) => ({ id, description })),
      });
    } catch (error) {
      llmFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const recommendation =
    llmResult?.status === "completed" && llmResult.recommendation
      ? sanitizeRecommendation(llmResult.recommendation, signals, fallback)
      : fallback;
  const usedRuntimeRecommendation =
    llmResult?.status === "completed" &&
    llmResult.recommendation &&
    isSupportedConsultationProfileId(validationProfileIdOf(llmResult.recommendation) ?? "");
  const source = usedRuntimeRecommendation ? "llm-recommendation" : "fallback-detection";

  const applied = applyProfileSelection({
    baseConfig: options.baseConfig,
    configLayers: options.configLayers,
    recommendation,
    signals,
    source,
  });

  const profileSelectionPath = getProfileSelectionPath(options.projectRoot, options.runId);
  await mkdir(dirname(profileSelectionPath), { recursive: true });
  const persistedRecommendation = toCanonicalAgentProfileRecommendation(recommendation);
  const persistedAppliedSelection = toCanonicalConsultationProfileSelection(applied.selection);
  const persistedLlmResult =
    llmResult?.status === "completed" && llmResult.recommendation
      ? {
          ...llmResult,
          recommendation: toCanonicalAgentProfileRecommendation(llmResult.recommendation),
        }
      : llmResult;
  await writeJsonFile(profileSelectionPath, {
    runId: options.runId,
    signals,
    ...(!allowRuntime ? { llmSkipped: true } : {}),
    ...(llmFailure ? { llmFailure } : {}),
    ...(persistedLlmResult ? { llmResult: persistedLlmResult } : {}),
    recommendation: persistedRecommendation,
    appliedSelection: persistedAppliedSelection,
  });

  return applied;
}

function validationProfileIdOf(
  recommendation: Pick<AgentProfileRecommendation, "validationProfileId">,
): string | undefined {
  return recommendation.validationProfileId;
}
