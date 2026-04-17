import type { AgentAdapter } from "../../adapters/types.js";
import type { ConsultationClarifyFollowUp, ConsultationPreflight } from "../../domain/run.js";
import type { MaterializedTaskPacket } from "../../domain/task.js";
import type { collectProfileRepoSignals } from "../consultation-profile.js";
import type { ProjectConfigLayers } from "../project.js";

export type ProfileSignals = Awaited<ReturnType<typeof collectProfileRepoSignals>>;
export type PreflightRuntimeResult = Awaited<ReturnType<AgentAdapter["recommendPreflight"]>>;

export interface RecommendConsultationPreflightOptions {
  adapter: AgentAdapter;
  allowRuntime?: boolean;
  configLayers: ProjectConfigLayers;
  projectRoot: string;
  reportsDir: string;
  runId: string;
  taskPacket: MaterializedTaskPacket;
}

export interface RecommendedConsultationPreflight {
  clarifyFollowUp?: ConsultationClarifyFollowUp;
  preflight: ConsultationPreflight;
  signals: ProfileSignals;
}

export interface PreflightSignalContext {
  researchBasisDrift?: boolean;
  signalFingerprint?: string;
  signalSummary: string[];
  signals: ProfileSignals;
}

export type ClarifyBlockedPreflight = ConsultationPreflight & {
  decision: "needs-clarification" | "external-research-required";
};

export interface ClarifyPressureContext {
  scopeKeyType: "target-artifact" | "task-source";
  scopeKey: string;
  repeatedCaseCount: number;
  repeatedKinds: Array<"clarify-needed" | "external-research-required">;
  recurringReasons: string[];
  priorQuestions: string[];
}
