import { type ProjectConfig, projectConfigSchema } from "../../../domain/config.js";
import type { ConsultationPlanArtifact } from "../../../domain/run.js";
import { resolveConsultationPlanCandidateCount } from "./candidate-count.js";
import { assertConsultationPlanExecutionGraphConsistency } from "./execution-graph.js";
import { resolveConsultationPlanOracles } from "./oracles.js";
import { assertConsultationPlanProfileSelectionConsistency } from "./profile-selection.js";
import { resolveConsultationPlanRounds } from "./rounds.js";
import { resolveConsultationPlanStrategies } from "./strategies.js";

export function applyConsultationPlanPreset(options: {
  baseConfig: ProjectConfig;
  consultationPlan: ConsultationPlanArtifact;
  requestedCandidateCount?: number;
}): ProjectConfig {
  const candidateCount = resolveConsultationPlanCandidateCount(
    options.consultationPlan,
    options.requestedCandidateCount,
  );
  const rounds = resolveConsultationPlanRounds(options.baseConfig, options.consultationPlan);
  const strategies = resolveConsultationPlanStrategies(
    options.baseConfig,
    options.consultationPlan,
    candidateCount,
  );
  const oracles = resolveConsultationPlanOracles(
    options.baseConfig,
    options.consultationPlan,
    rounds,
  );

  assertConsultationPlanProfileSelectionConsistency(options.consultationPlan, {
    candidateCount,
    oracleIds: oracles.map((oracle) => oracle.id),
    strategyIds: strategies.map((strategy) => strategy.id),
  });
  assertConsultationPlanExecutionGraphConsistency(options.consultationPlan, {
    availableOracleIds: options.baseConfig.oracles.map((oracle) => oracle.id),
    roundIds: rounds.map((round) => round.id),
  });

  return projectConfigSchema.parse({
    ...options.baseConfig,
    defaultCandidates: candidateCount,
    strategies,
    rounds,
    oracles,
  });
}
