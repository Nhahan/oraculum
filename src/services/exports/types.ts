import type { ManagedTreeRules } from "../../domain/config.js";
import type { CandidateManifest, ExportPlan, RunManifest } from "../../domain/run.js";

export interface MaterializeExportOptions {
  cwd: string;
  runId?: string;
  winnerId?: string;
  branchName?: string;
  materializationLabel?: string;
  withReport: boolean;
}

export interface WorkspaceSyncSummary {
  appliedFiles: string[];
  removedFiles: string[];
}

export interface MaterializationOutcome {
  cleanup(): Promise<void>;
  partialPlan: Partial<ExportPlan>;
  rollback(): Promise<void>;
  syncSummary?: WorkspaceSyncSummary;
}

export interface ExportMaterializationContext {
  managedTreeRules: ManagedTreeRules;
  manifest: RunManifest;
  projectRoot: string;
  winner: CandidateManifest;
}
