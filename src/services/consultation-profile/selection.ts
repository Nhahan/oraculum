import {
  defaultProjectConfig,
  type ProjectConfig,
  projectConfigSchema,
} from "../../domain/config.js";
import type {
  AgentProfileRecommendation,
  ConsultationProfileSelection,
  ProfileRepoSignals,
} from "../../domain/profile.js";
import { consultationProfileSelectionSchema, getValidationGaps } from "../../domain/profile.js";

import type { ProjectConfigLayers } from "../project.js";

import { buildGeneratedOracles } from "./generated-oracles.js";
import {
  clampCandidateCount,
  getSupportedValidationPostureId,
  type RecommendedConsultationProfile,
  resolveStrategyIds,
} from "./shared.js";
import { buildSelectionSignalSummary } from "./signals.js";

export function applyProfileSelection(options: {
  baseConfig: ProjectConfig;
  configLayers: ProjectConfigLayers;
  recommendation: AgentProfileRecommendation;
  signals: ProfileRepoSignals;
  source: ConsultationProfileSelection["source"];
}): RecommendedConsultationProfile {
  const strategyIds = resolveStrategyIds(options.baseConfig, options.recommendation.strategyIds);
  const generatedOracles = buildGeneratedOracles(
    options.recommendation.selectedCommandIds,
    options.signals.commandCatalog,
  );

  const explicitCandidateCount =
    options.configLayers.quick.defaultCandidates !== undefined &&
    options.configLayers.quick.defaultCandidates !== defaultProjectConfig.defaultCandidates;
  const explicitStrategies = options.configLayers.advanced?.strategies !== undefined;
  const explicitOracles = options.configLayers.advanced?.oracles !== undefined;

  const effectiveCandidateCount = explicitCandidateCount
    ? options.baseConfig.defaultCandidates
    : clampCandidateCount(options.recommendation.candidateCount);
  const effectiveStrategies = explicitStrategies
    ? options.baseConfig.strategies
    : options.baseConfig.strategies.filter((strategy) => strategyIds.includes(strategy.id));
  const effectiveOracles = explicitOracles ? options.baseConfig.oracles : generatedOracles;

  const config = projectConfigSchema.parse({
    ...options.baseConfig,
    defaultCandidates: effectiveCandidateCount,
    strategies: effectiveStrategies,
    oracles: effectiveOracles,
  });
  const validationSignals = buildSelectionSignalSummary(options.signals);
  const validationProfileId = getSupportedValidationPostureId(options.recommendation);
  const validationSummary = options.recommendation.validationSummary;
  const validationGaps = explicitOracles ? [] : getValidationGaps(options.recommendation);

  return {
    config,
    selection: consultationProfileSelectionSchema.parse({
      validationProfileId,
      confidence: options.recommendation.confidence,
      source: options.source,
      validationSummary,
      candidateCount: effectiveCandidateCount,
      strategyIds: effectiveStrategies.map((strategy) => strategy.id),
      oracleIds: effectiveOracles.map((oracle) => oracle.id),
      validationGaps,
      validationSignals,
    }),
  };
}
