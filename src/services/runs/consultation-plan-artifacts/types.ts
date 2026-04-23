import type { ProjectConfig, Strategy } from "../../../domain/config.js";
import type { ConsultationProfileSelection } from "../../../domain/profile.js";
import type {
  ConsultationClarifyFollowUp,
  ConsultationPlanReview,
  PlanConsensusArtifact,
  PlanningInterviewArtifact,
  PlanningSpecArtifact,
  RunManifest,
} from "../../../domain/run.js";
import type { MaterializedTaskPacket } from "../../../domain/task.js";

export interface ConsultationPlanArtifactWriterOptions {
  projectRoot: string;
  runId: string;
  createdAt: string;
  taskPacket: MaterializedTaskPacket;
  candidateCount: number;
  strategies: Array<Pick<Strategy, "id" | "label">>;
  config: ProjectConfig;
  deliberate?: boolean;
  preflight?: RunManifest["preflight"];
  clarifyFollowUp?: ConsultationClarifyFollowUp;
  planReview?: ConsultationPlanReview;
  profileSelection?: ConsultationProfileSelection;
  planningInterview?: PlanningInterviewArtifact;
  planningSpec?: PlanningSpecArtifact;
  planConsensus?: PlanConsensusArtifact;
}
