import type { ProjectConfig } from "../../domain/config.js";
import type {
  AgentProfileRecommendation,
  ConsultationProfileId,
  ConsultationProfileSelection,
  ProfileCommandCandidate,
  ProfileStrategyId,
} from "../../domain/profile.js";
import { getValidationProfileId, isSupportedConsultationProfileId } from "../../domain/profile.js";

export interface RecommendedConsultationProfile {
  config: ProjectConfig;
  selection: ConsultationProfileSelection;
}

export interface ProfileCommandSlot {
  capability: string;
  roundId: ProfileCommandCandidate["roundId"];
}

export const VALIDATION_POSTURE_DESCRIPTIONS: Record<ConsultationProfileId, string> = {
  generic:
    "Conservative default validation posture when repository evidence is weak or posture-specific checks are not safely grounded.",
  library:
    "Package/export-oriented validation posture. Favor lint/typecheck, deep tests, and packaging checks only when repository evidence supports them.",
  frontend:
    "Build and e2e oriented validation posture. Favor build and visual/e2e checks only when command-grounded repository evidence supports them.",
  migration:
    "Schema and migration validation posture. Favor schema, dry-run, rollback, and drift checks only when command-grounded repository evidence supports them.",
};

export function getSupportedValidationPostureId(
  recommendation: Pick<AgentProfileRecommendation, "profileId" | "validationProfileId">,
): ConsultationProfileId {
  const validationProfileId = getValidationProfileId(recommendation);
  if (!validationProfileId || !isSupportedConsultationProfileId(validationProfileId)) {
    throw new Error("Consultation profile recommendation requires a supported validation posture.");
  }
  return validationProfileId;
}

export function clampCandidateCount(value: number): number {
  return Math.max(1, Math.min(16, Math.trunc(value)));
}

export function resolveStrategyIds(baseConfig: ProjectConfig, requested: string[]): string[] {
  const available = new Set(baseConfig.strategies.map((strategy) => strategy.id));
  const filtered = requested.filter((id) => available.has(id));
  return filtered.length > 0 ? filtered : baseConfig.strategies.map((strategy) => strategy.id);
}

export function commandSlotKey(slot: {
  capability?: string | undefined;
  roundId: ProfileCommandCandidate["roundId"];
}): string {
  return `${slot.roundId}:${slot.capability ?? "unknown"}`;
}

export function commandExecutionKey(candidate: ProfileCommandCandidate): string {
  return (
    candidate.dedupeKey ??
    JSON.stringify([
      candidate.command,
      candidate.args,
      candidate.relativeCwd ?? "",
      candidate.pathPolicy ?? "local-only",
    ])
  );
}

export type FallbackDetectedProfileId = "generic";

export const FALLBACK_STRATEGY_IDS: ProfileStrategyId[] = ["minimal-change", "safety-first"];
