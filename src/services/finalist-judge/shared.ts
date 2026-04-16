import type { AgentAdapter, AgentJudgeResult, AgentRunResult } from "../../adapters/types.js";
import type { ManagedTreeRules, SecondOpinionJudgeConfig } from "../../domain/config.js";
import type { OracleVerdict } from "../../domain/oracle.js";
import type { ConsultationProfileSelection } from "../../domain/profile.js";
import type {
  CandidateManifest,
  ConsultationPlanArtifact,
  RunRecommendation,
} from "../../domain/run.js";

export interface RecommendWinnerOptions {
  adapter: AgentAdapter;
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  consultationPlan?: ConsultationPlanArtifact;
  projectRoot: string;
  runId: string;
  taskPacket: unknown;
  managedTreeRules?: ManagedTreeRules;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
  consultationProfile?: ConsultationProfileSelection;
}

export interface WinnerJudgeOutcome {
  fallbackAllowed: boolean;
  judgeResult?: AgentJudgeResult;
  recommendation?: RunRecommendation;
}

export interface RecommendSecondOpinionOptions {
  adapter: AgentAdapter;
  candidateResults: AgentRunResult[];
  candidates: CandidateManifest[];
  consultationPlan?: ConsultationPlanArtifact;
  consultationProfile?: ConsultationProfileSelection;
  managedTreeRules?: ManagedTreeRules;
  primaryJudgeResult?: AgentJudgeResult;
  primaryRecommendation?: RunRecommendation;
  projectRoot: string;
  runId: string;
  secondOpinion: SecondOpinionJudgeConfig;
  taskPacket: unknown;
  verdictsByCandidate: Map<string, OracleVerdict[]>;
}
